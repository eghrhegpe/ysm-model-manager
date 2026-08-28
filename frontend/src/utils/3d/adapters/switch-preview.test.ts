// ===== switchToSession 陈旧字段修复测试 =====
// 验证：ctx 中经 getter 访问的字段（built / sceneBaseline）
// 在 ctx 构造后被修改时，switchToSession 能读到最新值——
// 而非构造时快照的旧值（修复前的 bug）。

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { SwitchContext } from "./switch-preview.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";
import type { PreviewBuildCtx, PreviewScene, PreviewHandle } from "./mount-preview-core.ts";

/** 构造最小可用的 mock 测试上下文 */
function makeMockCtx(): {
  ctx: SwitchContext;
  state: {
    built: PreviewScene | null;
    sceneBaseline: Set<THREE.Object3D> | null;
    perFrame: ((dt: number) => void) | null;
    currentPath: string;
    _handle: PreviewHandle | null;
  };
  mockScene: THREE.Scene;
  mockAdapter: { build: ReturnType<typeof vi.fn> };
} {
  const state = {
    built: null as PreviewScene | null,
    sceneBaseline: null as Set<THREE.Object3D> | null,
    perFrame: null as ((dt: number) => void) | null,
    currentPath: "initial.glb",
    _handle: null as PreviewHandle | null,
  };

  const mockScene = new THREE.Scene();
  const loadingEl = document.createElement("div");
  const viewContainer = document.createElement("div");
  const overlay = document.createElement("div");
  const allBuilt: PreviewScene[] = [];

  const mockAdapter = {
    build: vi.fn().mockResolvedValue({
      dispose: vi.fn(),
    }),
  };

  const ctx: SwitchContext = {
    scene: mockScene,
    getSceneBaseline: () => state.sceneBaseline,
    getBuilt: () => state.built,
    setBuilt: (s) => { state.built = s; },
    allBuilt,
    loadingEl,
    viewContainer,
    overlay,
    menuHandle: { dispose: vi.fn(), setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn() } as any,
    adapter: mockAdapter,
    camBridge: undefined,
    selfMode: false,
    renderer: undefined,
    controls: undefined,
    orbitTarget: undefined,
    camera: undefined,
    lightCap: null,
    shadowCap: null,
    environmentCap: null,
    getCurrentPath: () => state.currentPath,
    setCurrentPath: (p) => { state.currentPath = p; },
    getCurrentRtype: () => state.currentPath,
    getPerFrame: () => state.perFrame,
    setPerFrame: (f) => { state.perFrame = f; },
    getHandle: () => state._handle,
    aborted: { v: false },
    inFlight: false,
    isDisposed: { v: false },
    myGen: 1,
    getGen: () => 1,
  };

  return { ctx, state, mockScene, mockAdapter };
}

