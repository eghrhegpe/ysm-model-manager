/**
 * 调度块（ADR-206 阶段 5）：契约测试 + 静态工具补挂 + scripts typecheck。
 *
 * 本模块回答「何时跑哪张清单」（调度），「怎么跑」在 static-tools.ts / contract-tests.ts。
 * 各函数自守卫：不满足模式的调用是 no-op，调度侧可无条件按序调用。
 *
 * @module gate-blocks/schedule
 */
import { runContractTestsParallel, selectContractTests } from "../contract-tests.ts";
import {
  ALL_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  type GateTool,
  GO_STATIC_TOOLS,
} from "../gate-config.ts";
import type { GateCtx } from "../gate-ctx.ts";
import { resolveToolBin } from "../tool-bin.ts";
import { runScopedDocDrift, runTools } from "./static-tools.ts";

/**
 * CI（test.yml）内已有**独立步骤**承担的静态工具——`--static` 清单须剔除这些项。
 *
 * 存在理由（2026-10-08 锐评）：同一 job 内同一工具跑两遍 = 双倍机时 + 两套判定上下文。
 * 实测 `check-deadcode-baseline` 被跑两遍时，第二遍因拿不到归属 base（CI 跑在 push
 * 之后、暂存区干净）退严格模式，把一切新增按阻断，与同 job 刚判过的独立步骤矛盾（假红）。
 *
 * 口径纪律：
 *   - **只剔 CI 档**（`--static`）。`--all` / `--docs` / push 模式清单不变——本地没有
 *     test.yml 的独立步骤，剔了就是真覆盖损失（红线突破时由它兜底，见 tech-debt-ledger R1）。
 *   - 剔除项**不是**「CI 不查」，而是「CI 换个地方查，且那一处才带归属基线」。
 *   - 新增本表条目须确认：test.yml 中确有该工具的独立步骤（否则是覆盖损失）。
 *     护栏 tests/test_gate_static_tools.ts 断言本表 ⊆ test.yml 实际独立步骤。
 */
export const CI_INDEPENDENT_TOOLS: readonly string[] = ["check-deadcode-baseline.ts"];

/** 契约测试（按域裁剪 #2：变更域 → 只跑相关契约测试）。
 * 规则（与 doctor 共用 _lib/contract-tests.ts 的 selectContractTests）：
 *   --all 全量模式 → 全量（发版前体检，不可裁剪）
 *   --files / push 模式 → 按变更域（byDomain 键集）选子集：改 go 跑 go 相关、改前端跑前端相关、
 *     改 data 跑 schema、改 docs 跑文档契约；改 scripts/tests（域 'tests'）→ 全量（工具自身改动影响面大）
 *   --docs 轻量模式 → 跳过（byDomain 为空 → 子集空） */
