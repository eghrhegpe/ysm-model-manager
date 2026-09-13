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
import { appendGateAudit, auditFilePath } from "./_lib/gate-audit.ts";
import {
  runAdrDomain,
  runDataDomain,
  runDocsDomain,
  runDocsIndexGuard,
} from "./_lib/gate-blocks/data-docs-domain.ts";
import { runFrontendDomain } from "./_lib/gate-blocks/frontend-domain.ts";
import { runGoDomain } from "./_lib/gate-blocks/go-domain.ts";
import { runRedlines } from "./_lib/gate-blocks/redlines.ts";
import {
  runContractTestsBlock,
  runScriptsTypecheck,
  runStaticToolsDispatch,
} from "./_lib/gate-blocks/schedule.ts";
import { coverageTailLine } from "./_lib/gate-coverage.ts";
import { createGateCtx } from "./_lib/gate-ctx.ts";
import { formatFailSummary, writeGateReport } from "./_lib/gate-report.ts";
import { resolveChanges } from "./_lib/gate-resolve.ts";
import { logPush, setLogPushMuted } from "./_lib/log-push.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const B = { OK: "[OK]", FAIL: "[FAIL]", FIX: "[FIX]", SKIP: "[SKIP]" };
// 子进程统一超时 = gate-ctx.GATE_TIMEOUT_MS（阶段 2 收敛的单一来源）；本文件已不再
// 直接持数组式 procRun 的 timeout（redlines 段随阶段 4 迁入 gate-blocks/redlines.ts）。
/** 远端领先提示（SKIP 与 FAIL 共用；2026-09-13 锐评 #10：push 模式带 remote-name——
 * 多 remote 场景裸 `git pull` 默认远端可能不对，指引必须可抄） */
const pullHint = (remote?: string) =>
  remote
    ? `提示: git 报 rejected/non-fast-forward 时先 git pull ${remote} 整合远端再重推（多 remote 勿裸 pull）。`
    : "提示: git 报 rejected/non-fast-forward 时先 git pull 整合远端再重推。";

