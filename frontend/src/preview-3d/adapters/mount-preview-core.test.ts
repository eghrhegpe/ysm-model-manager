// ===== 统一 3D 预览核心（mount3D）装配测试 =====
// 覆盖：mount3D 主路径（shared 基础设施复用 + build 注入 + 注册表登记 + 菜单注入 +
// perFrame 接线）、rAF 循环（WASD 相机运动 / 能力更新 / 统一渲染出口）、
// ESC 关闭（fullCleanup 生命周期）、build 失败降级、build 中途 abort（代际守卫）、
// unloadRole（注册表卸载）、统一多模型拾取器、cleanupPreview/_resetSingletons。
// WebGLRenderer/OrbitControls 为 fake（happy-dom 无 WebGL）；caps registry/菜单壳/input
// 桩掉外壳依赖，scene/camera/Vector3/Box3 用 three 真实实现（纯 JS 无 GL 依赖）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

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

// ---- three：仅替换 WebGLRenderer（happy-dom 无 WebGL；OrbitControls 由 addon mock 承担）----
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement & { getBoundingClientRect?: () => unknown };
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    getSize = (v: THREE.Vector2) => v.set(800, 600);
    constructor() {
      const el = document.createElement("canvas") as HTMLCanvasElement & {
        getBoundingClientRect?: () => unknown;
      };
      el.width = 800;
      el.height = 600;
      el.getBoundingClientRect = (() => ({
        left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600, toJSON: () => ({}),
      })) as unknown as HTMLCanvasElement["getBoundingClientRect"];
      this.domElement = el;
    }
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof THREE.WebGLRenderer,
  };
});

// ---- OrbitControls：真实实现会在 update() 里按 spherical 重摆相机（破坏射线取景确定性）→ 桩 ----
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

