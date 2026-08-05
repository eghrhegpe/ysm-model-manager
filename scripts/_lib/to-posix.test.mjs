import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { toPosix, toNative } from './to-posix.mjs';

// ── toPosix ──

test('toPosix converts backslashes to forward slashes', () => {
  assert.equal(toPosix('a\\b\\c.ts'), 'a/b/c.ts');
});

test('toPosix leaves posix input unchanged', () => {
  assert.equal(toPosix('a/b/c.ts'), 'a/b/c.ts');
});

test('toPosix handles mixed separators', () => {
  assert.equal(toPosix('a\\b/c\\d.ts'), 'a/b/c/d.ts');
});

test('toPosix is idempotent', () => {
  assert.equal(toPosix(toPosix('a\\b\\c.ts')), 'a/b/c.ts');
});

test('toPosix handles empty string and trailing slash', () => {
  assert.equal(toPosix(''), '');
  assert.equal(toPosix('a\\b\\'), 'a/b/');
});

// ── toNative ──

test('toNative converts forward slashes to platform separator', () => {
  assert.equal(toNative('a/b/c.ts'), 'a/b/c.ts'.split('/').join(path.sep));
});

test('toNative is inverse of toPosix on the same platform', () => {
  assert.equal(toNative(toPosix('a\\b\\c.ts')), 'a\\b\\c.ts'.split('\\').join(path.sep));
});
