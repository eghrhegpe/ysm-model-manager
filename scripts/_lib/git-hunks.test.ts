import assert from 'node:assert/strict';
import test from 'node:test';
import { addedLinesFromDiff, addedLinesToArray } from './git-hunks.ts';

// git-hunks.ts — 解析 --unified=0 diff 新增行号;A4 行级闸的行号来源。

function arr(diffText: string): number[] {
  return addedLinesToArray(addedLinesFromDiff(diffText));
}

test('纯插入 hunk:行号从 +c 起逐行递增', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -5,0 +6,3 @@',
    '+const a = 1;',
    '+const b = 2;',
    '+const c = 3;',
  ].join('\n');
  assert.deepEqual(arr(diff), [6, 7, 8]);
});

test('修改行(删+增同 hunk):只计 + 行', () => {
  const diff = ['@@ -3,1 +3,1 @@', '-old', '+new'].join('\n');
  assert.deepEqual(arr(diff), [3]);
});

test('多 hunk 混合:插入段 + 纯删除段 + 替换段', () => {
  const diff = [
    '@@ -10,0 +12,2 @@',
    '+x',
    '+y',
    '@@ -20,3 +22,0 @@',
    '-rm1',
    '-rm2',
    '-rm3',
    '@@ -30,2 +30,2 @@',
    '-o1',
    '+o2',
  ].join('\n');
  // hunk1 → 12,13;hunk2 纯删除(d=0)无新增;hunk3 替换 → 30
  assert.deepEqual(arr(diff), [12, 13, 30]);
});

test('内容行以 + 开头(++x)只计一行', () => {
  const diff = ['@@ -1,0 +1,2 @@', '++leadingPlus', '+normal'].join('\n');
  assert.deepEqual(arr(diff), [1, 2]);
});

test('hunk 外的 +++ 文件头与 \\ No newline 不误判', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,1 +1,2 @@',
    ' old',
    '+new',
    '\\ No newline at end of file',
  ].join('\n');
  assert.deepEqual(arr(diff), [2]);
});

test('仅文件头无 hunk → 空集合', () => {
  const diff = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts'].join('\n');
  assert.deepEqual(arr(diff), []);
});

test('空输入 → 空集合', () => {
  assert.deepEqual(arr(''), []);
  assert.deepEqual(arr('\n\n'), []);
});

test('上下文行(unified>0 防回归):上下文占位、删除不占、新增占', () => {
  const diff = ['@@ -1,3 +1,3 @@', ' ctx1', '-old', '+new', ' ctx2'].join('\n');
  // ctx1→1;old 删除不占;new→2;ctx2→3
  assert.deepEqual(arr(diff), [2]);
});

test('CRLF 输入兼容', () => {
  const diff = ['@@ -5,0 +6,1 @@\r\n', '+const a = 1;\r\n'].join('');
  assert.deepEqual(arr(diff), [6]);
});
