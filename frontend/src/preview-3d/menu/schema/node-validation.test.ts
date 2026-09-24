// ===== node-validation.test.ts — per-kind 字段契约门禁（2026-10 锐评收口）=====
//
// 与 health.test.ts 同属「菜单契约门」：health 管「面板有无渲染通道 / 渲染非空」，
// 本门管「节点字段与 kind 是否配对」——补 PreviewMenuNode 宽接口无判别器留下的静默错配盲区
// （`{kind:"field", radio:{…}}` 编译通过、渲染器静默忽略）。
//
// 双向断言：
//  ① 正向：CORE_MENU_ITEMS + core 面板 builder 产出 + schema-registry 全量 → 零违规。
//  ② 负向自检：故意构造错配节点 → validateNode 必须报出（证明门非摆设，对齐
//     health.test.ts「自检：guard 能抓出坏 builder」与 render-custom-audit 的自检纪律）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CORE_MENU_ITEMS } from "@/preview-3d/menu/engine/defs.ts";
import { buildPreviewMenuRouters } from "@/preview-3d/menu/engine/core.ts";
import { getSchema, listSchemas, resetSchemas } from "@/preview-3d/infra/schema-registry.ts";
import type { PreviewMenuNode } from "./menu-node-types.ts";
import {
  COMMON_NODE_FIELDS,
  KIND_SPECIFIC_FIELDS,
  validateNode,
  validateNodeTree,
} from "./node-validation.ts";
import { makeMenuCtx as makeCtx, mockMenuHandle as mockMenu } from "@/preview-3d/menu/menu-test-fixtures.ts";

// ===================================================================
// ① 负向自检：错配必须被抓（门非摆设）
// ===================================================================
describe("validateNode 自检（负向控制）", () => {
  it("抓到 kind 与专有字段错配（field 挂 row 的 radio）", () => {
    const bad = { id: "b", kind: "field", radio: { active: true, title: "t", onClick: () => {} } } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["radio"]);
  });

  it("抓到 material-row 专有字段挂到 slider 上", () => {
    const bad = { id: "b", kind: "slider", eye: { get: () => true, set: () => {} } } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["eye"]);
  });

  it("抓到 controls 通道字段挂到普通叶节点", () => {
    const bad = { id: "b", kind: "button", controls: [] } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["controls"]);
  });

  it("抓到卡牌折叠字段挂到 folder（collapsible 仅 card 合法）", () => {
    const bad = { id: "b", kind: "folder", collapsible: true } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["collapsible"]);
  });

  it("validateNodeTree 递归下钻 children 并聚合违规", () => {
    const tree: PreviewMenuNode[] = [
      {
        id: "folder-ok",
        kind: "folder",
        children: [
          { id: "bad-leaf", kind: "divider", value: "不该有" } as unknown as PreviewMenuNode,
        ],
      },
    ];
    const out = validateNodeTree(tree);
    expect(out).toEqual([{ id: "bad-leaf", kind: "divider", fields: ["value"] }]);
  });

  it("精确性：只认渲染器真正读取的字段——button/row 的 danger 未被读取 → 判契约外", () => {
    // danger 仅读于 core.ts|makePreviewMenuRow（叶节点 makeRow 路径，panel/action/custom），
    // button 走 rmMakeRowBase、row 走 rmAppendDynamicRow 均不读它。
    expect(
      validateNode({ id: "b", kind: "button", danger: true } as unknown as PreviewMenuNode),
    ).toEqual(["danger"]);
    expect(
      validateNode({ id: "r", kind: "row", danger: true } as unknown as PreviewMenuNode),
    ).toEqual(["danger"]);
    // 反证：同样 danger 在 action（makeRow 路径）合法
    expect(validateNode({ id: "a", kind: "action", danger: true } as unknown as PreviewMenuNode)).toEqual(
      [],
    );
  });
});

