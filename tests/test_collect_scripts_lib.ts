#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/collect-scripts.ts 共享层单元测试。
 *
 * 覆盖：
 *   1. 收集 .mjs：递归子目录、排除 _ 前缀共享层（_lib/）、排除 .test.mjs
 *   2. skipHooks=false（默认）：含 hooks/ 子目录（proc/readme 口径）
 *   3. skipHooks=true：排除 hooks/（hygiene 口径）
 *   4. 排序 + posix 路径输出
 *
 * 零依赖（仅 node:fs / node:path / node:os）。fixture 用临时目录，不污染仓库。
 * 运行：node tests/test_collect_scripts_lib.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectScripts } from '../scripts/_lib/collect-scripts.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-collect-test-'));
try {
  // fixture 目录树（2026-09 迁移后统一 .ts）：
  //   a.ts  b.test.ts  sub/s.ts  _lib/x.ts  hooks/h.ts  hooks/_inner.ts
  fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '_lib'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'hooks'), { recursive: true });
  for (const f of ['a.ts', 'b.test.ts', 'sub/s.ts', '_lib/x.ts', 'hooks/h.ts', 'hooks/_inner.ts']) {
    const fp = path.join(tmp, f);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '');
  }

  // 1. 默认（skipHooks=false）：含 hooks/，排除 _lib 与测试
  const all = collectScripts({ dir: tmp });
  assert.deepEqual(all, ['a.ts', 'hooks/h.ts', 'sub/s.ts'],
    `默认应含 hooks、排 _lib/测试（got: ${all.join(',')}）`);
  assert.ok(!all.includes('_lib/x.ts'), '_lib 共享层不应被收集');
  assert.ok(!all.includes('b.test.ts'), '.test.ts 不应被收集');
  assert.ok(!all.includes('hooks/_inner.ts'), 'hooks/ 内 _ 前缀文件不应被收集');

  // 2. skipHooks=true：排除 hooks/
  const noHooks = collectScripts({ dir: tmp, skipHooks: true });
  assert.deepEqual(noHooks, ['a.ts', 'sub/s.ts'],
    `skipHooks 应排除 hooks（got: ${noHooks.join(',')}）`);

  // 3. 排序 + posix：乱序创建验证排序稳定
  const sorted = collectScripts({ dir: tmp });
  assert.deepEqual(sorted, [...sorted].sort(), '输出应排序');

  console.log('OK: collect-scripts 共享层边界测试全过');
  console.log(`   skipHooks=false → ${all.join(', ')}`);
  console.log(`   skipHooks=true  → ${noHooks.join(', ')}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