/* ---------------- 工具 ---------------- */
// sh / shAsync / git / gofmtCheck 已收敛至 _lib/gate-ctx.ts 的 createGateCtx()
// （ADR-206 阶段 1 接线，2026-09-13）：终结「main 内联一份、_lib 里再一份」的双副本。
// 迁移收益（_lib 版修掉了内联版的三个缺陷，接线即生效）：
//   1. gofmtCheck 空列表早退——裸 `gofmt -l` 无参读 stdin 会把门禁挂到超时；
//   2. shAsync 输出 cap 1MB——go test/vite 级刷屏输出在 gate 进程内无界膨胀；
//   3. shAsync 标记 timedOut——超时被杀进程的 code 为 null，与「编译 FAIL」同形，
//      旧版会把它误报成编译错误（现 out 追加超时原因，tail 可见）。

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
// gofmt 只读校验已收敛至 gate-ctx.gofmtCheck（含空列表早退，防裸 gofmt 读 stdin 挂死）。

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
  // --json 真实现（2026-09-13 四锐评 #1）：此前 bools 声明但零消费——doctor --json 透传
  // 静默 no-op、hygiene 契约靠注释假绿。现语义：人读文本流静默（logPush 只写 push-log），
  // 判定终态以结构化 JSON 输出到 stdout（_summary + results，形状与 writeGateReport 同源）。
  // 边界：ctx 创建前的硬失败（stdin 解析失败/用法错误）仍为文本——无判定即无 JSON 契约对象。
  const jsonMode = args.json as boolean;
  if (jsonMode) setLogPushMuted(true);
  // 人读文本流的 stdout 出口（横幅/模式行）：--json 时静默，防污染 stdout 的 JSON 终态
  const say = jsonMode ? () => {} : console.log;
  const allMode = args.all as boolean;
  const docsMode = args.docs as boolean;
  const filesRaw = (args.files as string) ?? "";
  const filesMode = filesRaw.length > 0;

  say("========== YSM 本地质量门禁 ==========");

  // 结果收集 / 阻断标记 / exec 助手统一由 GateCtx 承载（ADR-206 阶段 1 接线，2026-09-13）。
  // record 的 blockPolicy 阻断矩阵与归属落库、blocked 活值 getter、sh/shAsync/git/gofmtCheck
  // 的单一实现均在 _lib/gate-ctx.ts；本文件不再持有副本。
  // ctx 在下方模式分流之后创建——plan / files / byDomain / push refs 由分流确定，须作构造参数注入。

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
  // push 模式的远端名（PULL_HINT 指引用）；非 push 模式保持 undefined → 裸 pull 文案
  let pushRemoteName: string | undefined;
  // push 模式的有效 ref 数（>0 表示真实推送运行，供审计留痕判别）
  let pushedCount = 0;
  // push 模式的全部有效 ref（逐 ref 审计留痕用——三锐评 #四2：多 ref 推送时
  // reflog 每个 ref 一条 push 事件，审计只记 pushed[0] 会让其余 ref 被
  // gate-audit-reconcile 误判为「无审计记录」缺口）
  let pushedRefs: { localOid: string; localRef: string }[] = [];

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
    say("模式: 全量检查（--all）");
    say("");
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
    say("模式: 文档检查（--docs）");
    say("");
  } else if (filesMode) {
    // —— 文件驱动模式（commit-with-check 调用）：按 staged files 真按域裁剪 ——
    files = filesRaw ? filesRaw.split("\n").filter(Boolean) : [];
    if (!files.length) {
      say('用法: node scripts/pre-push-gate.ts --files "<file1>\\n<file2>..." [--dry-run]');
      return 2;
    }
    plan = planFromFiles(files);
    byDomain = groupByDomain(files);
    domainSummary = domainSummaryText(byDomain);
    say(`模式: 文件驱动（--files，${files.length} 个文件）`);
    say(`变更域: ${domainSummary}`);
    say("");
  } else {
    // —— 推送门禁模式（默认）：stdin 驱动 ——
    const remoteName = args._[0] as string | undefined;
    const remoteUrl = args._[1] as string | undefined;

    if (!remoteName) {
      say("用法: node scripts/pre-push-gate.ts [--dry-run] <remote-name> <remote-url>");
      say("      node scripts/pre-push-gate.ts --all [--dry-run]");
      say("      node scripts/pre-push-gate.ts --docs [--dry-run]");
      say("      stdin: <local ref> <local oid> <remote ref> <remote oid>");
      return 2;
    }

    const lines = parseStdin().split("\n").filter(Boolean);
    if (!lines.length) {
      say(`${B.SKIP} 无可推送 ref（空 stdin），跳过`);
      say(`${B.SKIP} ${pullHint(remoteName)}`);
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
        say(
          `${B.FAIL} 变更集解析失败（git diff/show 均不可用），拒绝空跑放行 — 请检查本地 git 状态后重推`,
        );
        say(pullHint(remoteName));
        return 1;
      }
      for (const f of refFiles) fileSet.add(f);
      pushed.push({ localRef, localOid, remoteOid });
    }
    if (!pushed.length) {
      say(`${B.SKIP} 无有效推送 ref（均为删除/空 oid），跳过`);
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
    pushRemoteName = remoteName;
    pushedCount = pushed.length;
    pushedRefs = pushed.map((p) => ({ localOid: p.localOid, localRef: p.localRef }));
    const multiRef = pushed.length > 1;
    say(
      `推送: ${multiRef ? `${pushed.length} 个 ref` : localRef} ${multiRef ? "" : `${localOid.slice(0, 7)} `}→ ${remoteName} (${remoteUrl || "?"})`,
    );
    domainSummary = domainSummaryText(byDomain);
    say(`变更域: ${domainSummary}`);
    say("");
  }

  /* --- GateCtx 创建（模式分流后，注入确定态的共享态）--- */
  // plan / byDomain / files / push refs 至此均已定型；域块与调度段一律经 ctx 消费，
  // 不再直连 main 局部（ADR-206 目标态）。域块搬移（gate-blocks/*）时读取路径自然延续。
  const ctx = createGateCtx({ plan, byDomain, files, pushLocalRef, pushLocalOid, pushRemoteOid });

  /* --- 静态工具执行器已迁出 --- */
  // runTools / runScopedDocDrift 搬入 _lib/gate-blocks/static-tools.ts（ADR-206 阶段 2）。
  // 本模块只保留调度：何时跑哪张清单（--all / --docs / 按域补挂，见文件尾部调度段）。

  /* --- 域间并行：Go ∥ 前端（执行器已迁出，ADR-088 Take巧 #1）--- */
  // runGoDomain / runFrontendDomain 位于 _lib/gate-blocks/{go,frontend}-domain.ts（阶段 6）。
  // 二域完全独立（无共享状态、无文件写冲突），Promise.all 并行；域内自守卫。
  await Promise.all([runGoDomain(ctx), runFrontendDomain(ctx)]);

  /* --- 数据 / 文档 / ADR / 红线域（执行器已迁出）--- */
  // runDataDomain / runDocsDomain / runAdrDomain / runDocsIndexGuard / runRedlines
  // 分别位于 _lib/gate-blocks/data-docs-domain.ts 与 redlines.ts（ADR-206 阶段 3-4）。
  // 各执行器在模块内自守卫（读 ctx.plan.*），故此处为无条件按序调用——顺序即输出顺序，
  // 与搬移前一致（数据 → 文档 → 红线 → ADR → 索引守护）。
  runDataDomain(ctx);
  runDocsDomain(ctx);
  runRedlines(ctx);
  runAdrDomain(ctx);
  runDocsIndexGuard(ctx);

  /* --- 契约测试 / 静态工具补挂 / scripts typecheck（调度已迁出）--- */
  // runContractTestsBlock / runStaticToolsDispatch / runScriptsTypecheck 位于
  // _lib/gate-blocks/schedule.ts（ADR-206 阶段 5）。各函数自守卫，无条件按序调用。
  await runContractTestsBlock(ctx, { allMode, domains: Object.keys(byDomain) });
  runStaticToolsDispatch(ctx, { allMode, docsMode });
  await runScriptsTypecheck(ctx, { allMode, docsMode });

  /* --- 聚合摘要 --- */
  logPush("------------------- 结果 -------------------");
  // FAIL 后置（2026-09-08 锐评「AI 只读末尾 ~25 行」）：OK 明细在前供人扫读，
  // FAIL 明细块（归属→前 ≤4 条错误→复现）贴着结论放——保证落在尾部阅读窗口内。
  // 旧「FAIL 前置」(2026-08-29) 服务整页自上而下阅读，现由落盘报告 + 明细块取代。
  // 完整报告落盘（运行过程而非一次性返回信息）：结构化 JSON 存 .git/，
  // stderr 只给相对路径指针；写入失败不阻断门禁。
  const okResults = ctx.results.filter((r) => r.ok);
  const failResults = ctx.results.filter((r) => !r.ok);
  // --json 终态输出（四锐评 #1）：在三个 post-ctx 出口（无变更/PASS/FAIL）前统一发射，
  // 退出码语义与文本模式完全一致——JSON 模式只改输出形态，不改判定。
  const finishJson = () => {
    if (!jsonMode) return;
    setLogPushMuted(false);
    process.stdout.write(
      `${JSON.stringify(
        {
          _summary: {
            ok: !ctx.blocked,
            blocked: ctx.blocked,
            dryRun,
            counts: `${okResults.length}/${ctx.results.length}`,
            domainSummary,
            ...(reportPath ? { report: path.relative(ROOT, reportPath) } : {}),
          },
          results: ctx.results,
        },
        null,
        2,
      )}\n`,
    );
  };
  const reportPath = writeGateReport(ctx.results, {
    mode: allMode ? "all" : docsMode ? "docs" : filesMode ? "files" : "push",
    blocked: ctx.blocked,
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
      logPush(formatFailSummary(r, okResults.length, ctx.results.length, files.length > 0));
    }
  }
  logPush("");
  // 覆盖固定尾行（2026-09-13 锐评 P2）：「全绿 ≠ 仓库无风险」从知识卡被动警示
  // 升格为每次输出的主动提醒——PASS/FAIL 两路都打，数据源 _lib/gate-coverage.ts。
  logPush(coverageTailLine());
  // 审计留痕（2026-09-13 锐评 P1）：真实 push 模式的每次运行都留一行审计（oid+判定+N/M），
  // 与钩子侧 YSM_SKIP_GATE 的 SKIPPED 行共同构成连续审计流——「这次推送没有 gate 记录」
  // 事后可回溯（--no-verify 本身仍无法客户端检测，边界见 gate-audit.ts 头注释）。
  if (!filesMode && !allMode && !docsMode && pushedCount > 0) {
    // 逐 ref 留痕（三锐评 #四2）：多 ref 推送的 reflog 是每 ref 一条 update by push，
    // 审计流必须同构——每 ref 一行，否则 reconcile 会把 N-1 个 oid 误判为缺口
    for (const p of pushedRefs) {
      appendGateAudit(auditFilePath(), {
        kind: "PUSH",
        localOid: p.localOid.slice(0, 12),
        verdict: ctx.blocked ? "FAIL" : "PASS",
        counts: `${ctx.results.filter((r) => r.ok).length}/${ctx.results.length}`,
        remote: args._[0] as string,
      });
    }
  }
  if (!ctx.results.length) {
    finishJson();
    logPush(`${B.SKIP} 无相关域变更（${domainSummary}），无需检查`);
    return 0;
  }
  if (!ctx.blocked) {
    const passCount = ctx.results.filter((r) => r.ok).length;
    logPush(
      `结论: PASS ✅ ${dryRun ? "（DRY-RUN）" : "放行推送"} ${passCount}/${ctx.results.length} 项通过`,
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
    finishJson();
    return 0;
  }
  logPush(
    `结论: FAIL ❌ ${ctx.results.filter((r) => r.ok).length}/${ctx.results.length} 项通过，推送已${dryRun ? "将被" : ""}阻断`,
  );
  // 失败项清单（2026-08-29 可观测性）：一行点名全部失败指令，无需在结果表里逐行找
  const fails = ctx.results.filter((r) => !r.ok);
  logPush(`失败项 (${fails.length}): ${fails.map((r) => r.label).join(" / ")}`);
  logPush("明细见上方 FAIL 块（归属/首错/复现；完整报告见明细区头路径）");
  // 修复指引：gofmt 检出未格式化（疑似 --no-verify 绕过 pre-commit）→ 手动修复后重推
  // code_review fd349a91a #1/#2/#4/#7：匹配基于稳定前缀而非 "-w" 子串（-w 仅因
  // 原虚构标签 "gofmt -w ." 而来，标签如实化后子串匹配会静默失效；gofmt 标签唯一）
  const gofmt = ctx.results.find((r) => r.label.includes("gofmt"));
  let gofmtHint = "";
  if (gofmt && !gofmt.ok) {
    gofmtHint = "gofmt 检出未格式化——gofmt -w 修复后 git add + git commit 重推。";
  }
  // 修复指引：script-hygiene FAIL（新脚本文件头不合规）→ 补 JSDoc 头字段（见 check-script-hygiene.ts 注释）
  const hygiene = ctx.results.find((r) => r.label.includes("check-script-hygiene"));
  let hygieneHint = "";
  if (hygiene && !hygiene.ok && hygiene.tail?.includes("文件头")) {
    hygieneHint =
      "script-hygiene：新脚本缺文件头字段——补「文件名+描述/依赖/用法/退出码/设计意图」后重推。";
  }
  logPush(
    `修复指引: 按上方 [FAIL] 项处理；${gofmtHint}${hygieneHint}紧急绕过: git push --no-verify`,
  );
  logPush(pullHint(pushRemoteName));
  finishJson();
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
