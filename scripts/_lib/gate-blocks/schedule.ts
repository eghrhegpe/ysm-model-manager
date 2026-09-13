/**
 * 调度块（ADR-206 阶段 5）：契约测试 + 静态工具补挂 + scripts typecheck。
 *
 * 本模块回答「何时跑哪张清单」（调度），「怎么跑」在 static-tools.ts / contract-tests.ts。
 * 各函数自守卫：不满足模式的调用是 no-op，调度侧可无条件按序调用。
 *
 * @module gate-blocks/schedule
 */
import path from "node:path";
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
import { ROOT } from "../scan-files.ts";
import { runScopedDocDrift, runTools } from "./static-tools.ts";

/** 契约测试（按域裁剪 #2：变更域 → 只跑相关契约测试）。
 * 规则（与 doctor 共用 _lib/contract-tests.ts 的 selectContractTests）：
 *   --all 全量模式 → 全量（发版前体检，不可裁剪）
 *   --files / push 模式 → 按变更域（byDomain 键集）选子集：改 go 跑 go 相关、改前端跑前端相关、
 *     改 data 跑 schema、改 docs 跑文档契约；改 scripts/tests（域 'tests'）→ 全量（工具自身改动影响面大）
 *   --docs 轻量模式 → 跳过（byDomain 为空 → 子集空） */
export async function runContractTestsBlock(
  ctx: GateCtx,
  opts: { allMode: boolean; domains: string[] },
): Promise<void> {
  const contractFiles = opts.allMode ? undefined : selectContractTests(opts.domains);
  if (!opts.allMode && !(contractFiles && contractFiles.length > 0)) return;
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
    runTools(ctx, ALL_STATIC_TOOLS);
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
    const merged = new Map<string, GateTool>();
    for (const t of [...ALL_STATIC_TOOLS, ...DOC_EXTRA_SCRIPTS]) merged.set(t.tool, t);
    for (const t of FRONTEND_STATIC_TOOLS) if (!t.scopedFiles) merged.set(t.tool, t);
    runTools(ctx, [...merged.values()]);
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
 * tsc 不是 mjs 脚本，不走 runTools 的 node scripts/ 路径；TS18003（无输入）容忍为通过。 */
export async function runScriptsTypecheck(
  ctx: GateCtx,
  opts: { allMode: boolean; docsMode: boolean },
): Promise<void> {
  if (!opts.allMode && !opts.docsMode) return;
  const t0 = Date.now();
  const tSC = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  const r = await ctx.shAsync(`"${tSC}" --noEmit -p scripts/tsconfig.json`);
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
