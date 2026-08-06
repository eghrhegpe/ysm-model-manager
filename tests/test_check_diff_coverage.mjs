#!/usr/bin/env node
/**
 * 契约测试：check-diff-coverage.mjs 纯函数单元测试。
 *
 * 覆盖边界情况（源自 MikuMikuAR __tests__/check-diff-coverage.test.mjs，适配本仓库）：
 *   1. addLinesFromDiff：仅取 + 行号、上下文行递增、- 行不递增、多 hunk 独立起始
 *   2. parseRenameStatus：R 行解析（相似度/来源/目标），忽略 M/A/D
 *   3. statementPctForChangedLines：无语句 100 / 纯改名 100 / 部分覆盖按比例 / 空 statementMap 100
 *   4. buildSuggestBlock：commit message 建议区块格式与幂等对位
 *
 * 零依赖（仅 node:assert）。运行：node tests/test_check_diff_coverage.mjs
 */
import assert from 'node:assert';
import {
  addLinesFromDiff,
  parseRenameStatus,
  statementPctForChangedLines,
  buildSuggestBlock,
} from '../scripts/check-diff-coverage.mjs';

const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error('✗', name, '-', e.message);
  }
}

check('addLinesFromDiff 仅取 + 行号，上下文行递增，- 行不递增', () => {
  const diff = [
    'diff --git a/old b/new',
    '--- a/old',
    '+++ b/new',
    '@@ -10,3 +10,3 @@',
    ' context',
    '-removed',
    '+added',
    ' context2',
  ].join('\n');
  const out = new Set();
  addLinesFromDiff(out, diff);
  // 行号推演：@@ +10 → 10；" context"( )→11；"-removed" 不递增(11)；
  // "+added"(+)→add(11)→12；" context2"( )→13
  assert.deepEqual([...out], [11]);
});

check('addLinesFromDiff 多 hunk 各自独立起始', () => {
  const diff = [
    '@@ -1,1 +1,1 @@',
    '+only',
    '@@ -50,1 +50,1 @@',
    '+fifty',
  ].join('\n');
  const out = new Set();
  addLinesFromDiff(out, diff);
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    [1, 50],
  );
});

check('parseRenameStatus 解析 R 行，忽略 M/A/D', () => {
  const out = [
    'R098\tfrontend/src/views/app-content/site/edit.ts\tfrontend/src/views/app-content/site/editor.ts',
    'R100\ta/b.ts\ta/c.ts',
    'M\tx/y.ts',
    'A\tz/new.ts',
  ].join('\n');
  const map = parseRenameStatus(out);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('frontend/src/views/app-content/site/editor.ts'), {
    from: 'frontend/src/views/app-content/site/edit.ts',
    sim: 98,
  });
  assert.deepEqual(map.get('a/c.ts'), { from: 'a/b.ts', sim: 100 });
  assert.equal(map.has('x/y.ts'), false);
  assert.equal(map.has('z/new.ts'), false);
});

check('statementPctForChangedLines 变更行上无语句 → 100', () => {
  const entry = {
    s: { 0: 0 },
    statementMap: { 0: { start: { line: 5 }, end: { line: 5 } } },
  };
  // 变更行 7 上无 statement
  assert.equal(statementPctForChangedLines(entry, new Set([7])), 100);
});

check('statementPctForChangedLines 纯改名（仅 import 行无语句）→ 100', () => {
  // 模拟 rename 重构：改动行 20/30/40/50 均为 import 改写，无 statement
  const entry = {
    s: { 0: 1, 1: 1 },
    statementMap: {
      0: { start: { line: 10 }, end: { line: 12 } },
      1: { start: { line: 60 }, end: { line: 65 } },
    },
  };
  assert.equal(statementPctForChangedLines(entry, new Set([20, 30, 40, 50])), 100);
});

check('statementPctForChangedLines 部分覆盖按比例', () => {
  const entry = {
    s: { 0: 1, 1: 0 },
    statementMap: {
      0: { start: { line: 5 }, end: { line: 5 } },
      1: { start: { line: 10 }, end: { line: 10 } },
    },
  };
  assert.equal(statementPctForChangedLines(entry, new Set([5, 10])), 50);
  assert.equal(statementPctForChangedLines(entry, new Set([5])), 100);
  assert.equal(statementPctForChangedLines(entry, new Set([10])), 0);
});

check('statementPctForChangedLines 空 statementMap → 100', () => {
  assert.equal(statementPctForChangedLines({ s: {}, statementMap: {} }, new Set([1])), 100);
});

check('buildSuggestBlock 输出可追加进 commit message 的 Markdown 区块', () => {
  const block = buildSuggestBlock(
    [
      { file: 'frontend/src/views/app-content/site/edit.ts', pct: 25.0 },
      { file: 'frontend/src/views/app-preview/loader.ts', pct: 8.3 },
    ],
    60,
  );
  const lines = block.split('\n');
  // 首行即钩子 stripBlock 的 BLOCK_START 标记，保证幂等剥离可对位
  assert.equal(lines[0], '## 覆盖率建议（非阻断）');
  assert.match(block, /低于 60%/);
  assert.match(block, /`frontend\/src\/views\/app-content\/site\/edit.ts` — 25\.0%/);
  assert.match(block, /`frontend\/src\/views\/app-preview\/loader.ts` — 8\.3%/);
  assert.match(block, /不阻塞提交\/合并/);
  // 不含阈值以外的多余信息，保持 message 整洁
  assert.doesNotMatch(block, /\[X\]/);
});

check('buildSuggestBlock 单文件亦生成合法区块', () => {
  const block = buildSuggestBlock([{ file: 'frontend/src/utils/3d/model3d.ts', pct: 0 }], 60);
  assert.match(block, /`frontend\/src\/utils\/3d\/model3d.ts` — 0\.0%/);
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✅ 全部用例通过');