// ---- caps registry：全能力桩（id → 桩，含 render/postProc 接口）----
function makeCap(id: string): Record<string, unknown> {
  return {
    id,
    apply: vi.fn(),
    update: vi.fn(),
    setPreset: vi.fn(),
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
vi.mock("../caps/scene-capability-registry.ts", () => ({
  sceneCapabilityRegistry: {
    createAll: vi.fn(() => [...capsById.values()]),
    getById: vi.fn((id: string) => capsById.get(id) ?? null),
    loadAll: vi.fn(),
    saveAll: vi.fn(),
    dispose: vi.fn(),
  },
}));

// ---- 菜单壳 / 输入 / 焦点 / 视锥裁剪：桩 ----
vi.mock("../menu/core.ts", () => ({
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
vi.mock("./input-and-animation.ts", () => ({
  bindInputHandlers: (opts: unknown) => h.bindInput(opts),
}));
vi.mock("../../../utils/dom/focus-restore.ts", () => ({
  rememberTrigger: vi.fn(),
  returnFocus: vi.fn(),
  trapFocusAcrossShadow: vi.fn(() => vi.fn()),
}));
vi.mock("../frustum-cull.ts", () => ({
  isFrustumCullEnabled: vi.fn(() => false),
  restoreModelGroupsVisible: vi.fn(),
  cullModelGroups: vi.fn(),
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
  clearModelRoots: vi.fn(),
}));

import {
  mount3D,
  switchPreview,
  hasActivePreview,
  invalidatePreview,
  cleanupPreview,
  _resetSingletons,
} from "./mount-preview-core.ts";
import { sceneRegistry } from "./scene-registry.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import { bus } from "../../bus.ts";

/** 最小 panel 菜单项 */
function panelItem(id: string): unknown {
  return { id, icon: "x", labelKey: "x", fallback: id, kind: "panel" };
}

/** 最小可用 content（adapter.build 返回） */
function makeBuilt(): PreviewScene {
  return {
    update: vi.fn(),
    dispose: vi.fn(),
    resetCamera: vi.fn(),
    menuItems: [panelItem("model"), panelItem("shot")] as unknown as PreviewMenuNode[],
  };
}

/** rAF → setTimeout 兜底（happy-dom rAF 不可用时保持确定性节拍） */
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
  _resetSingletons();
  sceneRegistry.reset();
  vi.restoreAllMocks();
});

describe("mount3D 主路径（shared 基础设施 + build 注入）", () => {
  it("build 收到完整 ctx（scene/camera/renderer/controls/sessionId/switchTo）+ 注册表登记 + 菜单注入", async () => {
    const content = makeBuilt();
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(async () => content),
      onClose: vi.fn(),
    };
    await mount3D(adapter, "/m/a.vrm", { rtype: "vrm", siblings: ["/m/b.vrm"] });

       expect(adapter.build).toHaveBeenCalledTimes(1);
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    expect(buildCtx.scene).toBeDefined();
    expect(buildCtx.camera).toBeDefined();
    expect(buildCtx.renderer).toBeDefined();
    expect(buildCtx.controls).toBeDefined();
    expect(buildCtx.sessionId).toBe("s1");
    expect(typeof buildCtx.switchTo).toBe("function");
    expect(buildCtx.cameraControls).toBeDefined();
    // 菜单 ctx：候选过滤当前路径 + rtype 透传
    expect(h.menuOpts).not.toBeNull();
    expect((h.menuOpts!.getCurrentRtype as () => string)()).toBe("vrm");
    expect((h.menuOpts!.getSiblings as () => string[])()).toEqual(["/m/b.vrm"]);

    // 注册表登记 + 菜单注入（content.menuItems 合并统计面板）
    expect(sceneRegistry.count()).toBe(1);
    expect(sceneRegistry.getActiveId()).toBe("m1");
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalled();

    // 相机偏好桥：camBridge.getSpeed 读 keymap 默认
    const camBridge = (h.menuOpts!.getCamBridge as () => Record<string, unknown>)();
    expect(typeof camBridge.getSpeed).toBe("function");

    expect(hasActivePreview()).toBe(true);
  });

  it("switchPreview 转发到活跃会话；无会话时 no-op", async () => {
    await switchPreview("/x.vrm"); // 无会话 no-op 不抛
    const content = makeBuilt();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    // 会话内 switchTo：转发到 handle.switchTo（复用外壳重建内容层）
    await expect(switchPreview("/m/other.vrm")).resolves.toBeUndefined();
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
  });

  it("ESC → fullCleanup：dispose 内容层 + 移除 overlay + 注销注册表", async () => {
    const content = makeBuilt();
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => content), onClose: vi.fn() };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    buildCtx.scene!.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(content.dispose).toHaveBeenCalledTimes(1);
    expect(h.menuHandle!.dispose).toHaveBeenCalled();
    expect(sceneRegistry.count()).toBe(0);
    // 会话须从 _handles 摘除并通知调用方：ESC/关闭按钮走 fullCleanup，若只拆 DOM 不动
    // 句柄，hasActivePreview() 会恒为 true、调用方状态不复位、android-back 不注销。
    expect(adapter.onClose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
    cleanupPreview(); // 幂等兜底
    expect(hasActivePreview()).toBe(false);
  });

  it("build 期间被 invalidate：已产出的内容层仍须 dispose，不留 GPU 资源", async () => {
    const content = makeBuilt();
    let resolveBuild!: (b: PreviewScene) => void;
    const build = vi.fn(() => new Promise<PreviewScene>((res) => { resolveBuild = res; }));
    const adapter: PreviewAdapter = { id: "vrm", build, onClose: vi.fn() };
    const pending = mount3D(adapter, "/m/abort.vrm");
    invalidatePreview(); // 代际守卫：build resolve 后进入中止分支
    resolveBuild(content);
    await pending;
    // build 已返回内容层，中止分支须先把它登记进 allContent 再 fullCleanup，否则 dispose 不到
    expect(content.dispose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
    expect(adapter.onClose).toHaveBeenCalledTimes(1);
  });

  it("build 失败 → console.error + showLoadFailure 降级，不注册会话", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(async () => { throw new Error("parse boom"); }),
    };
    await mount3D(adapter, "/m/bad.vrm");
    expect(errSpy).toHaveBeenCalled();
    expect(hasActivePreview()).toBe(false);
    expect(sceneRegistry.count()).toBe(0);
  });

  it("build 期间 invalidatePreview（代际失效）→ 会话不注册不泄漏", async () => {
    const content = makeBuilt();
    let resolveBuild!: (v: PreviewScene) => void;
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(() => new Promise<PreviewScene>((res) => { resolveBuild = res; })),
    };
    const p = mount3D(adapter, "/m/a.vrm");
    invalidatePreview(); // 加载期间用户切换
    resolveBuild(content);
    await p;
    // 代际守卫：会话未注册（⚠️ fullCleanup 不含 allContent 尚未 push 的 content →
    // 刚建好的内容层 dispose 未被调用，疑似源码 bug，见 ESC 用例注释）
    expect(hasActivePreview()).toBe(false);
    expect(sceneRegistry.count()).toBe(0);
    cleanupPreview();
  });

  it("build 完成前 ESC → closeOverlay 早期路径：onClose + 焦点释放", async () => {
    let resolveBuild!: (v: PreviewScene) => void;
    const onClose = vi.fn();
    const adapter: PreviewAdapter = {
      id: "vrm",
      onClose,
      build: vi.fn(() => new Promise<PreviewScene>((res) => { resolveBuild = res; })),
    };
    const p = mount3D(adapter, "/m/a.vrm");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // 初始 escH → cleanupFn 尚空 → closeOverlay
    resolveBuild(makeBuilt());
    await p;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
    cleanupPreview();
  });

  it("菜单回调接线：switchExternal/toast/closeAllOverlays/getModelsByType/camBridge.reset/switchTo", async () => {
    const built1 = makeBuilt();
    const built2 = makeBuilt();
    const switchExternal = vi.fn(async () => {});
    const getModelsByType = vi.fn(async () => ["/m/x.vrm"]);
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn().mockResolvedValueOnce(built1).mockResolvedValueOnce(built2),
    };
    await mount3D(adapter, "/m/a.vrm", {
      rtype: "vrm",
      subtype: "EntityPlayer",
      switchExternal,
      getModelsByType,
    });
    const mo = h.menuOpts as Record<string, (...a: unknown[]) => unknown>;
    expect((mo.getCurrentSubtype as () => string)()).toBe("EntityPlayer");
    await (mo.getModelsByType as (t: string) => Promise<string[]>)("vrm");
    expect(getModelsByType).toHaveBeenCalledWith("vrm", undefined);

    // switchExternal 透传（Promise 归一 catch）
    (mo.switchExternal as (p: string) => void)("/m/other.vrm");
    expect(switchExternal).toHaveBeenCalledWith("/m/other.vrm", undefined, undefined);

    // toast → bus
    const toasts: unknown[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    (mo.toast as (m: string) => void)("hello");
    off();
    expect(toasts).toHaveLength(1);

    // closeAllOverlays → menuHandle.dispose
    (mo.closeAllOverlays as () => void)();
    expect(h.menuHandle!.dispose).toHaveBeenCalled();

    // camBridge.reset → 活跃会话 content.resetCamera
    (mo.getCamBridge as () => Record<string, () => void>)().reset();
    expect(built1.resetCamera).toHaveBeenCalledTimes(1);

    // switchTo → 会话内切换（第二次 build + setPerFrame 新旧交接 + 注册表更新）
    await (mo.switchTo as (p: string) => Promise<void>)("/m/b.vrm");
    expect((adapter.build as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(((adapter.build as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[])[1]).toBe("/m/b.vrm");
    expect(sceneRegistry.count()).toBe(1); // 旧 m1 注销、新 m2 登记
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalled();
    // shadowCap/environmentCap 消费切换新增量
    expect(capsById.get("shadow")!.applyMeshCasts).toHaveBeenCalled();
    expect(capsById.get("environment")!.syncMeshIntensity).toHaveBeenCalled();
  });
});

describe("rAF 渲染管线（WASD / perFrame / 能力 / 统一渲染出口）", () => {
  it("帧循环驱动：caps.update + perFrame + WASD 全向相机运动 + 统一渲染出口", async () => {
    const content = makeBuilt();
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => content) };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    const renderer = buildCtx.renderer as unknown as { render: ReturnType<typeof vi.fn> };
    const inputOpts = h.bindInput.mock.calls[0][0] as {
      keys: Record<string, boolean>;
      camera: THREE.PerspectiveCamera;
    };
    const camZ0 = inputOpts.camera.position.z;

    // 模拟按键态（bindInputHandlers 已把 code 映射进 keys）：forward+up 净位移
    inputOpts.keys.forward = true;
    inputOpts.keys.up = true;
    await new Promise((r) => setTimeout(r, 80)); // 跑几帧

    for (const cap of capsById.values()) {
      expect((cap.update as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    }
    expect(content.update).toHaveBeenCalled(); // perFrame 驱动内容层
    expect(renderer.render).toHaveBeenCalled(); // postProc.render false → rd.render 兜底
    // WASD：forward+up 改变相机位置
    expect(Math.abs(inputOpts.camera.position.z - camZ0)).toBeGreaterThan(0.001);

    // 全方向齐发（back/left/right/down 内层分支）：净位移≈0 但分支被走
    inputOpts.keys.back = true;
    inputOpts.keys.left = true;
    inputOpts.keys.right = true;
    inputOpts.keys.down = true;
    await new Promise((r) => setTimeout(r, 40));
    inputOpts.keys.back = false;
    inputOpts.keys.left = false;
    inputOpts.keys.right = false;
    inputOpts.keys.down = false;
    inputOpts.keys.forward = false;
    inputOpts.keys.up = false;

    // 模式桥：setOrbit(false) → 自由模式（euler 桥分支：target 跟随相机）
    const camBridge = (h.menuOpts!.getCamBridge as () => Record<string, (...a: unknown[]) => unknown>)();
    camBridge.setOrbit(false);
    expect(camBridge.getOrbit()).toBe(false);
    camBridge.setSpeed(42);
    expect(camBridge.getSpeed()).toBe(42);
    await new Promise((r) => setTimeout(r, 60)); // 自由模式帧（非 orbit target 分支）
    // reset → 活跃会话 content.resetCamera
    camBridge.reset!();
    expect(content.resetCamera).toHaveBeenCalledTimes(1);
    camBridge.setOrbit(true);
    cleanupPreview();
  });
});

describe("unloadRole（注册表卸载角色）", () => {
  it("卸载指定角色：dispose + 移除 roots + 注销 + 菜单复位 + refreshDock", async () => {
    const content = makeBuilt();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const unloadBuilt = { dispose: vi.fn(), update: vi.fn() } as unknown as PreviewScene;
    const id = sceneRegistry.register({
      path: "/m/role.vrm",
      rtype: "vrm",
      roots: [mesh],
      content: unloadBuilt,
      menuItems: [panelItem("role")] as unknown as PreviewMenuNode[],
    });

    // 经菜单 ctx 触发 unloadRole（角色面板 ⚙ → 卸载）
    (h.menuOpts!.unloadRole as (id: string) => void)(id);

    expect(unloadBuilt.dispose).toHaveBeenCalledTimes(1);
    // 注册表注销（活跃 id 转移/清空）
    expect(sceneRegistry.get(id)).toBeUndefined();
    // 活跃角色切换 → dock 换菜单（mount 会话 m1 仍在注册表且带统计 menuItems → 非空注入）
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalled();
    expect(h.menuHandle!.refreshDock).toHaveBeenCalled();
  });
});

describe("统一多模型拾取器（count>=2 激活）", () => {
  it("点击命中模型 → setActive + 骨骼回调透传（boneMaps 分支）+ 隐藏链跳过", async () => {
    const builtA = { ...makeBuilt(), onBoneSelect: vi.fn() } as unknown as PreviewScene;
    const onPickA = vi.fn();
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(async (ctx: PreviewBuildCtx) => {
        // 模型 A：命名 Group（骨骼名 b1，命中后经 nameMap 解析骨骼回调）
        const groupA = new THREE.Group();
        groupA.name = "b1";
        groupA.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
        groupA.position.set(0, 0, -5);
        // 模型 B：普通 mesh（更远处，同一直线上）
        const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        meshB.position.set(0, 0, -8);
        ctx.scene!.add(groupA, meshB);
        return makeBuilt();
      }),
    };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    const scene = buildCtx.scene!;
    // happy-dom viewContainer clientWidth=0 → 相机 aspect 退化（射线全空）→ 模拟有尺寸视口
    const cam = buildCtx.camera as THREE.PerspectiveCamera;
    cam.aspect = 1;
    cam.updateProjectionMatrix();
    scene.updateMatrixWorld(true);
    const groupA = scene.children.find((c) => (c as THREE.Group).isGroup)!;
    const meshB = scene.children.find((c) => (c as THREE.Mesh).isMesh)!;
    // mount 会话自身的注册项（无 boneMaps）会让 register 去重复用 → 先注销再注册带骨骼映射的条目
    sceneRegistry.unregister("m1");
    const idA = sceneRegistry.register({
      path: "/m/a.vrm",
      rtype: "vrm",
      roots: [groupA],
      content: builtA,
      boneMaps: {
        boneGroupMap: new Map([["b1", groupA as THREE.Group]]),
        nameMap: new Map([["b1", "b1"]]),
        parentMap: new Map([["b1", null]]),
        childrenMap: new Map([["b1", []]]),
      },
      onBonePick: onPickA,
    });
    const idB = sceneRegistry.register({ path: "/m/b.vrm", rtype: "vrm", roots: [meshB], content: makeBuilt() });

    const dom = buildCtx.renderer!.domElement as unknown as { dispatchEvent: (e: unknown) => void };
    // 点击 canvas 中央 → 射线沿 -Z → 先命中近处 groupA
    dom.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, bubbles: true }));
    expect(sceneRegistry.getActiveId()).toBe(idA);
    // boneMaps 分支：boneId 解析 + 骨骼信息组装 + 回调透传
    expect(onPickA).toHaveBeenCalledWith("b1");
    expect((builtA.onBoneSelect as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    // 隐藏链跳过：藏 A → 同一点位命中被跳过 → 切到 B
    sceneRegistry.setVisible(idA, false);
    dom.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, bubbles: true }));
    expect(sceneRegistry.getActiveId()).toBe(idB);
  });

  it("单模型（count<2）→ 点击不触发统一拾取", async () => {
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => makeBuilt()) };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    sceneRegistry.register({ path: "/m/a.vrm", rtype: "vrm", roots: [], content: makeBuilt() });
    const setActiveSpy = vi.spyOn(sceneRegistry, "setActive");
    const dom = buildCtx.renderer!.domElement as unknown as { dispatchEvent: (e: unknown) => void };
    dom.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));
    expect(setActiveSpy).not.toHaveBeenCalled();
  });
});

describe("公开 API", () => {
  it("cleanupPreview：清理全部会话并复位单例（renderer/canvas 保留语义由实现承担）", async () => {
    const content = makeBuilt();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
    expect(content.dispose).toHaveBeenCalledTimes(1);
    expect(_resetSingletons).toBeDefined();
    expect(invalidatePreview).toBeDefined();
  });

  it("cooperate=true 同台追加：allContent 累积，fullCleanup 逐一 dispose", async () => {
    const builtA = makeBuilt();
    const builtB = makeBuilt();
    await mount3D({ id: "vrm", build: vi.fn(async () => builtA) }, "/m/a.vrm", { cooperate: true });
    await mount3D({ id: "vrm", build: vi.fn(async () => builtB) }, "/m/b.vrm", { cooperate: true });
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(builtA.dispose).toHaveBeenCalledTimes(1);
    expect(builtB.dispose).toHaveBeenCalledTimes(1);
  });
});
