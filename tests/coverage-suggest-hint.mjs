// tests/coverage-suggest-hint.mjs — 覆盖率建议钩子契约测试
//
// 覆盖：
//   1. buildBlock：含/不含 uncoveredRanges 的区块格式
//   2. stripBlock：自定义 🔬 标记的幂等剥离（复用 knowledge-affected-hint）
//   3. --suggest：真实 coverage-final.json 解析出低覆盖率文件（>0）
//   4. 端到端：钩子仅终端提醒（不写 body）+ stderr 含 🔬
//   5. 逃生阀：YSM_SKIP_COVERAGE_HINT=1 静默（不提醒不写）
// 约定：只读现有 frontend/coverage/coverage-final.json，绝不触发 vitest --coverage。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../scripts/_lib/scan-files.mjs';
import { buildBlock, MAX_SUGGEST_FILES, formatCovTime, buildStaleHint } from '../scripts/hooks/coverage-suggest-hint.mjs';
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

check('buildBlock 超上限省略', () => {
  const files = Array.from({ length: MAX_SUGGEST_FILES + 5 }, (_, i) => ({
    file: `frontend/src/f${i}.ts`,
    stmts: 10 + i,
    uncoveredRanges: `${i}`,
  }));
  const block = buildBlock(files);
  const lines = block.split('\n');
  // 首行标记 + 20 个文件 + 1 省略行 + 尾标记
  assert.equal(lines.length, 1 + MAX_SUGGEST_FILES + 1 + 1);
  assert.ok(lines.some((l) => l.includes(`其余 5 个见 node scripts/test-coverage-report.mjs`)));
});

// ── 1.5 stale 提示：时间戳 + 刷新命令 ──
check('formatCovTime 输出 YYYY-MM-DD HH:mm（补零）', () => {
  const d = new Date(2026, 7, 9, 16, 9, 45); // 2026-08-09 16:09:45 本地时区
  assert.equal(formatCovTime(d), '2026-08-09 16:09');
});

check('buildStaleHint 有 mtime：附时间戳 + 刷新命令', () => {
  const hint = buildStaleHint(new Date(2026, 7, 9, 16, 19));
  assert.ok(hint.includes('2026-08-09 16:19'), `应含时间戳（got: ${hint}）`);
  assert.ok(hint.includes('npx vitest run --coverage'), '应含刷新命令');
  assert.ok(hint.includes('frontend/coverage/coverage-final.json'), '应含产物路径');
});

check('buildStaleHint 无 mtime：提示先跑 --coverage', () => {
  const hint = buildStaleHint(null);
  assert.ok(hint.includes('无数据'), '应标注无数据');
  assert.ok(hint.includes('npx vitest run --coverage'), '应提示先跑刷新命令');
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

// ── 3. --suggest 真实数据（CI 无 coverage 产物时 graceful 跳过）──
check('--suggest 解析真实 coverage（低覆盖率文件 > 0）', () => {
  if (!fs.existsSync(COV)) {
    console.log('  ↳ skip: 无 frontend/coverage/coverage-final.json（CI 未跑 vitest --coverage），跳过真实数据断言');
    return;
  }
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/test-coverage-report.mjs'), '--suggest', '--json'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  assert.ok(Array.isArray(j.files));
  assert.ok(j._summary.files > 0, `应有源文件（实际 ${j._summary.files}）`);
  // 阈值断言与配置源 vitest.config.ts 一致（code_review P3：此前硬编码 45，阈值调整后测试漂移）
  const vitestCfg = fs.readFileSync(path.join(ROOT, 'frontend/vitest.config.ts'), 'utf8');
  const cfgStmts = Number((vitestCfg.match(/statements\s*:\s*(\d+)/) || [])[1]);
  assert.ok(Number.isFinite(cfgStmts), 'vitest.config.ts 应有 statements 阈值');
  assert.ok(j._summary.thresholdStmts === cfgStmts, `阈值应读 vitest.config.ts（配置 ${cfgStmts}，实际 ${j._summary.thresholdStmts}）`);
  for (const f of j.files) {
    assert.ok(f.stmts < j._summary.thresholdStmts, `${f.file} 应低于阈值`);
  }
});

// ── 4. 端到端：写 message + 幂等（CI 无产物时 graceful 跳过）──
check('端到端：仅终端提醒，不写 body 区块', () => {
  if (!fs.existsSync(COV)) {
    console.log('  ↳ skip: 无 coverage 产物，跳过端到端断言');
    return;
  }
  const msgFile = path.join(ROOT, '.cov-hint-e2e.txt');
  fs.writeFileSync(msgFile, 'feat: e2e\n');
  try {
    const r = spawnSync(process.execPath, [HINT, msgFile, ''], { encoding: 'utf8' });
    assert.equal(r.status, 0, '钩子应 exit 0');
    const msg = fs.readFileSync(msgFile, 'utf8');
    assert.ok(!msg.includes(BLOCK_START), '终端模式不应写 body 区块');
    assert.ok((r.stderr || '').includes('🔬'), '终端应打印覆盖率提醒');
    assert.ok((r.stderr || '').includes('未写入 commit body'), '应标注仅终端提醒');
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
});

// ── 5. 逃生阀 ──
check('逃生阀 YSM_SKIP_COVERAGE_HINT=1 静默（不提醒不写）', () => {
  if (!fs.existsSync(COV)) {
    console.log('  ↳ skip: 无 coverage 产物，跳过逃生阀断言');
    return;
  }
  const msgFile = path.join(ROOT, '.cov-hint-skip.txt');
  fs.writeFileSync(msgFile, 'feat: skip\n');
  try {
    const r = spawnSync(process.execPath, [HINT, msgFile, ''], {
      encoding: 'utf8',
      env: { ...process.env, YSM_SKIP_COVERAGE_HINT: '1' },
    });
    const msg = fs.readFileSync(msgFile, 'utf8');
    assert.ok(!msg.includes(BLOCK_START), '逃生阀不应写 body');
    assert.ok(!(r.stderr || '').includes('🔬'), '逃生阀应静默（终端不提醒）');
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
  }
});

// ── 6. merge/squash 跳过 ──
check('merge/squash 提交跳过（不写区块、终端静默）', () => {
  if (!fs.existsSync(COV)) {
    console.log('  ↳ skip: 无 coverage 产物，跳过');
    return;
  }
  for (const source of ['merge', 'squash']) {
    const msgFile = path.join(ROOT, `.cov-hint-${source}.txt`);
    fs.writeFileSync(msgFile, `feat: ${source}\n`);
    try {
      const r = spawnSync(process.execPath, [HINT, msgFile, source], { encoding: 'utf8' });
      const msg = fs.readFileSync(msgFile, 'utf8');
      assert.ok(!msg.includes(BLOCK_START), `${source} 不应写 body`);
      assert.ok(!(r.stderr || '').includes('🔬'), `${source} 应终端静默`);
    } finally {
      try { fs.unlinkSync(msgFile); } catch { /* ignore */ }
    }
  }
});

// ── 7. 缺数据 graceful（脚本级）──
check('--suggest 缺数据 graceful（exit 0 且提示）', () => {
  const missing = path.join(ROOT, 'frontend/coverage/__nonexistent__.json');
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/test-coverage-report.mjs'), '--suggest', '--input', missing],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, '缺数据应 exit 0');
  assert.ok((r.stderr || '').includes('未找到覆盖率产物'), 'stderr 应提示先跑 test:coverage');
});

// ── 汇总 ──
if (errors.length) {
  console.error(`\n${errors.length} 项失败:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`\n✅ tests/coverage-suggest-hint.mjs 全部通过`);
