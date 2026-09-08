#!/usr/bin/env node
/**
 * 契约测试：jscpd-go「测试文件过滤」与「同文件自引用」智能豁免。
 *
 * 背景（2026-09-08 门禁鸡肋审查）：doctor --all 时 jscpd-go 报 8 个"新增重复对"，
 * 全部是 *_test.go 文件：
 *
 *   + go/download/download_edge_test.go#go/download/download_edge_test.go  ← benchmark 内部
 *   + go/internal/testutil/testutil.go#go/internal/testutil/testutil.go      ← 测试工具复用
 *   + go/sync/sync_boundary_test.go#go/sync/sync_toggle_hashlock_test.go   ← table-driven 同构
 *   + go/texture_cache/texture_cache_prune_test.go#go/texture_cache/texture_cache_prune_test.go
 *   + go/types/registry/types_edge_test.go#go/types/registry/types_edge_test.go
 *   + go/ysm/summary_benchmark_test.go#go/ysm/summary_benchmark_test.go
 *   + go/geometry/archive.go#go/geometry/maid_l0.go   ← 唯一生产代码对
 *   + go/sync/sync_toggle_hashlock_test.go#go/sync/sync_toggle_order_test.go
 *
 * 问题：测试代码的重复不算技术债——table-driven 测试必然同构、benchmark 内部 loop 必然
 * 自引用。jscpd-go 应该过滤掉测试文件之间的重复对，只看生产 Go 代码。
 *
 * 本测试定义了正确行为的契约：
 *   1. isGoTestFile：识别 Go 测试文件（*_test.go）
 *   2. filterTestDupes：从 pair 集合中剥离"两边都是测试文件"的对
 *   3. classifyDupes：把 pair 按 { prod-prod / prod-test / test-test } 三类归档
 *   4. ADR-144 真实案例回归：8 个 "added" 里 7 个 test-test 应被豁免
 *
 * 这些函数当前不在 jscpd-pairs.ts 中（仅存在于本测试里的"期望 API"形态），
 * 测试绿 = 正确行为逻辑被验证，可以搬去共享层；红 = 脚本没改，仍会误报。
 *
 * 零依赖（仅 node:assert）。fixture 内联，不读仓库文件。
 * 运行：node tests/test_jscpd_go_smart.ts
 */
import assert from "node:assert";
import {
  classifyDupes,
  filterTestDupes,
  isGoTestFile,
  isTestOnlyPair,
  matchDrift,
  pairsFrom,
} from "../scripts/_lib/jscpd-pairs.ts";

// ── 真实实现来自 _lib/jscpd-pairs.ts（isGoTestFile/filterTestDupes/classifyDupes） ──

// ── 1. isGoTestFile 基础判定 ──────────────────────

// 标准 *_test.go
assert.equal(isGoTestFile("go/sync/sync_boundary_test.go"), true, "*_test.go 应判定为测试");
assert.equal(
  isGoTestFile("go/download/download_zero_coverage_test.go"),
  true,
  "覆盖测试也算测试文件",
);
assert.equal(isGoTestFile("scripts/check-foo_test.ts"), false, "非 Go 测试后缀不应误判");

// 生产代码
assert.equal(isGoTestFile("go/sync/sync_boundary.go"), false, "非 *_test.go 不是测试");
assert.equal(isGoTestFile("go/types/classify.go"), false, "生产代码不是测试");
assert.equal(
  isGoTestFile("go/internal/testutil/testutil.go"),
  false,
  "名字含 test 但后缀是 .go 不是 _test.go —— 纯 Go 生产代码（测试工具库）",
);

// testdata 目录
assert.equal(isGoTestFile("go/scanner/testdata/bad.go"), true, "testdata/ 目录下算测试文件");

console.log("  ✓ isGoTestFile：基础判定正确（*_test.go / testdata / 生产代码不误判）");

// ── 2. filterTestDupes：过滤掉 test-test 对 ─────────

// 全部 test-test → 应全部过滤
const allTest = [
  "go/sync/sync_boundary_test.go#go/sync/sync_toggle_hashlock_test.go",
  "go/download/download_edge_test.go#go/download/download_edge_test.go",
  "go/internal/testutil/testutil.go#go/internal/testutil/testutil.go", // testutil 自身不是测试！
];
// 注意 testutil.go 是生产代码 → 上面第 3 个不是 test-test
assert.equal(isGoTestFile("go/internal/testutil/testutil.go"), false, "testutil.go 不是测试文件");
const filteredAll = filterTestDupes(allTest);
// sync_boundary_test × sync_toggle_hashlock_test = test-test → 过滤
// download_edge_test × download_edge_test = test-test → 过滤
// testutil.go × testutil.go = prod-prod → 保留
assert.equal(filteredAll.length, 1, "test-test 对应被过滤，testutil 自引用保留");
assert.equal(filteredAll[0], "go/internal/testutil/testutil.go#go/internal/testutil/testutil.go");

