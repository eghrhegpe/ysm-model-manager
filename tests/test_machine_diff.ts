#!/usr/bin/env node
/**
 * 契约测试：machine-diff.ts 滞留机器区自动收编判定（ADR-184）。
 *
 * 背景：gen 刷出的纯机器区 diff（auto_fields/symbols 键行 + 缩进列表项）与生成物整文件，
 * 因 gen 前已 dirty 被 gen-stage.ts 的并发隔离判定（stage = 快照变化 − 并行 dirty）排除而
 * 永久滞留工作区。本模块回答「滞留 dirty 文件可否自动收编」：
 *   - 生成物整文件（纯函数全量态，无人工策展区）→ whole 无条件收编；
 *   - 知识卡变更行全部匹配机器区行模式 → machine 收编；
 *   - 任一变更行落在人工策展区（正文/use_when/pitfalls/表格）→ manual 排除（并发隔离不放松）。
 *
 * 覆盖：
 *   1. 生成物整文件（event-graph.md 等）→ whole（无条件，不读 diff 内容）
 *   2. 知识卡纯机器区 diff（auto_fields 键行 + 缩进列表项）→ machine
 *   3. 知识卡 diff 含正文 prose 行 → manual 排除
 *   4. 知识卡 diff 含 use_when/pitfalls 等人工策展键 → manual 排除
 *   5. 空 diff → manual（防御：无变更不收编）
 *   6. 非快照域路径（scripts/ 等）→ inSnapScope false，不收编
 *   7. 生成物前缀（locales/completions）→ whole
 *   8. 逃生阀 YSM_SKIP_GEN_STAGE=1 → strandedStageList 空清单
 *   9. 路径归一化（反斜杠/正斜杠）
 *   10. project-map.md 刻意排除（用途表人工区）→ 按 diff 内容判定（含正文 → manual）
 *
 * 用法：node tests/test_machine_diff.ts
 * 退出码：0 通过 / 1 失败
 */
import assert from 'node:assert';

import {
  classifyStranded,
  isGenWholeOutput,
  inSnapScope,
  strandedStageList,
  GEN_WHOLE_OUTPUTS,
} from '../scripts/_lib/machine-diff.ts';

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error('✗', name, '-', (e as Error).message);
  }
}

// ── 1. 生成物整文件 → whole（无条件收编）──
check('生成物整文件（event-graph.md）→ whole 无条件收编', () => {
  // diff 内容任意（纯函数全量态），甚至含看似「人工」的行也不判 manual
  const diff = '--- a/docs/event-graph.md\n+++ b/docs/event-graph.md\n@@ -1 +1 @@\n-| 旧事件 |\n+| 新事件 |\n';
  assert.strictEqual(classifyStranded('docs/event-graph.md', diff), 'whole');
  assert.ok(isGenWholeOutput('docs/event-graph.md'), 'event-graph.md 应在整文件清单');
});

check('生成物前缀（locales/completions）→ whole', () => {
  assert.strictEqual(classifyStranded('frontend/public/locales/en.json', 'diff any'), 'whole');
  assert.strictEqual(classifyStranded('completions/ysm.bash', 'diff any'), 'whole');
  assert.ok(isGenWholeOutput('frontend/public/locales/zh-CN.json'));
  assert.ok(isGenWholeOutput('completions/_ysm'));
});

check('清单内关键路径齐全（routes 有源、project-map 刻意排除）', () => {
  // routes.md/routes-quick.md 描述列源在卡片 frontmatter（gen 读回），自身无人工区 → 在清单
  assert.ok(GEN_WHOLE_OUTPUTS.includes('docs/knowledge/routes.md'), 'routes.md 应在清单');
  assert.ok(GEN_WHOLE_OUTPUTS.includes('docs/knowledge/routes-quick.md'), 'routes-quick.md 应在清单');
  // project-map.md 用途表是人工知识（loadUsageFromDoc 读回）→ 不在整文件清单
  assert.ok(!GEN_WHOLE_OUTPUTS.includes('docs/project-map.md'), 'project-map.md 不得在整文件清单');
  assert.ok(!isGenWholeOutput('docs/project-map.md'));
});

