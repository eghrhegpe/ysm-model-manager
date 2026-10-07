// ===== litematic 分层切片测试：schema builder 声明式契约（renderCustom 逃生舱退役）=====
// litematic 分层（axis/layer 切片）经 registerSchema 注册 builder（[doc:adr-126-p5-a]），
// 面板内容由 renderMenu 声明式渲染；切片模式 = shell 闭包场景级会话态（select get/set
// 闭包 + slider visibleWhen 谓词读同一闭包，AGENTS.md 3d菜单唯一条件守卫口）。
// 覆盖：panel 入口 / builder 数据契约（轴切换重置、clamp 防御、applyLayer 体素过滤联动）
// / 注册生命周期 / renderMenu 真渲染器显隐。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { zhCN } from "@/locales/zh-CN.ts";
import { buildLitematicScene, LITEMATIC_SLICE_SCHEMA_ID } from "./litematic-adapter.ts";
import { getSchema } from "@/preview-3d/infra/schema-registry.ts";
import { previewSnapshot } from "@/preview-3d/state/preview-state.ts";
import { renderMenu, renderPreviewPanel, type PreviewMenuRouters } from "@/preview-3d/menu/engine/core.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/preview-3d/menu/shell/slide-menu.ts";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { findNodeById, nodeIds } from "@/preview-3d/menu/menu-test-helpers.ts";

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
    renderer: { domElement: document.createElement("div") } as unknown as THREE.WebGLRenderer,
    loadingEl: document.createElement("div"),
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn() },
  } as unknown as PreviewBuildCtx;
}

const mockVoxelCall = vi.fn(() =>
  Promise.resolve({
    groups: [{ positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], color: "#ff0000" }],
    // 三轴尺寸不同：断言轴切换联动 slider max（Y=11 / X=7 / Z=13）
    size: [7, 11, 13],
    truncated: false,
    maxBlocks: 100,
  }),
);

/** 构建场景并取当前注册的 slice builder 产出节点 */
async function buildScene(): Promise<{
  ctx: PreviewBuildCtx;
  content: Awaited<ReturnType<typeof buildLitematicScene>>;
  panel: PreviewMenuNode;
  sliceKey: string;
  nodes: PreviewMenuNode[];
}> {
  const ctx = makeMockCtx();
  const content = await buildLitematicScene(ctx, "/a.litematic", mockVoxelCall);
  const items = content.menuItems ?? [];
  const panel = findNodeById(items, "slice");
  const sliceKey = panel.schemaId!; // per-scene 唯一 key（5329a347 review P2：不再固定 "litematic-slice"）
  const builder = getSchema(sliceKey)!;
  return { ctx, content, panel, sliceKey, nodes: builder(previewSnapshot()) };
}

