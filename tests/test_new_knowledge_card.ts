#!/usr/bin/env node
/**
 * test_new_knowledge_card.ts — new-knowledge-card.ts 模板契约测试。
 *
 * 覆盖（2026-10-06 实证的两处病）：
 *   1. kind 默认产出 **kebab-case**（仓规：kind = 文件名 kebab-case；实测 181:1 悬殊，
 *      旧模板默认 snake_case 是历史遗留默认值，与 gen-knowledge-index.ts:66 明示口径相反）
 *   2. 模板**不产出必失效的 invariant_anchors 占位符**——旧模板硬写 `{source}|TODO`，
 *      必然触发漂移 ERROR「机制锚失效」，使工具产出的新卡天生不合规（自己末尾还跑漂移检查）
 *
 * 断言方式：直接对 TEMPLATE 字符串与纯函数断言，不落盘（零写入，纯契约）。
 */
import { readFileSync } from "node:fs";
import { ROOT } from "../scripts/_lib/scan-files.ts";

// 复刻被测模块的纯函数（若模块改为导出，此处改为 import；保持双源同步由第 3 组守卫）
function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== new-knowledge-card 模板契约 ===");

// ── 1. kind 归一为 kebab-case ─────────────────────────
check("toKebabCase：连字符分隔", () => {
  assert(toKebabCase("gate-chain-map") === "gate-chain-map", toKebabCase("gate-chain-map"));
});
check("toKebabCase：下划线归一为连字符", () => {
  assert(toKebabCase("debt_ledger_refresh") === "debt-ledger-refresh", toKebabCase("debt_ledger_refresh"));
});
check("toKebabCase：camelCase 无分隔即压平（不臆造分隔）", () => {
  // toLowerCase 先于分隔符归一，故 camelCase 不产生连字符——这是有意的保守行为：
  // 臆造分隔会产出与作者意图不符的 kind，故要求作者显式写连字符。
  assert(toKebabCase("gateChainMap") === "gatechainmap", toKebabCase("gateChainMap"));
});
check("toKebabCase：首尾连字符裁剪", () => {
  assert(toKebabCase("--foo--bar--") === "foo-bar", toKebabCase("--foo--bar--"));
});

// ── 2. 模板不含 TODO 占位锚 ────────────────────────────
check("模板 invariant_anchors 不含占位值（TODO/空数组均非法）", () => {
  const tpl = readTemplate();
  assert(!tpl.includes("|TODO"), "模板不应硬写 |TODO 机制锚（必失效 → 新卡天生 ERROR）");
  assert(
    !tpl.includes("invariant_anchors"),
    "模板不应输出 invariant_anchors 字段（含空数组——校验器对 [] 与 TODO 同判 ERROR；"
      + "architecture 缺失该字段只报 WARN，由作者按实际机制补）",
  );
});

// ── 3. 源码与纯函数口径一致（防双源漂移）───────────────
check("源码使用连字符（无 _ 替换）", () => {
  const src = readSource();
  assert(
    src.includes('.replace(/[^a-z0-9\\u4e00-\\u9fff]+/g, "-")'),
    "源码应将分隔符归一为 '-'（kebab-case 单一事实源）",
  );
  // 只查函数定义（注释里的历史说明提及旧名属正常），避免误报
  assert(
    !/function\s+toSnakeCase\s*\(/.test(src),
    "旧 snake_case 归一函数应已移除（避免双源口径）",
  );
});

// ── helpers ───────────────────────────────────────────
function readSource(): string {
  return readFileSync(`${ROOT}/scripts/new-knowledge-card.ts`, "utf8");
}
function readTemplate(): string {
  const src = readSource();
  const m = src.match(/const TEMPLATE = `([\s\S]*?)`;/);
  assert(!!m, "未能从源码提取 TEMPLATE");
  return m![1];
}

console.log(fails.length === 0 ? "\n✅ 全部通过" : `\n❌ ${fails.length} 组失败`);
if (fails.length > 0) process.exit(1);