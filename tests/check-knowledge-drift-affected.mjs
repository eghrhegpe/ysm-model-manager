#!/usr/bin/env node
/**
 * 契约测试：check-knowledge-drift.mjs --affected 主动防御模式。
 *
 * 验证「源码变更 → 列出受影响知识卡」的精确匹配：
 *   - 文件精确命中（source_files 含该文件）
 *   - 目录前缀命中（source_files 含该目录）
 *   - 无关文件不命中（应输出 ✅ 无需复核）
 *
 * 用法：node tests/check-knowledge-drift-affected.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPTS = path.join(process.cwd(), 'scripts');
const NODE = process.execPath;
const errors = [];

function runAffected(...files) {
  const r = spawnSync(NODE, [path.join(SCRIPTS, 'check-knowledge-drift.mjs'), '--affected', ...files], {
    encoding: 'utf-8',
    timeout: 30000,
  });
  if (r.status !== 0) errors.push(`--affected 退出码非 0: ${r.status} | stderr=${r.stderr?.slice(0, 120)}`);
  return r.stdout || '';
}

function assert(stdout, needle, label) {
  if (!stdout.includes(needle)) {
    errors.push(`[${label}] 期望输出含 "${needle}"，实际:\n${stdout.trim().slice(0, 200)}`);
  } else {
    console.log(`   ✓ ${label}`);
  }
}

console.log('=== check-knowledge-drift --affected 契约 ===');

// 1. 文件精确命中
const out1 = runAffected('frontend/src/services/registry.ts');
assert(out1, 'resource-registry', '文件精确命中 → resource-registry');

// 2. 目录前缀命中
const out2 = runAffected('go/avatar/');
assert(out2, 'go-avatar', '目录前缀命中 → go-avatar');

// 3. 多文件混合
const out3 = runAffected('frontend/src/services/registry.ts', 'go/avatar/');
assert(out3, 'resource-registry', '多文件 → resource-registry');
assert(out3, 'go-avatar', '多文件 → go-avatar');

// 4. 无关文件不命中
const out4 = runAffected('package.json');
assert(out4, '✅', '无关文件 → 无需复核');

// 5. 无参数 → 用法提示（退出码仍 0）
const out5 = runAffected();
assert(out5, '用法', '无参数 → 打印用法提示');

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('OK: check-knowledge-drift --affected 契约全过');
