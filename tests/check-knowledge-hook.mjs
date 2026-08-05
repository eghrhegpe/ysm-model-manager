#!/usr/bin/env node
// 契约测试：知识卡漂移主动防御钩子
//   - prepare-commit-msg 辅助脚本纯函数（stripBlock / buildBlock）的幂等性
//   - checker --affected --quiet 的机读输出契约
// 运行：node tests/check-knowledge-hook.mjs
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlock, buildBlock, BLOCK_START, BLOCK_END } from '../scripts/hooks/knowledge-affected-hint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error('✗', name, '-', e.message);
  }
}

check('stripBlock 无区块时原样返回', () => {
  assert.strictEqual(stripBlock('hello\nworld'), 'hello\nworld');
});

check('stripBlock 移除整段（含首尾标记，吞掉相邻换行）', () => {
  const msg = `feat: x\n\n${BLOCK_START}\n- docs/knowledge/a.md\n${BLOCK_END}\n`;
  assert.strictEqual(stripBlock(msg), 'feat: x\n');
});

check('stripBlock 幂等：多次剥离无副作用', () => {
  let msg = `feat: x\n${BLOCK_START}\n- a\n${BLOCK_END}`;
  msg = stripBlock(stripBlock(msg));
  assert.strictEqual(msg, 'feat: x');
});

check('buildBlock 生成正确行', () => {
  const b = buildBlock(['resource-registry', 'go-avatar']);
  assert.strictEqual(
    b,
    `${BLOCK_START}\n- docs/knowledge/resource-registry.md\n- docs/knowledge/go-avatar.md\n${BLOCK_END}`,
  );
});

check('端到端幂等：追加→剥离→追加 仅保留一个区块', () => {
  const base = 'feat: x\n\nbody';
  const r1 = stripBlock(base) + '\n' + buildBlock(['a']) + '\n';
  const r2 = stripBlock(r1) + '\n' + buildBlock(['a']) + '\n';
  assert.strictEqual(r2.split(BLOCK_START).length - 1, 1, '应只有一个区块起始标记');
});

check('--quiet 仅吐 card stem', () => {
  const out = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'check-knowledge-drift.mjs'),
      '--affected', '--quiet',
      'frontend/src/services/registry.ts', 'go/avatar/resource.go',
    ],
    { encoding: 'utf8' },
  );
  const lines = out.split('\n').map((s) => s.trim()).filter(Boolean).sort();
  assert.deepStrictEqual(lines, ['go-avatar', 'resource-registry']);
});

check('--quiet 无命中输出空', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-knowledge-drift.mjs'), '--affected', '--quiet', 'README.md'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(out.trim(), '');
});

if (fails.length) {
  console.error(`\n契约失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n全部通过');
