#!/usr/bin/env node
/**
 * 契约测试：check-menu-health.mjs 菜单健康门禁。
 *
 * 覆盖：
 *   1. parseItem 识别 panel 项的 render 与 renderCustom 两种渲染入口（ADR-085 逃生舱：
 *      PreviewMenuItemDef.render → PreviewMenuNode.renderCustom）
 *   2. parseItem 识别 action 项的 run
 *   3. 全量扫描当前仓库 4 个菜单表文件应 0 违规（rc=0）
 *   4. [2026-09-15 分层] 根项 / 叶子节点分层判据——非根节点（独立 const 叶子、children 内联叶子）
 *      不得按根白名单校验（原误报源：vrm-adapter 的 VRM_PLAY_EMPTY_NODE，kind:"field"）
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_menu_health.mjs
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveLegalLeafKinds,
  itemViolations,
  parseContent,
  parseFileNodes,
  parseItem,
} from "../scripts/check-menu-health.ts";
import { check, finish } from "./_lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function runMenuHealth(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-menu-health.ts"), ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

check("parseItem 识别 panel 项 render 入口", () => {
  const item = parseItem(
    `{
    id: "model",
    icon: "🧍",
    labelKey: "preview.model",
    dockGroup: "model",
    kind: "panel",
    render: (list, closePopup) => {},
  }`,
    "model",
  );
  assert.equal(item.kind, "panel");
  assert.equal(item.hasRender, true, "render: 应记为 hasRender");
});

check("parseItem 识别 panel 项 renderCustom 逃生舱入口（ADR-085）", () => {
  const item = parseItem(
    `{
    id: "bones",
    icon: "🦴",
    labelKey: "preview.bones",
    dockGroup: "model",
    kind: "panel",
    renderCustom: (list) => {},
  }`,
    "bones",
  );
  assert.equal(item.kind, "panel");
  assert.equal(item.hasRender, true, "renderCustom: 应记为 hasRender");
});

check("parseItem 识别 panel 项 schemaId 受控通道（ADR-126 P5）", () => {
  const item = parseItem(
    `{
    id: "model",
    icon: "🎭",
    labelKey: "preview.modelInfo",
    dockGroup: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
  }`,
    "model",
  );
  assert.equal(item.kind, "panel");
  assert.equal(
    item.hasRender,
    true,
    "schemaId: 应记为 hasRender（受控 schema 是渲染通道，renderPreviewPanel 优先查询）",
  );
});

check("parseItem 识别 schemaId + renderCustom 双通道同存（契约禁止——62c83271 review P3）", () => {
  const item = parseItem(
    `{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
    renderCustom: (list) => {},
  }`,
    "model",
  );
  assert.equal(
    item.dualChannel,
    true,
    "schemaId 与 renderCustom 同存 → dualChannel 标记（门禁 render-channel-ambiguous 拦截）",
  );
});

check("parseItem 识别 schemaId-only 不误报 dualChannel", () => {
  const item = parseItem(
    `{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
  }`,
    "model",
  );
  assert.equal(item.dualChannel, false, "仅 schemaId 无 renderCustom → 非双通道");
});

check("门禁拦截路径：schemaId + renderCustom 同存项产出 render-channel-ambiguous 违规", () => {
  const it = parseItem(
    `{
    id: "model",
    kind: "panel",
    labelKey: "preview.model",
    schemaId: YSM_MODEL_SCHEMA_ID,
    renderCustom: (list) => {},
  }`,
    "model",
  );
  it.file = "frontend/src/preview-3d/adapters/ysm-adapter.ts";
  const v = itemViolations(it, new Set(["preview.model"]));
  assert.ok(
    v.some((x) => x.rule === "render-channel-ambiguous"),
    "双通道同存必须被门禁拦截（拦截路径真实执行）",
  );
});

check("反例：schemaId 父项 + children 内 renderCustom 子节点不误报双通道", () => {
  const it = parseItem(
    `{
    id: "model",
    kind: "panel",
    schemaId: YSM_MODEL_SCHEMA_ID,
    children: [
      { id: "sub", kind: "field", renderCustom: (list) => {}, value: "" },
    ],
  }`,
    "model",
  );
  assert.equal(
    it.dualChannel,
    false,
    "children 内 renderCustom 不算父项双通道（stripTopChildren 剥离）",
  );
});

check("parseItem 识别 action 项 run 入口", () => {
  const item = parseItem(
    `{
    id: "export",
    icon: "📤",
    labelKey: "preview.export",
    kind: "action",
    run: () => {},
  }`,
    "export",
  );
  assert.equal(item.kind, "action");
  assert.equal(item.hasRun, true);
});

check("[2026-09-15 分层] 独立 const 叶子不计入根项，也不报 kind-valid", () => {
  const src = `
const VRM_PLAY_EMPTY_NODE: PreviewMenuNode = {
  id: "vrma-play-empty",
  kind: "field",
  labelKey: "preview.playEmpty",
  value: "未找到动作文件。",
};
const items: PreviewMenuNode[] = [
  {
    id: "model",
    kind: "panel",
    labelKey: "preview.model",
    dockGroup: "model",
    renderCustom: (list) => {},
  },
];
items.push({
  id: "vrma-play",
  kind: "panel",
  labelKey: "preview.mmdPlay",
  dockGroup: "motion",
  children: playChildren,
});
`;
  const { roots, leaves } = parseContent(
    src,
    "frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts",
  );
  assert.deepEqual(
    roots.map((i) => i.id),
    ["model", "vrma-play"],
    "根项 = PreviewMenuNode[] 标注 const 的数组元素 ∪ items.push 实参",
  );
  assert.deepEqual(
    leaves.map((i) => i.id),
    ["vrma-play-empty"],
    "独立 const 叶子节点应归入 leaves（kind:field 是合法 PreviewMenuNodeKind）",
  );
  const zh = new Set(["preview.model", "preview.mmdPlay", "preview.playEmpty"]);
  const v = [...roots, ...leaves].flatMap((it) => itemViolations(it, zh));
  assert.deepEqual(v, [], `根/叶子分层后不应有违规，实际：${JSON.stringify(v)}`);
});

check("[2026-09-15 分层] children 内联叶子走叶子白名单（divider 无 labelKey 不报）", () => {
  const src = `
const items: PreviewMenuNode[] = [
  {
    id: "play",
    kind: "panel",
    labelKey: "preview.mmdPlay",
    dockGroup: "motion",
    children: [
      { id: "anim-row", kind: "row", value: "" },
      { id: "sep", kind: "divider" },
    ],
  },
];
`;
  const { roots, leaves } = parseContent(src, "frontend/src/preview-3d/adapters/ysm-adapter.ts");
  assert.deepEqual(
    roots.map((i) => i.id),
    ["play"],
  );
  assert.deepEqual(
    leaves.map((i) => i.id),
    ["anim-row", "sep"],
    "children 数组内联字面量属叶子层",
  );
  const zh = new Set(["preview.mmdPlay"]);
  assert.deepEqual(
    itemViolations(
      leaves.find((i) => i.id === "sep"),
      zh,
    ),
    [],
    "叶子豁免「labelKey 必存在」（divider/sectionTitle 等无文案），但声明了仍须在 zh-CN",
  );
  assert.deepEqual(itemViolations(roots[0], zh), [], "父 panel 不应被 children 内容牵连");
});

check("[2026-09-15 分层] 叶子 kind 非法仍被拦（分层不脱牙）", () => {
  const it = parseItem(`{ id: "bad", kind: "nope", value: "" }`, "bad", "leaf");
  const v = itemViolations(it, new Set());
  assert.ok(
    v.some((x) => x.rule === "kind-valid"),
    "叶子 kind 不在 PreviewMenuNodeKind 白名单内必须拦",
  );
  assert.equal(it.tier, "leaf");
});

check("[2026-09-15 分层] 根项仍按可 dock 白名单拦 panel/action/divider 之外的 kind", () => {
  const it = parseItem(`{ id: "rootbad", kind: "row", labelKey: "preview.model" }`, "rootbad");
  const v = itemViolations(it, new Set(["preview.model"]));
  assert.ok(
    v.some((x) => x.rule === "kind-valid"),
    '根项 kind:"row" 非法（叶子 kind 不得上根）',
  );
});

check("[2026-09-15 分层] 叶子白名单自 PreviewMenuNodeKind 推导（单一事实来源）", () => {
  const kinds = deriveLegalLeafKinds();
  for (const k of [
    "folder",
    "panel",
    "action",
    "slider",
    "toggle",
    "select",
    "button",
    "color",
    "field",
    "row",
    "divider",
    "sectionTitle",
    "card",
    "material-row",
    "controls",
    "custom",
  ]) {
    assert.ok(kinds.has(k), `叶子白名单缺 ${k}（推导漏项）`);
  }
  assert.ok(!kinds.has("nope"), "推导清单不得混入非类型值");
});

check("[2026-09-15 分层] 真实仓库：vrma-play-empty 归类叶子、不计入根项", () => {
  const { roots, leaves } = parseFileNodes("frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts");
  assert.ok(
    !roots.some((i) => i.id === "vrma-play-empty"),
    "独立 const 叶子不得计入根菜单项（否则 kind:field 被按根白名单误报）",
  );
  const leaf = leaves.find((i) => i.id === "vrma-play-empty");
  assert.equal(leaf?.kind, "field", "该节点应作为叶子被识别");
  assert.equal(roots.length, 5, "vrm 根项：model/shot/material/vrma-play/perception");
});

check("全量 4 菜单表扫描当前仓库应 0 违规（rc=0）", () => {
  const { rc, out } = runMenuHealth(["--json"]);
  const data = JSON.parse(out);
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 500)}`);
  assert.equal(data._summary.violations, 0, `预期 0 违规，实际 ${data._summary.violations}`);
});

finish("契约测试全过");
console.log("\n全部通过");
