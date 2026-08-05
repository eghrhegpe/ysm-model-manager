import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrontmatter, getScalar, getList, parseSourceFiles } from './frontmatter.mjs';

// ── parseFrontmatter ──

test('parseFrontmatter extracts block between ---', () => {
  const text = `---
name: foo
category: env
---
body content`;
  assert.equal(parseFrontmatter(text), 'name: foo\ncategory: env');
});

test('parseFrontmatter returns null for no frontmatter', () => {
  assert.equal(parseFrontmatter('no frontmatter here'), null);
});

test('parseFrontmatter returns null for empty frontmatter', () => {
  // ---\n---\nbody — the pattern ^---\r?\n([\s\S]*?)\r?\n--- requires a trailing \n---,
  // but the string ends after the body, so no match → null.
  assert.equal(parseFrontmatter('---\n---\nbody'), null);
});

test('parseFrontmatter ignores trailing spaces', () => {
  const text = `---
name: foo 
category: env  
---
body`;
  assert.ok(parseFrontmatter(text));
});

// ── getScalar ──

test('getScalar returns value', () => {
  const fm = 'name: MyTitle\nstatus: Done';
  assert.equal(getScalar(fm, 'name'), 'MyTitle');
  assert.equal(getScalar(fm, 'status'), 'Done');
});

test('getScalar returns undefined for missing key', () => {
  const fm = 'name: MyTitle\nstatus: Done';
  assert.equal(getScalar(fm, 'category'), undefined);
});

test('getScalar returns undefined for empty value', () => {
  assert.equal(getScalar('name:', 'name'), undefined);
});

test('getScalar returns undefined for template placeholder', () => {
  assert.equal(getScalar('name: <placeholder>', 'name'), undefined);
  assert.equal(getScalar('tier: <architecture|leaf>', 'tier'), undefined);
});

test('getScalar strips trailing comment', () => {
  const fm = 'name: Title  # comment';
  assert.equal(getScalar(fm, 'name'), 'Title');
});

// ── getList ──

test('getList returns block list', () => {
  const fm = `adr:
  - ADR-001
  - ADR-019
  - ADR-084
other: val`;
  assert.deepEqual(getList(fm, 'adr'), ['ADR-001', 'ADR-019', 'ADR-084']);
});

test('getList returns empty array for no key', () => {
  assert.deepEqual(getList('name: foo', 'adr'), []);
});

test('getList ignores empty and placeholder items', () => {
  const fm = `adr:
  - 
  - <placeholder>
  - ADR-001`;
  assert.deepEqual(getList(fm, 'adr'), ['ADR-001']);
});

test('getList ends at next top-level key', () => {
  const fm = `adr:
  - ADR-001
name: foo`;
  assert.deepEqual(getList(fm, 'adr'), ['ADR-001']);
});

test('getList strips comments from items', () => {
  const fm = `adr:
  - ADR-001 # comment
  - ADR-019`;
  assert.deepEqual(getList(fm, 'adr'), ['ADR-001', 'ADR-019']);
});

test('getList returns empty array when frontmatter is null', () => {
  assert.deepEqual(getList(null, 'adr'), []);
});

test('getList with inline single value', () => {
  const fm = 'adr: ADR-001\nother: val';
  assert.deepEqual(getList(fm, 'adr'), ['ADR-001']);
});

// ── parseSourceFiles ──

test('parseSourceFiles block list', () => {
  const fm = `source_files:
  - frontend/src/scene/index.ts
  - frontend/src/core/state.ts`;
  assert.deepEqual(parseSourceFiles(fm), [
    'frontend/src/scene/index.ts',
    'frontend/src/core/state.ts',
  ]);
});

test('parseSourceFiles inline array', () => {
  const fm = `source_files: [frontend/src/scene/index.ts, frontend/src/core/state.ts]
name: test`;
  assert.deepEqual(parseSourceFiles(fm), [
    'frontend/src/scene/index.ts',
    'frontend/src/core/state.ts',
  ]);
});

test('parseSourceFiles strips quotes', () => {
  const fm = `source_files:
  - "frontend/src/scene/index.ts"
  - 'frontend/src/core/state.ts'`;
  assert.deepEqual(parseSourceFiles(fm), [
    'frontend/src/scene/index.ts',
    'frontend/src/core/state.ts',
  ]);
});

test('parseSourceFiles returns empty array when null', () => {
  assert.deepEqual(parseSourceFiles(null), []);
});

test('parseSourceFiles returns empty array when key absent', () => {
  assert.deepEqual(parseSourceFiles('name: foo'), []);
});

test('parseSourceFiles skips empty items', () => {
  const fm = `source_files:
  - 
  - frontend/src/scene/index.ts
  - `;
  assert.deepEqual(parseSourceFiles(fm), ['frontend/src/scene/index.ts']);
});

// ── parseFrontmatter: edge cases ──

test('parseFrontmatter CRLF line endings', () => {
  const text = '---\r\nname: foo\r\ncategory: env\r\n---\r\nbody';
  assert.equal(parseFrontmatter(text), 'name: foo\r\ncategory: env');
});

test('parseFrontmatter content contains --- code fence', () => {
  const text = `---
name: test
category: env
---
body

\`\`\`yaml
---
nested: true
---
\`\`\`

more body`;
  // Should only capture the first --- block
  assert.ok(parseFrontmatter(text).includes('name: test'));
  assert.ok(!parseFrontmatter(text).includes('nested:'));
});

test('getScalar null input', () => {
  assert.equal(getScalar(null, 'name'), undefined);
});

test('getScalar key with hyphens', () => {
  const fm = 'my-key: hyphen-value';
  assert.equal(getScalar(fm, 'my-key'), 'hyphen-value');
});

// ── parseFrontmatter: parseSourceFiles extra edge cases ──

test('parseSourceFiles inline array + block list mixed (inline takes priority)', () => {
  const fm = `source_files: [a.ts, b.ts]
  - c.ts
  - d.ts
name: test`;
  // Inline array [a, b] should be returned; block items c, d should be IGNORED
  // (inline indicates complete list, block list should not be appended)
  assert.deepEqual(parseSourceFiles(fm), ['a.ts', 'b.ts']);
});

test('parseSourceFiles empty inline array', () => {
  const fm = `source_files: []
name: test`;
  assert.deepEqual(parseSourceFiles(fm), []);
});

test('parseSourceFiles inline array with spaces', () => {
  const fm = `source_files: [ a.ts ,  b.ts , c.ts ]
name: test`;
  assert.deepEqual(parseSourceFiles(fm), ['a.ts', 'b.ts', 'c.ts']);
});

test('parseSourceFiles block list with mixed whitespace', () => {
  const fm = `source_files:
 - a.ts
   - b.ts
name: test`;
  assert.deepEqual(parseSourceFiles(fm), ['a.ts', 'b.ts']);
});
