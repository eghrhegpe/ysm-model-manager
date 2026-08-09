import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from './parse-args.mjs';

// ── bool flags ──

test('parseArgs bool flag sets true', () => {
  const args = parseArgs(['--strict'], { bools: ['strict'], strings: [], defaults: {} });
  assert.equal(args.strict, true);
  assert.deepEqual(args._, []);
});

test('parseArgs bool flag missing defaults false', () => {
  const args = parseArgs([], { bools: ['strict'], strings: [], defaults: {} });
  assert.equal(args.strict, false);
});

test('parseArgs positional args go to underscore', () => {
  const args = parseArgs(['foo', 'bar'], { bools: [], strings: [], defaults: {} });
  assert.deepEqual(args._, ['foo', 'bar']);
});

test('parseArgs mixed bool + positional', () => {
  const args = parseArgs(['--check', 'a', '--strict', 'b'], {
    bools: ['check', 'strict'],
    strings: [],
    defaults: {},
  });
  assert.equal(args.check, true);
  assert.equal(args.strict, true);
  assert.deepEqual(args._, ['a', 'b']);
});

// ── string flags ──

test('parseArgs string flag gets value', () => {
  const args = parseArgs(['--scope', 'core'], {
    bools: [], strings: ['scope'], defaults: { scope: null },
  });
  assert.equal(args.scope, 'core');
});

test('parseArgs string flag missing value uses default', () => {
  const args = parseArgs(['--scope'], {
    bools: [], strings: ['scope'], defaults: { scope: 'default' },
  });
  assert.equal(args.scope, 'default');
});

test('parseArgs string flag followed by another flag uses default', () => {
  const args = parseArgs(['--scope', '--check'], {
    bools: ['check'], strings: ['scope'], defaults: { scope: null },
  });
  assert.equal(args.scope, null);
  assert.equal(args.check, true);
});

// ── defaults ──

test('parseArgs respects defaults', () => {
  const args = parseArgs([], {
    bools: [], strings: ['format'], defaults: { format: 'mermaid' },
  });
  assert.equal(args.format, 'mermaid');
});

test('parseArgs empty argv', () => {
  const args = parseArgs([], { bools: ['strict'], strings: [], defaults: {} });
  assert.equal(args.strict, false);
  assert.deepEqual(args._, []);
});

// ── unknown flags ──

test('parseArgs unknown flag warns and continues', () => {
  const args = parseArgs(['--unknown', '--strict'], {
    bools: ['strict'], strings: [], defaults: {},
  });
  assert.equal(args.strict, true);
  assert.deepEqual(args._, []);
});

// ── new semantics（code_review P3 复核补充）──

test('parseArgs unknown flags collected in unknown array', () => {
  const args = parseArgs(['--checkk', '--strict'], {
    bools: ['strict'], strings: [], defaults: {},
  });
  assert.deepEqual(args.unknown, ['--checkk']);
});

test('parseArgs --flag=value inline string', () => {
  const args = parseArgs(['--dir=X'], {
    bools: [], strings: ['dir'], defaults: { dir: null },
  });
  assert.equal(args.dir, 'X');
});

test('parseArgs --check=true / false / 0 bool inline', () => {
  const t = parseArgs(['--check=true'], { bools: ['check'], strings: [], defaults: {} });
  assert.equal(t.check, true);
  const f = parseArgs(['--check=false'], { bools: ['check'], strings: [], defaults: {} });
  assert.equal(f.check, false);
  const z = parseArgs(['--check=0'], { bools: ['check'], strings: [], defaults: {} });
  assert.equal(z.check, false);
  const y = parseArgs(['--check=yes'], { bools: ['check'], strings: [], defaults: {} });
  assert.equal(y.check, true);
});

test('parseArgs --help / -h set help=true, not positional', () => {
  const h = parseArgs(['--help']);
  assert.equal(h.help, true);
  assert.deepEqual(h._, []);
  const s = parseArgs(['-h', '--strict'], { bools: ['strict'], strings: [], defaults: {} });
  assert.equal(s.help, true);
  assert.equal(s.strict, true);
});

test('parseArgs -- separator: --help after -- is positional', () => {
  const args = parseArgs(['--', '--help'], { bools: [], strings: [], defaults: {} });
  assert.equal(args.help, false);
  assert.deepEqual(args._, ['--', '--help']);
});

// ── -- separator ──

test('parseArgs -- is treated as positional arg', () => {
  const args = parseArgs(['--', 'foo', '--strict'], {
    bools: ['strict'], strings: [], defaults: {},
  });
  assert.equal(args.strict, false);
  assert.deepEqual(args._, ['--', 'foo', '--strict']);
});

test('parseArgs -- as sole argument', () => {
  const args = parseArgs(['--'], {
    bools: ['strict'], strings: [], defaults: {},
  });
  assert.deepEqual(args._, ['--']);
  assert.equal(args.strict, false);
});

test('parseArgs string flag with string value that looks like flag', () => {
  const args = parseArgs(['--scope', 'core'], {
    bools: [], strings: ['scope'], defaults: { scope: null },
  });
  assert.equal(args.scope, 'core');
});

test('parseArgs multiple string flags', () => {
  const args = parseArgs(['--scope', 'core', '--format', 'json'], {
    bools: [], strings: ['scope', 'format'], defaults: { scope: null, format: null },
  });
  assert.equal(args.scope, 'core');
  assert.equal(args.format, 'json');
  assert.deepEqual(args._, []);
});
