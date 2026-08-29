// menu-graph.test.ts — [doc:adr-128] collectMenuGraph / collectNodePredicates 契约测试
// 红线：双通道并集枚举（闭包 schemaBuilders + schema-registry Map）、children 递归、
//       fillers 过程式标 procedural、visibleWhen 快照可达性、节点级谓词收集（非 cap 级）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectMenuGraph, collectNodePredicates } from "./menu-graph.ts";
import type { MenuGraph, MenuGraphNode, RepresentativeSnapshot } from "./menu-graph.ts";
import type { PreviewMenuRouters } from "./preview-menu/core.ts";
import { buildPreviewMenuRouters } from "./preview-menu/core.ts";
import { makeMenuCtx, mockMenuHandle } from "./menu-test-fixtures.ts";
import { registerSchema, resetSchemas } from "./schema-registry.ts";
import type { PreviewMenuNode } from "./preview-menu/node-types.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";
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

  it("registry builder 抛错 → collectMenuGraph 抛异常（生成失败由上层门禁拦截，挡 AI 破坏真实路径于 e2e 之前，P2①）", () => {
    registerSchema("boom", () => {
      throw new Error("kaboom");
    });
    const { routers, menu } = buildGraphRouters();
    expect(() => collect(routers, menu, [{ name: "default", snapshot: DEFAULT_SNAP }])).toThrow(
      /boom.*kaboom/,
    );
  });

  it("多档代表性快照下 reachableBy 聚合（数组意义 = 跨档可见性并集，P2②）", () => {
    registerSchema("ysm-model", () => [
      {
        id: "model",
        kind: "panel",
        dockGroup: "model",
        children: [
          { id: "sky-node", kind: "field", visibleWhen: (s) => !!s["env.sky"] },
          { id: "mode-node", kind: "field", visibleWhen: (s) => s["ui.mode"] === "self" },
          { id: "always", kind: "field" },
        ],
      },
    ]);
    const { routers, menu } = buildGraphRouters();
    const snaps: RepresentativeSnapshot[] = [
      { name: "default", snapshot: {} },
      { name: "envOn", snapshot: { "env.sky": true } as PreviewSnapshot },
      { name: "roleLoaded", snapshot: { "ui.mode": "self" } as PreviewSnapshot },
    ];
    const graph = collect(routers, menu, snaps);
    const ysm = graph.docks.find((d) => d.group === "model")!.panels.find((p) => p.id === "ysm-model")!;
    const model = ysm.children.find((c) => c.id === "model")!;
    const sky = model.children.find((c) => c.id === "sky-node")!;
    const mode = model.children.find((c) => c.id === "mode-node")!;
    const always = model.children.find((c) => c.id === "always")!;
    // 各守卫节点只在命中快照档可见
    expect(sky.reachableBy).toEqual(["envOn"]);
    expect(mode.reachableBy).toEqual(["roleLoaded"]);
    expect(always.reachableBy).toEqual(["default", "envOn", "roleLoaded"]);
    // 面板级乐观（P1）：ysm-model reachableBy 恒全档，不随快照收窄
    expect(ysm.reachableBy).toEqual(["default", "envOn", "roleLoaded"]);
  });

  it("registryIds 白名单只收窄枚举、不收窄 coverage 判定（防白名单洗掉双通道债，P2③；并佐证 P3 带具体 id）", () => {
    registerSchema("ysm-model", () => [{ id: "model", kind: "panel", dockGroup: "model" }]);
    const { routers, menu } = buildGraphRouters();
    // 白名单只给 ysm-model：枚举收窄，但 closure builder 债仍按全量 listSchemas() 算
    const graph = collectMenuGraph({
      routers,
      menu,
      snapshots: [{ name: "default", snapshot: DEFAULT_SNAP }],
      registryIds: ["ysm-model"],
    });
    // 枚举收窄：registry 通道只产出 ysm-model（无其它 registry 面板混入）
    const modelDock = graph.docks.find((d) => d.group === "model")!;
    expect(modelDock.panels.map((p) => p.id)).toContain("ysm-model");
    // coverage 仍 partial：closure builder（lighting/shadow/...）未迁 registry，白名单洗不掉
    expect(graph.coverage).toBe("partial");
    expect(graph.uncoveredLayers).toContain("roles"); // procedural 面板 id
    // P3：closure builder id 在 uncoveredLayers（非 "schemaBuilders-not-in-registry" 占位）
    expect(graph.uncoveredLayers).toContain("lighting");
  });
});
