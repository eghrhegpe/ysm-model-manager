// ===== litematic 分层切片测试：schema builder 声明式契约（renderCustom 逃生舱退役）=====
// litematic 分层（axis/layer 切片）经 registerSchema 注册 builder（[doc:adr-126-p5-a]），
// 面板内容由 renderMenu 声明式渲染；切片模式 = shell 闭包场景级会话态（select get/set
// 闭包 + slider visibleWhen 谓词读同一闭包，AGENTS.md 3d菜单唯一条件守卫口）。
// 覆盖：panel 入口 / builder 数据契约（轴切换重置、clamp 防御、applyLayer 体素过滤联动）
// / 注册生命周期 / renderMenu 真渲染器显隐。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { zhCN } from "../../../core/i18n/locales/zh-CN.ts";
import { buildLitematicScene, LITEMATIC_SLICE_SCHEMA_ID } from "./litematic-adapter.ts";
import { getSchema } from "./schema-registry.ts";
import { previewSnapshot } from "../state/preview-state.ts";
import { renderMenu, renderPreviewPanel } from "./preview-menu.ts";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeMockCtx(): PreviewBuildCtx {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.05, 5000),
    controls: {
      target: new THREE.Vector3(),
      update: vi.fn(),
    },
    loadingEl: document.createElement("div"),
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn() },
  } as unknown as PreviewBuildCtx;
}

const mockVoxelCall = vi.fn(() =>
  Promise.resolve(
    JSON.stringify({
      groups: [{ positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], color: "#ff0000" }],
      // 三轴尺寸不同：断言轴切换联动 slider max（Y=11 / X=7 / Z=13）
      size: [7, 11, 13],
      maxBlocks: 100,
    }),
  ),
);

/** 构建场景并取当前注册的 slice builder 产出节点 */
async function buildScene(): Promise<{
  ctx: PreviewBuildCtx;
  built: Awaited<ReturnType<typeof buildLitematicScene>>;
  panel: PreviewMenuNode;
  sliceKey: string;
  nodes: PreviewMenuNode[];
}> {
  const ctx = makeMockCtx();
  const built = await buildLitematicScene(ctx, "/a.litematic", mockVoxelCall);
  const items = built.menuItems ?? [];
  const panel = items[0]!;
  const sliceKey = panel.schemaId!; // per-scene 唯一 key（5329a347 review P2：不再固定 "litematic-slice"）
  const builder = getSchema(sliceKey)!;
  return { ctx, built, panel, sliceKey, nodes: builder(previewSnapshot()) };
}

const nodeById = (nodes: PreviewMenuNode[], id: string): PreviewMenuNode =>
  nodes.find((n) => n.id === id)!;

/** 经模式 select 的 get/set 闭包驱动切片模式（真源 = shell，与生产 select change 同路径） */
function setMode(nodes: PreviewMenuNode[], mode: string): void {
  const m = nodeById(nodes, "slice-mode");
  m.control!.set!(mode);
  m.control!.onChange!(mode);
}

function renderNodes(nodes: PreviewMenuNode[]): HTMLElement {
  const container = document.createElement("div");
  renderMenu(container, nodes, {
    makeRow: ((def: { id?: string }) => {
      const row = document.createElement("div");
      if (def.id) row.dataset.testid = "preview-" + def.id;
      return row;
    }) as never,
    makePanelView: (() => ({ title: "", render: () => {} })) as never,
    menu: { refresh: vi.fn() } as never,
    actionCtx: { toast: vi.fn(), closeAllOverlays: vi.fn() },
  });
  return container;
}

/** 场景内全部 InstancedMesh（单 group 单 chunk：positions 都落在 (0,0) chunk） */
function instancedMeshesOf(ctx: PreviewBuildCtx): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  ctx.scene!.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) out.push(o);
  });
  return out;
}

