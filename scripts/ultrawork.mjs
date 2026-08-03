#!/usr/bin/env node
/**
 * Ultrawork — 一键三连。顺序执行：Go 编译 → 前端构建 → 测试 → 红线审查 → Git 状态。
 * 由 scripts/ultrawork.py 迁移（2026-08-03），逻辑逐点保真。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASS = '[OK]';
const FAIL = '[FAIL]';

function run(cmd, cwd = ROOT, label = '', stopOnFail = true, tail = 10) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const stdout = execFileSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf-8', timeout: 180000 });
    process.stdout.write(`  ${PASS} ${label} passed\n`);
    return true;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    process.stdout.write(`  ${FAIL} ${label} failed (showing last ${tail} lines)\n`);
    for (const line of out.trim().split('\n').slice(-tail)) {
      process.stdout.write(`    ${line}\n`);
    }
    if (stopOnFail) process.exit(1);
    return false;
  }
}

console.log('========== Ultrawork ==========');

run(['go', 'build', './go/...'], ROOT, '[1/5] Go Build');
run(['npx', 'vite', 'build'], path.join(ROOT, 'frontend'), '[2/5] Frontend Build');
run(['go', 'test', './go/...', '-count=1'], ROOT, '[3/5] Go Test');
run(['node', 'scripts/review.mjs'], ROOT, '[4/5] Code Review', false);
run(['git', 'status', '--short'], ROOT, '[5/5] Git Status', false);

console.log(`\n${PASS} Ultrawork complete`);
