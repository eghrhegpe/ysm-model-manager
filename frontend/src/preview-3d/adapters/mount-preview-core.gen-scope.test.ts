// ===== Gen-scoped 会话隔离契约测试（2026 锐评 P0 缺口：core_review 锐评「最大缺口」）=====
// 覆盖：
//   1. ownHandle / removeOwnHandle 单元契约（按 gen 精确解析，绝不取数组末尾）
//   2. 多会话 switchTo 隔离：A 的 buildCtx 闭包只触发 A 的 adapter 重建（ece0d4a4 #10 回归锚）
//   3. 会话终结（cleanupPreview）后陈旧 buildCtx 闭包被静默丢弃——不抛错、不触发 build、
//      不影响其他会话
// mock 面与 mount-preview-core.test.ts 一致（真链 + 外墙桩：three/OrbitControls/caps/菜单/输入）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PreviewAdapter, PreviewBuildCtx, PreviewHandle, PreviewScene } from "./mount-preview-core.ts";
import {
  cleanupPreview,
  mount3D,
  _resetSingletons,
} from "./mount-preview-core.ts";
import { ownHandle, removeOwnHandle } from "./mount-session.ts";

const h = vi.hoisted(() => ({
  bindInput: vi.fn(),
  menuHandle: null as null | {
    dispose: ReturnType<typeof vi.fn>;
    setAdapterItems: ReturnType<typeof vi.fn>;
    openPanel: ReturnType<typeof vi.fn>;
    refreshDock: ReturnType<typeof vi.fn>;
  },
  menuOpts: null as null | Record<string, unknown>,
}));

// ---- three：仅替换 WebGLRenderer（happy-dom 无 WebGL）----
// mock 本体抽到 test-utils/fake-webgl-renderer.ts（与主变体共享，防两处漂移）
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  const { makeCanvasFakeRenderer } = await import("@/test-utils/fake-webgl-renderer.ts");
  return {
    ...actual,
    WebGLRenderer: makeCanvasFakeRenderer() as unknown as typeof actual.WebGLRenderer,
  };
});

// ---- OrbitControls：桩（防 spherical 重摆破坏取景确定性）----
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const THREE = await import("three");
  class FakeOrbitControls {
    target = new THREE.Vector3();
    enableRotate = false;
    enableDamping = false;
    dampingFactor = 0;
    minDistance = 0;
    maxDistance = 0;
    update = vi.fn();
    constructor(_camera: unknown, _dom: unknown) {}
  }
  return { OrbitControls: FakeOrbitControls as unknown as typeof import("three/addons/controls/OrbitControls.js").OrbitControls };
});

// ---- caps registry：全能力桩 ----
function makeCap(id: string): Record<string, unknown> {
  return {
    id,
    apply: vi.fn(),
    update: vi.fn(),
    applyModelPreset: vi.fn(),
    applyPostProcDefaults: vi.fn(),
    loadAll: vi.fn(),
    setLightCap: vi.fn(),
    syncLights: vi.fn(),
    applyMeshCasts: vi.fn(),
    syncMeshIntensity: vi.fn(),
    setTarget: vi.fn(),
    setTargetHeight: vi.fn(),
    render: vi.fn(() => false),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    setReflectorCap: vi.fn(),
    dispose: vi.fn(),
  };
}
const capsById = new Map<string, Record<string, unknown>>(
  ["sky", "ground", "water", "light", "fog", "shadow", "reflector", "environment", "postprocessing"].map(
    (id) => [id, makeCap(id)],
  ),
);
vi.mock("@/preview-3d/caps/scene-capability-registry.ts", () => ({
  sceneCapabilityRegistry: {
    createAll: vi.fn(() => [...capsById.values()]),
    getById: vi.fn((id: string) => capsById.get(id) ?? null),
    loadAll: vi.fn(),
    saveAll: vi.fn(),
    dispose: vi.fn(),
  },
}));

// ---- 菜单壳 / 输入 / 焦点 / 视锥裁剪：桩 ----
vi.mock("@/preview-3d/menu/core.ts", () => ({
  mountPreviewRootMenu: vi.fn((_overlay: unknown, ctx: Record<string, unknown>) => {
    h.menuOpts = ctx;
    h.menuHandle = {
      dispose: vi.fn(),
      setAdapterItems: vi.fn(),
      openPanel: vi.fn(),
      refreshDock: vi.fn(),
    };
    return h.menuHandle;
  }),
}));
vi.mock("@/preview-3d/infra/input-and-animation.ts", () => ({
  bindInputHandlers: (opts: unknown) => h.bindInput(opts),
}));
vi.mock("@/utils/dom/focus-restore.ts", () => ({
  rememberTrigger: vi.fn(),
  returnFocus: vi.fn(),
}));
vi.mock("@/utils/dom/trap-focus-across-shadow.ts", () => ({
  trapFocusAcrossShadow: vi.fn(() => vi.fn()),
}));
vi.mock("@/preview-3d/infra/frustum-cull.ts", () => ({
  isFrustumCullEnabled: vi.fn(() => false),
  restoreModelGroupsVisible: vi.fn(),
  cullModelGroups: vi.fn(),
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
  clearModelRoots: vi.fn(),
}));

import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";

/** 最小可用 content */
function makeContent(): PreviewScene {
  return { update: vi.fn(), dispose: vi.fn() } as PreviewScene;
}

function makeAdapter(id: string, capture: (ctx: PreviewBuildCtx) => void): PreviewAdapter {
  return {
    id,
    build: vi.fn(async (ctx: PreviewBuildCtx, _path: string) => {
      capture(ctx);
      return makeContent();
    }) as never,
    onClose: vi.fn(),
  };
}

