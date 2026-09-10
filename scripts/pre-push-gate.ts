#!/usr/bin/env node
/**
 * pre-push-gate.ts — 本地质量门禁核心（.githooks/pre-push 的调度器）。
 *
 * 设计目标：CI 红之前，本地先红。按变更域（Go / 前端 / 数据 / 文档）只跑相关检查；
 * gofmt 修复下沉 pre-commit（提交时自动 -w 修复 + stage）；pre-push 对未格式化只读检出即阻断
 * （防 --no-verify 绕过 pre-commit 的自动修复）；
 * 需人工的（构建失败、断链、契约失败、红线扫描不可用）同样阻断推送。
 * 分层哲学（2026-08-13）：硬错误（编译/测试/契约/链接）阻断推送；基线债务
 * （红线新增、死代码等"没有报错"的治理欠账）只报告不阻断——推送后修，发布前全量 doctor 兜底。
 * 例外：红线扫描本身不可用（rg 缺失/fail-closed）必须阻断，扫描没跑成不等于债务。
 *
 * 用法（由 .githooks/pre-push 调用）：
 *   node scripts/pre-push-gate.ts <remote-name> <remote-url>
 *     标准输入：每行 `<local ref> <local oid> <remote ref> <remote oid>`
 *   node scripts/pre-push-gate.ts --dry-run <remote-name> <remote-url>
 *     只检查不修改（gofmt 只读检出、不自动修复），供调试与 CI 复用
 *   node scripts/pre-push-gate.ts --all [--dry-run]
 *     全量模式（等价 doctor 默认全量，无 stdin）：Go/前端/数据/文档/红线/契约 + 静态工具
 *   node scripts/pre-push-gate.ts --docs [--dry-run]
 *     文档模式（等价 doctor --docs）：仅文档/ADR/索引/静态文档工具
 *
 * 已知坑（2026-08-03 确认，2026-08-07 更新，2026-08-12 增补）：
 *   - link-checker.ts / type-consistency.ts 正常路径退出码恒 0，
 *     必须用 --json 解析 _summary 判定，不得依赖退出码；
 *     type-consistency 数据损坏/缺失的 fatal 路径现在 exit 1（+哨兵 _summary.issues=9999，code_review P3）。
 *   - Windows 下 npx 是 npx.cmd，node spawn 需 shell:true。
 *   - 严禁在 pre-push 内 commit --amend：git push 在调用钩子前已快照要推送的 oid，
 *     钩子里 amend 只是改本地 HEAD，推送的仍是旧 oid → 本地与远端分叉、二次 push 必被拒
 *     （2026-08-12 实测：gofmt amend 3291cb16 假成功，实际推送 b644e96b）。
 *     gofmt 修复因此下沉 pre-commit，此处只读校验。
 * 设计意图：pre-push-gate 工具脚本（doctor --gate/--all/--docs 的单一实现源头，2026-08-14 合并）
 * 依赖：node:child_process / node:fs / node:path / node:url
 *
 * 退出码：0 = 门禁通过（放行推送）；1 = 门禁失败（阻断推送）；2 = 用法错误。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runContractTestsParallel, selectContractTests } from "./_lib/contract-tests.ts";
import {
  domainSummaryText,
  groupByDomain,
  type Plan,
  planFromFiles,
} from "./_lib/domain-classify.ts";
import {
  ALL_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
} from "./_lib/gate-config.ts";
import { parseToolOutput, tryParseJson, tryParseSummary } from "./_lib/gate-parse.ts";
import { formatFailSummary, writeGateReport } from "./_lib/gate-report.ts";
import { resolveBaseRev, resolveChanges } from "./_lib/gate-resolve.ts";
import { logPush } from "./_lib/log-push.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { run as procRun, shq } from "./_lib/proc.ts";
import { ROOT } from "./_lib/scan-files.ts";

const B = { OK: "[OK]", FAIL: "[FAIL]", FIX: "[FIX]", SKIP: "[SKIP]" };
const TIMEOUT = 300_000;
/** 远端领先提示（SKIP 与 FAIL 共用，避免重复长文案） */
const PULL_HINT = "提示: git 报 rejected/non-fast-forward 时先 git pull 整合远端再重推。";

/* ---------------- 工具 ---------------- */

function sh(cmd: string, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  /** shell 执行命令（win32 兼容 .cmd），返回 { rc, out }。
   * 统一委托 _lib/proc.ts（超时/错误分类契约；shell:true 时 win32 走 cmd.exe、
   * POSIX 走 /bin/sh，承载管道/重定向命令）。
   * out 回退 err：ENOENT/超时诊断在 r.err，空 out 时保留原因（P3 复核）。 */
  const r = procRun(cmd, [], { cwd, timeout, shell: true });
  return { rc: r.rc, out: r.out || r.err || "" };
}

/**
 * 异步版 sh——用 spawn 包装 Promise，供 Promise.all 并行执行。
 * 仅用于 npm 三件套并行（vite build / tsc --noEmit），不替代同步 sh。
 */
function shAsync(cmd: string, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  return new Promise<{ rc: number | null; out: string }>((resolve) => {
    const child = spawn(cmd, [], { cwd, shell: true, timeout, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
    });
    child.stderr.on("data", (d) => {
      buf += d.toString();
    });
    child.on("close", (code) => resolve({ rc: code, out: buf }));
    child.on("error", (err) => resolve({ rc: -1, out: err.message }));
  });
}

function git(args: string[], { cwd = ROOT } = {}) {
  // core.quotepath=false：非 ASCII 文件名输出原始 UTF-8，避免引号/八进制转义破坏域匹配。
  // 数组参数直走 procRun（无 shell 拼接）：git ref 允许 $/`/;/| 等元字符，
  // 拼字符串后交给 sh() 经 shell 执行会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）。
  const r = procRun("git", ["-c", "core.quotepath=false", ...args], { cwd });
  return { rc: r.ok ? 0 : r.rc, out: r.out || "" };
}

/* ---------------- 变更域分析 ---------------- */
// resolveChanges 已收敛至 _lib/gate-resolve.ts（ADR-206 阶段 1 迁址，2026-09-08）：
// 与 resolveBaseRev 同源单一事实源，本模块经 import 使用（原私有副本删除，
// 终结双副本各自漂移——code_review P2：副本曾与 _lib 版 fallback 链实现分叉）。

/**
 * 基线 rev 解析已收敛至 _lib/gate-resolve.ts（2026-09-08 锐评 R4）：
 * fallbackBranchRevs 单一事实源 + resolveBaseRev，供本解析链与 golangci-lint 复用。
 * 从本模块 import（纯模块无顶层 main 副作用，契约测试可安全直达）。
 * 口径：远端 oid → merge-base origin/<branch> → origin/HEAD → origin/main → origin/master。
 */

/* ---------------- 检查执行 ---------------- */

/* ---------------- gofmt 只读校验 ---------------- */

function gofmtCheck(goFiles: string[]) {
  /** gofmt -l 只读检出未格式化文件（不修改）。修复由 pre-commit 提交时自动完成；
   * 此处若仍检出，说明提交绕过了 pre-commit（--no-verify 等），阻断并提示手动修复。 */
  return sh(`gofmt -l ${goFiles.map(shq).join(" ")}`)
    .out.trim()
    .split("\n")
    .filter((f) => f.endsWith(".go"));
}

