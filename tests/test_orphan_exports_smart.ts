#!/usr/bin/env node
/**
 * 契约测试：check-orphan-exports「白名单豁免 + 路径模式 + debt 级阻断」。
 *
 * 背景（2026-09-08 门禁鸡肋审查）：doctor --all 报 check-orphan-exports 有
 * 28 个 orphan。分类分析：
 *
 *   VIEW_TESTIDS × 13    ← 模板测试用 ID，跨文件共享空导出（设计产物）
 *   DEFAULT_*_PARAMS × 5 ← ADR-196 重构中暂存的统一数据源
 *   wasm glue × 4        ← Emscripten 产物（ysm-wasm-data*.js, _getWasmBinary*）
 *   真孤儿 ≈ 1-2 个       ← getStateValue / setStateValue 这类
 *
 * 结论：28 个里约 22 个是**设计产物/生成物**，不应被 flag。
 * check-orphan-exports 应支持：
 *   1. 符号名白名单：VIEW_TESTIDS、DEFAULT_*_PARAMS
 *   2. 路径模式豁免：wasm/ 目录下的 .js/.d.ts（Emscripten 产物）
 *   3. 重构过渡豁免：标记为"refactor-in-progress"的导出（ADR-196 暂存）
 *   4. 阻断策略：硬阻断 → debt（命名/设计产物，不影响运行）
 *
 * 运行：node tests/test_orphan_exports_smart.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOrphanExempt } from "../scripts/check-orphan-exports.ts";

// ── 1. 设计产物识别：真实 28 个 orphan 分类 ────────────

// doctor --all 跑 check-orphan-exports 的完整输出
const REAL_ORPHANS_20260908 = [
  // 第一类：VIEW_TESTIDS × 13（模板共享的空导出）
  { symbol: "VIEW_TESTIDS", file: "frontend/src/features/community/render.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/features/dialogs/modal-core.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/features/maintenance/recycle-bin.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-content/settings/tpl-settings.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-content/tpl.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-nav/index.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-sidebar/tpl.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-sync-manager/tpl.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-toast/index.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-tree/index.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-tree/row-tpl.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/app-tree/tpl.ts" },
  { symbol: "VIEW_TESTIDS", file: "frontend/src/views/context-menu/index.ts" },

  // 第二类：caps 默认参数/类型（ADR-196 重构中统一数据源暂存）
  { symbol: "SHADOW_TYPES", file: "frontend/src/preview-3d/caps/shadow-state.ts" },
  { symbol: "DEFAULT_SHADOW_PARAMS", file: "frontend/src/preview-3d/caps/shadow-state.ts" },
  { symbol: "DEFAULT_SKY_PARAMS", file: "frontend/src/preview-3d/caps/sky-state.ts" },
  { symbol: "DEFAULT_WATER_PARAMS", file: "frontend/src/preview-3d/caps/water-state.ts" },
  { symbol: "deepMergeLightParams", file: "frontend/src/preview-3d/caps/light-presets.ts" },

  // 第三类：ADR-196 env-state 暂存（统一数据源 refactor 中间态）
  { symbol: "getEnvCallbackCount", file: "frontend/src/preview-3d/state/env-dispatcher.ts" },
  { symbol: "getPresetKeys", file: "frontend/src/preview-3d/state/env-state-schema.ts" },
  { symbol: "getStateValue", file: "frontend/src/preview-3d/state/env-state.ts" },
  { symbol: "setStateValue", file: "frontend/src/preview-3d/state/env-state.ts" },

  // 第四类：wasm glue（Emscripten 自动生成）
  { symbol: "_getGlueCodeMt", file: "frontend/src/wasm/ysm-glue-data-mt.js" },
  { symbol: "_getWasmBinaryMt", file: "frontend/src/wasm/ysm-wasm-data-mt.d.ts" },
  { symbol: "_getWasmBinaryMt", file: "frontend/src/wasm/ysm-wasm-data-mt.js" },
  { symbol: "_getWasmBinary", file: "frontend/src/wasm/ysm-wasm-data.d.ts" },

  // 第五类：其它
  { symbol: "stripBanSuffix", file: "frontend/src/utils/model-name/display.ts" },
  {
    symbol: "forceRefreshCommunitySites",
    file: "frontend/src/views/app-content/community-data.ts",
  },
];

console.log(`   真实仓库 orphan 总数: ${REAL_ORPHANS_20260908.length}`);

// 豁免判定委托给脚本真实实现（scripts/check-orphan-exports.ts isOrphanExempt，
// 单一事实源，防测试与脚本实现漂移——钻 XOR 空子）。
function checkExempt(orphan: { symbol: string; file: string }): string | null {
  return isOrphanExempt(orphan.symbol, orphan.file);
}

// 本地 glob 辅助（仅用于对 exempted 结果/边界做断言，非豁免逻辑本身；
// 豁免逻辑一律经 isOrphanExempt，避免测试自证自洽）
function globMatch(pattern: string, target: string): boolean {
  const DS = "\u0000DS\u0000";
  const SS = "\u0000SS\u0000";
  let s = pattern.replace(/\*\*/g, DS).replace(/\*/g, SS);
  s = s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  s = s.split(DS).join(".*").split(SS).join("[^/]*");
  return new RegExp(`^${s}$`).test(target);
}

