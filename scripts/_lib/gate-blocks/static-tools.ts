#!/usr/bin/env node
/**
 * static-tools.ts — 静态工具清单执行器（pre-push-gate 域块，ADR-206 阶段 2）。
 *
 * 从 pre-push-gate.ts 的 main 闭包里搬出两段「按清单跑静态检查」的执行器：
 *   - runTools(ctx, tools)    通用清单执行器（--all / --docs / 按域补挂三处共用）
 *   - runScopedDocDrift(ctx)  知识卡 / 文档漂移的 --files 裁剪执行器
 *
 * 为什么值得单独成模块：两段合计约 120 行，却承载 4 处极易漂移的判定细节——
 *   `_summary` 判定优先级（委托 gate-parse.parseToolOutput）、gen 产物 autoFix 重验、
 *   scopedFiles 的数组式传参（绕 cmd 8K 墙）、scoped 时 note 的裁剪范围标注。
 * 它们混在 main 的域调度里时，改一处需通读全部域块；搬出后 pre-push-gate 只管
 * 「何时跑」，本模块管「怎么跑」。
 *
 * record 行为像素级不变（label / note / tail / raw / blockPolicy / time 原样），
 * 由三模式 dry-run baseline diff 守护（ADR-206 §3）。搬移期唯一实质改动：
 * autoFix 重验的 parseToolOutput 补回 tool 入参——此前漏传，解析失败的 note 会
 * 丢失工具名，与首轮调用口径不一致。
 *
 * 依赖：node:child_process（经 GateCtx 的 sh/shAsync）/ _lib/proc（数组式 procRun）
 *       / _lib/gate-parse / _lib/gate-config / _lib/gate-ctx / _lib/scan-files
 *
 * 用法：
 *   import { runTools, runScopedDocDrift } from "./gate-blocks/static-tools.ts";
 *   runTools(ctx, FRONTEND_STATIC_TOOLS);
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 *
 * 设计意图：让「静态工具怎么跑」成为可单测单元，把 main 的域调度层与工具执行层解耦
 * ——ADR-206 的目标态（pre-push-gate 只留 ~400 行调度骨架）。
 */
import type { GateTool } from "../gate-config.ts";
import { debtNoteSuffix, debtStatus } from "../gate-debt.ts";
import { type ExecResult, GATE_TIMEOUT_MS, type GateCtx } from "../gate-ctx.ts";
import { parseToolOutput } from "../gate-parse.ts";
import { run as procRun } from "../proc.ts";
import { ROOT } from "../scan-files.ts";

/**
 * 静态工具段的时间预算（2026-10-08 加护栏，起因见下）。
 *
 * 事故：`check-unread-fields.ts` 单条 18.3s（全仓文本解析），同时挂在 push 的
 * ALL_STATIC_TOOLS 与 commit 路径上 → 每次提交/推送白付 ~18s，而它 rc 恒 0 从不拦人。
 * 该条已摘除（见 gate-config 注释），但**机制上没有任何东西阻止下一条重演**：
 * 清单 36 项串行累加，`GATE_TIMEOUT_MS` 又是 300s/项（挂死也要等 5 分钟）。
 *
 * 护栏语义：静态工具段**总耗时**超本预算 → 记一条 FAIL，点名最慢的几项，
 * 把「悄悄变慢」变成「显式红灯」——慢不是不能接受，**未经知会的慢**不可接受。
 * 预算口径（2026-10-09 改**按表分级**）：单预算同时套「33 项域表」与「40 项全量表」是口径错配
 * ——同一 30s 在域表（前端域 push 路径实测 ~25s）绰绰有余，在全量表（ALL / `--static` 合并表
 * 实测 30.6–34.0s，随机器负载与并行会话在途改动浮动）却压线假红。故分两档：
 *   · `STATIC_TOOLS_BUDGET_MS = 30s`：域表（FRONTEND / GO / DOC 子集）
 *   · `STATIC_TOOLS_BUDGET_FULL_MS = 35s`：全量表（`--all` 的 ALL_STATIC_TOOLS、`--static` 合并表）
 * 档位由调用方按表选（`runTools(ctx, tools, { tier })`），`--all`/`--static` 两处显式 full。
 * 正常应低于本档；超标即说明又有人往清单里加了重物。
 * 逃生阀 `YSM_GATE_BUDGET_MS=<ms>`：**一次覆盖所有档**（慢机器/CI 上放宽，或临时排查）。
 *
 * 摘除判据（勿滥用逃生阀；摘前先核这两条）：
 *   ① **有无判定力**：`check-unread-fields` rc 恒 0、--strict 才 rc=1，挂门禁里从不拦人 → 可摘。
 *   ② **CI 有无兜底**：CI 独立 shell 步骤跑着的项，本地重复付费只买「早知道」，可考虑摘；
 *      CI 不跑的项，本地摘 = 直接关闸。
 * 判据 ② 的执行面（2026-10-09 追加）：`auto-import`（固定 ~9s 全树扫，`--files` 裁剪救不了：
 *   实测全量 7.8s ≈ 单文件 8.1s，成本在「先建全树导出表」而非目标文件）从 FRONTEND_STATIC_TOOLS
 *   摘除、**保留在 ALL_STATIC_TOOLS**——`doctor --all` 与 CI 的 `pre-push-gate --static`
 *   （test.yml「静态治理门禁」步，exit 传播=阻断）照跑同一条命令，远端零损失，本地
 *   push / commit-with-check 热路径不再重复付费。
 *   ⚠️ 判断「CI 有无兜底」不能只看有没有以该脚本命名的**独立步骤**——`--static` 模式把
 *   ALL_STATIC_TOOLS 整表带进 CI。本注释 2026-10-08 版曾据「无独立步骤」误判 auto-import
 *   「本地是唯一防线，必须留」（该结论已作废，见 gate-config 的摘除注释）。
 * 换取的收益是真实的：本次摘除让 commit 与 push 各立省 ~18s。
 */