export async function runContractTestsBlock(
  ctx: GateCtx,
  opts: { allMode: boolean; docsMode?: boolean; staticMode?: boolean; domains: string[] },
): Promise<void> {
  // 2026-10-08（第三轮审计 P0-①）：本地 push **不再重复跑契约测试**。
  // 证据链：
  //   ① CI 已全量跑同一脚本——test.yml:98-100 job `contracts` 的
  //      `node scripts/contract-tests.ts`（不传 --domain ⇒ contract-tests.ts:81 走 all 分支
  //      = 127 个测试全量），且 test.yml:95 注释明写「与本地 pre-push-gate **同源**」；
  //   ② 本地 push 侧实测 32.6s（push 总 63s 的**一半**），而命中 `tests` 域时
  //      selectContractTests 规则本就回退全量（contract-tests.ts:40-41「工具改动即命中
  //      'tests' → 全量」）⇒ 裁剪后 ≈ 全量 36.3s，等于把 CI 那个 job 原样再干一遍；
  //   ③ 这 32.6s 买不到任何 CI 不买的东西：契约测试是「代码正确性」而非「本次提交形态」，
  //      本地早失败省下的等待，远小于它每次都强收的固定税（且改 scripts/tests 必触发）。
  // 保留的例外（两类，都必须保留）：
  //   - `--all`（doctor 发版体检）：全量体检语义，不可裁；
  //   - `--static`（CI 的 pre-push-gate --static 步）：CI 侧无独立契约 job 契约覆盖，
  //     剔掉会让远端少一层（该步由 test.yml:245-253 调用）。
  // 逃生阀：`YSM_LOCAL_CONTRACT_TESTS=1` 恢复本地跑（排查「本地绿 CI 红」时用）。
  const localContractEnabled = process.env.YSM_LOCAL_CONTRACT_TESTS === "1";
  // 先算「本来会跑哪些」——只在**确实有匹配测试**时才记跳过说明。
  // 空域（无匹配）保持 no-op：与既有契约 `test_gate_schedule.ts` 「空域 + 非 all 模式不 record」
  // 一致（避免域裁剪为空的域给门禁输出凭空添噪声条目）。
  const contractFiles = opts.allMode ? undefined : selectContractTests(opts.domains);
  const wouldRun = opts.allMode || (contractFiles && contractFiles.length > 0);
  if (!wouldRun) return;
  if (!opts.allMode && !opts.staticMode && !localContractEnabled) {
    ctx.record("contract tests（本地跳过，交 CI contracts job 全量）", true, {
      time: 0,
      note: `本地 push 不重复跑 ${contractFiles!.length} 项：CI test.yml:98 已全量跑同一脚本（127 项）。设 YSM_LOCAL_CONTRACT_TESTS=1 可本地强制跑。`,
    });
    return;
  }
  const t0 = Date.now();
  const tests = await runContractTestsParallel(contractFiles);
  const ok = tests.length === 0 || tests.every((t) => t.ok);
  // ADR-234：标签如实描述执行面——原 `for f in tests/*.ts` glob 声称
  // 全量（实际 selectContractTests 按域裁剪子集 + _ 前缀排除 + spawn 有界并发，
  // push/files 模式只跑相关子集——假保证 + glob 语法 Windows 不可执行）
  ctx.record(`contract tests (${tests.length}${opts.allMode ? "，全量" : "，按域裁剪"})`, ok, {
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

/** 静态工具（--all / --docs / push 按变更域补挂）。
 * 回退 ADR-088：runTools 恢复串行，不 await。
 * 2026-08-17 P1-1 修复：push 模式此前从不执行静态治理工具（ALL_STATIC_TOOLS 只在
 * --all/--docs 跑）→ gate 名存实亡。现按变更域补挂子集：frontend 变更跑前端静态工具、
 * go 变更跑 Go 静态工具、docs/adr 变更跑文档静态工具——保持按域裁剪的轻量。 */
export function runStaticToolsDispatch(
  ctx: GateCtx,
  opts: { allMode: boolean; docsMode: boolean; staticMode?: boolean },
): void {
  if (opts.allMode) {
    // 刻意不跑 FRONTEND_STATIC_TOOLS（ADR-234）：三档扫描器是「全库阈值 + 增量
    // 裁剪」模式（scopedFiles），--all 无 --files 上下文，全量跑 = 301 条 debt 刷屏 +
    // check-params 59.4s 墙钟（见 gate-config.ts 三档位注释）——「防淹没 + 控成本」两动机
    // 在全量模式同样成立。baseline 比对落地后三档才有资格进 --all；覆盖尾行已如实点名。
    // 预算档位 full（2026-10-09 按表分级）：本表 35 项、实测 30.6–34.0s，套域表的 30s
    // 会压线假红（同一段落早些时候 <30s 通过 ⇒ 负载敏感）。档位跟着表的规模走。
    runTools(ctx, ALL_STATIC_TOOLS, { tier: "full" });
    runTools(ctx, DOC_EXTRA_SCRIPTS);
  }
  if (opts.docsMode) {
    runTools(ctx, DOC_STATIC_TOOLS);
    runTools(ctx, DOC_EXTRA_SCRIPTS);
  }
  if (opts.staticMode) {
    // CI 静态模式（--static，2026-09-14 锐评 P0）：补 CI 缺的那一层——静态治理工具。
    // 合并 ALL + DOC_EXTRA + FRONTEND 非 scoped 项，按 tool 名去重、FRONTEND 档位优先
    // （其 args 更严：event-graph --strict 覆盖 --check、check-biome --strict 等）。
    // 三档扫描器（complexity / params / type-safety）与 --all 同口径排除：它们需
    // --files 上下文，全库跑 = 301 条 debt 刷屏 + check-params 59.4s 墙钟。
    //
    // ⚠️ CI 已独立承担项的例外（2026-10-08 锐评去重）：deadcode 在 test.yml 的
    // frontend job 内有独立步骤，而本清单同款工具会再跑一遍——① 白烧一次
    // knip+jscpd 全扫（实测本地 3.4s），② 第二遍拿不到 step/job 级 env 之外的
    // 归属上下文（CI 跑在 push 之后、暂存区干净）⇒ 退严格模式把一切新增按阻断，
    // 与刚判过的独立步骤自相矛盾（假红）。故 CI 档剔除此项，唯一执行点归
    // test.yml 的独立步骤（它按 ADR-244 显式带 changed-base）。
    // ⚠️ 只剔 CI 档：`--all` 与 push 模式仍照跑（本地无 CI 独立步骤，覆盖不损）。
    const merged = new Map<string, GateTool>();
    for (const t of [...ALL_STATIC_TOOLS, ...DOC_EXTRA_SCRIPTS]) merged.set(t.tool, t);
    for (const t of FRONTEND_STATIC_TOOLS) if (!t.scopedFiles) merged.set(t.tool, t);
    for (const dup of CI_INDEPENDENT_TOOLS) merged.delete(dup);
    // 预算档位 full：合并表 ~40 项（ALL + DOC_EXTRA + FRONTEND 非 scoped），与 --all 同量级。
    runTools(ctx, [...merged.values()], { tier: "full" });
  }
  if (!opts.allMode && !opts.docsMode && !opts.staticMode) {
    if (ctx.plan.frontend) runTools(ctx, FRONTEND_STATIC_TOOLS);
    if (ctx.plan.go) runTools(ctx, GO_STATIC_TOOLS);
    if (ctx.plan.docs || ctx.plan.adr) {
      // 文件驱动模式：doc-drift / knowledge-drift 按 --files 裁剪（与 check-redlines 同款），
      // 避免并行会话留在 docs/knowledge/ 的未跟踪草稿卡（如 commit-with-check.md）阻断本次 commit。
      // 二者从通用 runTools 摘除（否则无 --files 全扫），改由 runScopedDocDrift 数组式传 --files。
      runTools(
        ctx,
        DOC_STATIC_TOOLS.filter((t) => t.tool !== "check-doc-drift.ts"),
      );
      runTools(
        ctx,
        DOC_EXTRA_SCRIPTS.filter((t) => t.tool !== "check-knowledge-drift.ts"),
      );
      runScopedDocDrift(ctx);
    }
  }
}

/** scripts/ TS 类型检查（--all / --docs 模式；.ts 文件随 _lib/ 迁移逐步出现）。
 * tsc 不是 mjs 脚本，不走 runTools 的 node scripts/ 路径；TS18003（无输入）容忍为通过。
 *
 * ⚠️ 二进制须经 `_lib/tool-bin.ts` 双根探测（2026-09-15 CI 实证）：本地常在根 `npm i`
 * （工具落根 .bin），CI 只在 `frontend/` 跑 `pnpm install`（工具落 frontend/.bin）——
 * 曾硬编码根路径，致本步在 CI 报 cmd 的「找不到路径」并以 hard 策略阻断整步。
 * `opts.resolveBin` 为测试注入缝（默认走真实探测），使契约测试可脱离环境断言。 */
export async function runScriptsTypecheck(
  ctx: GateCtx,
  opts: { allMode: boolean; docsMode: boolean; resolveBin?: (name: string) => string | null },
): Promise<void> {
  if (!opts.allMode && !opts.docsMode) return;
  const t0 = Date.now();
  const tsc = (opts.resolveBin ?? resolveToolBin)("tsc");
  if (!tsc) {
    // 缺工具不是「类型检查通过」：如实阻断 + 给出可执行处方（比 cmd 的缺路径报错可诊断）。
    ctx.record("npx tsc --noEmit -p scripts/tsconfig.json", false, {
      time: Date.now() - t0,
      note: "tsc 未安装（根 / frontend 两处 node_modules/.bin 均未命中）",
      tail: "修复：cd frontend && pnpm install（CI 唯一安装点 = frontend/）",
    });
    return;
  }
  const r = await ctx.shAsync(`"${tsc}" --noEmit -p scripts/tsconfig.json`);
  const tscOk = r.rc === 0 || r.rc === 2; // rc=2 = TS18003 无输入，容忍
  ctx.record("npx tsc --noEmit -p scripts/tsconfig.json", tscOk, {
    time: Date.now() - t0,
    raw: r.out,
    note:
      r.rc === 2
        ? "无 .ts 文件（待 _lib/ 迁移后生效）"
        : r.rc === 0
          ? "类型检查通过"
          : `${r.out.trim().split("\n").filter(Boolean).length} 个错误`,
    tail: r.rc === 0 ? "" : r.out.trim().split("\n").slice(-5).join("\n"),
  });
}
