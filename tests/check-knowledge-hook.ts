#!/usr/bin/env node
// 契约测试：知识卡漂移主动防御钩子
//   - prepare-commit-msg 辅助脚本纯函数（stripBlock / buildBlock）的幂等性
//   - checker --affected --quiet 的机读输出契约
// 运行：node tests/check-knowledge-hook.mjs
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlock, buildBlock, BLOCK_START, BLOCK_END, findStaleSnippets, diffIntroducesNew, parseCardText } from '../scripts/hooks/knowledge-affected-hint.ts';

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
      path.join(ROOT, 'scripts', 'check-knowledge-drift.ts'),
      '--affected', '--quiet',
      'frontend/src/services/registry.ts', 'go/avatar/resource.go',
    ],
    { encoding: 'utf8' },
  );
  const lines = out.split('\n').map((s) => s.trim()).filter(Boolean).sort();
  // frontend_repo_audit 为整包审计快照卡（source_files: frontend/src/ 粒度过粗），
  // 已声明 affected: false 退出 affected 匹配——若本断言失败且输出含它，
  // 说明 opt-out 标记失效或有人删了该标记（整包卡会污染所有前端文件的提交提示）
  assert.deepStrictEqual(lines, ['go-avatar', 'resource-registry']);
});

check('--quiet 无命中输出空', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-knowledge-drift.ts'), '--affected', '--quiet', 'README.md'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(out.trim(), '');
});

// ── 疑似过时句检测（ADR-047 增强）──

check('diffIntroducesNew：diff 引入 pointerdown → true', () => {
  const diff = '+ addEventListener("pointerdown", onDown)';
  assert.strictEqual(diffIntroducesNew(diff), true);
});

check('diffIntroducesNew：diff 无新写法 → false', () => {
  const diff = '+ addEventListener("click", onDown)';
  assert.strictEqual(diffIntroducesNew(diff), false);
});

check('findStaleSnippets：卡仍写 mousedown 且 diff 引入 pointerdown → 报行', () => {
  const card = '## 交互\ncanvas 绑定 mousedown 处理拖拽。\n';
  const diff = '+ canvas.addEventListener("pointerdown", onDown);\n- canvas.addEventListener("mousedown", onDown);';
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
  const diff = '+ canvas.addEventListener("pointerdown", onDown);';
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：词边界（mouseup 不命中 mousemove 行）', () => {
  const card = 'canvas 绑定 mousemove 跟踪位置。\n';
  const diff = '+ window.addEventListener("pointerup", onUp);';
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

check('findStaleSnippets：删除行含新词不报（diff 移除 pointerdown 而非引入）', () => {
  const card = 'canvas 绑定 mousedown 处理拖拽。\n';
  // 只有 - 行（删除）含 pointerdown，无 + 行 → 未引入新写法，不报
  const diff = '- renderer.addEventListener("pointerdown", onDown);\n';
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

check('findStaleSnippets：大小写不敏感（卡写 MouseDown / diff 写 PointerDown）', () => {
  const card = 'canvas 绑定 MouseDown 处理拖拽。\n';
  const diff = '+ canvas.addEventListener("PointerDown", onDown);\n';
  const hits = findStaleSnippets(card, diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 1);
  assert.ok(hits[0].pair.oldWord, 'mousedown'); // 展示用纯词
});

check('findStaleSnippets：lineOffset 补偿 frontmatter 行号（P2 修复）', () => {
  // frontmatter 4 行（--- / kind / --- / 空行），正文第 1 行 = 全文第 5 行
  const card = '---\nkind: x\n---\n\ncanvas 绑定 mousedown 处理拖拽。\n';
  const diff = '+ addEventListener("pointerdown", onDown);\n';
  const hits = findStaleSnippets(card, diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 5); // 而非 body 相对行号 1
});

check('parseCardText：剥离 frontmatter 并返回正确 offset', () => {
  const text = '---\nkind: x\nname: y\n---\n\n正文内容\n';
  const { body, offset } = parseCardText(text);
  assert.strictEqual(body, '正文内容\n');
  assert.strictEqual(offset, 5); // frontmatter 4 行 + 分隔空行 1 行 = 5 行
});

check('parseCardText：无 frontmatter 返回原文本 + offset 0', () => {
  const { body, offset } = parseCardText('纯正文\n');
  assert.strictEqual(body, '纯正文\n');
  assert.strictEqual(offset, 0);
});

check('parseCardText：UTF-8 BOM 前缀不破坏 frontmatter 解析（P4）', () => {
  const { body, offset } = parseCardText('\uFEFF---\nkind: x\n---\n\n正文\n');
  assert.strictEqual(body, '正文\n');
  // BOM 与 --- 同行（第 1 行），frontmatter 块占 4 个换行 → offset 4，正文首行为第 5 行
  assert.strictEqual(offset, 4);
});

check('findStaleSnippets：CONTEXTUAL 大小写变体不误报（Deprecated/must not）', () => {
  const card = 'mousedown 已被 Deprecated，勿用。\ncanvas 绑定 mousedown 处理拖拽。\n';
  const diff = '+ addEventListener("pointerdown", onDown);\n';
  const hits = findStaleSnippets(card, diff);
  // 第 1 行含 Deprecated → 警示语境跳过；第 2 行正常描述 → 报
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
});

check('findStaleSnippets：裸词 mouse 泛指命中（真实场景 model3d.md L73）', () => {
  const card = '- cleanup() 必须完整执行：移除 keydown/keyup/mouse/resize/fullscreenchange 全部监听\n';
  const diff = '+ canvas.addEventListener("pointerdown", (e) => {\n- canvas.addEventListener("mousedown", (e) => {';
  const hits = findStaleSnippets(card, diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].pair.oldWord, 'mouse');
  assert.strictEqual(hits[0].pair.new, 'pointer');
});

check('findStaleSnippets：裸词 mouse 不误命中 mousedown 行（词边界）', () => {
  // mousedown 内嵌 mouse 但 \bmouse\b 不成立 → 由精确对 mousedown 报一次
  const card = 'canvas 绑定 mousedown 处理拖拽。\n';
  const diff = '+ addEventListener("pointerdown", onDown);\n';
  const hits = findStaleSnippets(card, diff);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].pair.oldWord, 'mousedown'); // 精确词优先，非裸词
});

check('findStaleSnippets：裸词 mouse 警示语境不误报（零残留 mouse 事件）', () => {
  const card = '- **零残留 mouse 事件**：不得出现 `mousedown` 注册（红线）\n';
  const diff = '+ addEventListener("pointerdown", fn);\n';
  assert.deepStrictEqual(findStaleSnippets(card, diff), []);
});

if (fails.length) {
  console.error(`\n契约失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n全部通过');