const nodeById = (nodes: PreviewMenuNode[], id: string): PreviewMenuNode =>
  findNodeById(nodes, id);

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
    }) as unknown as (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
    makePanelView: (() => ({ title: "", render: () => {} })) as unknown as (node: PreviewMenuNode) => SlideMenuView,
    menu: { refresh: vi.fn() } as unknown as SlideMenuHandle,
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
    expect(panel.schemaId).toMatch(new RegExp(`^${LITEMATIC_SLICE_SCHEMA_ID}-`));
    expect(panel.renderCustom).toBeUndefined();
    expect(getSchema(panel.schemaId!)).toBeTypeOf("function");
  });

  it("builder 产出：divider + 轴 select + 模式 select + 3 个条件 slider", async () => {
    const { nodes } = await buildScene();
    // 节点成员（精确集合；builder 声明序不测）
    expect(nodeIds(nodes).sort()).toEqual(
      [
        "slice-divider", "slice-axis", "slice-mode",
        "slice-layer", "slice-range-start", "slice-range-end",
      ].sort(),
    );
    const axis = nodeById(nodes, "slice-axis");
    expect(axis.kind).toBe("select");
    expect(axis.control!.options!.map((o) => o.value)).toEqual(["Y", "X", "Z"]);
    const mode = nodeById(nodes, "slice-mode");
    // 模式真源 = shell 闭包（场景级会话态）：get/set 闭包读写
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
    // 成员集合不变（非单例重建）
    expect(nodeIds(again).sort()).toEqual(nodeIds(nodes).sort());
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

  it("all 模式恢复全量实例（过滤是可逆的：single 截断后切回 all 必须复原）", async () => {
    // 此前从未执行的一支：既有用例只经 single/range 调 applyLayer（all 是面板默认态，
    // 却只在 `set!` 里写过、没走过 onChange）——「切回 all 后 instance count 不复原」
    // 会表现为「切遍切片模式后模型永久残缺」，静默且不可逆。本用例先截断再恢复。
    const { ctx, nodes } = await buildScene();
    const meshes = instancedMeshesOf(ctx);
    expect(meshes.every((m) => m.count === 3)).toBe(true); // 初始 = build 时全量（3 个方块同 chunk）

    setMode(nodes, "single");
    const layer = nodeById(nodes, "slice-layer");
    layer.control!.set!(1);
    layer.control!.onChange!(1);
    expect(meshes.every((m) => m.count === 1)).toBe(true); // 层 1 只余 [0,0,0]
    const versions = meshes.map((m) => m.instanceMatrix.version);

    setMode(nodes, "all"); // 切回全量
    expect(meshes.every((m) => m.count === 3)).toBe(true);
    // 恢复不只改 count：矩阵缓冲也确实被标脏（version 递增 → WebGL 重传 instanceMatrix）。
    // 注意 needsUpdate 在 three 里是**只写**访问器（读了恒 undefined），故认 version。
    expect(meshes.map((m) => m.instanceMatrix.version)).toEqual(versions.map((v) => v + 1));
  });

  it("visibleWhen 谓词：all 隐藏全部 slider / single 1 个 / range 2 个", async () => {
    const { nodes } = await buildScene();
    const visible = (s: ReturnType<typeof previewSnapshot>): PreviewMenuNode[] =>
      nodes.filter((n) => !n.visibleWhen || n.visibleWhen(s));
    // all 态：仅基础三节点可见（slider 全隐藏）
    expect(nodeIds(visible(previewSnapshot())).sort()).toEqual(
      ["slice-divider", "slice-axis", "slice-mode"].sort(),
    );
    setMode(nodes, "single");
    // single 态：+ slice-layer
    expect(nodeIds(visible(previewSnapshot())).sort()).toEqual(
      ["slice-divider", "slice-axis", "slice-mode", "slice-layer"].sort(),
    );
    setMode(nodes, "range");
    // range 态：+ slice-range-start + slice-range-end
    expect(nodeIds(visible(previewSnapshot())).sort()).toEqual(
      ["slice-divider", "slice-axis", "slice-mode", "slice-range-start", "slice-range-end"].sort(),
    );
  });

  it("renderMenu 真渲染器：slider 显隐随切片模式（shell 闭包）变化（range+number 联动）", async () => {
    const { nodes } = await buildScene();
    // all：无滑条
    expect(renderNodes(nodes).querySelectorAll(".cs-bar").length).toBe(0);
    // single：1 滑条 + 1 数字输入
    setMode(nodes, "single");
    let c = renderNodes(nodes);
    expect(c.querySelectorAll(".cs-bar").length).toBe(1);
    expect(c.querySelectorAll('input[type="number"]').length).toBe(1);
    // range：2 滑条 + 2 数字输入（双滑块契约）
    setMode(nodes, "range");
    c = renderNodes(nodes);
    expect(c.querySelectorAll(".cs-bar").length).toBe(2);
    expect(c.querySelectorAll('input[type="number"]').length).toBe(2);
  });

  it("dispose 注销 schema；切片模式随 shell 闭包消亡（不动全局状态）", async () => {
    const { content, nodes, sliceKey } = await buildScene();
    setMode(nodes, "single"); // 场景级会话态置位
    content.dispose();
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
      }) as unknown as (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
      makePanelView: (() => ({ title: "", render: () => {} })) as unknown as (node: PreviewMenuNode) => SlideMenuView,
      menu: { refresh } as unknown as SlideMenuHandle,
      actionCtx: { toast: vi.fn(), closeAllOverlays: vi.fn() },
    };
    const container = document.createElement("div");
    renderMenu(container, nodes, deps);
    const mode = container.querySelector('[data-testid="cap-slice-mode"] select') as HTMLSelectElement;
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
    expect(c2.querySelectorAll(".cs-bar").length).toBe(1);
    expect(c2.querySelectorAll('input[type="number"]').length).toBe(1);
    // 轴 select 真实 change（闭包更新轴）→ 重建后 slider max 随轴（X 轴 sizeX=7）
    const axis = container.querySelector('[data-testid="cap-slice-axis"] select') as HTMLSelectElement;
    axis.value = "X";
    axis.dispatchEvent(new Event("change"));
    const rebuilt2 = getSchema(sliceKey)!(previewSnapshot());
    expect(nodeById(rebuilt2, "slice-layer").control!.max).toBe(7);
  });

  it("集成：schemaId → 生产 panel-view 接线（renderPreviewPanel 经 schemaId 解析产出控件）", async () => {
    // 5329a347 review P3（finding 3）：此前测试经 getSchema 直接调 builder——若生产
    // 本用例走 renderPreviewPanel（生产调度路径）锁接线。
    const { panel } = await buildScene();
    const list = document.createElement("div");
    renderPreviewPanel(
      list,
      panel,
      { schemaBuilders: {} } as unknown as PreviewMenuRouters, // litematic 无 schemaBuilders 条目——走 getSchema 分支
      {
        menu: { refresh: vi.fn() } as unknown as SlideMenuHandle,
        hideMenu: () => {},
        actionCtx: { toast: vi.fn(), closeAllOverlays: vi.fn() },
        makeRow: ((def: { id?: string }) => {
          const row = document.createElement("div");
          if (def.id) row.dataset.testid = "preview-" + def.id;
          return row;
        }) as unknown as (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
        makePanelView: (() => ({ title: "", render: () => {} })) as unknown as (node: PreviewMenuNode) => SlideMenuView,
      },
    );
    expect(list.querySelector('[data-testid="cap-slice-mode"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="cap-slice-axis"]')).not.toBeNull();
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

// ---------------------------------------------------------------------------
// 分块/合法性守卫（此前 0 命中的分支：异 chunk 跳过、非法坐标整条丢弃、空组不建 mesh）
// ---------------------------------------------------------------------------

describe("litematic 切片过滤的分块与合法性守卫", () => {
  /** CHUNK_SIZE=32：size 100 ⇒ xChunks=4；[0,0,0] 与 [1,1,1] 落在 ck=0，[40,0,0] 落在 ck=1 */
  const sparseVoxelCall = vi.fn(() =>
    Promise.resolve({
      groups: [
        { positions: [], color: "#00ff00" }, // 空组：不建 mesh（`!group.positions?.length` 分支）
        {
          positions: [
            [0, 0, 0],
            [1, 1, 1],
            [40, 0, 0], // 异 chunk：不得写进 ck=0 的 InstancedMesh
            [Number.NaN, 0, 0], // 非法坐标：整条丢弃（常值哨兵陷阱 #17 的反面）
          ],
          color: "#0000ff",
        },
      ],
      size: [100, 100, 100],
      truncated: false,
      maxBlocks: 100,
    }),
  );

  async function buildSparse(): Promise<{
    ctx: PreviewBuildCtx;
    nodes: PreviewMenuNode[];
  }> {
    const ctx = makeMockCtx();
    const content = await buildLitematicScene(ctx, "/sparse.litematic", sparseVoxelCall);
    const panel = findNodeById(content.menuItems ?? [], "slice");
    const nodes = getSchema(panel.schemaId!)!(previewSnapshot());
    return { ctx, nodes };
  }

  it("空组不建 mesh；非法坐标在构建期即不占实例位", async () => {
    const { ctx } = await buildSparse();
    const meshes = instancedMeshesOf(ctx);
    expect(meshes).toHaveLength(2); // 空组零 mesh；两个 chunk 各一个
    // instanceMatrix.count = 分配容量：ck=0 → 2（[0,0,0]+[1,1,1]），ck=1 → 1（[40,0,0]）；
    // NaN 条目在 build 期被 isValidPos 丢弃 ⇒ 总容量 3（而非原始 positions 的 4）。
    const alloc = meshes.map((m) => m.instanceMatrix.count).sort((a, b) => a - b);
    expect(alloc).toEqual([1, 2]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("applyLayer all：异 chunk 体素不写进本 chunk（count 与本 chunk 合法体素数一致）", async () => {
    const { ctx, nodes } = await buildSparse();
    setMode(nodes, "all"); // 触发一次真实 applyLayer 过滤
    const counts = instancedMeshesOf(ctx)
      .map((m) => m.count)
      .sort((a, b) => a - b);
    // ck=0 → 2（[0,0,0] + [1,1,1]；[40,0,0] 属 ck=1，NaN 非法）；ck=1 → 1
    expect(counts).toEqual([1, 2]);
  });

  it("applyLayer single：非法坐标与异 chunk 均不参与层过滤", async () => {
    const { ctx, nodes } = await buildSparse();
    setMode(nodes, "single");
    const layer = nodeById(nodes, "slice-layer");
    layer.control!.set!(2); // Y=1 → 仅 [1,1,1]（ck=1 的 [40,0,0] Y=0 不命中 → 该 mesh count 0）
    layer.control!.onChange!(2);
    const counts = instancedMeshesOf(ctx)
      .map((m) => m.count)
      .sort((a, b) => a - b);
    expect(counts).toEqual([0, 1]);
  });
});
