// tests/coverage-suggest-hint.mjs — 覆盖率建议钩子契约测试
//
// 覆盖：
//   1. buildBlock：含/不含 uncoveredRanges 的区块格式
//   2. stripBlock：自定义 🔬 标记的幂等剥离（复用 knowledge-affected-hint）
//   3. --suggest：真实 coverage-final.json 解析出低覆盖率文件（>0）
//   4. 端到端：钩子写 message 区块 + 幂等重跑不重复
//   5. 逃生阀：YSM_SKIP_COVERAGE_HINT=1 不写区块
// 约定：只读现有 frontend/coverage/coverage-final.json，绝不触发 vitest --coverage。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../scripts/_lib/scan-files.mjs';
import { buildBlock } from '../scripts/hooks/coverage-suggest-hint.mjs';
import { stripBlock } from '../scripts/hooks/knowledge-affected-hint.mjs';
import { BLOCK_START, BLOCK_END } from '../scripts/hooks/coverage-suggest-hint.mjs';

const HINT = path.join(ROOT, 'scripts/hooks/coverage-suggest-hint.mjs');
const COV = path.join(ROOT, 'frontend/coverage/coverage-final.json');

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

// ── 1. buildBlock 格式 ──
check('buildBlock 含 uncoveredRanges', () => {
  const block = buildBlock([{ file: 'frontend/src/a.ts', stmts: 30.5, uncoveredRanges: '34, 56-58' }]);
  assert.ok(block.startsWith(BLOCK_START));
  assert.ok(block.endsWith(BLOCK_END));
  assert.ok(block.includes('- [30.5%] frontend/src/a.ts（未覆盖行 34, 56-58）'));
  const lines = block.split('\n');
  assert.equal(lines[0], BLOCK_START);
  assert.equal(lines[lines.length - 1], BLOCK_END);
});

check('buildBlock 无 uncoveredRanges', () => {
  const block = buildBlock([{ file: 'frontend/src/b.ts', stmts: 10, uncoveredRanges: '' }]);
  assert.ok(block.includes('- [10%] frontend/src/b.ts'));
  assert.ok(!block.includes('（未覆盖行）'));
});

// ── 2. stripBlock 自定义标记幂等 ──
check('stripBlock 剥离 🔬 区块（吞前后换行）', () => {
  const msg = `feat: x\n\n${BLOCK_START}\n- [30%] frontend/src/a.ts\n${BLOCK_END}\n`;
  assert.equal(stripBlock(msg, BLOCK_START, BLOCK_END), 'feat: x\n');
});

check('stripBlock 幂等：多次剥离无副作用', () => {
  let msg = `feat: x\n${BLOCK_START}\n- [30%] a\n${BLOCK_END}`;
  msg = stripBlock(stripBlock(msg, BLOCK_START, BLOCK_END), BLOCK_START, BLOCK_END);
  assert.equal(msg, 'feat: x');
});

check('stripBlock 与知识卡区块互不干扰', () => {
  const msg = `feat: x\n\n📚 受影响知识卡：\n- docs/knowledge/a.md\n📚 ──END──\n\n${BLOCK_START}\n- [30%] a\n${BLOCK_END}\n`;
  const stripped = stripBlock(msg, BLOCK_START, BLOCK_END);
  assert.ok(stripped.includes('📚 受影响知识卡'));
  assert.ok(!stripped.includes(BLOCK_START));
});

// ── 3. --suggest 真实数据 ──
check('--suggest 解析真实 coverage（低覆盖率文件 > 0）', () => {
  assert.ok(fs.existsSync(COV), 'coverage-final.json 应存在');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-coverage-report.mjs'), '--suggest', '--json'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  assert.ok(Array.isArray(j.files));
  assert.ok(j._summary.files > 0, `应有源文件（实际 ${j._summary.files}）`);
  assert.ok(j._summary.thresholdStmts === 45, `阈值应读 vite.config.js（实际 ${j._summary.thresholdStmts}）`);
  for (const f of j.files) {
    assert.ok(f.stmts < j._summary.thresholdStmts, `${f.file} 应低于阈值`);
  }
});

// ── 4. 端到端：写 message + 幂等 ──
check('端到端：写区块 + 幂等重跑不重复', () => {
  const msgFile = path.join(ROOT, '.cov-hint-e2e.txt');
  fs.writeFileSync(msgFile, 'feat: e2e\n');
  try {
    execFileSync(process.execPath, [HINT, msgFile, ''], { encoding: 'utf8' });
    let msg = fs.readFileSync(msgFile, 'utf8');
    const firstCount = (msg.match(new RegExp(BLOCK_START, 'g')) || []).length;
    assert.equal(firstCount, 1, '首次应写入一块');
    assert.ok(msg.includes('🔬 覆盖率建议'), '应含覆盖率区块');

    execFileSync(process.execPath, [HINT, msgFile, ''], { encoding: 'utf8' });
    msg = fs.readFileSync(msgFile, 'utf8');
    const secondCount = (msg.match(new RegExp(BLOCK_START, 'g')) || []).length;
    assert.equal(secondCount, 1, '幂等重跑应仍只有一块');
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
});

// ── 5. 逃生阀 ──
check('逃生阀 YSM_SKIP_COVERAGE_HINT=1 不写区块', () => {
  const msgFile = path.join(ROOT, '.cov-hint-skip.txt');
  fs.writeFileSync(msgFile, 'feat: skip\n');
  try {
    execFileSync(process.execPath, [HINT, msgFile, ''], {
      encoding: 'utf8',
      env: { ...process.env, YSM_SKIP_COVERAGE_HINT: '1' },
    });
    const msg = fs.readFileSync(msgFile, 'utf8');
    assert.ok(!msg.includes(BLOCK_START), '逃生阀应跳过写入');
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
});

// ── 汇总 ──
if (errors.length) {
  console.error(`\n${errors.length} 项失败:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`\n✅ tests/coverage-suggest-hint.mjs 全部通过`);
