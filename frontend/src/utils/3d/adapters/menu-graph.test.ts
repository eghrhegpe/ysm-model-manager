// menu-graph.test.ts — [doc:adr-128] collectMenuGraph / collectNodePredicates 契约测试
// 红线：双通道并集枚举（闭包 schemaBuilders + schema-registry Map）、children 递归、
//       fillers 过程式标 procedural、visibleWhen 快照可达性、节点级谓词收集（非 cap 级）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectMenuGraph, collectNodePredicates } from "./menu-graph.ts";
import type { MenuGraph, MenuGraphNode, RepresentativeSnapshot } from "./menu-graph.ts";
import type { PreviewMenuRouters } from "./preview-menu.ts";
import { buildPreviewMenuRouters } from "./preview-menu.ts";
import { makeMenuCtx, mockMenuHandle } from "./menu-test-fixtures.ts";
import { registerSchema, resetSchemas } from "./schema-registry.ts";
import type { PreviewMenuNode, PreviewSnapshot } from "./preview-menu-node-types.ts";
import type { SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";

/** 默认代表性快照：空记录（无状态守卫激活）→ 非守卫节点可达，守卫节点隐藏 */
const DEFAULT_SNAP: PreviewSnapshot = {};

function buildGraphRouters(): { routers: PreviewMenuRouters; menu: SlideMenuHandle } {
  const ctx = makeMenuCtx();
  const menu = mockMenuHandle();
  const actionCtx = { toast: vi.fn(), closeAllOverlays: vi.fn() };
  const shell = { handle: null };
  return { routers: buildPreviewMenuRouters(ctx, () => {}, menu, actionCtx, shell), menu };
}

/** 类型化包装：消费 MenuGraph / PreviewMenuRouters / RepresentativeSnapshot 公共契约 */
function collect(routers: PreviewMenuRouters, menu: SlideMenuHandle, snaps: RepresentativeSnapshot[]): MenuGraph {
  return collectMenuGraph({ routers, menu, snapshots: snaps });
}

describe("collectMenuGraph（ADR-128 双通道并集枚举）", () => {
  beforeEach(() => resetSchemas());
  afterEach(() => resetSchemas());

  it("枚举闭包 schemaBuilders + registry 双通道，roles 标 procedural（coverage=partial）", () => {
    // registry 通道：注册 ysm-model（模拟 ysm-adapter 运行时注册）
    registerSchema("ysm-model", () => [
      {
        id: "model",
        kind: "panel",
        dockGroup: "model",
        children: [{ id: "stat-tex", kind: "field", value: "x" }],
      },
    ]);
    const { routers, menu } = buildGraphRouters();
    const graph = collect(routers, menu, [{ name: "default", snapshot: DEFAULT_SNAP }]);

    const byGroup = Object.fromEntries(
      graph.docks.map((d) => [d.group, d.panels.map((p) => p.id)]),
    );
    // 闭包 schemaBuilders 通道（6 个常驻 L2 面板）
    expect(byGroup["scene"]).toEqual(
      expect.arrayContaining(["lighting", "shadow", "postproc", "camera"]),
    );
    expect(byGroup["settings"]).toEqual(expect.arrayContaining(["settings"]));
    expect(byGroup["env"]).toEqual(expect.arrayContaining(["environment"]));
    // registry 通道（ysm-model 解析进 model dock）+ 闭包缺的 roles filler
    expect(byGroup["model"]).toEqual(expect.arrayContaining(["roles", "ysm-model"]));

    // 🔴 P4-B 未落地：roles 过程式 + 6 builder 未迁 registry → partial
    expect(graph.coverage).toBe("partial");
    expect(graph.proceduralPanels).toContain("roles");
    // 关键：registry 通道真被枚举（死穴一的反证）
    expect(graph.proceduralPanels).not.toContain("ysm-model");
  });

  it("children 递归 + visibleWhen 快照可达性求值（默认快照下守卫节点不可达）", () => {
    registerSchema("ysm-model", () => [
      {
        id: "model",
        kind: "panel",
        dockGroup: "model",
        children: [
          { id: "stat-tex", kind: "field", value: "x", visibleWhen: (s) => s["ui.mode"] === "self" },
        ],
      },
    ]);
    const { routers, menu } = buildGraphRouters();
    const graph = collect(routers, menu, [{ name: "default", snapshot: DEFAULT_SNAP }]);
    const ysm: MenuGraphNode = graph.docks.find((d) => d.group === "model")!.panels.find((p) => p.id === "ysm-model")!;
    // registry builder 返回 [model(panel), ...]，stat-tex 嵌在 model 子节点下（ysm-adapter 真实形态）
    const modelNode = ysm.children.find((c) => c.id === "model")!;
    const stat = modelNode.children.find((c) => c.id === "stat-tex")!;
    // 默认快照未置 ui.mode → 不可达
    expect(stat.reachable).toBe(false);
    expect(stat.reachableBy).toEqual([]);
    // 父 panel 无守卫 → 可达
    expect(ysm.reachable).toBe(true);
  });

  it("collectNodePredicates 收节点级 visibleWhen（与 cap 级 collectVisiblePredicates 严格区分）", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "a",
        kind: "panel",
        children: [{ id: "b", kind: "field", visibleWhen: (s) => !!s["env.sky"] }],
      },
    ];
    const preds = collectNodePredicates(nodes);
    expect(preds).toHaveLength(1);
    expect(preds[0].nodeId).toBe("b");
    // 是节点级谓词（吃 PreviewSnapshot），非 cap 级无参 c.visible
    expect(preds[0].predicate(DEFAULT_SNAP)).toBe(false);
    expect(preds[0].predicate({ "env.sky": true } as PreviewSnapshot)).toBe(true);
  });

  it("renderCustom 节点标记 escapeHatch:true（骨骼/litematic 复杂逃生舱，图不强行走通）", () => {
    registerSchema("ysm-model", () => [
      {
        id: "model",
        kind: "panel",
        dockGroup: "model",
        children: [{ id: "raw", kind: "custom", renderCustom: () => {} }],
      },
    ]);
    const { routers, menu } = buildGraphRouters();
    const graph = collect(routers, menu, [{ name: "default", snapshot: DEFAULT_SNAP }]);
    const ysm: MenuGraphNode = graph.docks.find((d) => d.group === "model")!.panels.find((p) => p.id === "ysm-model")!;
    const modelNode = ysm.children.find((c) => c.id === "model")!;
    expect(modelNode.children.find((c) => c.id === "raw")!.escapeHatch).toBe(true);
  });

  it("runners 动作节点标 nonNav（close 不进导航路径）", () => {
    const { routers, menu } = buildGraphRouters();
    const graph = collect(routers, menu, [{ name: "default", snapshot: DEFAULT_SNAP }]);
    expect(graph.actions.map((a) => a.id)).toContain("close");
    expect(graph.actions.find((a) => a.id === "close")!.nonNav).toBe(true);
  });
});