/**
 * 静态工具段的时间预算档位。
 *   domain —— 域表（FRONTEND / GO / DOC 子集）：前端域 push 路径实测 ~25s。
 *   full   —— 全量表（--all 的 ALL_STATIC_TOOLS / --static 合并表）：实测 30.6–34.0s。
 */
export type StaticBudgetTier = "domain" | "full";

/** 域表预算（ms）。 */
export const STATIC_TOOLS_BUDGET_MS = 30_000;
/** 全量表预算（ms）——比域表高一档：表更大且含 auto-import 等固定全树成本项。 */
export const STATIC_TOOLS_BUDGET_FULL_MS = 35_000;

/**
 * 解析实际预算（纯函数，可测）。
 * 优先级：`YSM_GATE_BUDGET_MS` 显式覆盖（对所有档位生效）> 档位常量。
 * 非法/非正数环境值一律忽略（防 `YSM_GATE_BUDGET_MS=abc` 把护栏变成 NaN 恒不触发）。
 */
export function resolveStaticBudget(
  tier: StaticBudgetTier = "domain",
  env: string | undefined = process.env.YSM_GATE_BUDGET_MS,
): number {
  const override = Number(env ?? "");
  if (Number.isFinite(override) && override > 0) return override;
  return tier === "full" ? STATIC_TOOLS_BUDGET_FULL_MS : STATIC_TOOLS_BUDGET_MS;
}

/**
 * 按清单串行执行静态工具，逐条 record。
 *
 * 刻意不并行（ADR-088 实证回退）：并行版 2m15s vs 串行基线 75s——spawn 开销吃掉
 * sub-second 工具的并行收益。域间并行（Go ∥ 前端）保留在 pre-push-gate 调度层，
 * 静态工具段一律串行。
 *
 * @param opts.tier 预算档位（默认 "domain"）。全量表（`--all` / `--static` 合并表）
 *        由调用方显式传 `"full"`——档位跟着**这次跑的表的规模**走，而不是写死一个数
 *        同时套大小两种表（那是 2026-10-09 修掉的压线假红成因）。
 */
