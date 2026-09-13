#!/usr/bin/env node
/**
 * data-docs-domain.ts — 数据域 / 文档域 / ADR 域 / 索引守护执行器（ADR-206 阶段 3）。
 *
 * 从 pre-push-gate.ts 的 main 闭包搬出四段串行域检查：
 *   - runDataDomain(ctx)      数据域：type-consistency（单一事实来源派生守卫）
 *   - runDocsDomain(ctx)      文档域：link-checker（断链）+ release-notes-gen --check（tag 漂移）
 *   - runAdrDomain(ctx)       ADR 域：adr-check
 *   - runDocsIndexGuard(ctx)  生成器守护：gen-docs-index --check（索引产物过期）
 *
 * 四者共用同一形态：`ctx.sh` 同步执行 → 手工解析 `_summary` 拼自定义 note → record。
 * 之所以**不**收敛进 parseToolOutput：这几处判定是 fail-closed 语义而非 parseToolOutput
 * 的「_summary.ok → errors===0 → rc」链——
 *   · type-consistency 只认 `issues===0`（缺失/解析失败必须阻断）
 *   · link-checker 只认 `links_broken===0`
 *   · release-notes-gen / adr-check / gen-docs-index 天然 rc 判定
 * ADR-206 §2.4 明确「显式特例不塞进通用契约」，故判定逻辑原样搬动，仅补注释说明。
 *
 * 自守卫（guard 在模块内而非调用点）：`pre-push-gate` 的调度段因此回到「无条件按序调用」的
 * 纯骨架形态，与 Go/前端域 IIFE 内的 `if (!plan.go) return;` 同构，避免 plan 判定散落两处。
 *
 * record 行为像素级不变（label / note / tail / raw / time 原样），由三模式 dry-run
 * baseline diff 守护（ADR-206 §3）。
 *
 * 依赖：_lib/gate-ctx（GateCtx）/ _lib/gate-parse（tryParseSummary）
 *
 * 用法：
 *   import { runDataDomain, runDocsDomain } from "./gate-blocks/data-docs-domain.ts";
 *   runDataDomain(ctx); // 自行判定 ctx.plan.data
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 */
import type { GateCtx } from "../gate-ctx.ts";
import { tryParseSummary } from "../gate-parse.ts";

/** 数据域：resource_types.json ↔ extensions.ts 派生链路（ADR-204）。 */
export function runDataDomain(ctx: GateCtx): void {
  if (!ctx.plan.data) return;
  const t0 = Date.now();
  const tc = ctx.sh("node scripts/type-consistency.ts --json");
  // 特殊块：只取 _summary.issues 数值；解析失败 → null（fail-closed 阻断，不静默放行）
  const issues = tryParseSummary(tc.out)?.issues ?? null;
  const ok = issues === 0;
  ctx.record("node scripts/type-consistency.ts --json", ok, {
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

/** 文档域：断链 + 发版说明漂移（git tag 单一事实源）。 */
export function runDocsDomain(ctx: GateCtx): void {
  if (!ctx.plan.docs) return;
  const t0 = Date.now();
  const lc = ctx.sh("node scripts/link-checker.ts --json");
  // 特殊块：link-checker 正常路径退出码恒 0（见文件头「已知坑」），故只认 links_broken；
  // 解析失败 → null → fail-closed 阻断，不静默放行
  const broken = tryParseSummary(lc.out)?.links_broken ?? null;
  const ok = broken === 0;
  ctx.record("node scripts/link-checker.ts --json", ok, {
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
  const rn = ctx.sh("node scripts/release-notes-gen.ts --check");
  ctx.record("node scripts/release-notes-gen.ts --check", rn.rc === 0, {
    time: Date.now() - t1,
    tail: rn.rc ? rn.out.trim().split("\n").slice(-14).join("\n") : "",
  });
}

/** ADR 域：决策记录编号/状态/被取代标注健康度。 */
export function runAdrDomain(ctx: GateCtx): void {
  if (!ctx.plan.adr) return;
  const t0 = Date.now();
  const ac = ctx.sh("node scripts/adr-check.ts");
  ctx.record("node scripts/adr-check.ts", ac.rc === 0, {
    time: Date.now() - t0,
    raw: ac.out,
    tail: ac.rc ? ac.out.trim().split("\n").slice(-4).join("\n") : "",
  });
}

/** 生成器守护：索引产物是否过期（docs 或 adr 变更时）。 */
export function runDocsIndexGuard(ctx: GateCtx): void {
  if (!ctx.plan.docs && !ctx.plan.adr) return;
  const t0 = Date.now();
  const gd = ctx.sh("node scripts/gen-docs-index.ts --check");
  ctx.record("node scripts/gen-docs-index.ts --check", gd.rc === 0, {
    time: Date.now() - t0,
    raw: gd.out,
    tail: gd.rc ? gd.out.trim().split("\n").slice(-4).join("\n") : "",
  });
}
