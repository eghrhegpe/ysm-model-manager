#!/usr/bin/env node
/**
 * 契约测试：check-menu-health.mjs 菜单健康门禁。
 *
 * 覆盖：
 *   1. parseItem 识别 panel 项的 render 与 renderCustom 两种渲染入口（ADR-085 逃生舱：
 *      PreviewMenuItemDef.render → PreviewMenuNode.renderCustom）
 *   2. parseItem 识别 action 项的 run
 *   3. 全量扫描当前仓库 4 个菜单表文件应 0 违规（rc=0）
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_menu_health.mjs
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseItem, itemViolations } from '../scripts/check-menu-health.mjs';

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

function runMenuHealth(args) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-menu-health.mjs'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

check('parseItem 识别 panel 项 render 入口', () => {
  const item = parseItem(`{
    id: "model",
    icon: "🧍",
    labelKey: "preview.model",
    dockGroup: "model",
    kind: "panel",
    render: (list, closePopup) => {},
  }`, 'model');
  assert.equal(item.kind, 'panel');
  assert.equal(item.hasRender, true, 'render: 应记为 hasRender');
});

check('parseItem 识别 panel 项 renderCustom 逃生舱入口（ADR-085）', () => {
  const item = parseItem(`{
    id: "bones",
    icon: "🦴",
    labelKey: "preview.bones",
    dockGroup: "model",
    kind: "panel",
    renderCustom: (list) => {},
  }`, 'bones');
  assert.equal(item.kind, 'panel');
  assert.equal(item.hasRender, true, 'renderCustom: 应记为 hasRender');
});

check('parseItem 识别 panel 项 schemaId 受控通道（ADR-126 P5）', () => {
  const item = parseItem(`{
    id: "model",
    icon: "🎭",
    labelKey: "preview.modelInfo",
    dockGroup: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
  }`, 'model');
  assert.equal(item.kind, 'panel');
  assert.equal(item.hasRender, true, 'schemaId: 应记为 hasRender（受控 schema 是渲染通道，renderPreviewPanel 优先查询）');
});

check('parseItem 识别 schemaId + renderCustom 双通道同存（契约禁止——62c83271 review P3）', () => {
  const item = parseItem(`{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
    renderCustom: (list) => {},
  }`, 'model');
  assert.equal(item.dualChannel, true, 'schemaId 与 renderCustom 同存 → dualChannel 标记（门禁 render-channel-ambiguous 拦截）');
});

check('parseItem 识别 schemaId-only 不误报 dualChannel', () => {
  const item = parseItem(`{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
  }`, 'model');
  assert.equal(item.dualChannel, false, '仅 schemaId 无 renderCustom → 非双通道');
});

check('门禁拦截路径：schemaId + renderCustom 同存项产出 render-channel-ambiguous 违规', () => {
  const it = parseItem(`{
    id: "model",
    kind: "panel",
    labelKey: "preview.model",
    schemaId: YSM_MODEL_SCHEMA_ID,
    renderCustom: (list) => {},
  }`, 'model');
  it.file = 'frontend/src/preview-3d/adapters/ysm-adapter.ts';
  const v = itemViolations(it, new Set(['preview.model']));
  assert.ok(v.some((x) => x.rule === 'render-channel-ambiguous'), '双通道同存必须被门禁拦截（拦截路径真实执行）');
});

check('反例：schemaId 父项 + children 内 renderCustom 子节点不误报双通道', () => {
  const it = parseItem(`{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
    children: [
      { id: "sub", kind: "field", renderCustom: (list) => {}, value: "" },
    ],
  }`, 'model');
  assert.equal(it.dualChannel, false, 'children 内 renderCustom 不算父项双通道（stripTopChildren 剥离）');
});

check('parseItem 识别 action 项 run 入口', () => {
  const item = parseItem(`{
    id: "export",
    icon: "📤",
    labelKey: "preview.export",
    kind: "action",
    run: () => {},
  }`, 'export');
  assert.equal(item.kind, 'action');
  assert.equal(item.hasRun, true);
});

check('全量 4 菜单表扫描当前仓库应 0 违规（rc=0）', () => {
  const { rc, out } = runMenuHealth(['--json']);
  const data = JSON.parse(out);
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 500)}`);
  assert.equal(data._summary.violations, 0, `预期 0 违规，实际 ${data._summary.violations}`);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