function lastPath(adapter: PreviewAdapter): unknown {
  return (adapter.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSingletons();
  sceneRegistry.reset();
  h.bindInput.mockImplementation(() => ({
    onKeyDown: vi.fn(),
    onKeyUp: vi.fn(),
    onDragPointerDown: vi.fn(),
    onDragPointerUp: vi.fn(),
    onDragPointerMove: vi.fn(),
    onResize: vi.fn(),
  }));
});

afterEach(() => {
  cleanupPreview();
  document.getElementById("ysm-overlay-3d")?.remove();
  _resetSingletons();
  sceneRegistry.reset();
  vi.restoreAllMocks();
});

describe("ownHandle / removeOwnHandle 单元契约", () => {
  it("按 gen 精确解析本会话句柄（绝不取数组末尾）", () => {
    const h1: PreviewHandle = { cleanup: vi.fn() };
    const h2: PreviewHandle = { cleanup: vi.fn() };
    const handles = [
      { handle: h1, gen: 1 },
      { handle: h2, gen: 2 },
    ];
    expect(ownHandle({ handles, myGen: 1 })).toBe(h1);
    expect(ownHandle({ handles, myGen: 2 })).toBe(h2);
    // gen 不存在 → undefined（不抛错、不误取末尾）
    expect(ownHandle({ handles, myGen: 99 })).toBeUndefined();
  });

  it("removeOwnHandle 按 gen 摘除（非末尾 session 可摘）", () => {
    const h1: PreviewHandle = { cleanup: vi.fn() };
    const h2: PreviewHandle = { cleanup: vi.fn() };
    const handles = [
      { handle: h1, gen: 1 },
      { handle: h2, gen: 2 },
    ];
    removeOwnHandle({ handles, myGen: 1 });
    expect(handles).toHaveLength(1);
    expect(handles[0].handle).toBe(h2);
    // 再摘不存在的 gen → no-op
    removeOwnHandle({ handles, myGen: 99 });
    expect(handles).toHaveLength(1);
  });
});

describe("多会话 gen-scoped switchTo 隔离（ece0d4a4 #10 回归锚）", () => {
  it("单会话（最新 gen）可会话内切换", async () => {
    let ctxA: PreviewBuildCtx | undefined;
    const adapterA = makeAdapter("vrm", (ctx) => (ctxA = ctx));

    await mount3D(adapterA, "/m/a.vrm", { rtype: "vrm" });
    expect(adapterA.build).toHaveBeenCalledTimes(1);

    // 会话内切换 → A 的 build 再次触发（外壳复用，内容层重建）
    await ctxA!.switchTo!("/m/a2.vrm");
    expect(lastPath(adapterA)).toBe("/m/a2.vrm");
    expect((adapterA.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2);
  });

  it("cooperate 多会话：新会话可切换，旧会话切换被代际守卫拒绝（不跨会话误触发）", async () => {
    let ctxA: PreviewBuildCtx | undefined;
    let ctxB: PreviewBuildCtx | undefined;
    const adapterA = makeAdapter("vrm", (ctx) => (ctxA = ctx));
    const adapterB = makeAdapter("mmd", (ctx) => (ctxB = ctx));

    await mount3D(adapterA, "/m/a.vrm", { rtype: "vrm" });
    // cooperate=true：B 叠加进同一外壳（不清理 A）→ 多会话并存（_gen 推进到 2）
    await mount3D(adapterB, "/m/b.pmx", { rtype: "mmd", cooperate: true });
    expect(adapterA.build).toHaveBeenCalledTimes(1);
    expect(adapterB.build).toHaveBeenCalledTimes(1);

    // A 的 myGen=1 < _gen=2 → beginSwitch 代际守卫拒绝：A 的闭包切换静默丢弃，
    // 不误触发 A 的 adapter 重建（旧会话闭包不再误操作他人会话——ece0d4a4 #10 语义）
    await ctxA!.switchTo!("/m/a2.vrm");
    expect(lastPath(adapterA)).toBe("/m/a.vrm"); // 仍是首次 mount 路径
    expect((adapterA.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1);
    expect(adapterB.build).toHaveBeenCalledTimes(1); // B 未受影响

    // B 是最新会话（myGen=2 === _gen=2）→ 可会话内切换
    await ctxB!.switchTo!("/m/b2.pmx");
    expect(lastPath(adapterB)).toBe("/m/b2.pmx");
    expect((adapterB.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2);
    expect((adapterA.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1); // A 不再增加
  });

  it("会话终结（cleanupPreview）后，陈旧 buildCtx 闭包被静默丢弃", async () => {
    let ctxA: PreviewBuildCtx | undefined;
    let ctxB: PreviewBuildCtx | undefined;
    const adapterA = makeAdapter("vrm", (ctx) => (ctxA = ctx));
    const adapterB = makeAdapter("mmd", (ctx) => (ctxB = ctx));

    await mount3D(adapterA, "/m/a.vrm", { rtype: "vrm" });
    await mount3D(adapterB, "/m/b.pmx", { rtype: "mmd", cooperate: true });
    const buildsA = (adapterA.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    const buildsB = (adapterB.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;

    cleanupPreview(); // 全部会话终结（handles 清空）

    // 陈旧闭包调用：ownHandle 找不到本 gen 句柄 → 静默 resolve，不抛错、不触发 build
    await expect(ctxA!.switchTo!("/m/a3.vrm")).resolves.toBeUndefined();
    await expect(ctxB!.switchTo!("/m/b3.pmx")).resolves.toBeUndefined();
    expect((adapterA.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(buildsA);
    expect((adapterB.build as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(buildsB);
  });
});