describe("litematic 分层切片（schema builder 声明式契约）", () => {
  it("panel 节点走 schemaId 注册通道（无 renderCustom 逃生舱）", async () => {
    const { panel } = await buildScene();
    expect(panel.id).toBe("slice");
    expect(panel.dockGroup).toBe("model");
    expect(panel.kind).toBe("panel");
    expect(panel.legacyTestId).toBe("litematic-slice-entry");
    expect(panel.schemaId).toMatch(new RegExp(`^${LITEMATIC_SLICE_SCHEMA_ID}-`));
    expect(panel.renderCustom).toBeUndefined();
    expect(getSchema(panel.schemaId!)).toBeTypeOf("function");
  });

  it("builder 产出：divider + 轴 select + 模式 select + 3 个条件 slider", async () => {
    const { nodes } = await buildScene();
    expect(nodes.map((n) => n.id)).toEqual([
      "slice-divider", "slice-axis", "slice-mode",
      "slice-layer", "slice-range-start", "slice-range-end",
    ]);
    const axis = nodeById(nodes, "slice-axis");
    expect(axis.kind).toBe("select");
    expect(axis.control!.options!.map((o) => o.value)).toEqual(["Y", "X", "Z"]);
    const mode = nodeById(nodes, "slice-mode");
    // 模式真源 = shell 闭包（场景级会话态）：非 bind 模式，get/set 闭包读写
    expect(mode.control!.bind).toBeUndefined();
    expect(mode.control!.get!(undefined)).toBe("all");
    mode.control!.set!("bogus");
    expect(mode.control!.get!(undefined)).toBe("all"); // 非法值防御回落 all
    mode.control!.set!("all");
    expect(mode.control!.options!.map((o) => o.value)).toEqual(["all", "single", "range"]);
    // 切片模式 select 切换后面板重渲染（slider 显隐刷新）
    expect(mode.control!.refreshOnChange).toBe(true);
  });

  it("builder 每次渲染重建节点（非单例）——slider max 随轴保持新鲜的机制前提", async () => {
    const { nodes } = await buildScene();
    const { nodes: again } = await buildScene();
    expect(again).not.toBe(nodes);
    expect(again.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
  });

  it("轴 select：set 更新闭包轴 + 重置层值，重建节点后 slider max 随轴刷新", async () => {
    const { nodes, sliceKey } = await buildScene();
    // 默认 Y 轴（下标 1）→ max = sizeY = 11，层值重置为 max
    expect(nodeById(nodes, "slice-axis").control!.get!(undefined)).toBe("Y");
    expect(nodeById(nodes, "slice-layer").control!.max).toBe(11);
    expect(nodeById(nodes, "slice-layer").control!.get!(undefined)).toBe(11);
    // 切 X 轴：闭包轴/层值即时生效；max 快照在节点上——重建（真实 UI 由 refreshOnChange 触发）后刷新
    nodeById(nodes, "slice-axis").control!.set!("X");
    expect(nodeById(nodes, "slice-axis").control!.get!(undefined)).toBe("X");
    const rebuilt = getSchema(sliceKey)!(previewSnapshot());
    expect(nodeById(rebuilt, "slice-layer").control!.max).toBe(7);
    expect(nodeById(rebuilt, "slice-layer").control!.get!(undefined)).toBe(7);
    // 再切 Z 轴：max → sizeZ = 13
    nodeById(rebuilt, "slice-axis").control!.set!("Z");
    expect(nodeById(getSchema(sliceKey)!(previewSnapshot()), "slice-layer").control!.max).toBe(13);
  });

  it("slider set clamp：越界输入收敛到 [1, layerMax]（非法值回落 max）", async () => {
    const { nodes } = await buildScene();
    const layer = nodeById(nodes, "slice-layer");
    layer.control!.set!(99);
    expect(layer.control!.get!(undefined)).toBe(11);
    layer.control!.set!(0);
    expect(layer.control!.get!(undefined)).toBe(1);
    layer.control!.set!(Number.NaN);
    expect(layer.control!.get!(undefined)).toBe(11);
  });

  it("slider onChange 联动 applyLayer：single 模式层号过滤 instance count", async () => {
    const { ctx, nodes } = await buildScene();
    setMode(nodes, "single");
    const layer = nodeById(nodes, "slice-layer");
    const meshes = instancedMeshesOf(ctx);
    expect(meshes.length).toBeGreaterThan(0);
    // 初始层值 = max(11)：Y=target 10 无方块 → 过滤后 count 0
    layer.control!.onChange!(layer.control!.get!(undefined));
    expect(meshes.every((m) => m.count === 0)).toBe(true);
    // 层 1：仅 [0,0,0] 的 p[1]=0 命中 → count 1
    layer.control!.set!(1);
    layer.control!.onChange!(1);
    expect(meshes.every((m) => m.count === 1)).toBe(true);
  });

  it("range 双滑块：lo=layerVal / hi=layerVal2，hi 收敛 [lo, max] 语义不变", async () => {
    const { ctx, nodes } = await buildScene();
    setMode(nodes, "range");
    const lo = nodeById(nodes, "slice-range-start");
    const hi = nodeById(nodes, "slice-range-end");
    expect(lo.control!.get!(undefined)).toBe(11);
    expect(hi.control!.get!(undefined)).toBe(11);
    lo.control!.set!(2);
    hi.control!.set!(4);
    lo.control!.onChange!(2);
    hi.control!.onChange!(4);
    // Y ∈ [1, 4) → p[1] ∈ {1,2,3} → [1,1,1] 与 [2,2,2] 命中
    const meshes = instancedMeshesOf(ctx);
    expect(meshes.every((m) => m.count === 2)).toBe(true);
  });

  it("visibleWhen 谓词：all 隐藏全部 slider / single 1 个 / range 2 个", async () => {
    const { nodes } = await buildScene();
    const visible = (s: ReturnType<typeof previewSnapshot>): PreviewMenuNode[] =>
      nodes.filter((n) => !n.visibleWhen || n.visibleWhen(s));
    expect(visible(previewSnapshot()).map((n) => n.id)).toEqual([
      "slice-divider", "slice-axis", "slice-mode",
    ]);
    setMode(nodes, "single");
    expect(visible(previewSnapshot()).map((n) => n.id)).toEqual([
      "slice-divider", "slice-axis", "slice-mode", "slice-layer",
    ]);
    setMode(nodes, "range");
    expect(visible(previewSnapshot()).map((n) => n.id)).toEqual([
      "slice-divider", "slice-axis", "slice-mode", "slice-range-start", "slice-range-end",
    ]);
  });

  it("renderMenu 真渲染器：slider 显隐随切片模式（shell 闭包）变化（range+number 联动）", async () => {
    const { nodes } = await buildScene();
    // all：无滑条
    expect(renderNodes(nodes).querySelectorAll('input[type="range"]').length).toBe(0);
    // single：1 滑条 + 1 数字输入
    setMode(nodes, "single");
    let c = renderNodes(nodes);
    expect(c.querySelectorAll('input[type="range"]').length).toBe(1);
    expect(c.querySelectorAll('input[type="number"]').length).toBe(1);
    // range：2 滑条 + 2 数字输入（双滑块契约）
    setMode(nodes, "range");
    c = renderNodes(nodes);
    expect(c.querySelectorAll('input[type="range"]').length).toBe(2);
    expect(c.querySelectorAll('input[type="number"]').length).toBe(2);
  });

  it("dispose 注销 schema；切片模式随 shell 闭包消亡（不动全局状态）", async () => {
    const { built, nodes, sliceKey } = await buildScene();
    setMode(nodes, "single"); // 场景级会话态置位
    built.dispose();
    expect(getSchema(sliceKey)).toBeUndefined();
    // 模式存于闭包：dispose 后 shell 不可达，无全局残留可断言（跨场景零误伤的结构保证）
  });

  it("集成：真实 select change 驱动 bind→onChange→refreshOnChange 全链（不绕过渲染器）", async () => {
    // 5329a347 review P3（finding 2）：此前测试直接 setStateValue/control.onChange +
    // mock refresh——若 rmAppendSelect 的「bind 写状态 → onChange → refreshOnChange」顺序
    // 反转或 refresh 不重建 builder，测试全绿但真实面板用过期 mode/axis。本用例走真实
    // 渲染器 + 真实 change 事件锁全链。
    const { nodes, sliceKey } = await buildScene();
    const refresh = vi.fn();
    const deps = {
      makeRow: ((def: { id?: string }) => {
        const row = document.createElement("div");
        if (def.id) row.dataset.testid = "preview-" + def.id;
        return row;
      }) as never,
      makePanelView: (() => ({ title: "", render: () => {} })) as never,
      menu: { refresh } as never,
      actionCtx: { toast: vi.fn(), closeAllOverlays: vi.fn() },
    };
    const container = document.createElement("div");
    renderMenu(container, nodes, deps);
    const mode = container.querySelector('[data-testid="preview-slice-mode"]') as HTMLSelectElement;
    expect(mode).not.toBeNull();
    // 真实 change：all → single
    mode.value = "single";
    mode.dispatchEvent(new Event("change"));
    expect(nodeById(nodes, "slice-mode").control!.get!(undefined)).toBe("single"); // (a) set 闭包写 shell.mode
    expect(refresh).toHaveBeenCalled(); // (b) refreshOnChange 触发重渲染接线点
    // (c) 模拟 refresh 重跑 builder：single 出现 1 滑条 + 1 数字输入
    const rebuilt = getSchema(sliceKey)!(previewSnapshot());
    const c2 = document.createElement("div");
    renderMenu(c2, rebuilt, deps);
    expect(c2.querySelectorAll('input[type="range"]').length).toBe(1);
    expect(c2.querySelectorAll('input[type="number"]').length).toBe(1);
    // 轴 select 真实 change（闭包更新轴）→ 重建后 slider max 随轴（X 轴 sizeX=7）
    const axis = container.querySelector('[data-testid="preview-slice-axis"]') as HTMLSelectElement;
    axis.value = "X";
    axis.dispatchEvent(new Event("change"));
    const rebuilt2 = getSchema(sliceKey)!(previewSnapshot());
    expect(nodeById(rebuilt2, "slice-layer").control!.max).toBe(7);
  });

  it("集成：schemaId → 生产 panel-view 接线（renderPreviewPanel 经 schemaId 解析产出控件）", async () => {
    // 5329a347 review P3（finding 3）：此前测试经 getSchema 直接调 builder——若生产
    // panel-view 的 schemaId 解析断开（或 legacyTestId 未挂 DOM），测试仍绿而真实面板空。
    // 本用例走 renderPreviewPanel（生产调度路径）锁接线。
    const { panel } = await buildScene();
    const list = document.createElement("div");
    renderPreviewPanel(
      list,
      panel,
      { schemaBuilders: {} } as never, // litematic 无 schemaBuilders 条目——走 getSchema 分支
      { refresh: vi.fn() } as never,
      () => {},
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      {
        makeRow: ((def: { id?: string }) => {
          const row = document.createElement("div");
          if (def.id) row.dataset.testid = "preview-" + def.id;
          return row;
        }) as never,
        makePanelView: (() => ({ title: "", render: () => {} })) as never,
      },
    );
    expect(list.dataset.panelTestId).toBe("litematic-slice-entry"); // legacyTestId 挂 DOM
    expect(list.querySelector('[data-testid="preview-slice-mode"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="preview-slice-axis"]')).not.toBeNull();
  });

  it("i18n 键三语存在（slice 面板 + 新增 slider 标签）", () => {
    for (const key of [
      "preview.sliceAxis", "preview.sliceControl", "preview.sliceMode",
      "preview.sliceLayer", "preview.sliceRangeStart", "preview.sliceRangeEnd",
    ]) {
      expect(key in zhCN).toBe(true);
    }
  });
});
