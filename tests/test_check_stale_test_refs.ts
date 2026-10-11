#!/usr/bin/env node
/**
 * 契约测试：check-stale-test-refs.ts 注释点名测试引用存在性闸（巡检第 14 轮 F4）。
 *
 * 覆盖：
 *   1. Go 假声明抓到（第 14 轮原型病灶：TestFindInstDir_ResourcepackZipKept 型）
 *   2. Go 真名点名不误报；改名后指认真身转绿
 *   3. TS 陈旧 basename 抓到、现役 basename 放过、任意目录同名放过
 *   4. 代码行不判（字符串字面量喂被测函数属合法引用）
 *   5. 通配/片段（`*.parity.test.ts`、`-parity.test.ts`）与示例名（x/foo/fake 前缀/_r6）豁免
 *   6. 数据值示例（引号紧邻 "TestModel"、XML 串 TestModel</name>）不判
 *   7. 行内豁免 claim-check:ignore: 带理由生效、空理由不豁免
 *   8. 全仓自检：当前源码树 0 命中（闸上线即清账，且防豁免规则被后续改动悄悄放宽）
 *
 * 零依赖（仅 node:assert / node:path / node:url）。
 * 运行：node tests/test_check_stale_test_refs.ts（经 contract-tests 的 @/ 别名注入）
 */
import assert from "node:assert";
import { buildIndex, scanAll, scanText, type TestIndex } from "../scripts/check-stale-test-refs.ts";
import { check, finish } from "./_lib.mts";

const GO = "go/types/registry/findinst.go";
const TS = "frontend/src/preview-3d/menu/engine/core.ts";

/** 合成索引：只放本测试可控的真名集合。 */
function fakeIndex(o: Partial<TestIndex> = {}): TestIndex {
  return {
    tsFiles: new Set(o.tsFiles ?? ["health.test.ts", "items.test.ts", "components-styles.test.ts"]),
    goFuncs: new Set(o.goFuncs ?? ["TestFindInstDir_Resourcepack_NoFallback", "TestIsGuiBone"]),
  };
}

function refsGo(text: string): string[] {
  return scanText(GO, text, fakeIndex()).map((h) => h.ref);
}
function refsTs(text: string): string[] {
  return scanText(TS, text, fakeIndex()).map((h) => h.ref);
}

check("Go：注释点名不存在的 Test 符号 → 抓到（第 14 轮原型病灶）", () => {
  const hits = refsGo("// 兜底扫描完全失效（回归守卫 TestFindInstDir_ResourcepackZipKept）。");
  assert.deepEqual(hits, ["TestFindInstDir_ResourcepackZipKept"]);
});

check("Go：真名点名放过；改名后指认真身转绿", () => {
  assert.deepEqual(refsGo("// 见 TestIsGuiBone 表驱动。"), []);
  // 同一行注释：旧名（不在索引）仍抓、新名（在索引）放过——混合形态只报缺的那个
  const mixed = refsGo(
    "// 守卫 TestFindInstDir_Resourcepack_NoFallback（原 TestFindInstDir_ResourcepackZipKept 已改造）。",
  );
  assert.deepEqual(mixed, ["TestFindInstDir_ResourcepackZipKept"]);
});

check("TS：陈旧 basename 抓到、现役放过、路径前缀取 basename", () => {
  assert.deepEqual(refsTs("// 导出供 preview-menu-health.test.ts 复用。"), ["preview-menu-health"]);
  assert.deepEqual(refsTs("// 导出供 health.test.ts 复用。"), []);
  assert.deepEqual(refsTs("// 见 @/preview-3d/menu/engine/items.test.ts 遍历断言。"), []);
});

check("代码行不判：字符串字面量（夹具名喂被测函数）属合法引用", () => {
  // 非注释行（无 // 前导）——即便引用不存在也不报
  const hits = refsGo('if name == "TestNotARealLock" {\n\treturn\n}');
  assert.deepEqual(hits, []);
});

check("通配/片段与示例名豁免：*.parity.test.ts、x.test.ts、foo.d.test.ts、_r6_canary", () => {
  assert.deepEqual(refsTs("// 白名单豁免 *-parity.test.ts 双端同源。"), []);
  assert.deepEqual(refsTs("// 目录级剪枝会让 core/__tests__/x.test.ts 静默逃逸。"), []);
  assert.deepEqual(refsTs("// 探测 `foo.d.test.ts`（而非 foo.test.ts）。"), []);
  assert.deepEqual(refsTs("// 金丝雀 _r6_canary.test.ts 已随迁移移除。"), []);
});

check("数据值示例豁免：引号紧邻与 XML 串形态的 TestModel 不判", () => {
  assert.deepEqual(
    refsGo('// e.g. "TestModel</name>" → "TestModel", "abc123</hash>" → "abc123"'),
    [],
  );
});

check("行内豁免：claim-check:ignore: 带理由生效；空理由不豁免", () => {
  assert.deepEqual(
    refsGo("// 回归守卫 TestGhostLock。 // claim-check:ignore: 行为示例，仓内无此锁系刻意虚构"),
    [],
  );
  const noReason = refsGo("// 回归守卫 TestGhostLock。 // claim-check:ignore:");
  assert.deepEqual(noReason, ["TestGhostLock"], "空理由不构成豁免");
});

check("非生产文件域不判：.test.ts / _test.go 自身互引归测试域演化", () => {
  assert.equal(
    scanText("go/types/registry/findinst_test.go", "// 依赖 TestPhantomHelper", fakeIndex()).length,
    0,
  );
  assert.equal(
    scanText("frontend/src/foo.test.ts", "// 见 phantom.test.ts", fakeIndex()).length,
    0,
  );
});

check("全仓自检：当前源码树 0 命中（闸上线即清账 + 防豁免面被悄悄放宽）", () => {
  const index = buildIndex();
  assert.ok(index.tsFiles.size > 100, `ts 索引体量异常: ${index.tsFiles.size}`);
  assert.ok(index.goFuncs.size > 500, `go 索引体量异常: ${index.goFuncs.size}`);
  const hits = scanAll(index);
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line} → ${h.ref}`),
    [],
    "存在陈旧测试引用：改注释指认真身，或确属示例加 claim-check:ignore 豁免",
  );
});

finish();