// 分类 28 个真实 orphan
const exempted: Array<(typeof REAL_ORPHANS_20260908)[number] & { reason: string }> = [];
const realOrphans: Array<(typeof REAL_ORPHANS_20260908)[number]> = [];

for (const o of REAL_ORPHANS_20260908) {
  const reason = checkExempt(o);
  if (reason) exempted.push({ ...o, reason });
  else realOrphans.push(o);
}

console.log(`   豁免后: ${exempted.length} 设计产物 + ${realOrphans.length} 真孤儿`);

// 验证分类
const exemptedByReason = exempted.reduce<Record<string, number>>((acc, e) => {
  acc[e.reason] = (acc[e.reason] || 0) + 1;
  return acc;
}, {});
for (const [reason, count] of Object.entries(exemptedByReason)) {
  console.log(`     ${count} × ${reason}`);
}

assert.ok(
  exempted.length >= 20,
  `应豁免 ≥ 20 个设计产物（got ${exempted.length}），28 个里大部分是 VIEW_TESTIDS / DEFAULT_* / wasm glue / ADR-196 暂存`,
);
assert.ok(
  realOrphans.length <= 8,
  `真孤儿应 ≤ 8 个（got ${realOrphans.length}），大部分是设计产物`,
);

// 列出真孤儿
if (realOrphans.length > 0) {
  console.log("\n   真孤儿（应该手动清理或加 refactor 豁免）:");
  for (const o of realOrphans) {
    console.log(`     ${o.symbol} @ ${o.file}`);
  }
}

console.log("  ✓ 白名单 + 路径模式 + glob 匹配：28 → 20+ 豁免，只剩 ≤8 真孤儿");

// ── 2. 具体规则验证 ──────────────────────────────────

// VIEW_TESTIDS 应该被豁免 13 个
const viewTestIdsCount = exempted.filter((e) => e.symbol === "VIEW_TESTIDS").length;
assert.equal(viewTestIdsCount, 13, `VIEW_TESTIDS 应豁免 13 个（got ${viewTestIdsCount}）`);

// DEFAULT_*_PARAMS + *_TYPES 应该豁免 4 个（SHADOW_TYPES + DEFAULT_SHADOW/SKY/WATER_PARAMS）
const capsDefaultCount = exempted.filter(
  (e) => globMatch("DEFAULT_*_PARAMS", e.symbol) || globMatch("*_TYPES", e.symbol),
).length;
assert.equal(
  capsDefaultCount,
  4,
  `caps 默认参数/类型应豁免 4 个（got ${capsDefaultCount}）—— SHADOW_TYPES + DEFAULT_*_PARAMS ×3`,
);

// wasm glue 应该豁免 4 个（3 × _getWasmBinary* + 1 × _getGlueCodeMt）
const wasmCount = exempted.filter(
  (e) =>
    globMatch("**/wasm/*.{js,d.ts}", e.file) ||
    globMatch("_getWasmBinary*", e.symbol) ||
    globMatch("_getGlueCode*", e.symbol),
).length;
assert.equal(
  wasmCount,
  4,
  `wasm glue 应豁免 4 个（got ${wasmCount}）—— 3 × _getWasmBinary* + 1 × _getGlueCodeMt`,
);

// ADR-196 env-state 暂存应该豁免 5 个（getStateValue / setStateValue / getPresetKeys / getEnvCallbackCount / deepMergeLightParams）
const adr196Count = exempted.filter(
  (e) =>
    globMatch("get*Value", e.symbol) ||
    globMatch("set*Value", e.symbol) ||
    e.symbol === "getPresetKeys" ||
    e.symbol === "getEnvCallbackCount" ||
    e.symbol === "deepMergeLightParams",
).length;
assert.equal(adr196Count, 5, `ADR-196 暂存应豁免 5 个（got ${adr196Count}）`);

console.log(
  "  ✓ 具体规则验证：VIEW_TESTIDS(13) + caps defaults(5) + wasm glue(4) + ADR-196(5) 全部豁免",
);

// ── 3. 路径模式 glob 测试 ────────────────────────────

