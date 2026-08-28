// ===== litematic 分层控件测试：声明式根菜单切片面板契约（Phase 3 收编）=====
// litematic 分层（axis/layer 切片调节）通过 litematicMenuItems 注入 ⚙️ 根菜单
// 模型组面板，替代旧 extraControls(topBar) 方案。此处断言其控件结构稳定 + i18n 键齐全。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { zhCN } from "../../../core/i18n/locales/zh-CN.ts";
import { buildLitematicScene, litematicMenuItems } from "./litematic-adapter.ts";
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
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn(), getCurrentPanelId: vi.fn(() => null) },
  } as unknown as PreviewBuildCtx;
}

const mockVoxelCall = vi.fn(() =>
  Promise.resolve(
    JSON.stringify({
      groups: [{ positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], color: "#ff0000" }],
      size: [10, 10, 10],
      maxBlocks: 100,
    }),
  ),
);

/** 提取 buildLitematicScene 返回的 menuItems（由 mount-preview-core 负责注入到 dock-menu） */
async function extractMenuDOM(): Promise<{
  slicePanel: HTMLElement;
  items: PreviewMenuNode[];
}> {
  const ctx = makeMockCtx();
  const built = await buildLitematicScene(ctx, "/a.litematic", mockVoxelCall);
  const items = built.menuItems ?? [];
  const list = document.createElement("div");
  if (items[0]?.renderCustom) items[0].renderCustom(list, {} as any);
  return { slicePanel: list, items };
}

describe("litematic 分层控件（声明式根菜单模型组面板）", () => {
  it("setAdapterItems 接收 1 个菜单面板项（分层切片）", async () => {
    const { items } = await extractMenuDOM();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("slice");
    expect(items[0].dockGroup).toBe("model");
    expect(items[0].kind).toBe("panel");
  });

  it("切片面板含 8 个控件元素（sep + label + axisSel + layerMode + slider/input ×2）", async () => {
    const { slicePanel } = await extractMenuDOM();
    // children 中的直接子元素：sep, axisLabel, axisSel, layerMode, layerSlider, layerInput, layerSlider2, layerInput2
    expect(slicePanel.children.length).toBeGreaterThanOrEqual(8);
  });

  it("axisSel 轴选择含 Y/X/Z（顺序固定）", async () => {
    const { slicePanel } = await extractMenuDOM();
    const axisSel = slicePanel.querySelector<HTMLSelectElement>("select");
    expect(axisSel).not.toBeNull();
    expect([...axisSel!.options].map((o) => o.value)).toEqual(["Y", "X", "Z"]);
  });

  it("layerMode 含全部/单层/范围三种模式", async () => {
    const { slicePanel } = await extractMenuDOM();
    const selects = slicePanel.querySelectorAll("select");
    expect(selects.length).toBe(2);
    expect([...(selects[1] as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "all",
      "single",
      "range",
    ]);
  });

  it("分层滑块 2 个 + 数字输入 2 个（range 模式双滑块契约）", async () => {
    const { slicePanel } = await extractMenuDOM();
    expect(slicePanel.querySelectorAll('input[type="range"]').length).toBe(2);
    expect(slicePanel.querySelectorAll('input[type="number"]').length).toBe(2);
  });

  it("litematicMenuItems 返回正确的菜单项结构", () => {
    const sep = document.createElement("span");
    const axisLabel = document.createElement("span");
    const axisSel = document.createElement("select");
    const layerMode = document.createElement("select");
    const layerSlider = document.createElement("input");
    const layerInput = document.createElement("input");
    const layerSlider2 = document.createElement("input");
    const layerInput2 = document.createElement("input");
    const items = litematicMenuItems({ sep, axisLabel, axisSel, layerMode, layerSlider, layerInput, layerSlider2, layerInput2 });
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("slice");
    expect(items[0].icon).toBe("🧊");
    expect(items[0].dockGroup).toBe("model");
    expect(items[0].kind).toBe("panel");
    expect(items[0].legacyTestId).toBe("litematic-slice-entry");
  });

  it("i18n 键 preview.sliceAxis / preview.sliceControl 三语存在", () => {
    expect("preview.sliceAxis" in zhCN).toBe(true);
    expect("preview.sliceControl" in zhCN).toBe(true);
  });
});