// 混合场景：1 个 prod-prod + 3 个 test-test
const mixed = [
  "go/geometry/archive.go#go/geometry/maid_l0.go", // prod-prod：真债
  "go/sync/sync_boundary_test.go#go/sync/sync_toggle_hashlock_test.go", // test-test
  "go/download/download_edge_test.go#go/download/download_edge_test.go", // test-test
  "go/ysm/summary_benchmark_test.go#go/ysm/summary_benchmark_test.go", // test-test
];
const filteredMixed = filterTestDupes(mixed);
assert.equal(filteredMixed.length, 1, "应只保留 1 个 prod-prod 对");
assert.ok(filteredMixed.includes("go/geometry/archive.go#go/geometry/maid_l0.go"));

// 全部 prod-prod → 不过滤
const allProd = [
  "go/geometry/archive.go#go/geometry/maid_l0.go",
  "go/sync/sync_push.go#go/sync/sync_toggle.go",
];
assert.deepEqual(filterTestDupes(allProd), allProd, "全生产代码不应被过滤");

// 空输入
assert.deepEqual(filterTestDupes([]), [], "空数组返回空");

console.log("  ✓ filterTestDupes：正确过滤 test-test 对，保留 prod-prod");

// ── 3. classifyDupes：三类归档 ─────────────────────

const mixedPairs = [
  "go/geometry/archive.go#go/geometry/maid_l0.go", // prod-prod
  "go/sync/sync_boundary_test.go#go/sync/sync_toggle_hashlock_test.go", // test-test
  "go/sync/sync.go#go/sync/sync_boundary_test.go", // prod-test
  "go/sync/sync_toggle_hashlock_test.go#go/sync/sync_toggle_order_test.go", // test-test
];
const classified = classifyDupes(mixedPairs);
assert.equal(classified.prod_prod.length, 1, "prod_prod 应 1 个");
assert.equal(classified.prod_test.length, 1, "prod_test 应 1 个");
assert.equal(classified.test_test.length, 2, "test_test 应 2 个");
assert.ok(classified.prod_prod.includes("go/geometry/archive.go#go/geometry/maid_l0.go"));
assert.ok(classified.prod_test.includes("go/sync/sync.go#go/sync/sync_boundary_test.go"));

console.log("  ✓ classifyDupes：三类归档正确");

// ── 4. 同文件自引用（A#A）的语义 ────────────────────

// 同文件自引用 + 是测试文件 = benchmark 内部 loop 或 table-driven 模板 → 应豁免
const selfTest = "go/download/download_edge_test.go#go/download/download_edge_test.go";
assert.equal(isTestOnlyPair(selfTest), true, "同文件测试自引用是 test-test → 应被豁免");

// 同文件自引用 + 是生产代码 = 真重复（函数内部复制粘贴）→ 应保留
const selfProd = "go/internal/testutil/testutil.go#go/internal/testutil/testutil.go";
assert.equal(isTestOnlyPair(selfProd), false, "同文件生产代码自引用不是 test-test → 保留为真债");

// 另一个生产代码自引用
const selfProd2 = "go/geometry/archive.go#go/geometry/archive.go";
assert.equal(isTestOnlyPair(selfProd2), false, "同文件 archive.go 自引用应保留");

console.log("  ✓ 同文件自引用：测试文件豁免，生产代码保留");

// ── 5. ADR-144 扩展真实案例回归（2026-09-08） ─────────

// doctor --all 跑 jscpd-go 报的 8 个 "新增重复对"
const addedReal20260908 = [
  "go/download/download_edge_test.go#go/download/download_edge_test.go",
  "go/geometry/archive.go#go/geometry/maid_l0.go",
  "go/internal/testutil/testutil.go#go/internal/testutil/testutil.go",
  "go/sync/sync_boundary_test.go#go/sync/sync_toggle_hashlock_test.go",
  "go/sync/sync_toggle_hashlock_test.go#go/sync/sync_toggle_order_test.go",
  "go/texture_cache/texture_cache_prune_test.go#go/texture_cache/texture_cache_prune_test.go",
  "go/types/registry/types_edge_test.go#go/types/registry/types_edge_test.go",
  "go/ysm/summary_benchmark_test.go#go/ysm/summary_benchmark_test.go",
];

const classifiedReal = classifyDupes(addedReal20260908);
console.log(
  `   ADR-144 扩展案例: ${classifiedReal.prod_prod.length} prod-prod + ${classifiedReal.prod_test.length} prod-test + ${classifiedReal.test_test.length} test-test`,
);