/* ---------------- 静态分析工具清单（--all / --docs 模式，doctor 全量迁入） ---------------- */
// 工具清单单一事实来源 = _lib/gate-config.ts；gate 本身只负责调度，不改清单逻辑。

/* ---------------- 主流程 ---------------- */

function parseStdin() {
  try {
    return fs.readFileSync(0, "utf-8").trim();
  } catch {
    return "";
  }
}

async function main() {
  // 统一参数解析（位置参数收集在 _：git 钩子 <remote-name> <remote-url>、--gate 的 ref）
  const args = parseArgs(process.argv.slice(2), {
    bools: ["dry-run", "no-banner", "all", "docs", "json"],
    strings: ["files"],
  });
  if (args.unknown.length) console.warn(`[pre-push-gate] 忽略未知参数: ${args.unknown.join(", ")}`);
  const dryRun = args["dry-run"] as boolean;
  const noBanner = args["no-banner"] as boolean;
  const allMode = args.all as boolean;
  const docsMode = args.docs as boolean;
  const filesRaw = (args.files as string) ?? "";
  const filesMode = filesRaw.length > 0;

  console.log("========== YSM 本地质量门禁 ==========");

  // 统一结果收集与阻断标记
  const results: any[] = [];
  let blocked = false;
  /**
   * 记录检查结果。ok=false 时按 blockPolicy 决定是否阻断：
   *   hard（默认）     → blocked=true
   *   debt             → 只记录，不阻断
   *   failClosed       → 只记录，不阻断（调用方须在 record() 外自行判断 fail-closed 场景）
   * raw：工具原始输出（2026-09 锐评「输出运行过程而非返回信息」）——FAIL 摘要的
   * 结构化前 ≤4 条错误提取（gate-report errorDetailLines）与落盘报告的事实源；cap 64KB 尾部
   * 防超大输出（go test/vite）撑爆报告，JSON 检查输出远小于此不受影响。
   */
  const record = (
    label: string,
    ok: boolean,
    {
      time = 0,
      note = "",
      tail = "",
      raw,
      blockPolicy,
    }: {
      time?: number;
      note?: string;
      tail?: string;
      raw?: string;
      blockPolicy?: "hard" | "debt" | "failClosed";
    },
  ) => {
    const rawCapped =
      raw === undefined ? undefined : raw.length > 65536 ? `…${raw.slice(-65536)}` : raw;
    results.push({ label, ok, time, note, tail, raw: rawCapped });
    if (!ok && blockPolicy !== "debt" && blockPolicy !== "failClosed") blocked = true;
  };

  let plan: Plan;
  let domainSummary = "";
  let byDomain: Record<string, string[]> = {};
  let files: string[] = []; // 本次变更文件集（--files / push 模式填充；--all / --docs 保持为空）
  // 推送上下文：Go 域 golangci-lint 需 local/remote oid 解析 --new-from-rev 基线（ADR-205）；
  // 定义在 main 顶层是因为 pushed/ref 只存在于「推送门禁模式」分支块内，Go 域在其外。
  // --all / --docs / --files 模式保持空串 → resolveBaseRev 走 merge-base fallback 链。
  let pushLocalRef = "";
  let pushLocalOid = "";
  let pushRemoteOid = "";

  if (allMode) {
    // —— 全量模式：所有域 + 静态工具（等价 doctor 默认全量）——
    plan = {
      go: true,
      frontend: true,
      data: true,
      docs: true,
      adr: true,
      contractTests: true,
      redlines: true,
    };
    domainSummary = "all";
    console.log("模式: 全量检查（--all）");
    console.log("");
  } else if (docsMode) {
    // —— 文档模式：轻量（等价 doctor --docs）——
    plan = {
      go: false,
      frontend: false,
      data: false,
      docs: true,
      adr: true,
      contractTests: false,
      redlines: false,
    };
    domainSummary = "docs";
    console.log("模式: 文档检查（--docs）");
    console.log("");
  } else if (filesMode) {
    // —— 文件驱动模式（commit-with-check 调用）：按 staged files 真按域裁剪 ——
    files = filesRaw ? filesRaw.split("\n").filter(Boolean) : [];
    if (!files.length) {
      console.log('用法: node scripts/pre-push-gate.ts --files "<file1>\\n<file2>..." [--dry-run]');
      return 2;
    }
    plan = planFromFiles(files);
    byDomain = groupByDomain(files);
    domainSummary = domainSummaryText(byDomain);
    console.log(`模式: 文件驱动（--files，${files.length} 个文件）`);
    console.log(`变更域: ${domainSummary}`);
    console.log("");
  } else {
    // —— 推送门禁模式（默认）：stdin 驱动 ——
    const remoteName = args._[0] as string | undefined;
    const remoteUrl = args._[1] as string | undefined;

    if (!remoteName) {
      console.log("用法: node scripts/pre-push-gate.ts [--dry-run] <remote-name> <remote-url>");
      console.log("      node scripts/pre-push-gate.ts --all [--dry-run]");
      console.log("      node scripts/pre-push-gate.ts --docs [--dry-run]");
      console.log("      stdin: <local ref> <local oid> <remote ref> <remote oid>");
      return 2;
    }

    const lines = parseStdin().split("\n").filter(Boolean);
    if (!lines.length) {
      console.log(`${B.SKIP} 无可推送 ref（空 stdin），跳过`);
      console.log(`${B.SKIP} ${PULL_HINT}`);
      return 0;
    }

    // 多 ref 推送（git push origin a b）逐行分析，按文件集并集计算变更域；
    // delete 行（local oid 全零）跳过。全零 localOid = 删除远端 ref，无本地文件可查。
    const fileSet = new Set<string>();
    const pushed: { localRef: string; localOid: string; remoteOid: string }[] = [];
    for (const line of lines) {
      const [localRef, localOid, , remoteOid] = line.trim().split(/\s+/) as [
        string,
        string,
        string,
        string,
      ];
      if (!localOid || /^0+$/.test(localOid)) continue; // delete ref，跳过
      const refFiles = resolveChanges(localRef, localOid, remoteOid);
      if (refFiles === null) {
        console.log(
          `${B.FAIL} 变更集解析失败（git diff/show 均不可用），拒绝空跑放行 — 请检查本地 git 状态后重推`,
        );
        console.log(PULL_HINT);
        return 1;
      }
      for (const f of refFiles) fileSet.add(f);
      pushed.push({ localRef, localOid, remoteOid });
    }
    if (!pushed.length) {
      console.log(`${B.SKIP} 无有效推送 ref（均为删除/空 oid），跳过`);
      return 0;
    }
    files = [...fileSet];
    plan = planFromFiles(files);
    byDomain = groupByDomain(files);

    const { localRef, localOid } = pushed[0]!;
    // 提升到外层供 Go 域 golangci-lint 复用（ADR-205 基线解析）
    pushLocalRef = localRef;
    pushLocalOid = localOid;
    pushRemoteOid = pushed[0]!.remoteOid;
    const multiRef = pushed.length > 1;
    console.log(
      `推送: ${multiRef ? `${pushed.length} 个 ref` : localRef} ${multiRef ? "" : `${localOid.slice(0, 7)} `}→ ${remoteName} (${remoteUrl || "?"})`,
    );
    domainSummary = domainSummaryText(byDomain);
    console.log(`变更域: ${domainSummary}`);
    console.log("");
  }

  /* --- 静态工具统一执行器 --- */
  // 回退 ADR-088 静态工具并行（实测 2m15s vs 基线 75s，runSpawn spawn 开销吃掉并行收益）
  // 恢复串行 runTools——域间并行（Go ∥ 前端）留作后续 Take巧，静态工具段不并行
  const runTools = (tools: any[]) => {
    for (const entry of tools) {
      const tool = entry.tool;
      const extraArgs = entry.args || [];
      // 解法 C：gen-*.ts 自动继承 autoFix=true（命名约定驱动）
      // 显式声明 autoFix 优先；否则按 tool.startsWith('gen-') 判定
      const effectiveAutoFix = entry.autoFix ?? tool.startsWith("gen-");
      // 文件驱动模式（commit-with-check 等）下，check-go-diff-coverage 必须按
      // --staged 只查本次暂存区——否则回退 base=origin/main 全库 diff，把
      // origin/main 之后所有未推送改动（含并行会话提交）误算进本次覆盖门禁，
      // 纯签名重构会被误报 0% 阻断（ADR-145 实践实证）。push 模式 files 为空，
      // 不加 --staged，保持全库比对（推送时本就该查全部待推改动）。
      const stagedArg = files.length > 0 && tool === "check-go-diff-coverage.ts" ? "--staged" : "";
      const t0 = Date.now();
      const r = sh(`node scripts/${tool} --json ${stagedArg} ${extraArgs.join(" ")}`);
      // P1 修复（2026-08-17）：审计类工具退出码不可靠（i18n/孤儿/命名/卫生默认恒 0），
      // 必须解析 --json 的 _summary 判定——与文件头「不得依赖退出码」契约对齐。
      // 判定语义收敛到 _lib/gate-parse.ts（parseToolOutput，契约测试锁死）：
      //   _summary.ok → errors===0 → 退回 rc；解析失败 note 明示非 JSON 回退。
      const parsed = parseToolOutput(r.out, r.rc, tool);
      let ok = parsed.ok;
      let note = parsed.note;
      const tail = parsed.tail;
      // autoFix（2026-08-23 用户诉求"gen 产物老要 AI 手打刷新"）：--check FAIL 的
      // gen 产物工具自动跑写盘版刷新后重验——修"提交间隙 gen 产物过期 → doctor FAIL"
      // 的鸡生蛋（pre-commit 只在提交时跑 gen；间隙跑 doctor 需手打对应 gen 脚本）
      if (!ok && effectiveAutoFix) {
        const fixR = sh(`node scripts/${tool} --json`); // 写盘刷新（无 --check）
        if (fixR.rc === 0) {
          const re = sh(`node scripts/${tool} --json ${extraArgs.join(" ")}`);
          const reOk = parseToolOutput(re.out, re.rc).ok;
          if (reOk) {
            ok = true;
            note = `autoFix: node scripts/${tool} 已自动刷新`;
          } else {
            note = note
              ? `${note}（autoFix 已尝试但仍 FAIL）`
              : `node scripts/${tool} autoFix 已尝试但仍 FAIL`;
          }
        }
      }
      // label = 完整检查命令（AI 失败时可直接抄，无需翻文档找脚本名）
      const cmdLabel = `node scripts/${tool} --json${stagedArg ? ` ${stagedArg}` : ""}${extraArgs.length ? ` ${extraArgs.join(" ")}` : ""}`;
      record(cmdLabel, ok, {
        time: Date.now() - t0,
        note,
        raw: r.out,
        // warns_list 摘要优先（FAIL 可读性）；否则回退原始输出尾部
        tail: !ok ? tail || r.out.trim().split("\n").slice(-12).join("\n") : "",
        blockPolicy: entry.blockPolicy,
      });
    }
  };

  /* --- 文档漂移按 --files 裁剪执行器（与 check-redlines 同款数组式 procRun）---
   * commit/push 文件驱动模式：仅校验本次变更知识卡，避免并行会话未跟踪草稿卡阻断本次提交。
   * doc-drift / knowledge-drift 默认全扫 docs/knowledge/，此处强制 --files 裁剪。
   * 数组式传参（shell:false）承载换行分隔的 --files 大列表（避开 cmd 8K 墙，见 check-redlines 注释）。 */
  const runScopedDocDrift = (changedFiles: string[]) => {
    if (changedFiles.length === 0) return;
    for (const tool of ["check-doc-drift.ts", "check-knowledge-drift.ts"]) {
      const t0 = Date.now();
      const r = procRun("node", [`scripts/${tool}`, "--json", "--files", changedFiles.join("\n")], {
        cwd: ROOT,
        timeout: TIMEOUT,
      });
      const out = r.out || r.err || "";
      const parsed = parseToolOutput(out, r.rc, tool);
      const ok = parsed.ok;
      const note = parsed.note;
      // doc-drift/knowledge-drift 无 warns_list 契约，统一回退原始输出尾部
      const tail = !ok ? out.trim().split("\n").slice(-12).join("\n") : "";
      // label = 完整命令（--files 为内部裁剪机制，AI 手动复查时直接全扫即可）
      record(`node scripts/${tool} --json`, ok, {
        time: Date.now() - t0,
        note,
        raw: out,
        tail: !ok ? tail : "",
      });
    }
  };

  /* --- 域间并行：Go ∥ 前端（ADR-088 Take巧 #1）--- */
  // Go 和前端域完全独立（无共享状态、无文件写冲突），用 Promise.all 并行。
  // Take巧 #4（静态工具并行）已回退（spawn 开销吃掉 sub-second 工具收益）；
  // 此处仅 2 个域级操作，spawn 开销 0.6s << 域本身 58s，收益成立。
  // 域内用 shAsync（spawn 异步）替代 sh（execFileSync 同步），避免阻塞主线程。
  await Promise.all([
    // ── Go 域 ──
    (async () => {
      if (!plan.go) return;
      // updater helper 前置构建（doctor 全量协议）：go/updater/updater.go 通过 //go:embed
      // 内嵌 ysm-updater-helper.exe（.gitignore 不入库），干净 checkout 缺此文件会导致
      // go build/vet/test 失败（2026-08-14 补入 gate，对齐 doctor）。
      const tH = Date.now();
      const uh = await shAsync("go build -o go/updater/ysm-updater-helper.exe ./cmd/updater");
      record("go build -o go/updater/ysm-updater-helper.exe ./cmd/updater", uh.rc === 0, {
        time: Date.now() - tH,
        tail: uh.rc ? uh.out.trim().split("\n").slice(-4).join("\n") : "",
      });

      const goFiles = (byDomain.go || []).filter((f) => f.endsWith(".go"));

      const t0 = Date.now();
      const goBuild = await shAsync("go build ./go/...");
      record("go build ./go/...", goBuild.rc === 0, {
        time: Date.now() - t0,
        tail: goBuild.rc ? goBuild.out.trim().split("\n").slice(-4).join("\n") : "",
      });

      const t1 = Date.now();
      // 对齐 doctor 全量：go test 同时跑 ./internal/app/（2026-08-14 修复漏测）
      // 2026-09-04 恢复 test cache：-count=1 系 .mjs→.ts 机械迁移（2685e53a）照抄的旧参数，
      // 无防假绿动机。源码/测试未变时重复跑（重推失败重试 / 连续 doctor）→ (cached) 秒回，
      // go test 37.4s → <1s。逃生阀：YSM_FRESH_GO_TEST=1 强制新鲜（发版前 / 怀疑测试读
      // 仓库外可变状态致缓存假绿时，doctor 输出 [WARN]skip 场景可配合使用）。
      // ADR-202 刀5（2026-09-07）：-race 仅并发敏感包（共享单锁/缓存/worker 池的包），
      // 其余包普通跑——-race 插桩慢 ~2-3x，非并发包无数据竞争风险，分级后门禁提速；
      // 普通全量仍覆盖 ./go/... ./internal/app/（并发包普通跑一遍，cache 秒回）。
      const freshGoTest = process.env.YSM_FRESH_GO_TEST === "1";
      // 并发敏感包 -race；其余包经 go list 过滤（排除并发包，避免重复跑两遍）。
      // 实测（-count=1 强制新鲜）：全量 -race 42.5s → 分级+过滤 18.9s（-55%）。
      // 跨平台修复：095b3d911 原命令含 `$(go list ...)` bash 替换——Windows cmd.exe
      // 不展开字面 `$(...)`（go 收到畸形包名恒 FAIL），自 ADR-202 刀5 起 Windows
      // gate 该项持续红（90+ commit 积压未推的直接原因）。改为 JS 侧先取包清单
      // 再拼字面命令，双平台等价（grep -vE 'go/(…)(\/|$)' → 等价正则在 JS 实现）。
      const racePkgs =
        "./go/sync/... ./go/conc/... ./go/download/... ./go/instance/... ./go/installer/... ./go/watcher/... ./go/scanner/...";
      const racePkgRe = /(^|\/)go\/(sync|conc|download|instance|installer|watcher|scanner)(\/|$)/;
      const goList = await shAsync("go list ./go/... ./internal/app/");
      if (goList.rc !== 0) {
        record("go list ./go/... ./internal/app/", false, { tail: goList.out.trim().split("\n").slice(-4).join("\n") });
        return;
      }
      const otherPkgs = goList.out
        .trim()
        .split(/\s+/)
        .filter((p) => p && !racePkgRe.test(p));
      // code_review fd349a91a #6：命令提为变量供 label 复用——原标签含 `...`/中文伪
      // 命令不可执行且省略真实 flags（-count=1/-timeout 60s/go list grep）
      const goTestCmd =
        `go test -race ${racePkgs} ${freshGoTest ? "-count=1 " : ""}-timeout 60s ` +
        `&& go test ${otherPkgs.join(" ")} ${freshGoTest ? "-count=1 " : ""}-timeout 60s`;
      const goTest = await shAsync(goTestCmd);
      // 记录命令：并发敏感包 -race + 其余包普通跑（ADR-202 刀5 分级）
      record(goTestCmd, goTest.rc === 0, {
        time: Date.now() - t1,
        tail: goTest.rc ? goTest.out.trim().split("\n").slice(-4).join("\n") : "",
        note: freshGoTest
          ? "YSM_FRESH_GO_TEST=1 强制新鲜跑"
          : "ADR-202 刀5：-race 仅并发敏感包 + 普通全量",
      });

      const tV = Date.now();
      const goVet = await shAsync("go vet ./go/... ./internal/app/...");
      record("go vet ./go/... ./internal/app/...", goVet.rc === 0, {
        time: Date.now() - tV,
        tail: goVet.rc ? goVet.out.trim().split("\n").slice(-4).join("\n") : "",
      });

      // golangci-lint（ADR-205）：补齐 Go 静态分析真空面（errcheck/unused/ineffassign/
      // gocritic/gocyclo/staticcheck）。两条硬约束：
      //   ① 只跑增量（--new-from-rev）——全量会撞 736 条存量债（errcheck 623 占 85%），
      //      等于每次 push 必红，门禁即废。存量清零另案，不在此处惩罚。
      //   ② 未安装 / 无基线 rev → 降级 debt（只记录不阻断），与 gofmt 不可用同口径
      //      （.githooks/pre-commit:235）——不给未装工具的开发机或孤儿分支添堵。
      const tGL = Date.now();
      const glVer = procRun("golangci-lint", ["--version"], { cwd: ROOT });
      if (!glVer.ok) {
        record("golangci-lint（跳过：未安装）", true, {
          time: Date.now() - tGL,
          note: "未检测到 golangci-lint，跳过 Go 静态分析。安装：go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
          blockPolicy: "debt",
        });
      } else {
        // code_review 9403a4dff #4（P2）：版本地板校验——.golangci.yml 为 v2 schema
        // （version: "2"），v1 线或 <v1.64 的二进制解析不了（go directive/config keys
        // 静默丢）→ run 必失败且硬阻断，违背「宁可漏检不可误堵」；按地板降级 debt
        const glVerLine = glVer.out.split("\n")[0] ?? "";
        const vM = glVerLine.match(/v?(\d+)\.(\d+)\.(\d+)/);
        // code_review 9403a4dff #4 修复补（TS2345）：vM[1]/vM[2] 是 match 数组索引
        // （string | undefined）——parseInt 收 string 报 TS 错误；`?? "0"` 安抚类型
        // 且防极端空组 NaN（match 成功时组必在，兜底不改变正常语义）
        const glMaj = vM ? parseInt(vM[1] ?? "0", 10) : 0;
        const glMin = vM ? parseInt(vM[2] ?? "0", 10) : 0;
        const belowFloor = glMaj !== 0 && (glMaj < 1 || (glMaj === 1 && glMin < 64) || glMaj > 2);
        if (belowFloor) {
          record("golangci-lint（跳过：版本低于地板 v1.64+/v2 线）", true, {
            time: Date.now() - tGL,
            note: `${glVerLine} 低于 ADR-205 §2.4 版本地板（.golangci.yml 为 v2 schema）；安装 v2 线：go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`,
            blockPolicy: "debt",
          });
        } else {
          // code_review 9403a4dff #1/#9（P2）：非 push 模式（--all/--files）localOid 为
          // 空串 → merge-base 空 rev 必失败 → fallback 链恒返回 ""，doctor 每次记录误导性
          // 「跳过：孤儿分支」（真实原因是空 oid）；以 HEAD 为本地侧走 fallback 链
          const baseRev = resolveBaseRev(pushLocalOid || "HEAD", pushRemoteOid, pushLocalRef);
          // code_review 9403a4dff #5（P2）：baseRev 可能来自 pre-push stdin 派生的
          // remoteOid（未验证 hex）——插入 shell 字符串执行构成命令注入（violate
          // git() helper 明示的「stdin 元字符禁入 shell」不变式）——先验 hex 再执行
          const hexOk = /^[0-9a-f]{40,64}$/i.test(baseRev);
          if (!baseRev || !hexOk) {
            record("golangci-lint（跳过：无基线 rev）", true, {
              time: Date.now() - tGL,
              note: `${glVerLine} 已安装，但无法解析 --new-from-rev 基线（孤儿分支/无远端/基线非 hex）；全量跑会撞 736 条存量债，故跳过而非阻断`,
              blockPolicy: "debt",
            });
          } else if (
            // code_review 9403a4dff #2/#3/#6（P2）：快照守卫——golangci-lint 分析当前
            // 检出工作树，基线却取被推 ref：推非当前分支/脏工作树时 lint 错快照
            // （漏检被推代码 / 误堵无关 WIP）；HEAD==localOid 才跑，否则降级
            pushLocalOid &&
            !pushLocalOid.startsWith("0") &&
            procRun("git", ["rev-parse", "HEAD"], { cwd: ROOT }).out.trim() !== pushLocalOid
          ) {
            record("golangci-lint（跳过：推非当前分支）", true, {
              time: Date.now() - tGL,
              note: `${glVerLine} 已安装，但推送 ref 与当前检出 HEAD 不一致——增量 lint 分析错快照（漏检被推代码/误堵 HEAD）；降级跳过（ADR-205 口径：宁可漏检不可误堵）`,
              blockPolicy: "debt",
            });
          } else {
            // 数组形式执行（防 shell 解析 baseRev）；字符串仅供 label 展示
            const glLabel = `golangci-lint run --new-from-rev=${baseRev} ./...`;
            const gl = procRun("golangci-lint", ["run", `--new-from-rev=${baseRev}`, "./..."], {
              cwd: ROOT,
            });
            record(glLabel, gl.rc === 0, {
              time: Date.now() - tGL,
              note: `增量基线 ${baseRev.slice(0, 8)}（只检新增代码；存量 736 条另案清零）`,
              tail: gl.rc ? gl.out.trim().split("\n").slice(-8).join("\n") : "",
            });
          }
        }
      }

      // gofmt：只读校验（修复已下沉 pre-commit；此处检出即阻断，防止绕过提交）
      const t2 = Date.now();
      const unformatted = gofmtCheck(goFiles);
      // code_review fd349a91a #1/#2/#4/#7：标签须与实际执行一致——门禁只跑只读
      // `gofmt -l <变更文件>`，原标签 "gofmt -w ." 冒充全仓库写盘命令（门禁从不执行
      // 写盘，dry-run 契约 + FAIL 时照抄会全库格式化变更集外的并行文件）
      record("gofmt -l（只读校验，未格式化文件见 tail）", unformatted.length === 0, {
        time: Date.now() - t2,
        note: unformatted.length
          ? `检出 ${unformatted.length} 个未格式化文件（pre-commit 应已自动修复；疑似 --no-verify 绕过）`
          : "无未格式化文件",
        tail: unformatted.length ? unformatted.join("\n") : "",
      });
      // 格式类债务阻断推送（2026-08-17 注释对齐：record 已置 blocked；pre-commit 正常已自动 gofmt -w，
      // 此处检出即说明绕过了 pre-commit——防 --no-verify 绕过，与 .githooks/pre-commit 口径一致）

      const t3 = Date.now();
      const bc = await shAsync("node scripts/binding-check.ts --json");
      record("node scripts/binding-check.ts --json", bc.rc === 0, {
        time: Date.now() - t3,
        raw: bc.out,
        tail: bc.rc ? bc.out.trim().split("\n").slice(-4).join("\n") : "",
      });
    })(),
    (async () => {
      if (!plan.frontend) return;
      // 分层守护：前端目录间反向依赖（R1/R2 零容忍 + R3/R4 基线，现基线 0 条）
      const tL = Date.now();
      const ll = await shAsync("node scripts/check-layering.ts --json");
      const lz = tryParseSummary(ll.out);
      const lOk = ll.rc === 0;
      record("node scripts/check-layering.ts --json", lOk, {
        time: Date.now() - tL,
        raw: ll.out,
        note:
          lz === null
            ? "输出解析失败（scripts/check-layering.ts 缺失？）"
            : lOk
              ? `分层合规（零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}）`
              : `零容忍 ${lz.zero_tolerance} + 新增回归 ${lz.regressions}`,
      });

      // ADR-146：路径卫生门禁（反桶 R1 + 深度 R2 + 上跳 R3 + 跨边界冻结 R4 + 双写一致性）。
      // R0 别名闸已于闸二（2026-09-01）整条删除——check-layering/check-circular/check-path-hygiene 自身均已别名感知，
      // 写别名通过门禁（WARN 不阻断，仅 R4/一致性 FAIL 才会 rc≠0）。
      const tP = Date.now();
      const ph = await shAsync("node scripts/check-path-hygiene.ts --json");
      const pz = tryParseSummary(ph.out);
      const pOk = ph.rc === 0;
      record("node scripts/check-path-hygiene.ts --json", pOk, {
        time: Date.now() - tP,
        raw: ph.out,
        note:
          pz === null
            ? "输出解析失败（scripts/check-path-hygiene.ts 缺失？）"
            : pOk
              ? `路径卫生合规（warn ${pz.warn}）`
              : `FAIL ${pz.fail}：R4=${pz.r4_cross_boundary?.count}/${pz.r4_cross_boundary?.baseline} 一致性=${pz.consistency?.ok}`,
      });

      // ADR-224：mock 路径守卫（vi.mock 失效静默病灶静态校验）。
      // M1 内部 spec（@/ #root/ ./ ../）解析失败 → FAIL（唯一 fail-closed，sync 那类病灶）；
      // M2 裸包 deps∪node_modules 皆无 → 默认 WARN 不阻断（--strict 才升 FAIL，ADR E1 决策：
      //   deps 主导、node_modules 只兜底，本仓 node_modules 不完整，fail-closed 会制造环境噪声）；
      // M3 .js 胶水兜底（app.js→app.ts）→ INFO 只统计。故此处不加 --strict，只拦 M1。
      const tMock = Date.now();
      const mk = await shAsync("node scripts/check-mock-paths.ts --json");
      const mkz = tryParseSummary(mk.out);
      const mkOk = mk.rc === 0;
      record("node scripts/check-mock-paths.ts --json", mkOk, {
        time: Date.now() - tMock,
        raw: mk.out,
        note:
          mkz === null
            ? "输出解析失败（scripts/check-mock-paths.ts 缺失？）"
            : mkOk
              ? `mock 路径合规（fail ${mkz.fail} warn ${mkz.warn} info ${mkz.m3_info}）`
              : `FAIL ${mkz.fail}：M1=${mkz.m1_fail} 处 mock 路径失效`,
      });

      // ADR-085：菜单表健康门禁——"加菜单项只改表"的自动兜底（秒级正则扫描，早失败早停）。
      // 校验：id 唯一 / labelKey 非空 / i18n 三语齐全 / dockGroup 合法 / kind 合法 / render·run 完备。
      const tM = Date.now();
      const mh = await shAsync("node scripts/check-menu-health.ts --json");
      const mz = tryParseSummary(mh.out);
      const mOk = mh.rc === 0 && mz && mz.ok === true;
      record("node scripts/check-menu-health.ts --json", mOk, {
        time: Date.now() - tM,
        raw: mh.out,
        note:
          mz === null
            ? "输出解析失败"
            : mOk
              ? `菜单表 ${mz.total} 项全绿`
              : `${mz.violations} 条菜单表违规（id/labelKey/i18n/dockGroup/kind/render-run）`,
        tail: mOk ? "" : mh.out.trim().split("\n").slice(-4).join("\n"),
      });
      // 菜单表违规 = hard（默认）：record() 已自动置 blocked，无需重复手动设

      // 右键菜单 i18n key 门禁（2026-09-01 新增）：menu-defs.ts / context-menu*-handlers.ts
      // 里所有字面量 tr("key") 必须存在于 zh-CN 基准包，否则运行时静默回退英文。
      // 与 check-menu-health 同口径——漏 i18n 破坏菜单文案契约，硬阻断。
      const tC = Date.now();
      const ci = await shAsync("node scripts/check-ctx-menu-i18n.ts --json");
      const cz = tryParseSummary(ci.out);
      const cOk = ci.rc === 0 && cz && cz.ok === true;
      record("node scripts/check-ctx-menu-i18n.ts --json", cOk, {
        time: Date.now() - tC,
        raw: ci.out,
        note:
          cz === null
            ? "输出解析失败"
            : cOk
              ? `右键菜单 ${cz.total} 个 tr() key 全绿`
              : `${cz.violations} 个 key 缺失（运行时静默回退英文）`,
        tail: cOk ? "" : ci.out.trim().split("\n").slice(-8).join("\n"),
      });
      // 右键菜单 i18n 缺失 = hard（默认）：record() 已自动置 blocked，无需重复手动设

      // 问题 3-A 解法：禁止绕过 bindings 直接调 window.go.main.App.xxx
      // 前端调 Go 函数必须走 bindings/ 强类型接口，避免参数错位编译期不报错
      const tB = Date.now();
      const bu = await shAsync("node scripts/check-binding-usage.ts --json", {
        cwd: path.join(ROOT, "frontend"),
      });
      const buz = tryParseSummary(bu.out);
      const buOk = bu.rc === 0 && buz && buz.ok === true;
      // code_review fd349a91a #5：标签带 cwd=frontend 上下文（实际执行带 cwd: frontend，
      // 仓库根 scripts/ 下无此脚本）——原标签照抄从根执行 ENOENT；与同域 vite/tsc
      // vitest 标签的 "cd frontend &&" 约定对齐
      record("cd frontend && node scripts/check-binding-usage.ts --json", buOk, {
        time: Date.now() - tB,
        raw: bu.out,
        note:
          buz === null
            ? "输出解析失败"
            : buOk
              ? "无绕过 bindings 的直接调用"
              : `${buz.violations} 处绕过 bindings 直接调 window.go.main.App`,
        tail: buOk ? "" : bu.out.trim().split("\n").slice(-8).join("\n"),
      });

      // npm 三件套并行优化：vite build ∥ tsc --noEmit，vitest 串行在后
      // （vitest 是重活儿，独占资源更稳；build 与 tsc 无依赖，墙钟减半）
      // tsc 路径解析：优先 npx 探测（workspace hoisting 兼容），回退硬编码路径
      const t0 = Date.now();
      const [fb, tscResult] = await Promise.all([
        shAsync("npx vite build", { cwd: path.join(ROOT, "frontend") }),
        // npx tsc --version 探测（最简且最鲁棒的 monorepo 兼容方案）
        shAsync("npx tsc --version")
          .then((r) => {
            if (r.rc !== 0) return { rc: -1, out: "" };
            // tsc 可用，再跑 --noEmit 检查
            return shAsync("npx tsc --noEmit", { cwd: path.join(ROOT, "frontend") });
          })
          .catch(() => ({ rc: -1, out: "" })),
      ]);
      const wallA = Date.now() - t0;
      const tscRc = tscResult.rc ?? -1;
      record("cd frontend && npx vite build", fb.rc === 0, {
        time: wallA,
        tail: fb.rc ? fb.out.trim().split("\n").slice(-4).join("\n") : "",
      });
      if (tscRc >= 0) {
        const lines = tscResult.out.trim().split("\n").filter(Boolean);
        record("cd frontend && npx tsc --noEmit", tscRc === 0, {
          time: wallA,
          note: tscRc === 0 ? "" : `${lines.length} errors`,
          tail: tscRc === 0 ? "" : lines.slice(-5).join("\n"),
        });
      } else {
        record("cd frontend && npx tsc --noEmit", false, {
          time: 0,
          note: "tsc 未安装（npx tsc --version 失败）——请 npm ci 后重推",
        });
      }

      // ADR-023 P3：L3 Vitest 随前端域变更回归（串行在后，独占资源）
      const t1 = Date.now();
      // 与 frontend/package.json test 对齐：--maxWorkers 8（24 核默认并发过载反慢 ~10s）
      const ft = await shAsync("npx vitest run --maxWorkers 8", {
        cwd: path.join(ROOT, "frontend"),
      });
      // 失败时抓失败测试名：vitest 输出里 ❯/×/FAIL 行含测试文件名+用例名，
      // 比取最后 4 行（汇总数字）更易定位。最多取 8 行避免 tail 过长。
      const vitestTail = ft.rc
        ? (ft.out.match(/^(?:❯|×|FAIL)[^\n]*$/gm) || ft.out.trim().split("\n").slice(-4))
            .slice(0, 8)
            .join("\n")
        : "";
      record("cd frontend && npx vitest run --maxWorkers 8", ft.rc === 0, {
        time: Date.now() - t1,
        tail: vitestTail,
      });
    })(),
  ]);

  /* --- 数据域 --- */
  if (plan.data) {
    const t0 = Date.now();
    const tc = sh("node scripts/type-consistency.ts --json");
    // 特殊块：只取 _summary.issues 数值；解析失败 → null（fail-closed 阻断，不静默放行）
    const issues = tryParseSummary(tc.out)?.issues ?? null;
    const ok = issues === 0;
    record("node scripts/type-consistency.ts --json", ok, {
      time: Date.now() - t0,
      raw: tc.out,
      note:
        issues === null
          ? "输出解析失败（scripts/type-consistency.ts 缺失？）"
          : ok
            ? "extensions.ts 派生链路完好（单一事实来源守护通过）"
            : `${issues} 个不一致`,
    });
  }

  /* --- 文档域 --- */
  if (plan.docs) {
    const t0 = Date.now();
    const lc = sh("node scripts/link-checker.ts --json");
    const broken = tryParseSummary(lc.out)?.links_broken ?? null;
    const ok = broken === 0;
    record("node scripts/link-checker.ts --json", ok, {
      time: Date.now() - t0,
      raw: lc.out,
      note:
        broken === null
          ? "输出解析失败（scripts/link-checker.ts 缺失？）"
          : ok
            ? "全部链接有效"
            : `${broken} 条断链`,
    });

    // 发版说明漂移守护：git tag 单一事实源——每个正式 tag 必须有 docs/releases/<tag>.md
    // （失败输出 AI 友好：--check 自带每条缺失的 git 区间补写命令）
    const t1 = Date.now();
    const rn = sh("node scripts/release-notes-gen.ts --check");
    record("node scripts/release-notes-gen.ts --check", rn.rc === 0, {
      time: Date.now() - t1,
      tail: rn.rc ? rn.out.trim().split("\n").slice(-14).join("\n") : "",
    });
  }
  if (plan.redlines) {
    const t0 = Date.now();
    // 变更域过滤（--files，2026-08-26）：文件驱动/push 模式把本次变更文件传给
    // check-redlines——仅「变更文件内」的违规计入新增阻断，仓库内其他文件既有债务
    // 不干扰当前提交（否则只改 Go/文档会被未提交 frontend 存量新增红线卡住）。
    // --all / --docs 模式 files 为空、不传 --files → 全库基线比对，向后兼容。
    // 数组参数直走 procRun（无 shell）：--files 大列表（整目录搬家可达 300+ 文件）经
    // shell:true 会超 cmd.exe 8191 限制，check-redlines 进程起不来 → fail-closed 报
    // 「输出解析失败」误阻断推送（2026-08-31 ADR-129 第三刀 utils/3d → preview-3d 实证）。
    // 数组直传走 Windows CreateProcess 32767 上限，避开 cmd 8K 墙。all/docs 模式 files 为空 → 全库比对。
    const rlArgs = ["scripts/check-redlines.ts", "--json", "--baseline"];
    if (files.length) rlArgs.push("--files", files.join("\n"));
    const rlRaw = procRun("node", rlArgs, { cwd: ROOT, timeout: TIMEOUT });
    const rl = { rc: rlRaw.rc, out: rlRaw.out || rlRaw.err || "" };
    let newV = null,
      ok = false,
      scanHealthy = false,
      baseCount = 0,
      rlTail = "";
    // 特殊块：需要整对象（顶层 results 供 tail 展示 + _summary 判定），解析失败 → fail-closed 阻断
    const rlParsed = tryParseJson(rl.out) as { _summary?: any; results?: any[] } | null;
    if (rlParsed) {
      const s = rlParsed._summary;
      newV = s.newViolations ?? null;
      baseCount = s.baselineViolations ?? 0;
      ok = s.ok === true;
      // 扫描健康门（fail-closed）：rg 缺失/执行失败时 check-redlines 输出
      // scanHealthy:false——必须阻断推送，否则红线门禁静默放行（P1 修复）
      scanHealthy = s.scanHealthy === true;
      // 违规详情（供 tail 展示方向，不阻断推送）
      if (!ok && Array.isArray(rlParsed.results)) {
        rlTail = rlParsed.results
          .filter((r: any) => r.count > 0)
          .map(
            (r: any) =>
              `[${r.rule_id} ${r.name}] ` +
              r.violations.map((v: any) => `${v.file}:${v.line}`).join(", "),
          )
          .join("\n");
      }
    } else {
      /* parse fail */ ok = false;
      scanHealthy = false;
    }
    // 基线债务（红线新增）不阻断推送：推送后修；发布前全量 doctor 仍会报告（2026-08-13 决策）
    // failClosed：扫描本身不可用（rg 缺失/fail-closed）才阻断——由下方 !scanHealthy 兜底
    record("node scripts/check-redlines.ts --json --baseline", ok, {
      time: Date.now() - t0,
      raw: rl.out,
      blockPolicy: "failClosed",
      // note 顺序：newV===null 唯一标识 JSON parse 失败（rg 不可用时 newViolations
      // 非 null——runBaseline fail-closed 返回 allKeys），必须先于 scanHealthy 判定
      note:
        newV === null
          ? "输出解析失败——fail-closed 阻断，红线门禁未执行"
          : !scanHealthy
            ? "扫描不可用（rg 缺失/执行失败）——fail-closed 阻断，红线门禁未执行"
            : ok
              ? `红线零新增（基线 ${baseCount} 条）`
              : `${newV} 条新增红线违规（基线 ${baseCount} 条）——债务项，推送后处理`,
      tail: rlTail,
    });
    if (!scanHealthy) blocked = true;
  }
  if (plan.adr) {
    const t0 = Date.now();
    const ac = sh("node scripts/adr-check.ts");
    record("node scripts/adr-check.ts", ac.rc === 0, {
      time: Date.now() - t0,
      raw: ac.out,
      tail: ac.rc ? ac.out.trim().split("\n").slice(-4).join("\n") : "",
    });
  }

  /* --- 生成器守护：索引产物是否过期（docs 或 adr 变更时） --- */
  if (plan.docs || plan.adr) {
    const t0 = Date.now();
    const gd = sh("node scripts/gen-docs-index.ts --check");
    record("node scripts/gen-docs-index.ts --check", gd.rc === 0, {
      time: Date.now() - t0,
      raw: gd.out,
      tail: gd.rc ? gd.out.trim().split("\n").slice(-4).join("\n") : "",
    });
  }

  /* --- 契约测试（按域裁剪 #2：变更域 → 只跑相关契约测试） --- */
  // 规则（与 doctor 共用 _lib/contract-tests.ts 的 selectContractTests）：
  //   --all 全量模式 → 全量（发版前体检，不可裁剪）
  //   --files / push 模式 → 按变更域（byDomain 键集）选子集：改 go 跑 go 相关、改前端跑前端相关、
  //     改 data 跑 schema、改 docs 跑文档契约；改 scripts/tests（域 'tests'）→ 全量（工具自身改动影响面大）
  //   --docs 轻量模式 → 跳过（byDomain 为空 → 子集空）
  const contractFiles = allMode
    ? undefined // 全量
    : selectContractTests(Object.keys(byDomain));
  if (allMode || (contractFiles && contractFiles.length > 0)) {
    const t0 = Date.now();
    const tests = await runContractTestsParallel(contractFiles);
    const ok = tests.length === 0 || tests.every((t) => t.ok);
    // code_review fd349a91a #3：标签如实描述执行面——原 `for f in tests/*.ts` glob 声称
    // 全量（实际 selectContractTests 按域裁剪子集 + _ 前缀排除 + spawn 有界并发，
    // push/files 模式只跑相关子集——假保证 + glob 语法 Windows 不可执行）
    record(`contract tests (${tests.length}${allMode ? "，全量" : "，按域裁剪"})`, ok, {
      time: Date.now() - t0,
      note:
        tests.length === 0
          ? "无匹配契约测试，跳过"
          : ok
            ? "全部通过"
            : tests
                .filter((t) => !t.ok)
                .map((t) => `${t.name}\n${t.out}`)
                .join("\n"),
    });
  }

  /* --- 静态工具（--all / --docs / push 按变更域补挂） --- */
  // 回退 ADR-088：runTools 恢复串行，调用点去掉 await
  if (allMode) {
    runTools(ALL_STATIC_TOOLS);
    runTools(DOC_EXTRA_SCRIPTS);
  }
  if (docsMode) {
    runTools(DOC_STATIC_TOOLS);
    runTools(DOC_EXTRA_SCRIPTS);
  }
  // 2026-08-17 P1-1 修复：push 模式此前从不执行静态治理工具（ALL_STATIC_TOOLS 只在
  // --all/--docs 跑）→ gate 名存实亡。现按变更域补挂子集：frontend 变更跑前端静态工具、
  // go 变更跑 Go 静态工具、docs/adr 变更跑文档静态工具——保持按域裁剪的轻量。
  if (!allMode && !docsMode) {
    if (plan.frontend) runTools(FRONTEND_STATIC_TOOLS);
    if (plan.go) runTools(GO_STATIC_TOOLS);
    if (plan.docs || plan.adr) {
      // 文件驱动模式：doc-drift / knowledge-drift 按 --files 裁剪（与 check-redlines 同款），
      // 避免并行会话留在 docs/knowledge/ 的未跟踪草稿卡（如 commit-with-check.md）阻断本次 commit。
      // 二者从通用 runTools 摘除（否则无 --files 全扫），改由 runScopedDocDrift 数组式传 --files。
      runTools(DOC_STATIC_TOOLS.filter((t) => t.tool !== "check-doc-drift.ts"));
      runTools(DOC_EXTRA_SCRIPTS.filter((t) => t.tool !== "check-knowledge-drift.ts"));
      runScopedDocDrift(files);
    }
  }

  /* --- scripts/ TS 类型检查（--all 模式；.ts 文件随 _lib/ 迁移逐步出现）--- */
  // tsc 不是 mjs 脚本，不走 runTools 的 node scripts/ 路径；TS18003（无输入）容忍为通过。
  // 当前 _lib/ 尚未有 .ts 文件，tsc 返回 rc=2；allowRc2=true 时视为通过（零 .ts = 零错误）。
  // 未来 _lib/proc.ts 等迁移到位后，rc=2 自动变为 rc=0/1，无需额外改 gate。
  if (allMode || docsMode) {
    const tSC0 = Date.now();
    const tSC = path.join(
      ROOT,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsc.cmd" : "tsc",
    );
    const tscResult = await shAsync(`"${tSC}" --noEmit -p scripts/tsconfig.json`);
    const tscOk = tscResult.rc === 0 || tscResult.rc === 2; // rc=2 = TS18003 无输入，容忍
    record("npx tsc --noEmit -p scripts/tsconfig.json", tscOk, {
      time: Date.now() - tSC0,
      raw: tscResult.out,
      note:
        tscResult.rc === 2
          ? "无 .ts 文件（待 _lib/ 迁移后生效）"
          : tscResult.rc === 0
            ? "类型检查通过"
            : `${tscResult.out.trim().split("\n").filter(Boolean).length} 个错误`,
      tail: tscResult.rc === 0 ? "" : tscResult.out.trim().split("\n").slice(-5).join("\n"),
    });
  }

  /* --- 聚合摘要 --- */
  logPush("------------------- 结果 -------------------");
  // FAIL 后置（2026-09-08 锐评「AI 只读末尾 ~25 行」）：OK 明细在前供人扫读，
  // FAIL 明细块（归属→前 ≤4 条错误→复现）贴着结论放——保证落在尾部阅读窗口内。
  // 旧「FAIL 前置」(2026-08-29) 服务整页自上而下阅读，现由落盘报告 + 明细块取代。
  // 完整报告落盘（运行过程而非一次性返回信息）：结构化 JSON 存 .git/，
  // stderr 只给相对路径指针；写入失败不阻断门禁。
  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);
  const reportPath = writeGateReport(results, {
    mode: allMode ? "all" : docsMode ? "docs" : filesMode ? "files" : "push",
    blocked,
    domainSummary,
  });
  for (const r of okResults) {
    logPush(`${B.OK} ${r.label}  ${((r.time / 1000).toFixed(1)).padStart(5)}s  ${r.note || ""}`);
  }
  if (failResults.length) {
    const display = reportPath ? path.relative(ROOT, reportPath) : "（报告写入失败）";
    logPush(`------ FAIL 明细（归属 → 前 ≤4 条错误 → 复现）｜ 完整报告: ${display} ------`);
    for (const r of failResults) {
      // hard 失败的归属：push/files 模式（files 非空）可归因本次变更；全扫（--all/--docs）待归因
      logPush(formatFailSummary(r, okResults.length, results.length, files.length > 0));
    }
  }
  logPush("");
  if (!results.length) {
    logPush(`${B.SKIP} 无相关域变更（${domainSummary}），无需检查`);
    return 0;
  }
  if (!blocked) {
    const passCount = results.filter((r) => r.ok).length;
    logPush(
      `结论: PASS ✅ ${dryRun ? "（DRY-RUN）" : "放行推送"} ${passCount}/${results.length} 项通过`,
    );
    if (reportPath) logPush(`完整报告: ${path.relative(ROOT, reportPath)}`);
    // P0 修复（子代理锐评）：横幅移到 dry-run 分支——AI 验证完（dry-run）时看到「可直接 push」，
    // 真实 push 时（!dryRun）已在执行，复读机提示无意义。
    // Q1 修复（子代理再洗礼）：--no-banner 抑制横幅，由调用方（commit-with-check）在 commit 成功后自己打印
    // （commit-with-check 恒走 dry-run，横幅在自动 commit 前出现会诱导 AI push 旧 HEAD）
    if (dryRun && !noBanner) {
      logPush("");
      logPush("════════════════════════════════════════");
      logPush("  ✅ 门禁全绿，可直接执行：git push");
      logPush("  （无需再手动跑 doctor --docs / tsc / build 确认）");
      logPush("════════════════════════════════════════");
    }
    return 0;
  }
  logPush(
    `结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过，推送已${dryRun ? "将被" : ""}阻断`,
  );
  // 失败项清单（2026-08-29 可观测性）：一行点名全部失败指令，无需在结果表里逐行找
  const fails = results.filter((r) => !r.ok);
  logPush(`失败项 (${fails.length}): ${fails.map((r) => r.label).join(" / ")}`);
  logPush("明细见上方 FAIL 块（归属/首错/复现；完整报告见明细区头路径）");
  // 修复指引：gofmt 检出未格式化（疑似 --no-verify 绕过 pre-commit）→ 手动修复后重推
  // code_review fd349a91a #1/#2/#4/#7：匹配基于稳定前缀而非 "-w" 子串（-w 仅因
  // 原虚构标签 "gofmt -w ." 而来，标签如实化后子串匹配会静默失效；gofmt 标签唯一）
  const gofmt = results.find((r) => r.label.includes("gofmt"));
  let gofmtHint = "";
  if (gofmt && !gofmt.ok) {
    gofmtHint = "gofmt 检出未格式化——gofmt -w 修复后 git add + git commit 重推。";
  }
  // 修复指引：script-hygiene FAIL（新脚本文件头不合规）→ 补 JSDoc 头字段（见 check-script-hygiene.ts 注释）
  const hygiene = results.find((r) => r.label.includes("check-script-hygiene"));
  let hygieneHint = "";
  if (hygiene && !hygiene.ok && hygiene.tail?.includes("文件头")) {
    hygieneHint =
      "script-hygiene：新脚本缺文件头字段——补「文件名+描述/依赖/用法/退出码/设计意图」后重推。";
  }
  logPush(
    `修复指引: 按上方 [FAIL] 项处理；${gofmtHint}${hygieneHint}紧急绕过: git push --no-verify`,
  );
  logPush(PULL_HINT);
  return 1;
}