// ── 2. 知识卡纯机器区 diff → machine ──
check('知识卡纯机器区（auto_fields 键行 + 缩进列表项）→ machine', () => {
  const diff = [
    '--- a/docs/knowledge/go-types.md',
    '+++ b/docs/knowledge/go-types.md',
    '@@ -69,8 +69,10 @@ auto_fields:',
    '  auto_fields:',
    '    symbols_with_lines:',
    '    - IsRenderableTextureExt',
    '    - IsTextureExt',
    '    - IsYsmEntryJSON',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/go-types.md', diff), 'machine');
});

check('知识卡纯机器区（symbols 顶层字段）→ machine', () => {
  const diff = [
    '--- a/docs/knowledge/x.md',
    '+++ b/docs/knowledge/x.md',
    '@@ -1,3 +1,4 @@',
    'symbols:',
    '  - AddedSym',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', diff), 'machine');
});

// ── 3. 人工策展区 → manual 排除 ──
check('知识卡 diff 含正文 prose 行 → manual 排除', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -10,4 +10,5 @@',
    '+这是并行会话手写的正文描述，非机器区',
    '    - IsYsmEntryJSON',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('知识卡 diff 含 use_when 人工策展键 → manual 排除', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -3,2 +3,3 @@',
    '+use_when: 并行会话补充的适用场景',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('知识卡 diff 含表格/正文列表（人工区形态）→ manual 排除', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -40,3 +40,4 @@',
    '+| 新表格行 | 人工维护 |',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

// ── 4. 防御：空 diff / 纯删除机器区 ──
check('空 diff → manual（防御：无变更不收编）', () => {
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', ''), 'manual');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', '   '), 'manual');
});

check('纯删除的机器区列表项 → machine（已删符号清理也是机器区）', () => {
  const diff = [
    '--- a/docs/knowledge/x.md',
    '+++ b/docs/knowledge/x.md',
    '@@ -69,8 +69,6 @@ auto_fields:',
    '    - addClearRow',
    '    - buildDepthMap',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', diff), 'machine');
});

// ── 5. 非快照域 → 不收编 ──
check('非快照域路径（scripts/go/frontend 源码）→ inSnapScope false', () => {
  assert.strictEqual(inSnapScope('scripts/_lib/gen-stage.ts'), false);
  assert.strictEqual(inSnapScope('go/fileops/folder_import.go'), false);
  assert.strictEqual(inSnapScope('frontend/src/app.ts'), false);
  assert.strictEqual(inSnapScope('docs/knowledge/x.md'), true);
  assert.strictEqual(inSnapScope('frontend/public/locales/en.json'), true);
  assert.strictEqual(inSnapScope('completions/_ysm'), true);
});

// ── 6. 路径归一化 ──
check('路径归一化（反斜杠命中整文件清单）', () => {
  assert.strictEqual(isGenWholeOutput('docs\\event-graph.md'), true);
  assert.strictEqual(classifyStranded('docs\\knowledge\\go-types.md', '  auto_fields:\n    - X'), 'machine');
});

// ── 7. 逃生阀 ──
check('逃生阀 YSM_SKIP_GEN_STAGE=1 → strandedStageList 空清单', () => {
  const prev = process.env.YSM_SKIP_GEN_STAGE;
  process.env.YSM_SKIP_GEN_STAGE = '1';
  try {
    assert.deepEqual(strandedStageList(['docs/knowledge/x.md']), []);
  } finally {
    if (prev === undefined) delete process.env.YSM_SKIP_GEN_STAGE;
    else process.env.YSM_SKIP_GEN_STAGE = prev;
  }
});

check('strandedStageList 空输入 → 空清单（不触发 git）', () => {
  assert.deepEqual(strandedStageList([]), []);
});

// ── 8. project-map.md 按 diff 内容判定 ──
check('project-map.md 用途表人工区 → manual（不误收编）', () => {
  const diff = [
    '--- a/docs/project-map.md',
    '+++ b/docs/project-map.md',
    '@@ -20,2 +20,3 @@',
    '+| upstream/ | 第三方 vendor（人工维护用途） |',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/project-map.md', diff), 'manual');
});

if (fails.length) {
  console.error(`\n${fails.length} 个用例失败:`);
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('\n全部通过 ✅');
