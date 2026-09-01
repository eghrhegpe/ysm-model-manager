#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/jscpd-pairs.ts 共享层单元测试。
 *
 * 背景（2026-09-01 ADR-144 复盘）：jscpd-go.ts 门禁对「文件搬迁」失明——
 * classify.go 从 go/types/ 搬到 go/packs/ 后，重复对 key 从
 * `go/types/classify.go#go/types/location.go` 变成 `go/packs/classify.go#go/types/location.go`，
 * 增量门禁误报「新增 3 个重复对」，实际零新债（旧 baseline 三对全命中路径漂移）。
 * 本次修复把 pair 归一化/漂移匹配抽成共享层并钉住行为：
 *
 *   1. normPair：A#B 与 B#A 归一为同一对（R24 review P3 语义保持）
 *   2. pairsFrom：从 jscpd v5 报告提取归一化文件对（丢弃 \\ → / 差异）
 *   3. matchDrift：added 对与 fixed 对按 basename 集匹配路径漂移
 *      - exact：basename 集完全相同（纯搬迁，如 classify.go 搬家）
 *      - partial：basename 集部分交集（测试拆文件，如 types_extra_test.go 拆出 model_file_test.go）
 *      - 无交集：真新债，不标漂移
 *   4. ADR-144 真实案例回归：三对 added ↔ 三对 fixed 全部识别为漂移
 *
 * 零依赖（仅 node:assert）。fixture 内联，不读仓库文件。
 * 运行：node tests/test_jscpd_pairs.ts
 */
import assert from 'node:assert';
import { normPair, pairsFrom, matchDrift } from '../scripts/_lib/jscpd-pairs.ts';

// ── 1. normPair：归一化 ─────────────────────────────
assert.equal(normPair('a.go#b.go'), 'a.go#b.go', '正序对应原样');
assert.equal(normPair('b.go#a.go'), 'a.go#b.go', '逆序对应排序归一');
assert.equal(normPair('a.go#a.go'), 'a.go#a.go', '同文件对原样');

// ── 2. pairsFrom：jscpd v5 报告提取 ─────────────────
const report = {
  duplicates: [
    { firstFile: { name: 'go\\a.go' }, secondFile: { name: 'go\\b.go' } },
    { firstFile: { name: 'go/b.go' }, secondFile: { name: 'go/a.go' } }, // 逆序 + 正斜杠
    { firstFile: { name: 'go\\c.go' }, secondFile: { name: 'go\\c.go' } },
  ],
};
assert.deepEqual(
  pairsFrom(report),
  ['go/a.go#go/b.go', 'go/c.go#go/c.go'],
  '应去重 + 归一 + 反斜杠转正斜杠 + 排序',
);
assert.deepEqual(pairsFrom({ duplicates: [] }), [], '空报告返回空数组');
assert.deepEqual(pairsFrom({}), [], '缺 duplicates 字段返回空数组');

// ── 3. matchDrift：漂移匹配 ─────────────────────────
const base = (p) => p.split('/').pop();

// 3a. exact：basename 集完全相同（classify.go 纯搬迁）
const driftExact = matchDrift(
  ['go/packs/classify.go#go/types/location.go'],
  ['go/types/classify.go#go/types/location.go'],
);
assert.equal(driftExact.length, 1, 'exact 漂移应命中 1 条');
assert.equal(driftExact[0].type, 'exact', 'classify.go 搬迁应判 exact');
assert.equal(driftExact[0].added, 'go/packs/classify.go#go/types/location.go');
assert.equal(driftExact[0].fixed, 'go/types/classify.go#go/types/location.go');

// 3b. partial：basename 集部分交集（types_extra_test.go 拆出 model_file_test.go）
const driftPartial = matchDrift(
  ['go/internal/testutil/testutil.go#go/packs/model_file_test.go'],
  ['go/internal/testutil/testutil.go#go/types/types_extra_test.go'],
);
assert.equal(driftPartial.length, 1, 'partial 漂移应命中 1 条');
assert.equal(driftPartial[0].type, 'partial', '共享 testutil.go 应判 partial');
assert.deepEqual(
  driftPartial[0].shared.map(base).sort(),
  ['testutil.go'],
  'shared 应只含交集 basename testutil.go',
);

// 3c. 无交集：真新债，不标漂移
const driftNone = matchDrift(
  ['go/x/new_dup.go#go/y/other.go'],
  ['go/types/classify.go#go/types/location.go'],
);
assert.equal(driftNone.length, 0, 'basename 集无交集不应标漂移');

// 3d. 边界：空输入
assert.deepEqual(matchDrift([], ['a#b']), [], 'added 为空返回空');
assert.deepEqual(matchDrift(['a#b'], []), [], 'fixed 为空返回空');

// 3e. 一对多：一个 added 只匹配最优（exact > partial）
const driftBest = matchDrift(
  ['go/packs/classify.go#go/types/location.go'],
  [
    'go/types/classify.go#go/types/location.go', // exact
    'go/packs/classify.go#go/other/thing.go',    // partial（共享 classify.go）
  ],
);
assert.equal(driftBest.length, 1, '一个 added 只出一条最优匹配');
assert.equal(driftBest[0].type, 'exact', 'exact 优先于 partial');

// ── 4. ADR-144 真实案例回归：三 added ↔ 三 fixed 全漂移 ──
const addedReal = [
  'go/internal/testutil/testutil.go#go/packs/model_file_test.go',
  'go/packs/classify.go#go/types/location.go',
  'go/packs/model_file_test.go#go/sync/sync_extra_test.go',
];
const fixedReal = [
  'go/internal/testutil/testutil.go#go/types/types_extra_test.go',
  'go/types/classify.go#go/types/location.go',
  'go/sync/sync_extra_test.go#go/types/types_extra_test.go',
];
const driftReal = matchDrift(addedReal, fixedReal);
assert.equal(driftReal.length, 3, `ADR-144 三对应全部识别为漂移（got ${driftReal.length}）`);
assert.equal(
  driftReal.filter((d) => d.type === 'exact').length, 1,
  '应恰 1 条 exact（classify.go 搬迁）',
);
assert.equal(
  driftReal.filter((d) => d.type === 'partial').length, 2,
  '应恰 2 条 partial（测试拆文件）',
);

console.log('OK: jscpd-pairs 共享层契约测试全过');
console.log(`   normPair / pairsFrom / matchDrift(exact+partial) / ADR-144 回归 ${driftReal.length}/3 漂移识别`);