// ── 文档待补地图：仅门禁 PASS 时刷新（非阻断），供文档类 AI 定位「哪块城邦失修、该补哪里」──
// 失败/用法错误时跳过：失败推送无地图消费方，且 gen-doc-next-steps 内部会重跑
// check-knowledge-drift / link-checker / adr-check 三个重型检查，会延迟失败回执（2026-08-12 排查）。
main()
  .then(async (code) => {
    if (code === 0) {
      // P2 修复（2026-08-17）：地图刷新此前 execFileSync 同步阻塞每次成功推送（≤300s），
      // 失败空 catch 吞掉 + stdio ignore 无感知——改为后台 spawn（detached+unref），
      // 推送立即返回，失败至少打一行可见提示（门禁锐评 P2-1）。
      try {
        // 2026-08-17 code_review P2：去掉 shell:true——process.execPath 是真实 .exe
        // 直接 spawn；带 shell 会经 cmd.exe 重新解析 `C:\Program Files\...` 路径（空格炸）。
        const child = spawn(process.execPath, ["scripts/gen-doc-next-steps.ts"], {
          cwd: ROOT,
          stdio: "ignore",
          detached: true,
        });
        child.unref();
        child.on("error", (e) =>
          console.error(`[MAP] 后台刷新启动失败（不影响推送）: ${e.message}`),
        );
        console.log(
          "[MAP] 已触发后台刷新 docs/.doc-next-steps.md（AI 待补地图，非阻断，不阻塞推送）",
        );
      } catch (e: any) {
        console.error(`[MAP] 后台刷新启动失败（不影响推送）: ${e.message}`);
      }
    }
    process.exit(code ?? 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
