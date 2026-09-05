#!/usr/bin/env node
/**
 * 契约测试：machine-diff.ts 滞留机器区自动收编判定（ADR-184）。
 *
 * 背景：gen 刷出的纯机器区 diff（auto_fields/symbols 键行 + 裸符号列表项）与生成物整文件，
 * 因 gen 前已 dirty 被 gen-stage.ts 的并发隔离判定（stage = 快照变化 − 并行 dirty）排除而
 * 永久滞留工作区。本模块回答「滞留 dirty 文件可否自动收编」：
 *   - 生成物整文件（纯函数全量态，无人工策展区）→ whole 无条件收编；
 *   - 知识卡 diff 变更行全部落在真实机器区（auto_fields YAML 块，信号 = hunk section 头
 *     `@@ ... @@ auto_fields:` 或块内顶格机器键行）且形态为裸符号列表项 → machine 收编；
 *   - 任一变更行落在人工策展区（正文/use_when/pitfalls/表格/列0 bullet/ADR 正文）→ manual
 *     排除（并发隔离不放松——ADR-151 卷带红线）。
 *
 * 真实 git diff 形态（本仓 git 实证 6f53154f）：机器区 hunk 头带 funcname section
 * （`@@ -66,9 +66,11 @@ auto_fields:`）；上下文行 = 单空格前缀 + 原文件行。
 *
 * 覆盖：
 *   1. 生成物整文件（event-graph.md 等）→ whole（无条件，不读 diff 内容）
 *   2. 生成物前缀（locales/completions）→ whole
 *   3. 清单关键路径：routes 在、project-map.md 刻意排除
 *   4. 机器区 hunk（section 头 auto_fields + `+    - 裸符号`）→ machine
 *   5. 机器区纯删除（符号移除清理）→ machine
 *   6. 机器区无 section 头但 hunk 内含 auto_fields 键行上下文 → machine（键行信号路径）
 *   7. 机器块内旧格式空行重排（符号间空行删除 + 符号变更混合）→ machine（空行中性）
 *   8. 机器子键行变更（`+  symbols_with_lines:` 整块形态）→ machine
 *   9. use_when/pitfalls 人工 bullet（缩进中文/含连字符 token）→ manual
 *   10. 列0 bullet 增删（`+- 项` / `-- 项`，content 以 +/- 开头）→ manual（旧 L83 防御回归）
 *   11. 正文 prose / 表格行 / ADR 文档 bullet → manual
 *   12. 混合 diff：机器区 hunk + 人工行 → manual（任一人行排除整体）
 *   13. 空 diff / 纯空行删除 diff → manual（无机器变更保守不收编）
 *   14. 非快照域路径（scripts/ 等）→ inSnapScope false
 *   15. 逃生阀 YSM_SKIP_GEN_STAGE=1 → strandedStageList 空清单
 *   16. 路径归一化（反斜杠/正斜杠）
 *   17. project-map.md 用途表人工区（表格行）→ manual
 *   18. 人工 bullet 恰好是裸符号形态但在 use_when 人工块内 → manual（块信号兜底）
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

// ── 2. 机器区 hunk（section 头信号）→ machine ──
// 真实形态：本仓 git 对深 hunk 也会带 `@@ ... @@ auto_fields:`（6f53154f go-types 66-139 行实证）
check('机器区新增（section 头 auto_fields + 缩进裸符号项）→ machine', () => {
  const diff = [
    '--- a/docs/knowledge/go-types.md',
    '+++ b/docs/knowledge/go-types.md',
    '@@ -66,9 +66,11 @@ auto_fields:',
    '     - IsDirLevelSync',
    '     - IsDisableSuffix',
    '     - IsNestedModelDir',
    '+    - IsRenderableTextureExt',
    '     - IsResourceAllowed',
    '     - IsScanInstance',
    '     - IsSupportedExt',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/go-types.md', diff), 'machine');
});

check('机器区纯删除（已删符号清理，section 头 auto_fields）→ machine', () => {
  const diff = [
    '--- a/docs/knowledge/go-types.md',
    '+++ b/docs/knowledge/go-types.md',
    '@@ -69,8 +69,6 @@ auto_fields:',
    '     - IsDirLevelSync',
    '     - IsDisableSuffix',
    '-    - buildDepthMap',
    '-    - addClearRow',
    '     - IsNestedModelDir',
    '     - IsResourceAllowed',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/go-types.md', diff), 'machine');
});

// ── 3. 机器区无 section 头，但 hunk 内含顶格机器键行上下文 → machine ──
check('无 section 头但 hunk 内见 auto_fields 键行 → machine（键行信号路径）', () => {
  const diff = [
    '--- a/docs/knowledge/go-types.md',
    '+++ b/docs/knowledge/go-types.md',
    '@@ -8,5 +8,6 @@',
    ' auto_fields:',
    '   symbols_with_lines:',
    '     - AllExts',
    '+    - NewSym',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/go-types.md', diff), 'machine');
});

// ── 4. 机器块内旧格式空行重排（符号+空行交替 → 压缩）+ 符号变更 → machine ──
check('机器块空行删除混合符号变更 → machine（空行中性不误判）', () => {
  const diff = [
    '--- a/docs/knowledge/frontend_repo_audit.md',
    '+++ b/docs/knowledge/frontend_repo_audit.md',
    '@@ -66,9 +66,9 @@ auto_fields:',
    '     - IsDirLevelSync',
    '-',
    '     - IsDisableSuffix',
    '     - IsNestedModelDir',
    '+    - IsRenderableTextureExt',
    '     - IsResourceAllowed',
    '     - IsScanInstance',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/frontend_repo_audit.md', diff), 'machine');
});

// ── 5. 机器子键行整块新增（gen 首次插入 auto_fields）→ machine ──
check('整块新增（auto_fields 键 + symbols_with_lines 子键 + 列表项）→ machine', () => {
  const diff = [
    '--- a/docs/knowledge/x.md',
    '+++ b/docs/knowledge/x.md',
    '@@ -6,0 +7,4 @@',
    '+auto_fields:',
    '+  symbols_with_lines:',
    '+    - SymA',
    '+    - SymB',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', diff), 'machine');
});

// ── 6. 人工策展区 → manual 排除 ──
check('use_when 人工 bullet 增补（缩进中文长句）→ manual', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -8,3 +8,4 @@ use_when:',
    '   - 场景A',
    '   - 场景B',
    '+  - 并行会话补充的新适用场景',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('pitfalls 人工 bullet 删除（含连字符 token，2 空格缩进）→ manual', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -40,4 +40,3 @@ pitfalls:',
    '   - Vector3 频繁 new 造成 GC 抖动；必须复用或池化',
    '-  - AbortController 未清理导致事件泄漏；必须在 dispose 时 abort',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('use_when 人工 bullet 恰好是裸符号形态 → manual（块信号兜底，不吞人工编辑）', () => {
  // 形态与机器项同构（`  - IsTextureExt`），但处于 use_when 人工块（section 头非机器键）
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -8,2 +8,3 @@ use_when:',
    '   - 场景A',
    '+  - IsTextureExt',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('正文 prose 行 → manual 排除', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -10,4 +10,5 @@',
    '+这是并行会话手写的正文描述，非机器区',
    '     - IsYsmEntryJSON',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

// ── 7. 列0 bullet 增删（content 以 +/- 开头）→ manual（旧 L83 防御回归）──
check('列0 bullet 新增（`+- item`）→ manual（不被静默吞掉）', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -50,3 +50,4 @@',
    ' 正文段落',
    '+- 人工维护的列0 bullet',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

check('列0 bullet 删除（`-- item`）→ manual（不被静默吞掉）', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -50,4 +50,3 @@',
    ' 正文段落',
    '-- 人工维护的列0 bullet',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

// ── 8. ADR 文档 / 表格 → manual ──
check('ADR 文档新增决策 bullet → manual（docs/adr 非机器区）', () => {
  const diff = [
    '--- a/docs/adr/ADR-184-diff-gen-stage-stage.md',
    '+++ b/docs/adr/ADR-184-diff-gen-stage-stage.md',
    '@@ -10,2 +10,3 @@',
    ' ## 决策',
    '+ - 追加一条并行会话新决策',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/adr/ADR-184-diff-gen-stage-stage.md', diff), 'manual');
});

check('知识卡 diff 含表格行 → manual 排除', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -40,3 +40,4 @@',
    '+| 新表格行 | 人工维护 |',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

// ── 9. 混合 diff：机器区 + 人工行 → manual（任一人行排除整体）──
check('机器区 hunk + 人工 use_when bullet 混合 → manual（防吞并行手改）', () => {
  const diff = [
    '--- a/docs/knowledge/some-card.md',
    '+++ b/docs/knowledge/some-card.md',
    '@@ -66,9 +66,11 @@ auto_fields:',
    '     - IsDirLevelSync',
    '+    - IsRenderableTextureExt',
    '     - IsResourceAllowed',
    '@@ -8,3 +8,4 @@ use_when:',
    '   - 场景A',
    '+  - 并行会话补充的新适用场景',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/some-card.md', diff), 'manual');
});

// ── 10. 防御：空 diff / 纯空行变更 ──
check('空 diff → manual（防御：无变更不收编）', () => {
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', ''), 'manual');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', '   '), 'manual');
});

check('纯空行删除（无符号变更）→ manual（无机器变更保守不收编）', () => {
  const diff = [
    '--- a/docs/knowledge/x.md',
    '+++ b/docs/knowledge/x.md',
    '@@ -66,8 +66,6 @@ auto_fields:',
    '     - IsDirLevelSync',
    '-',
    '     - IsDisableSuffix',
  ].join('\n');
  assert.strictEqual(classifyStranded('docs/knowledge/x.md', diff), 'manual');
});

// ── 11. 非快照域 → 不收编 ──
check('非快照域路径（scripts/go/frontend 源码）→ inSnapScope false', () => {
  assert.strictEqual(inSnapScope('scripts/_lib/gen-stage.ts'), false);
  assert.strictEqual(inSnapScope('go/fileops/folder_import.go'), false);
  assert.strictEqual(inSnapScope('frontend/src/app.ts'), false);
  assert.strictEqual(inSnapScope('docs/knowledge/x.md'), true);
  assert.strictEqual(inSnapScope('frontend/public/locales/en.json'), true);
  assert.strictEqual(inSnapScope('completions/_ysm'), true);
});

// ── 12. 路径归一化 ──
check('路径归一化（反斜杠命中整文件清单）', () => {
  assert.strictEqual(isGenWholeOutput('docs\\event-graph.md'), true);
});

// ── 13. 逃生阀 ──
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

// ── 14. project-map.md 按 diff 内容判定 ──
check('project-map.md 用途表人工区（表格行）→ manual（不误收编）', () => {
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