// ===================================================================
// ①′ 负向自检的反面：合法组合不得误报（防空转/过严）
// ===================================================================
describe("validateNode 正例（合法组合不误报）", () => {
  it("row 带 value/radio/badge/headerToggle/action/rowDensity 全合法", () => {
    const ok: PreviewMenuNode = {
      id: "ok-row",
      kind: "row",
      value: "meta",
      radio: { active: false, title: "t", onClick: () => {} },
      badge: { icon: "settings", title: "t", onClick: () => {} },
      headerToggle: { value: true, onChange: () => {} },
      action: () => {},
      rowDensity: "compact",
    };
    expect(validateNode(ok)).toEqual([]);
  });

  it("field 带 value、panel 带 children/schemaId/action、controls 带 controls 均合法", () => {
    expect(validateNode({ id: "f", kind: "field", value: 1 })).toEqual([]);
    expect(
      validateNode({ id: "p", kind: "panel", children: [], schemaId: "x", action: () => {} }),
    ).toEqual([]);
    expect(validateNode({ id: "c", kind: "controls", controls: [] })).toEqual([]);
  });

  it("button 带 rowDensity（rmMakeRowBase 共用行壳）、custom 带 action/danger（rmAppendLeaf）均合法", () => {
    expect(
      validateNode({ id: "b", kind: "button", rowDensity: "compact", action: () => {} }),
    ).toEqual([]);
    expect(
      validateNode({
        id: "cu",
        kind: "custom",
        renderCustom: () => {},
        action: () => {},
        danger: true,
      }),
    ).toEqual([]);
  });

  it("通用字段（labelKey/label/icon/visibleWhen/dockGroup/settingsOrder/hintKey）全 kind 合法", () => {
    // 用 folder 作代表：通用字段一个不落都不应报违规
    const ok = {
      id: "f",
      kind: "folder",
      labelKey: "preview.x",
      label: "明文",
      icon: "settings",
      hintKey: "preview.h",
      settingsOrder: 1,
      dockGroup: "settings",
      visibleWhen: () => true,
    } as unknown as PreviewMenuNode;
    expect(validateNode(ok)).toEqual([]);
  });

  it("COMMON_NODE_FIELDS 与 KIND_SPECIFIC_FIELDS 无交集（防重复登记漂移）", () => {
    const common = new Set<string>(COMMON_NODE_FIELDS);
    for (const [kind, fields] of Object.entries(KIND_SPECIFIC_FIELDS)) {
      for (const f of fields) {
        expect(common.has(f), `kind "${kind}" 的专有字段 "${f}" 与通用集重叠`).toBe(false);
      }
    }
  });
});

// ===================================================================
// ② 正向门：真实菜单树零违规
// ===================================================================
describe("真实菜单树 per-kind 字段契约（零违规门）", () => {
  beforeEach(() => resetSchemas());
  afterEach(() => resetSchemas());

  it("CORE_MENU_ITEMS 零违规", () => {
    expect(validateNodeTree(CORE_MENU_ITEMS)).toEqual([]);
  });

  it("core 面板 builder 产出（含 children 下钻）零违规", () => {
    const menu = mockMenu();
    const routers = buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      menu,
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    const violations: ReturnType<typeof validateNodeTree> = [];
    for (const [id, builder] of Object.entries(routers.schemaBuilders)) {
      const nodes = builder(menu);
      const bad = validateNodeTree(nodes);
      for (const b of bad) violations.push({ ...b, id: `${id}/${b.id}` });
    }
    expect(violations, `core 面板节点存在 kind/字段错配：${JSON.stringify(violations)}`).toEqual([]);
  });

  it("schema-registry 全量 builder 产出零违规（含 core 双注册——生产同路径，防门空转）", () => {
    // 生产里 core 面板经 buildPreviewMenuRouters 双注册进 registry；此处先复现该状态再枚举，
    // 否则 registry 为空 → 门空转恒绿（对齐 render-custom-audit 的「防白名单空转」自检纪律）。
    const menu = mockMenu();
    buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      menu,
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    const ids = listSchemas();
    expect(ids.length, "registry 应至少含 core 七面板（防门空转恒绿）").toBeGreaterThanOrEqual(7);
    const violations: ReturnType<typeof validateNodeTree> = [];
    for (const id of ids) {
      const builder = getSchema(id);
      if (!builder) continue;
      const bad = validateNodeTree(builder({}));
      for (const b of bad) violations.push({ ...b, id: `${id}/${b.id}` });
    }
    expect(violations, `registry 面板节点存在 kind/字段错配：${JSON.stringify(violations)}`).toEqual(
      [],
    );
  });
});