describe("switchToSession 陈旧字段修复", () => {
  it("built 字段在 ctx 构造后被 setBuilt 更新，switchTo 能读到最新值（旧模型 dispose）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const oldDispose = vi.fn();
    // 模拟首次 build 后的状态
    state.built = { dispose: oldDispose } as PreviewScene;

    await switchToSession(ctx, "new.glb");

    // 关键断言：旧模型的 dispose 必须被调用（修复前因 ctx.built 快照为 null 而永不触发）
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(mockAdapter.build).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "new.glb",
    );
  });

  it("sceneBaseline 字段在 ctx 构造后被赋值，switchTo 能读到最新值", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const childA = new THREE.Mesh();
    mockScene.add(childA);
    // 模拟首次 build 后设置 sceneBaseline
    state.sceneBaseline = new Set(mockScene.children);

    await switchToSession(ctx, "new.glb");

    // 关键断言：stale filter 必须使用最新 snapshot
    // childA 在 baseline 中，不应被移除；mockScene 的子节点数不变
    expect(mockScene.children.length).toBe(1);
    expect(mockAdapter.build).toHaveBeenCalledTimes(1);
  });

  it("currentPath 字段在 ctx 构造后更新，第二次 switchTo 使用最新路径", async () => {
    const { ctx, state } = makeMockCtx();

    await switchToSession(ctx, "first.glb");
    expect(state.currentPath).toBe("first.glb");

    await switchToSession(ctx, "second.glb");
    expect(state.currentPath).toBe("second.glb");
  });

  it("perFrame 字段在 ctx 构造后更新，switchTo 后 perFrame 为新模型的 update", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const nextUpdate = vi.fn();
    mockAdapter.build.mockResolvedValue({
      dispose: vi.fn(),
      update: nextUpdate,
    } as unknown as PreviewScene);

    await switchToSession(ctx, "new.glb");
    expect(state.perFrame).toBe(nextUpdate);
  });

  it("r12 P1：并发切换抑制——inFlight 期间第二次 switchTo 直接丢弃，build 只调用一次", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    // 让首次 build 永不 resolve，保持 inFlight=true
    mockAdapter.build.mockReturnValue(new Promise<PreviewScene>(() => {}));

    const p1 = switchToSession(ctx, "first.glb");
    const p2 = switchToSession(ctx, "second.glb"); // 应被 inFlight 拦截

    expect(ctx.inFlight).toBe(true);
    expect(mockAdapter.build).toHaveBeenCalledTimes(1);
    expect(mockAdapter.build).toHaveBeenCalledWith(expect.anything(), "first.glb");

    p1.catch(() => {});
    p2.catch(() => {});
  });

  it("r12 P2：aborted 引用对象——closeOverlay 后 switchToSession 入口守卫生效（不再值捕获失效）", async () => {
    const { ctx } = makeMockCtx();
    // 模拟 closeOverlay 设置 aborted.v = true（引用对象，switchToSession 能读到）
    ctx.aborted.v = true;
    // 入口守卫应在读 ctx.aborted.v 时 return，不触发 build
    // 注意：inFlight=false 已复位（上次正常出口），此处验证 aborted 通道
    const mockAdapter2 = (ctx.adapter as unknown as { build: ReturnType<typeof vi.fn> }).build;
    await switchToSession(ctx, "new.glb");
    expect(mockAdapter2).not.toHaveBeenCalled();
  });
});

describe("syncLightTargetFromContent 陈旧字段修复", () => {
  it("sceneBaseline 为 null 时跳过（首次 build 前）", () => {
    const setTargetSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: vi.fn() } as any;
    const scene = new THREE.Scene();

    syncLightTargetFromContent(scene, null, mockLightCap);
    expect(setTargetSpy).not.toHaveBeenCalled();
  });

  it("sceneBaseline 非空时正确更新 lightCap target", () => {
    const setTargetSpy = vi.fn();
    const setTargetHeightSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: setTargetHeightSpy } as any;
    const scene = new THREE.Scene();
    const baseline = new Set<THREE.Object3D>();
    const content = new THREE.Mesh();
    scene.add(content);
    baseline.add(content); // content 是基线的一部分，不算增量

    syncLightTargetFromContent(scene, baseline, mockLightCap);
    expect(setTargetSpy).not.toHaveBeenCalled(); // 无增量内容
  });

  it("sceneBaseline 中存在增量内容时更新 lightCap target", () => {
    const setTargetSpy = vi.fn();
    const setTargetHeightSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: setTargetHeightSpy } as any;
    const scene = new THREE.Scene();
    const baseline = new Set<THREE.Object3D>();
    const content = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    content.position.set(1, 2, 3);
    scene.add(content);
    // 不加入 baseline = 增量内容

    syncLightTargetFromContent(scene, baseline, mockLightCap);
    expect(setTargetSpy).toHaveBeenCalledTimes(1);
    expect(setTargetHeightSpy).toHaveBeenCalledTimes(1);
  });
});
