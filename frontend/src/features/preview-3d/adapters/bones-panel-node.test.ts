// ===== bones-panel-node.ts 测试（通用骨骼面板菜单项工厂）=====
// 覆盖：节点形状（id/icon/labelKey/fallback/kind/dockGroup/legacyTestId/renderCustom）
// / null 守卫（viewContainer/camera/scene 任一缺失早 return）/ cleanup 重入清理 /
// tree=null 走 makeBonePanelRenderer 空态（让被委托函数自己处理，工厂不二次包装）。
// 4 个 adapter 的 menuItems 测试覆盖「是否有 bones 项」，本测覆盖「骨头项形状契约」。

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { makeBonesPanelItem } from "./bones-panel-node.ts";
import type { BoneTree } from "../bone-tools.ts";

// mock vrm-bone-ui：观察工厂调 makeBonePanelRenderer 的参数与顺序，不真实挂载面板
vi.mock("./vrm-bone-ui.ts", () => ({
  makeBonePanelRenderer: vi.fn(() => {
    // 工厂返回「renderer」：调用时写一个回收集合便于断言
    return (panel: HTMLElement, ctx: { viewContainer: HTMLElement; camera: THREE.Camera; scene: THREE.Object3D }): (() => void) => {
      (panel as HTMLElement & { __ctx?: unknown }).__ctx = ctx;
      return (): void => { /* cleanup */ };
    };
  }),
}));

import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.mocked(makeBonePanelRenderer).mockClear();
});

function makeCtx() {
  const viewContainer = document.createElement("div");
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  return { viewContainer, camera, scene };
}

describe("makeBonesPanelItem", () => {
  it("节点形状：id/icon/labelKey/fallback/kind/dockGroup/legacyTestId 固定，renderCustom 是函数", () => {
    const item = makeBonesPanelItem({
      tree: null,
      cleanupRef: { current: null },
      viewContainer: null,
      camera: null,
      scene: null,
      legacyTestId: "ysm-bones-entry",
    });
    expect(item.id).toBe("bones");
    expect(item.icon).toBe("🦴");
    expect(item.labelKey).toBe("preview.section.bones");
    expect(item.fallback).toBe("骨骼");
    expect(item.kind).toBe("panel");
    expect(item.dockGroup).toBe("motion");
    expect(item.legacyTestId).toBe("ysm-bones-entry");
    expect(typeof item.renderCustom).toBe("function");
  });

  it("legacyTestId 由 caller 注入（4 个 adapter 各自不同）", () => {
    const cases: Array<{ id: string; legacyTestId: string }> = [
      { id: "ysm", legacyTestId: "ysm-bones-entry" },
      { id: "vrm", legacyTestId: "vrm-bones-entry" },
      { id: "mmd", legacyTestId: "mmd-bones-entry" },
      { id: "fbx", legacyTestId: "fbx-bones-entry" },
    ];
    for (const c of cases) {
      const item = makeBonesPanelItem({
        tree: null, cleanupRef: { current: null },
        viewContainer: null, camera: null, scene: null,
        legacyTestId: c.legacyTestId,
      });
      expect(item.legacyTestId, `${c.id} 应保留各自 legacyTestId`).toBe(c.legacyTestId);
    }
  });

  it("null 守卫：viewContainer 缺失 → renderCustom 早 return，不调 makeBonePanelRenderer", () => {
    const { camera, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as BoneTree,
      cleanupRef: { current: null },
      viewContainer: null,
      camera, scene,
      legacyTestId: "test-bones-entry",
    });
    item.renderCustom!(document.createElement("div"));
    expect(makeBonePanelRenderer).not.toHaveBeenCalled();
  });

  it("null 守卫：viewContainer = undefined（adapter 字段实际类型）→ 早 return", () => {
    const { camera, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as BoneTree,
      cleanupRef: { current: null },
      viewContainer: undefined,
      camera, scene,
      legacyTestId: "test-bones-entry",
    });
    item.renderCustom!(document.createElement("div"));
    expect(makeBonePanelRenderer).not.toHaveBeenCalled();
  });

  it("null 守卫：camera 缺失 → renderCustom 早 return，不调 makeBonePanelRenderer", () => {
    const { viewContainer, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as BoneTree,
      cleanupRef: { current: null },
      viewContainer,
      camera: null, scene,
      legacyTestId: "test-bones-entry",
    });
    item.renderCustom!(document.createElement("div"));
    expect(makeBonePanelRenderer).not.toHaveBeenCalled();
  });

  it("null 守卫：scene 缺失 → renderCustom 早 return，不调 makeBonePanelRenderer", () => {
    const { viewContainer, camera } = makeCtx();
    const item = makeBonesPanelItem({
      tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as BoneTree,
      cleanupRef: { current: null },
      viewContainer, camera,
      scene: null,
      legacyTestId: "test-bones-entry",
    });
    item.renderCustom!(document.createElement("div"));
    expect(makeBonePanelRenderer).not.toHaveBeenCalled();
  });

  it("三件套齐全 → 调 makeBonePanelRenderer 一次，参数透传 tree", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const tree: BoneTree = { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() };
    const item = makeBonesPanelItem({
      tree, cleanupRef: { current: null },
      viewContainer, camera, scene,
      legacyTestId: "test-bones-entry",
    });
    const list = document.createElement("div");
    item.renderCustom!(list);
    expect(makeBonePanelRenderer).toHaveBeenCalledTimes(1);
    expect(makeBonePanelRenderer).toHaveBeenCalledWith(tree);
    // 工厂透传 ctx 给 renderer（renderer 内部 mock 写回 panel.__ctx 便于断言）
    const ctx = (list as HTMLElement & { __ctx?: { viewContainer: HTMLElement; camera: THREE.Camera; scene: THREE.Object3D } }).__ctx;
    expect(ctx).toBeDefined();
    expect(ctx!.viewContainer).toBe(viewContainer);
    expect(ctx!.camera).toBe(camera);
    expect(ctx!.scene).toBe(scene);
  });

  it("cleanupRef 重入清理：第二次 renderCustom 前先调上一次 cleanup 并置 null", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const cleanupRef: { current: (() => void) | null } = { current: null };
    const item = makeBonesPanelItem({
      tree: null, cleanupRef,
      viewContainer, camera, scene,
      legacyTestId: "test-bones-entry",
    });
    const list = document.createElement("div");
    // 第一次挂载：mock renderer 返回的 cleanup 我们替换成 spy
    let firstCleanupCalled = 0;
    vi.mocked(makeBonePanelRenderer).mockReturnValueOnce(() => {
      return (): void => { firstCleanupCalled++; };
    });
    item.renderCustom!(list);
    expect(cleanupRef.current).toBeTypeOf("function");
    expect(firstCleanupCalled).toBe(0);

    // 第二次挂载：工厂应先调第一次的 cleanup，再调 makeBonePanelRenderer
    item.renderCustom!(list);
    expect(firstCleanupCalled).toBe(1);
    expect(cleanupRef.current).not.toBeNull(); // 新 cleanup 写回
    expect(makeBonePanelRenderer).toHaveBeenCalledTimes(2);
  });

  it("tree=null 透传：工厂不二次包装空态（让 makeBonePanelRenderer 自己处理，vrm-bone-ui.ts L48-58）", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: null, cleanupRef: { current: null },
      viewContainer, camera, scene,
      legacyTestId: "test-bones-entry",
    });
    item.renderCustom!(document.createElement("div"));
    // makeBonePanelRenderer 仍被调（参数 tree=null）
    expect(makeBonePanelRenderer).toHaveBeenCalledWith(null);
  });
});