export function runTools(
  ctx: GateCtx,
  tools: readonly GateTool[],
  opts: { tier?: StaticBudgetTier } = {},
): void {
  const budgetMs = resolveStaticBudget(opts.tier ?? "domain");
  const slowest: { tool: string; ms: number }[] = [];
  let phaseMs = 0;
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
    const stagedArg =
      ctx.files.length > 0 && tool === "check-go-diff-coverage.ts" ? "--staged" : "";
    // 增量裁剪通道（2026-09-13）：清单里声明 scopedFiles:true 的工具改用数组式 procRun
    // 传 `--files <本次变更文件集>`。两个理由，缺一不可：
    //   1. 防存量债淹没：check-complexity / check-params / check-type-safety 是全库阈值型，
    //      未触碰文件的既有命中（complexity 301 条 / params 54 条）会把每次推送刷成全红。
    //   2. 数组式（shell:false）：--files 换行大列表经 shell:true 会撞 cmd.exe 8191 上限
    //      （check-redlines 同款注释，ADR-129 实证），procRun 数组直传走 Windows
    //      CreateProcess 32767 上限。脚本侧按自身 --scope 过滤非本域文件（传全量变更集
    //      即可，无需在 gate 侧做域判定——改纯 Go/文档时 matched=0 → 合法 PASS）。
    // --all / --docs 模式 files 为空 → scoped=false，退回全库（向后兼容）。
    const scoped = entry.scopedFiles === true && ctx.files.length > 0;
    const invoke = (extra: string[]): ExecResult => {
      if (scoped) {
        const rr = procRun(
          "node",
          [
            `scripts/${tool}`,
            "--json",
            ...(stagedArg ? [stagedArg] : []),
            ...extra,
            "--files",
            ctx.files.join("\n"),
          ],
          { cwd: ROOT, timeout: GATE_TIMEOUT_MS },
        );
        return { rc: rr.rc, out: rr.out || rr.err || "" };
      }
      return ctx.sh(`node scripts/${tool} --json ${stagedArg} ${extra.join(" ")}`);
    };
    const t0 = Date.now();
    const r = invoke(extraArgs);
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
    // ⚠️ autoFix 写盘语义契约（ADR-234）：此处是 pre-push-gate 里
    // **唯一会写仓库文件**的执行点——gen 脚本 FAIL 时写盘刷新产物后重验。
    //   1. 刻意不受 --dry-run 限制：commit-with-check 走 --files --dry-run，
    //      gen 产物过期若不刷新会阻断提交流（pre-commit 的 GEN_CMDS 兜底在提交阶段，
    //      来不及救本次 gate 判定）；「dry-run 只检查不修改」的契约仅指 gofmt/仓库源码，
    //      不含 gen 产物刷新
    //   2. 写盘发生在 pre-push 钩子内，被推送的 oid 是钩子调用前的快照——刷新产物
    //      **不进入本次推送**，属预期行为（随下次 commit/push 进入变更集）；
    //      钩子内严禁 amend / git add（见 pre-push-gate.ts 头部已知坑：amend 致 oid 分叉）
    //   3. push 后工作树 gen 产物呈脏态 = autoFix 已工作的正常痕迹，勿当作回归修复
    if (!ok && effectiveAutoFix) {
      const fixR = ctx.sh(`node scripts/${tool} --json`); // 写盘刷新（无 --check）
      if (fixR.rc === 0) {
        const re = invoke(extraArgs);
        // tool 入参不可省：解析失败时 note 靠它标明是哪个工具在退化（阶段 2 补齐）。
        const reOk = parseToolOutput(re.out, re.rc, tool).ok;
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
    if (scoped) {
      // note 追加裁剪范围：_summary 的 errors 是「本次变更文件内」的命中数，
      // 不带范围会与全库数字（301/54）混淆，AI 无法判断归因范围。
      const scopeNote = `--files 裁剪：本次变更 ${ctx.files.length} 文件`;
      note = note ? `${note}（${scopeNote}）` : scopeNote;
    }
    // 存量债到期状态（2026-10-09 到期制）：debt 不是「永远只记一笔」——FAIL 时把债的
    // 期限挂到 note，「第三次看到同一条 knip 债」与「到期未处置」在读输出时即可分辨。
    // 刻意不在此升级阻断：存量债与本次变更无关，拿它挡住无关推送者正是本仓反复吃亏的
    // 「假红训练人忽略红灯」；到期的硬处置收敛在 doctor --all 的到期盘点段。
    if (!ok && entry.blockPolicy === "debt") note += debtNoteSuffix(debtStatus(entry.debt));
    // label = 完整检查命令（AI 失败时可直接抄，无需翻文档找脚本名）。
    // scoped 时 label 沿用全扫命令（--files 是门禁内部裁剪机制，AI 手动复查直接全扫
    // 即可看到完整命中方向——同 runScopedDocDrift 口径）；范围信息落在上方 note。
    const cmdLabel = `node scripts/${tool} --json${stagedArg ? ` ${stagedArg}` : ""}${extraArgs.length ? ` ${extraArgs.join(" ")}` : ""}`;
    const elapsed = Date.now() - t0;
    phaseMs += elapsed;
    slowest.push({ tool, ms: elapsed });
    ctx.record(cmdLabel, ok, {
      time: elapsed,
      note,
      raw: r.out,
      // warns_list 摘要优先（FAIL 可读性）；否则回退原始输出尾部
      tail: !ok ? tail || r.out.trim().split("\n").slice(-12).join("\n") : "",
      blockPolicy: entry.blockPolicy,
    });
  }
  // 预算护栏：超时即点名，防「悄悄变慢 → 全队每天白付」重演（见常量注释）。
  //
  // ⚠️ 瞬态校验（2026-10-08 实测补强）：绝对耗时预算会被**环境瞬态**误伤——
  // 本护栏上线当日即误报一次：`check-android-unavailable.ts` 实测 33.5s（其 `GOOS=android
  // go list` 撞冷缓存/并行会话负载），而紧接着连跑两次仅 1.0–1.2s。若直接把瞬态判红，
  // 得到的是「待归因」的假 FAIL + 全队被 blame——比不加护栏更糟（假红会训练人忽略红灯）。
  // 故超预算时对**最慢项复跑一次**做归一：复跑回到正常量级 ⇒ 判环境瞬态（WARN 不阻断，
  // 但必须明文留痕，因为「偶发慢」本身仍是症状）；复跑仍慢 ⇒ 判结构性慢（FAIL）。
  if (phaseMs > budgetMs) {
    const ranked = slowest.slice().sort((a, b) => b.ms - a.ms);
    const top = ranked
      .slice(0, 5)
      .map((s) => `${s.tool} ${(s.ms / 1000).toFixed(1)}s`)
      .join(" / ");
    const worst = ranked[0];
    let transient = false;
    let rerunMs = 0;
    if (worst) {
      const rt = Date.now();
      // 数组式 procRun（shell:false）而非 ctx.sh：`${worst.tool}` 是插值，
      // 走 shell 拼接会触发 sh-invariants 闸的 DYNAMIC_ALLOWLIST 要求（shell 注入面）。
      // 用数组直传既满足闸，也与上方 scopedFiles 分支同款（Windows CreateProcess 直传）。
      procRun("node", [`scripts/${worst.tool}`, "--json"], { cwd: ROOT, timeout: GATE_TIMEOUT_MS });
      rerunMs = Date.now() - rt;
      // 复跑低于首次 1/3 且回到预算的 1/4 以内 ⇒ 判瞬态
      transient = rerunMs * 3 < worst.ms && rerunMs < budgetMs / 4;
    }
    const over = ((phaseMs - budgetMs) / 1000).toFixed(1);
    ctx.record(
      `静态工具段耗时预算（${opts.tier ?? "domain"} 档 ≤${(budgetMs / 1000).toFixed(0)}s${
        transient ? "，判为环境瞬态" : ""
      }）`,
      transient,
      {
        time: phaseMs,
        note: transient
          ? `本段实测 ${(phaseMs / 1000).toFixed(1)}s，超预算 ${over}s；但最慢项复跑仅 ` +
            `${(rerunMs / 1000).toFixed(1)}s（首次 ${worst ? (worst.ms / 1000).toFixed(1) : "?"}s）⇒ 判为环境瞬态` +
            `（冷缓存/并行负载），不阻断。最慢项：${top}。` +
            `若此类瞬态频繁出现，说明机器负载或缓存策略需调整——偶发慢仍是症状。`
          : `本段实测 ${(phaseMs / 1000).toFixed(1)}s，超预算 ${over}s，且最慢项复跑 ` +
            `${(rerunMs / 1000).toFixed(1)}s 未回落（首次 ${worst ? (worst.ms / 1000).toFixed(1) : "?"}s）` +
            `⇒ 判为结构性慢。最慢项：${top}。处置：摘除/优化慢项，或如实调高 YSM_GATE_BUDGET_MS ` +
            `并在提交说明写理由（慢不是不能接受，未经知会的慢不可接受）。`,
        tail: "",
        blockPolicy: "hard",
      },
    );
  }
}

/**
 * 文档漂移按 --files 裁剪执行器（与 check-redlines 同款数组式 procRun）。
 *
 * commit/push 文件驱动模式：仅校验本次变更知识卡，避免并行会话未跟踪草稿卡阻断本次提交。
 * doc-drift / knowledge-drift 默认全扫 docs/knowledge/，此处强制 --files 裁剪。
 * 数组式传参（shell:false）承载换行分隔的 --files 大列表（避开 cmd 8K 墙，见 check-redlines 注释）。
 */
export function runScopedDocDrift(ctx: GateCtx): void {
  if (ctx.files.length === 0) return;
  for (const tool of ["check-doc-drift.ts", "check-knowledge-drift.ts"]) {
    const t0 = Date.now();
    const r = procRun("node", [`scripts/${tool}`, "--json", "--files", ctx.files.join("\n")], {
      cwd: ROOT,
      timeout: GATE_TIMEOUT_MS,
    });
    const out = r.out || r.err || "";
    const parsed = parseToolOutput(out, r.rc, tool);
    const ok = parsed.ok;
    const note = parsed.note;
    // doc-drift/knowledge-drift 无 warns_list 契约，统一回退原始输出尾部
    const tail = !ok ? out.trim().split("\n").slice(-12).join("\n") : "";
    // label = 完整命令（--files 为内部裁剪机制，AI 手动复查时直接全扫即可）
    ctx.record(`node scripts/${tool} --json`, ok, {
      time: Date.now() - t0,
      note,
      raw: out,
      tail: !ok ? tail : "",
    });
  }
}
