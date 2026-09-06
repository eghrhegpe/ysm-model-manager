// ===== bones-panel-node.ts 测试（通用骨骼面板菜单项工厂）=====
// 覆盖：节点形状（id/icon/labelKey/fallback/kind/dockGroup/renderCustom）
// / null 守卫（viewContainer/camera/scene 任一缺失早 return）/ cleanup 双持有者 /
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
  it("节点形状：id/icon/labelKey/fallback/kind/dockGroup 固定，renderCustom 是函数", () => {
    const item = makeBonesPanelItem({
      tree: null,
      cleanupRef: { current: null },
      viewContainer: null,
      camera: null,
      scene: null,
    });
    expect(item.id).toBe("bones");
    expect(item.icon).toBe("🦴");
    expect(item.labelKey).toBe("preview.section.bones");
    expect(item.fallback).toBe("骨骼");
    expect(item.kind).toBe("panel");
    expect(item.dockGroup).toBe("motion");
    expect(typeof item.renderCustom).toBe("function");
  });

  it("null 守卫：viewContainer 缺失 → renderCustom 早 return，不调 makeBonePanelRenderer", () => {
    const { camera, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as BoneTree,
      cleanupRef: { current: null },
      viewContainer: null,
      camera, scene,
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

  it("cleanup 双持有者：renderCustom 返回 cleanup 且同一函数写回 cleanupRef", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const cleanupRef: { current: (() => void) | null } = { current: null };
    const item = makeBonesPanelItem({
      tree: null, cleanupRef,
      viewContainer, camera, scene,
    });
    const list = document.createElement("div");
    // mock renderer 返回的 cleanup 换成 spy，观察谁在什么时候调它
    let cleanupCalls = 0;
    vi.mocked(makeBonePanelRenderer).mockReturnValueOnce(() => {
      return (): void => { cleanupCalls++; };
    });

    const returned = item.renderCustom!(list);
    // ① 面板级：return 给渲染器（render.ts runCustomMount 按容器持有，重渲染前先清旧）
    expect(returned).toBeTypeOf("function");
    // ② 模型级：同一 cleanup 写回 caller 的 cleanupRef（adapter.dispose 时摘 listener）
    expect(cleanupRef.current).toBe(returned);
    // 工厂只创建、不执行——挂载期不调 cleanup
    expect(cleanupCalls).toBe(0);

    // code_review 4ac2b4f72 #1/#3：重入清理由工厂先行——每次挂载新渲染器前先摘旧
    // cleanupRef（元素无关单槽：面板 close→reopen 换新容器时 registry 按容器键控
    // miss，工厂前置调用是唯一防线，防 N 次开合累计 N 个 viewContainer listener）
    item.renderCustom!(list);
    expect(cleanupCalls).toBe(1); // 旧 cleanup（首次 spy）在挂载新渲染器前被摘除
    expect(cleanupRef.current).not.toBeNull(); // 新 cleanup 覆盖写回
    expect(makeBonePanelRenderer).toHaveBeenCalledTimes(2);

    // 模型级兜底通道可用：adapter.dispose 调 cleanupRef.current 即摘 listener
    cleanupRef.current!();
    expect(cleanupCalls).toBe(1); // 第二次挂载的 cleanup 是默认 no-op mock，spy 不再被调
  });

  it("reopen 换新容器：旧 cleanupRef 被先行摘除（registry 键控 miss 的防线）", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const cleanupRef: { current: (() => void) | null } = { current: null };
    const item = makeBonesPanelItem({
      tree: null, cleanupRef,
      viewContainer, camera, scene,
    });
    let cleanupCalls = 0;
    // 每次 renderer 返回的 cleanup 都计数——验证「同模型最多 1 个存活 cleanup」单槽语义
    vi.mocked(makeBonePanelRenderer).mockImplementation(() => {
      return (): () => void => () => { cleanupCalls++; };
    });
    // 第一次挂载（面板打开）——不调任何旧 cleanup
    item.renderCustom!(document.createElement("div"));
    expect(cleanupCalls).toBe(0);
    // close→reopen：导航建**新** list 容器（旧容器已脱离文档），runCustomMount 的
    // customCleanups.get(新容器) 永远 miss——旧 cleanup 只能由工厂前置调用摘除
    item.renderCustom!(document.createElement("div"));
    expect(cleanupCalls).toBe(1); // 旧 cleanup 恰好被调一次（单槽：同模型最多 1 listener）
    expect(makeBonePanelRenderer).toHaveBeenCalledTimes(2);
  });

  it("模型级兜底：adapter.dispose 调 cleanupRef.current 即执行 renderer cleanup", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const cleanupRef: { current: (() => void) | null } = { current: null };
    const item = makeBonesPanelItem({
      tree: null, cleanupRef,
      viewContainer, camera, scene,
    });
    let cleanupCalls = 0;
    vi.mocked(makeBonePanelRenderer).mockReturnValueOnce(() => {
      return (): void => { cleanupCalls++; };
    });
    item.renderCustom!(document.createElement("div"));
    // 模拟 adapter.dispose（模型卸载而菜单仍存活）
    cleanupRef.current?.();
    expect(cleanupCalls).toBe(1);
  });

  it("tree=null 透传：工厂不二次包装空态（让 makeBonePanelRenderer 自己处理，vrm-bone-ui.ts L48-58）", () => {
    const { viewContainer, camera, scene } = makeCtx();
    const item = makeBonesPanelItem({
      tree: null, cleanupRef: { current: null },
      viewContainer, camera, scene,
    });
    item.renderCustom!(document.createElement("div"));
    // makeBonePanelRenderer 仍被调（参数 tree=null）
    expect(makeBonePanelRenderer).toHaveBeenCalledWith(null);
  });
});
