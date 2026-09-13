/**
 * gate-coverage.ts — 门禁覆盖口径计算（「N/32 固定尾行」数据源）。
 *
 * 设计意图（2026-09-13 锐评 P2）：知识卡长期警示「门禁全绿 ≠ 仓库无风险」，但该警示
 * 只活在文档里，读者/AI 极易把 PASS 误读为安全。本模块把覆盖口径变成门禁输出的
 * **固定尾行**：每次跑都打「本次覆盖 x/M 项 check-*，未接入清单」，让诚实性约束
 * 从被动文档转为主动输出。
 *
 * 口径：
 *   全集   = scripts/check-*.ts（当前 32 个；动态枚举，新增脚本自动进入分母，
 *            防「写死 32 过期」——分母漂移本身就是需要被看见的信号）
 *   已覆盖 = gate-config 四张清单 + GO_STATIC_TOOLS + 域检查直连项（gate-blocks 内
 *            ctx.record 直接调用的 check-*，如 layering/redlines 等）
 *   未覆盖 = 全集 - 已覆盖（如 check-biome-lines / check-diff-coverage 等 pre-commit /
 *            doctor 旁路项），在尾行逐个点名
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts(ROOT) / _lib/gate-config.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  ALL_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
} from "./gate-config.ts";
import { ROOT } from "./scan-files.ts";

/**
 * 域检查直连（gate-blocks 内 ctx.record 调用、不走 gate-config 清单）的 check-* 脚本。
 * 手工常量（2026-09-13 锐评勘误 #9）：gate-blocks 新增直连 ctx.record("check-…") 时本数组
 * 不会自动更新 → 由 tests/test_gate_coverage.ts 双向扫描锁死（新增直连漏登记、或数组
 * 登记了已下线的检查，都会 FAIL），把「手工同步」升级为「测试网同步」。
 */
export const DOMAIN_BLOCK_CHECKS = [
  "check-layering.ts",
  "check-path-hygiene.ts",
  "check-mock-paths.ts",
  "check-menu-health.ts",
  "check-ctx-menu-i18n.ts",
  "check-binding-usage.ts",
  "check-redlines.ts",
] as const;

/** 全集：scripts/check-*.ts 动态枚举（文件名含 .ts 后缀） */
export function listAllCheckScripts(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((f) => /^check-.*\.ts$/.test(f))
    .sort();
}

/** 已覆盖集：清单 + 域直连的并集（取 basename，容忍清单写法差异） */
export function listCoveredCheckScripts(): Set<string> {
  const covered = new Set<string>();
  for (const tool of [
    ...ALL_STATIC_TOOLS,
    ...DOC_STATIC_TOOLS,
    ...DOC_EXTRA_SCRIPTS,
    ...FRONTEND_STATIC_TOOLS,
    ...GO_STATIC_TOOLS,
  ]) {
    if (tool.tool.startsWith("check-")) covered.add(tool.tool);
  }
  for (const c of DOMAIN_BLOCK_CHECKS) covered.add(c);
  return covered;
}

export interface GateCoverage {
  total: number;
  covered: number;
  uncovered: string[];
}

export function gateCoverage(): GateCoverage {
  const all = listAllCheckScripts();
  const covered = listCoveredCheckScripts();
  return {
    total: all.length,
    covered: all.filter((f) => covered.has(f)).length,
    uncovered: all.filter((f) => !covered.has(f)),
  };
}

/** 固定尾行文本（PASS/FAIL 两路共用，保证每次输出形态一致） */
export function coverageTailLine(): string {
  const c = gateCoverage();
  const list = c.uncovered.length ? `未接入: ${c.uncovered.join(", ")}` : "无未接入项";
  return `覆盖口径: ${c.covered}/${c.total} 项 check-* 已接入门禁（${list}）—— 全绿 ≠ 仓库无风险，未接入项走 pre-commit/CI/doctor 旁路`;
}
