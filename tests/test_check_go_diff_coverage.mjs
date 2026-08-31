// tests/test_check_go_diff_coverage.mjs — check-go-diff-coverage.mjs 纯函数契约测试。
//
// 覆盖（不触发真实 go test，快速确定）：
//   1. parseGoCover：解析 go coverprofile 文本 → 文件→语句块映射
//   2. stripModulePrefix：模块根前缀剥离
//   3. stmtPctForChangedLines：变更行覆盖率加权计算（含空/纯注释边界）
//   4. packagePatternFor：改动文件 → go 包模式
//   5. addLinesFromDiff：`--unified=0` diff 新增行号提取
import assert from 'node:assert/strict';
import {
  parseGoCover,
  stripModulePrefix,
  stmtPctForChangedLines,
  packagePatternFor,
  addLinesFromDiff,
  buildSuggestBlock,
  isExemptLifecycle,
} from '../scripts/check-go-diff-coverage.mjs';

const errors = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

// ── 1. parseGoCover ──
check('parseGoCover 解析语句块', () => {
  const txt = [
    'mode: set',
    'ysm-model-manager/go/download/download.go:37.29,37.44 1 1',
    'ysm-model-manager/go/download/download.go:90.3,92.2 3 0',
    'ysm-model-manager/go/scanner/scanner.go:352.13,352.30 2 1',
    '',
  ].join('\n');
  const m = parseGoCover(txt);
  assert.equal(m.get('go/download/download.go').length, 2);
  assert.deepEqual(m.get('go/download/download.go')[1], { sl: 90, el: 92, n: 3, count: 0 });
  assert.equal(m.get('go/scanner/scanner.go')[0].count, 1);
});

check('parseGoCover 空文本 → 空 Map', () => {
  assert.equal(parseGoCover('').size, 0);
});

// ── 2. stripModulePrefix ──
check('stripModulePrefix 剥离模块根', () => {
  assert.equal(stripModulePrefix('ysm-model-manager/go/x/a.go'), 'go/x/a.go');
  assert.equal(stripModulePrefix('ysm-model-manager/internal/app/app.go'), 'internal/app/app.go');
  assert.equal(stripModulePrefix('ysm-model-manager/main.go'), 'main.go');
});

// ── 3. stmtPctForChangedLines ──
check('覆盖统计：变更行命中已覆盖块 → 100%', () => {
  const blocks = [{ sl: 37, el: 37, n: 1, count: 1 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([37])), 100);
});

check('覆盖统计：变更行命中未覆盖块 → 0%', () => {
  const blocks = [{ sl: 90, el: 92, n: 3, count: 0 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([91])), 0);
});

check('覆盖统计：部分覆盖按语句数加权', () => {
  const blocks = [
    { sl: 10, el: 12, n: 3, count: 1 },   // 覆盖 3 条
    { sl: 20, el: 22, n: 1, count: 0 },   // 未覆盖 1 条
  ];
  // 变更行同时命中两段 → 3/4 = 75%
  const pct = stmtPctForChangedLines(blocks, new Set([10, 11, 20, 21]));
  assert.ok(Math.abs(pct - 75) < 1e-9, `pct=${pct}`);
});

check('覆盖统计：变更行无语句（纯注释）→ 100% 放行', () => {
  const blocks = [{ sl: 50, el: 50, n: 1, count: 0 }];
  assert.equal(stmtPctForChangedLines(blocks, new Set([99])), 100);
});

check('覆盖统计：无块 → 100%', () => {
  assert.equal(stmtPctForChangedLines([], new Set([1])), 100);
});

// ── 4. packagePatternFor ──
check('packagePatternFor 包模式', () => {
  assert.equal(packagePatternFor('go/scanner/scanner.go'), './go/scanner/...');
  assert.equal(packagePatternFor('internal/app/app.go'), './internal/app/...');
  assert.equal(packagePatternFor('main.go'), '.');
});

// ── 5. addLinesFromDiff ──
check('addLinesFromDiff 提取新增行号', () => {
  const diff = [
    '@@ -10,6 +10,8 @@',
    ' aaa',
    '+newline1',
    '+newline2',
    ' bbb',
    ' ccc',
    '-removed',
    '+newline3',
  ].join('\n');
  const out = new Set();
  addLinesFromDiff(out, diff);
  // 新增块从第 10 行开始：newline1=11, newline2=12, 上下文 bbb=13, ccc=14, 删除行不算, newline3=15
  assert.deepEqual([...out].sort((a, b) => a - b), [11, 12, 15]);
});

// ── 6. buildSuggestBlock ──
check('buildSuggestBlock 生成 Markdown 区块', () => {
  const block = buildSuggestBlock([{ file: 'go/x/a.go', pct: 30.5 }], 60);
  assert.ok(block.includes('## Go 覆盖率建议（非阻断）'));
  assert.ok(block.includes('- `go/x/a.go` — 30.5%'));
});

// ── 7. isExemptLifecycle ──
check('isExemptLifecycle 命中窗口事件豁免名单', () => {
  assert.equal(isExemptLifecycle('internal/app/plaza_window.go'), true);
});

check('isExemptLifecycle 普通文件不豁免', () => {
  assert.equal(isExemptLifecycle('internal/app/app.go'), false);
  assert.equal(isExemptLifecycle('go/scanner/scanner.go'), false);
});

if (errors.length) {
  console.error(`\ntest_check_go_diff_coverage.mjs: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log('test_check_go_diff_coverage.mjs: 全部通过 ✅');
}