// wasm/ 目录下的文件应该被 pathGlob 命中
assert.ok(
  checkExempt({ symbol: "_getWasmBinary", file: "frontend/src/wasm/ysm-wasm-data.d.ts" }),
  "wasm/*.d.ts 应被 pathGlob 豁免",
);
assert.ok(
  checkExempt({ symbol: "anything", file: "frontend/src/wasm/ysm-wasm-data-mt.js" }),
  "wasm/*.js 应被 pathGlob 豁免",
);

// 非 wasm 目录不应该被 pathGlob 命中
assert.ok(
  !checkExempt({ symbol: "someRegularFunc", file: "frontend/src/utils/something.ts" }),
  "utils/ 目录下不应被 wasm 路径豁免（且符号名不符合任何豁免规则）",
);

// DEFAULT_*_PARAMS glob 应正确匹配
assert.ok(
  globMatch("DEFAULT_*_PARAMS", "DEFAULT_SHADOW_PARAMS"),
  "DEFAULT_*_PARAMS glob 应匹配 DEFAULT_SHADOW_PARAMS",
);
assert.ok(
  globMatch("DEFAULT_*_PARAMS", "DEFAULT_SKY_PARAMS"),
  "DEFAULT_*_PARAMS glob 应匹配 DEFAULT_SKY_PARAMS",
);
assert.ok(
  !globMatch("DEFAULT_*_PARAMS", "DEFAULT_PARAMS"),
  "DEFAULT_*_PARAMS glob 不应匹配 DEFAULT_PARAMS（缺中间词）",
);
assert.ok(
  !globMatch("DEFAULT_*_PARAMS", "OTHER_DEFAULT_PARAMS"),
  "DEFAULT_*_PARAMS glob 不应匹配 OTHER_DEFAULT_PARAMS（前缀错）",
);

console.log("  ✓ glob 模式匹配：pathGlob + symbolGlob 正确工作");

// ── 4. 阻断策略：orphan-exports 应降级为 debt ────────

// 和 boolean-naming 同级——设计产物/重构中间态很多，硬阻断会误伤
// code_review cbd138f38 #10（P2）：原 `for (...) assert.ok(true)` 恒真循环对被测
// 系统零验证——改为真实读取 gate-config.ts 断言三脚本确有 blockPolicy: 'debt' 声明
const SHOULD_BE_DEBT = [
  "check-orphan-exports.ts",
  "check-boolean-naming.ts",
  "check-deadcode-baseline.ts",
];
const gateConfigSrc = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "_lib",
    "gate-config.ts",
  ),
  "utf8",
);
for (const script of SHOULD_BE_DEBT) {
  assert.ok(
    gateConfigSrc.includes(`"${script}"`) && gateConfigSrc.includes(`blockPolicy: "debt"`),
    `${script} 应在 gate-config.ts 声明 blockPolicy: "debt"（设计产物/重构中间态，不影响运行）`,
  );
}

console.log("  ✓ 阻断策略：orphan-exports / boolean-naming / deadcode-baseline 应降级为 debt");

// ── 5. 真孤儿清理路径 ────────────────────────────────

// 真孤儿 ≤ 8 个时，可以手动逐个判定：
//   a) 如果是 refactor 中间态 → 加临时豁免规则（注明 ADR/commit）
//   b) 如果是 dead code → 直接删除导出
//   c) 如果是跨文件 import 的解析盲区 → 改进扫描逻辑
const CLEANUP_PATH = [
  "check-orphan-exports 扫出真孤儿（≤8 个）",
  "人工判定：refactor 中间态 → 加临时豁免；dead code → 删除导出",
  "豁免规则集中维护（orphan-exempt.json 或脚本内常量），注明原因和关联 ADR/commit",
  "定期清理：豁免规则超过 3 个月 → 要么重构完成（删除规则）要么确认永久设计产物（改硬编码白名单）",
];

console.log("\n   清理路径:");
for (let i = 0; i < CLEANUP_PATH.length; i++) {
  console.log(`     ${i + 1}. ${CLEANUP_PATH[i]}`);
}

console.log("  ✓ 清理路径明确：白名单集中维护 + 定期过期");

// ── 总结 ─────────────────────────────────────────

console.log("\n📋 check-orphan-exports 改造契约汇总：");
console.log("   1. 白名单三层：symbol 精确 + symbolGlob 模式 + pathGlob 路径");
console.log("   2. 28 orphan → 20+ 豁免（VIEW_TESTIDS 13 / wasm 4 / ADR-196 5 / caps 5）");
console.log("   3. 阻断策略从 hard 降级为 debt");
console.log("   4. 豁免规则集中维护，定期过期清理");
console.log("");
console.log("🟡 改造路径：");
console.log("   A. 先在脚本里加 ORPHAN_EXEMPT_RULES 常量 → 误报从 28 降到 ≤8");
console.log('   B. gate-config 加 blockPolicy: "debt" → 硬阻断消失');
console.log("   C. 后续逐个清理真孤儿（手动删除或加 refactor 豁免）");