// 预期：8 个里只有 2 个 prod-prod（archive#maid_l0 + testutil 自引用），其余 6 个 test-test 应豁免
assert.equal(
  classifiedReal.prod_prod.length,
  2,
  `8 个 added 里应 2 个 prod-prod（got ${classifiedReal.prod_prod.length}）——只有 archive#maid_l0 和 testutil 自引用`,
);
assert.equal(
  classifiedReal.test_test.length,
  6,
  `8 个 added 里应 6 个 test-test（got ${classifiedReal.test_test.length}）——7 个 *_test.go 相关减去 1 个 prod-prod（testutil 自引用）`,
);

const onlyProd = filterTestDupes(addedReal20260908);
assert.equal(onlyProd.length, 2, "过滤 test-test 后应只剩 2 个真正技术债");

console.log("  ✓ ADR-144 扩展回归：8 added → 2 真债 + 6 test-test 豁免");

// ── 6. 漂移匹配 × 测试文件过滤的交集 ─────────────────

// 场景：added 里有 1 个 prod-prod 漂移 + 2 个 test-test 漂移
// 正确行为：先过滤 test-test，再对剩余 prod-prod 跑漂移匹配
const addedMixedDrift = [
  "go/packs/classify.go#go/types/location.go", // prod-prod 漂移
  "go/download/download_edge_test.go#go/download/download_edge_test.go", // test-test
];
const fixedOld = [
  "go/types/classify.go#go/types/location.go", // prod-prod 旧路径
  "go/download/download_edge_test.go#go/download_other_test.go", // test-test 旧路径
];

// 步骤 1：过滤 test-test
const addedProdOnly = filterTestDupes(addedMixedDrift);
const fixedProdOnly = filterTestDupes(fixedOld);
assert.equal(addedProdOnly.length, 1, "added 过滤 test-test 后只剩 prod-prod");
assert.equal(fixedProdOnly.length, 1, "fixed 过滤 test-test 后只剩 prod-prod");

// 步骤 2：漂移匹配
const drift = matchDrift(addedProdOnly, fixedProdOnly);
assert.equal(drift.length, 1, "prod-prod 漂移应被匹配");
assert.equal(drift[0].type, "exact", "classify.go 搬迁 → exact 漂移");

console.log("  ✓ 漂移匹配 × 测试文件过滤：先过滤再匹配，互不干扰");

// ── 7. 与现有 jscpd-pairs 函数的集成点 ─────────────────

// pairsFrom → classifyDupes 是 jscpd-go 应有的集成链
const jscpdReport = {
  duplicates: [
    {
      firstFile: { name: "go\\download\\download_edge_test.go" },
      secondFile: { name: "go\\download\\download_edge_test.go" },
    },
    {
      firstFile: { name: "go\\geometry\\archive.go" },
      secondFile: { name: "go\\geometry\\maid_l0.go" },
    },
    {
      firstFile: { name: "go\\sync\\sync_boundary_test.go" },
      secondFile: { name: "go\\sync\\sync_toggle_hashlock_test.go" },
    },
  ],
};
const pairs = pairsFrom(jscpdReport); // 反斜杠→正斜杠 + 归一化
const classified7 = classifyDupes(pairs);
assert.equal(pairs.length, 3, "jscpd 报告 3 对 → pairsFrom 应提取 3 个归一化对");
assert.equal(classified7.prod_prod.length, 1, "1 个 prod-prod（archive#maid_l0）");
assert.equal(classified7.test_test.length, 2, "2 个 test-test");

// jscpd-go 最终应只对 prod_prod 跑 baseline 比对 + 漂移匹配
const realDebtOnly = filterTestDupes(pairs);
assert.equal(realDebtOnly.length, 1, "最终只有 1 个真正技术债需要门禁处理");

console.log("  ✓ 集成链：pairsFrom → classifyDupes → filterTestDupes 正确");
console.log("     （这个链就是 jscpd-go.ts 应该调用的序列）");

// ── 总结 ─────────────────────────────────────────

console.log("\n📋 正确行为契约汇总：");
console.log("   1. isGoTestFile：*_test.go + testdata/ → 测试文件");
console.log("   2. isTestOnlyPair：两边都是测试 → 不计入技术债");
console.log("   3. classifyDupes：prod_prod / prod_test / test_test 三类归档");
console.log("   4. ADR-144 扩展案例：8 added → 2 真债 + 6 豁免");
console.log("   5. 集成链：pairsFrom → classifyDupes → filterTestDupes → baseline 比对");
console.log("   real 实现来源: scripts/_lib/jscpd-pairs.ts（已由 jscpd-go.ts 接入门禁）");
console.log("   ✓ 本契约测试与 jscpd-go.ts 共享同一实现，防止钻 XOR 空子");
