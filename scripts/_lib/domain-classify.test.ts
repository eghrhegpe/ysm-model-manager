import assert from 'node:assert/strict';
import test from 'node:test';
import { groupByDomain, domainSummaryText } from './domain-classify.ts';

// ── groupByDomain：文件集 → { 域: [文件] } ──

test('多域文件按 classify 归组', () => {
  const files = ['go/scanner/scanner.go', 'go.mod', 'frontend/src/app.ts', 'resource_types.json', 'docs/x.md', 'tests/t.mjs'];
  const g = groupByDomain(files);
  assert.deepEqual(g.go, ['go/scanner/scanner.go', 'go.mod']);
  assert.deepEqual(g.frontend, ['frontend/src/app.ts']);
  assert.deepEqual(g.data, ['resource_types.json']);
  assert.deepEqual(g.docs, ['docs/x.md']);
  assert.deepEqual(g.tests, ['tests/t.mjs']);
});

test('空文件集 → 空对象', () => {
  assert.deepEqual(groupByDomain([]), {});
});

test('同域多文件保持输入顺序', () => {
  const g = groupByDomain(['go/a.go', 'go/b.go', 'frontend/c.ts']);
  assert.deepEqual(g.go, ['go/a.go', 'go/b.go']);
});

// ── domainSummaryText：分组 → 摘要串 ──

test('非空分组 → "域:数量" 空格拼接', () => {
  assert.equal(domainSummaryText({ go: ['a.go', 'b.go'], frontend: ['c.ts'] }), 'go:2  frontend:1');
});

test('空分组 → 无变更', () => {
  assert.equal(domainSummaryText({}), '无变更');
});
