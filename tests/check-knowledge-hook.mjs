#!/usr/bin/env node
// 契约测试：知识卡漂移主动防御钩子
//   - prepare-commit-msg 辅助脚本纯函数（stripBlock / buildBlock）的幂等性
//   - checker --affected --quiet 的机读输出契约
// 运行：node tests/check-knowledge-hook.mjs
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlock, buildBlock, BLOCK_START, BLOCK_END, findStaleSnippets, diffIntroducesNew } from '../scripts/hooks/knowledge-affected-hint.mjs';

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

// ── 疑似过时句检测（ADR-047 增强）──

check('diffIntroducesNew：diff 引入 pointerdown → true', () => {
  const diff = 'addEventListener("pointerdown", onDown)';
  assert.strictEqual(diffIntroducesNew(diff), true);
});

check('diffIntroducesNew：diff 无新写法 → false', () => {
  const diff = 'addEventListener("click", onDown)';
  assert.strictEqual(diffIntroducesNew(diff), false);
});

check('findStaleSnippets：卡仍写 mousedown 且 diff 引入 pointerdown → 报行', () => {
  const card = '## 交互\ncanvas 绑定 mousedown 处理拖拽。\n';
  const diff = 'canvas.addEventListener("pointerdown", onDown);\n- canvas.addEventListener("mousedown", onDown);';
  const hits = findStaleSnippets(card, diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
  assert.ok(hits[0].text.includes('mousedown'));
});

check('findStaleSnippets：diff 未引入新写法 → 零命中（不误报）', () => {
  const card = 'canvas 绑定 mousedown 处理拖拽。\n';
  const diff = '仅改文案。';
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：卡已是新写法 → 零命中', () => {
  const card = 'canvas 绑定 pointerdown 处理拖拽。\n';
  const diff = 'canvas.addEventListener("pointerdown", onDown);';
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：词边界（mouseup 不命中 mousemove 行）', () => {
  const card = 'canvas 绑定 mousemove 跟踪位置。\n';
  const diff = 'window.addEventListener("pointerup", onUp);';
  // diff 引入 pointerup，卡里是 mousemove（不同迁移对）→ 不报
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：对照/警示语境不误报（不得出现 mousedown）', () => {
  const card = '- **零残留 mouse 事件**：不得出现 `mousedown/mousemove` 注册（红线）\n';
  const diff = 'canvas.addEventListener("pointerdown", onDown);';
  // 卡是在说「禁止旧写法」，刻意提及 → 不报
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：对照/警示语境不误报（替代 mouseenter）', () => {
  const card = '- **菜单 hover**：`pointerenter/pointerleave`（替代 `mouseenter/mouseleave`）\n';
  const diff = 'ddWrap.addEventListener("pointerenter", fn);';
  // 行内含 pointerenter（新词）+ 替代 → 不报
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

if (fails.length) {
  console.error(`\n契约失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n全部通过');
