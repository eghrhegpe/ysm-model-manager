// ===== 统一 3D 预览核心（mount3D）装配 + 行为测试（2026 锐评整改：双胞胎合体）=====
//
// 历史：mount-preview-core 曾有 .test.ts（happy-dom 装配）+ .behavior.test.ts（node
// 环境手搓 200 行假 DOM）双胞胎，同一模块 1504 行测试 / 817 行源码，mock 各写一套，
// 「测试在测试它自己的 mock」。本次合体：
//   1. 统一 happy-dom 真实 DOM —— 删除手搓 document/window/rAF/getContext 假环境
//   2. mock 面积收敛为「真链 + 外墙桩」：three(WebGLRenderer/OrbitControls)、caps
//      注册表、菜单壳、输入绑定、焦点陷阱、视锥裁剪为桩；sceneRegistry / bus /
//      switch-preview / i18n / storage 等走真实实现（happy-dom 下全链可跑）
//   3. 墓碑测试（describe「模块级单例 _handle 竞态」三个 BUG: 用例）删除——其断言
//      的是旧单 _handle 时代的错误行为，现代码已 _handles 数组化 + myGen 代际守卫，
//      语义被 finishSession 幂等 / 代际守卫 / switchPreview no-op 用例覆盖
//
// 覆盖：mount3D 主路径（shared 基础设施复用 + build 注入 + 注册表登记 + 菜单注入 +
// perFrame 接线）、rAF 循环（WASD 相机运动 / 能力更新 / 统一渲染出口）、
// ESC 关闭（fullCleanup 生命周期）、build 失败降级、build 中途 abort（代际守卫）、
// unloadModel（注册表卸载）、统一多模型拾取器、外壳单例复用、self 模式/配置缺失降级、
// ESC 后再次 mount 的 canvas 重挂载回归、cleanupPreview/_resetSingletons。
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

// ---- caps registry：全能力桩（id → 桩，含 render/postProc 接口；water 需在表内，shared-infra 查询）----
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
function makeContent(): PreviewScene {
  return {
    update: vi.fn(),
    dispose: vi.fn(),
    resetCamera: vi.fn(),
    menuItems: [panelItem("model"), panelItem("shot")] as unknown as PreviewMenuNode[],
  };
}

/** 构造最小 PreviewAdapter；build 捕获 buildCtx 供用例断言派生字段 */
function makeAdapter(opts: {
  scene?: Partial<PreviewScene>;
  content?: PreviewScene;
  capture?: (ctx: PreviewBuildCtx) => void;
} = {}): PreviewAdapter & { build: ReturnType<typeof vi.fn> } {
  const build = vi.fn(async (ctx: PreviewBuildCtx, _path: string) => {
    opts.capture?.(ctx);
    return opts.content ?? opts.scene
      ? ({ dispose: vi.fn(), update: vi.fn(), ...opts.scene } as PreviewScene)
      : makeContent();
  });
  return { id: "vrm", build, onClose: vi.fn() };
}

/** 从最近一次 mount3D 捕获的 buildCtx 读取字段 */
function lastBuildCtx(build: ReturnType<typeof vi.fn>): PreviewBuildCtx {
  return build.mock.calls[0][0] as PreviewBuildCtx;
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
  // build 失败路径不注册 handle，cleanupPreview 清不到它创建的 overlay——
  // 强制摘除残留 overlay，防跨用例 DOM 串扰（真实行为：失败 UI 由用户关闭）
  document.getElementById("ysm-overlay-3d")?.remove();
  _resetSingletons();
  sceneRegistry.reset();
  vi.restoreAllMocks();
});

describe("mount3D 主路径（shared 基础设施 + build 注入）", () => {
  it("build 收到完整 ctx（scene/camera/renderer/controls/sessionId/switchTo）+ 注册表登记 + 菜单注入", async () => {
    const content = makeContent();
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

  it("hasActivePreview 初始为 false；invalidatePreview 无活跃会话时不抛错", () => {
    expect(hasActivePreview()).toBe(false);
    expect(() => invalidatePreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("switchPreview 转发到活跃会话；无会话时 no-op", async () => {
    await switchPreview("/x.vrm"); // 无会话 no-op 不抛
    const content = makeContent();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    // 会话内 switchTo：转发到 handle.switchTo（复用外壳重建内容层）
    await expect(switchPreview("/m/other.vrm")).resolves.toBeUndefined();
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
  });

  it("ESC → fullCleanup：dispose 内容层 + 移除 overlay + 注销注册表", async () => {
    const content = makeContent();
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

  it("build 失败：console.error + onClose 不被调用 + 不注册会话", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter: PreviewAdapter = {
      id: "vrm",
      onClose: vi.fn(),
      build: vi.fn(async () => { throw new Error("parse boom"); }),
    };
    await mount3D(adapter, "/m/bad.vrm");
    expect(errSpy).toHaveBeenCalled();
    expect(hasActivePreview()).toBe(false);
    expect(sceneRegistry.count()).toBe(0);
    // build 失败路径只走 unsafe 清理，不触发 onClose（会话从未注册，无关闭语义）
    expect(adapter.onClose).not.toHaveBeenCalled();
  });

  it("build 期间被 invalidate：已产出的内容层仍须 dispose，不留 GPU 资源", async () => {
    const content = makeContent();
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

  it("build 期间 invalidatePreview（代际失效）→ 会话不注册不泄漏", async () => {
    const content = makeContent();
    let resolveBuild!: (v: PreviewScene) => void;
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(() => new Promise<PreviewScene>((res) => { resolveBuild = res; })),
    };
    const p = mount3D(adapter, "/m/a.vrm");
    invalidatePreview(); // 加载期间用户切换
    resolveBuild(content);
    await p;
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
    resolveBuild(makeContent());
    await p;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
    cleanupPreview();
  });

  it("快速连续 mount 两次：第一次代际失效走 fullCleanup，第二个会话保持活跃", async () => {
    const firstContent = makeContent();
    let resolveFirst!: (b: PreviewScene) => void;
    const firstAdapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn(() => new Promise<PreviewScene>((res) => { resolveFirst = res; })),
    };
    const firstPromise = mount3D(firstAdapter, "/first.ysm");
    // 第二个 mount 完成：++_gen 使第一次 await 后的 myGen !== _gen
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/second.ysm");
    // 释放第一个 build → 代际守卫命中 → fullCleanup 分支（_handles 数组：不误杀第二个会话）
    resolveFirst(firstContent);
    await firstPromise;
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
  });

  it("菜单回调接线：switchExternal/toast/closeAllOverlays/getModelsByType/camBridge.reset/switchTo", async () => {
    const content1 = makeContent();
    const content2 = makeContent();
    const switchExternal = vi.fn(async () => {});
    const getModelsByType = vi.fn(async () => ["/m/x.vrm"]);
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn().mockResolvedValueOnce(content1).mockResolvedValueOnce(content2),
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
    expect(content1.resetCamera).toHaveBeenCalledTimes(1);

    // switchTo → 会话内切换（第二次 build + setPerFrame 新旧交接 + 注册表更新）
    await (mo.switchTo as (p: string) => Promise<void>)("/m/b.vrm");
    expect(adapter.build).toHaveBeenCalledTimes(2);
    expect((adapter.build as ReturnType<typeof vi.fn>).mock.calls[1][1]).toBe("/m/b.vrm");
    expect(sceneRegistry.count()).toBe(1); // 旧 m1 注销、新 m2 登记
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalled();
    // shadowCap/environmentCap 消费切换新增量
    expect(capsById.get("shadow")!.applyMeshCasts).toHaveBeenCalled();
    expect(capsById.get("environment")!.syncMeshIntensity).toHaveBeenCalled();
  });
});

// 外壳单例复用（viewContainer 随外壳初始化只建一次；回归：多次 mount3D 曾反复 new 空容器）
describe("外壳单例复用", () => {
  /** 当前 overlay 内的 view-container 数量（overlay 为 shadow host；降级 light DOM 时查 host 本体） */
  function viewContainerCount(): number {
    const overlay = document.getElementById("ysm-overlay-3d");
    if (!overlay) return 0;
    const root = (overlay.shadowRoot as unknown as HTMLElement) ?? overlay;
    return root.querySelectorAll(".preview-view-container").length;
  }

  it("连续两次 mount3D（同台复用外壳）只创建一个 view-container", async () => {
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/a.ysm");
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/b.ysm");
    expect(viewContainerCount()).toBe(1);
    cleanupPreview();
  });

  it("cleanupPreview 后重新 mount：重建外壳（重新创建唯一 view-container）", async () => {
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/a.ysm");
    cleanupPreview();
    expect(document.getElementById("ysm-overlay-3d")).toBeNull();
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/b.ysm");
    expect(viewContainerCount()).toBe(1);
    cleanupPreview();
  });
});

// 生命周期事件顺序：cleanupPreview 幂等 / 重复卸载
describe("cleanupPreview 幂等 / 重复卸载", () => {
  it("无活跃会话时 cleanupPreview 应 no-op 且不抛错", () => {
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("重复调用 cleanupPreview 两次不抛错（第二次应 no-op）", async () => {
    await mount3D(makeAdapter(), "/model.ysm");
    expect(hasActivePreview()).toBe(true);
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("cleanup 后再 mount 应重新开始（句柄重建）", async () => {
    await mount3D(makeAdapter(), "/a.ysm");
    cleanupPreview();
    await mount3D(makeAdapter(), "/b.ysm");
    expect(hasActivePreview()).toBe(true);
  });
});

// 部分配置缺失时的降级（self 模式 / 最小 content / 缺回调 / 缺 opts）
describe("部分配置缺失时的降级行为", () => {
  it("adapter.mode='self'：核心不创建 scene/camera/renderer，build ctx 内均为 undefined", async () => {
    let capturedCtx: PreviewBuildCtx | null = null;
    const adapter: PreviewAdapter = {
      id: "self-adapter",
      mode: "self",
      build: async (ctx: PreviewBuildCtx) => {
        capturedCtx = ctx;
        return { dispose: vi.fn(), update: vi.fn() };
      },
      onClose: vi.fn(),
    };
    await mount3D(adapter, "/self.ysm");
    expect(hasActivePreview()).toBe(true);
    expect(capturedCtx).not.toBe(null);
    expect(capturedCtx!.scene).toBeUndefined();
    expect(capturedCtx!.camera).toBeUndefined();
    expect(capturedCtx!.renderer).toBeUndefined();
    expect(capturedCtx!.controls).toBeUndefined();
    expect(capturedCtx!.cameraControls).toBeUndefined();
    expect(capturedCtx!.viewContainer).toBeDefined();
    expect(capturedCtx!.overlay).toBeDefined();
    expect(capturedCtx!.menu).toBeDefined();
    cleanupPreview();
  });

  it("adapter.build 返回的 PreviewScene 只有 dispose（无 update 等）：不抛错", async () => {
    // 契约：能力可选，缺字段 = 功能降级而非崩溃（no 空实现补数）
    await mount3D({ id: "vrm", build: vi.fn(async () => ({ dispose: vi.fn() })) }, "/minimal.ysm");
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
  });

  it("adapter.onClose 缺失：cleanup 时安全降级不抛错", async () => {
    const adapter = makeAdapter();
    delete (adapter as unknown as { onClose?: unknown }).onClose;
    await mount3D(adapter, "/no-callback.ysm");
    expect(() => cleanupPreview()).not.toThrow();
  });

  it("opts.siblings / switchExternal / getModelsByType / getTypeTabs 全部缺失：菜单仍创建，对应字段 undefined", async () => {
    await mount3D(makeAdapter(), "/a.ysm");
    expect(hasActivePreview()).toBe(true);
    const mo = h.menuOpts as Record<string, unknown>;
    expect(mo.getSiblings).toBeDefined();
    expect(() => (mo.getSiblings as () => string[])()).not.toThrow();
    expect((mo.getSiblings as () => string[])()).toEqual([]); // 向后兼容缺省
    expect(mo.switchExternal).toBeUndefined();
    cleanupPreview();
  });
});

describe("rAF 渲染管线（WASD / perFrame / 能力 / 统一渲染出口）", () => {
  it("帧循环驱动：caps.update + perFrame + WASD 全向相机运动 + 统一渲染出口", async () => {
    const content = makeContent();
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
      expect(cap.update as ReturnType<typeof vi.fn>).toHaveBeenCalled();
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

describe("unloadModel（注册表卸载模型）", () => {
  it("卸载指定角色：dispose + 移除 roots + 注销 + 菜单复位 + refreshDock", async () => {
    const content = makeContent();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const unloadContent = { dispose: vi.fn(), update: vi.fn() } as unknown as PreviewScene;
    const id = sceneRegistry.register({
      path: "/m/role.vrm",
      rtype: "vrm",
      roots: [mesh],
      content: unloadContent,
      menuItems: [panelItem("role")] as unknown as PreviewMenuNode[],
    });

    // 经菜单 ctx 触发 unloadModel（角色面板 ⚙ → 卸载）
    (h.menuOpts!.unloadModel as (id: string) => void)(id);

    expect(unloadContent.dispose).toHaveBeenCalledTimes(1);
    // 注册表注销（活跃 id 转移/清空）
    expect(sceneRegistry.get(id)).toBeUndefined();
    // 活跃角色切换 → dock 换菜单（mount 会话 m1 仍在注册表且带统计 menuItems → 非空注入）
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalled();
    expect(h.menuHandle!.refreshDock).toHaveBeenCalled();
  });

  it("卸载当前活跃角色，全新活跃角色无专属项 → 显式清空 dock 适配器项（不残留已卸载菜单）", async () => {
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/model.ysm");
    const id = sceneRegistry.register({
      path: "/model.ysm",
      rtype: "vrm",
      roots: [],
      content: { dispose: vi.fn() } as unknown as PreviewScene,
      menuItems: null, // 卸载的是注册表里 M1 会话自身；先手动注销让其余为空或去重
    });
    // 预置第二个角色（menuItems null）模拟 cooperate 双角色 —— 卸载后它成为新活跃
    const id2 = sceneRegistry.register({
      path: "/second.ysm",
      rtype: "vrm",
      roots: [],
      content: { dispose: vi.fn() } as unknown as PreviewScene,
      menuItems: null,
    });
    // 预置完成后卸载第一个：新活跃无专属项 → 应显式清空 dock 适配器项（P2 修复）
    (h.menuOpts!.unloadModel as (id: string) => void)(id);
    expect(sceneRegistry.getActiveId()).toBe(id2);
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalledWith([]);
    cleanupPreview();
  });

  it("卸载最后一个角色：内容层 dispose + dock 适配器项清空（无残留菜单）", async () => {
    await mount3D({ id: "vrm", build: vi.fn(async () => makeContent()) }, "/only.ysm");
    const id = sceneRegistry.getActiveId()!; // mount3D 注册的唯一会话（m1）
    (h.menuOpts!.unloadModel as (id: string) => void)(id);
    // 卸载后注册表清空 → 新活跃不存在 → unloadModel 走 else 分支清空 dock 适配器项
    expect(sceneRegistry.getActiveId()).toBeNull();
    expect(h.menuHandle!.setAdapterItems).toHaveBeenCalledWith([]);
    cleanupPreview();
  });
});

describe("统一多模型拾取器（count>=2 激活）", () => {
  it("点击命中模型 → setActive + 骨骼回调透传（boneMaps 分支）+ 隐藏链跳过", async () => {
    const contentA = { ...makeContent(), onBoneSelect: vi.fn() } as unknown as PreviewScene;
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
        return makeContent();
      }),
    };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    const scene = buildCtx.scene!;
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
      content: contentA,
      boneMaps: {
        boneGroupMap: new Map([["b1", groupA as THREE.Group]]),
        nameMap: new Map([["b1", "b1"]]),
        parentMap: new Map([["b1", null]]),
        childrenMap: new Map([["b1", []]]),
      },
      onBonePick: onPickA,
    });
    const idB = sceneRegistry.register({ path: "/m/b.vrm", rtype: "vrm", roots: [meshB], content: makeContent() });

    const dom = buildCtx.renderer!.domElement as unknown as { dispatchEvent: (e: unknown) => void };
    // 点击 canvas 中央 → 射线沿 -Z → 先命中近处 groupA
    dom.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, bubbles: true }));
    expect(sceneRegistry.getActiveId()).toBe(idA);
    // boneMaps 分支：boneId 解析 + 骨骼信息组装 + 回调透传
    expect(onPickA).toHaveBeenCalledWith("b1");
    expect((contentA.onBoneSelect as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    // 隐藏链跳过：藏 A → 同一点位命中被跳过 → 切到 B
    sceneRegistry.setVisible(idA, false);
    dom.dispatchEvent(new MouseEvent("click", { clientX: 400, clientY: 300, bubbles: true }));
    expect(sceneRegistry.getActiveId()).toBe(idB);
  });

  it("单模型（count<2）→ 点击不触发统一拾取", async () => {
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm");
    const buildCtx = (adapter.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as PreviewBuildCtx;
    sceneRegistry.register({ path: "/m/a.vrm", rtype: "vrm", roots: [], content: makeContent() });
    const setActiveSpy = vi.spyOn(sceneRegistry, "setActive");
    const dom = buildCtx.renderer!.domElement as unknown as { dispatchEvent: (e: unknown) => void };
    dom.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));
    expect(setActiveSpy).not.toHaveBeenCalled();
  });
});

describe("公开 API", () => {
  it("cleanupPreview：清理全部会话并复位单例（renderer/canvas 保留语义由实现承担）", async () => {
    const content = makeContent();
    await mount3D({ id: "vrm", build: vi.fn(async () => content) }, "/m/a.vrm");
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
    expect(content.dispose).toHaveBeenCalledTimes(1);
    expect(_resetSingletons).toBeDefined();
    expect(invalidatePreview).toBeDefined();
  });

  it("cooperate=true 同台追加：allContent 累积，fullCleanup 逐一 dispose", async () => {
    const contentA = makeContent();
    const contentB = makeContent();
    await mount3D({ id: "vrm", build: vi.fn(async () => contentA) }, "/m/a.vrm", { cooperate: true });
    await mount3D({ id: "vrm", build: vi.fn(async () => contentB) }, "/m/b.vrm", { cooperate: true });
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(contentA.dispose).toHaveBeenCalledTimes(1);
    expect(contentB.dispose).toHaveBeenCalledTimes(1);
  });
});

// finishSession 幂等契约：closeOverlay（ESC 早期路径）与 fullCleanup（post-build 路径）
// 都会调 finishSession。源码注释明确：「不幂等则 onClose 会重复触发」。
describe("finishSession 幂等契约", () => {
  it("build 期间 ESC（closeOverlay）后 build resolve 进 fullCleanup：onClose 只调一次", async () => {
    let resolveBuild!: (v: PreviewScene) => void;
    const onClose = vi.fn();
    const adapter: PreviewAdapter = {
      id: "vrm",
      onClose,
      build: vi.fn(() => new Promise<PreviewScene>((res) => { resolveBuild = res; })),
    };
    const p = mount3D(adapter, "/m/a.vrm");
    // ESC 在 build await 期间触发 → closeOverlay → finishSession（第 1 次）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // build 完成 → 代际守卫命中 → fullCleanup → finishSession（第 2 次，应被幂等守卫拦截）
    resolveBuild(makeContent());
    await p;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
  });

  it("build 成功后 ESC（fullCleanup）再重复 ESC：onClose 只调一次", async () => {
    const onClose = vi.fn();
    const adapter: PreviewAdapter = { id: "vrm", onClose, build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm");
    // build 成功后 ESC → fullCleanup → finishSession（第 1 次）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // 再次 ESC：escH 已在 fullCleanup 内 removeEventListener，第二次 dispatch 无效果
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasActivePreview()).toBe(false);
  });

  it("cleanupPreview → handle.cleanup → fullCleanup → finishSession：onClose 只调一次", async () => {
    const onClose = vi.fn();
    const adapter: PreviewAdapter = { id: "vrm", onClose, build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm");
    cleanupPreview();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(() => cleanupPreview()).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// switchExternal vs switchTo 路由契约：同类型走 switchTo（会话内复用外壳），
// 跨类型走 switchExternal（关当前会话 + 开目标）。
describe("switchExternal vs switchTo 路由契约", () => {
  it("switchTo 走会话内切换（复用外壳，调 adapter.build 第二次）", async () => {
    const content1 = makeContent();
    const content2 = makeContent();
    const adapter: PreviewAdapter = {
      id: "vrm",
      build: vi.fn().mockResolvedValueOnce(content1).mockResolvedValueOnce(content2),
    };
    await mount3D(adapter, "/m/a.vrm", { rtype: "vrm" });
    // switchTo = 会话内切换：复用外壳，重建内容层
    await (h.menuOpts!.switchTo as (p: string) => Promise<void>)("/m/b.vrm");
    expect(adapter.build).toHaveBeenCalledTimes(2);
    expect((adapter.build as ReturnType<typeof vi.fn>).mock.calls[1][1]).toBe("/m/b.vrm");
    // 注册表仍为 1（旧 m1 注销、新 m2 登记——switchTo 不创建新会话）
    expect(sceneRegistry.count()).toBe(1);
    cleanupPreview();
  });

  it("switchExternal 走跨类型跳转（透传到 opts.switchExternal 回调）", async () => {
    const switchExternal = vi.fn(async () => {});
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm", { rtype: "vrm", switchExternal });
    (h.menuOpts!.switchExternal as (p: string) => void)("/m/b.mmd");
    expect(switchExternal).toHaveBeenCalledWith("/m/b.mmd", undefined, undefined);
    cleanupPreview();
  });

  it("switchExternal 缺失时菜单 ctx.switchExternal 为 undefined（不抛错）", async () => {
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm"); // 不传 switchExternal
    expect(h.menuOpts!.switchExternal).toBeUndefined();
    cleanupPreview();
  });

  it("switchTo 缺失时菜单 ctx.switchTo 仍可调（会话内切换的核心能力不可缺）", async () => {
    const adapter: PreviewAdapter = { id: "vrm", build: vi.fn(async () => makeContent()) };
    await mount3D(adapter, "/m/a.vrm");
    expect(typeof h.menuOpts!.switchTo).toBe("function");
    cleanupPreview();
  });
});

// switchToSession 并发抑制（inFlight）契约：连续点击触发重复 build 被静默丢弃
describe("switchToSession 并发抑制（inFlight）契约", () => {
  it("切换进行中再次 switchTo：第二次被静默丢弃（adapter.build 不被第三次调用）", async () => {
    let resolveBuild1!: (v: PreviewScene) => void;
    let resolveBuild2!: (v: PreviewScene) => void;
    const buildMock = vi.fn();
    buildMock
      .mockReturnValueOnce(new Promise<PreviewScene>((res) => { resolveBuild1 = res; }))
      .mockReturnValueOnce(new Promise<PreviewScene>((res) => { resolveBuild2 = res; }))
      .mockResolvedValueOnce(makeContent());
    const adapter: PreviewAdapter = { id: "vrm", build: buildMock };
    const p1 = mount3D(adapter, "/m/a.vrm");
    resolveBuild1(makeContent()); // 首次 mount 完成
    await p1;

    // 启动第一次 switchTo（卡在 adapter.build 第二次调用）
    const switchPromise1 = (h.menuOpts!.switchTo as (p: string) => Promise<void>)("/m/b.vrm");
    // 立即启动第二次 switchTo（inFlight=true，应被静默丢弃）
    const switchPromise2 = (h.menuOpts!.switchTo as (p: string) => Promise<void>)("/m/c.vrm");

    // resolve 第二次 build（第一次 switchTo 的 build）
    resolveBuild2(makeContent());
    await switchPromise1;
    await switchPromise2;

    // inFlight 守卫在 beginSwitch 就 return false，不会调 buildSwitchContent
    expect(buildMock).toHaveBeenCalledTimes(2); // 首次 mount + 第一次 switchTo
    cleanupPreview();
  });

  it("build 失败后 inFlight 复位：后续 switchTo 不被死锁", async () => {
    const buildMock = vi.fn();
    buildMock
      .mockResolvedValueOnce(makeContent()) // 首次 mount
      .mockRejectedValueOnce(new Error("switch build failed")) // 第一次 switchTo 失败
      .mockResolvedValueOnce(makeContent()); // 第二次 switchTo 成功
    const adapter: PreviewAdapter = { id: "vrm", build: buildMock };
    await mount3D(adapter, "/m/a.vrm");

    // 第一次 switchTo：build 失败 → recoverSwitchFailure 复位 inFlight
    await (h.menuOpts!.switchTo as (p: string) => Promise<void>)("/m/bad.vrm");
    // 第二次 switchTo：inFlight 已复位，应正常执行
    await (h.menuOpts!.switchTo as (p: string) => Promise<void>)("/m/good.vrm");

    expect(buildMock).toHaveBeenCalledTimes(3); // 首次 mount + 失败的 switchTo + 成功的 switchTo
    cleanupPreview();
  });
});

// ESC 关闭后再次 mount 的 canvas 重新挂载回归（用户报告：第一次进 3D 预览正常，
// 第二次进 3D 预览空白/无反应。根因：fullCleanup 移除 viewContainer（含 canvas）但
// 保留 _singletonRenderer；再次 mount3D 复用 renderer 时未把 canvas 重新挂载到新
// viewContainer —— shared-infra buildSharedInfra 已含 parentNode 校验重挂载）
describe("ESC 关闭后再次 mount（canvas 重新挂载回归）", () => {
  it("fullCleanup 后再次 mount3D：renderer canvas 被重新挂载到新 viewContainer", async () => {
    // 首次 mount：捕获 renderer.domElement（happy-dom 真实 canvas 元素）
    const first = makeAdapter();
    await mount3D(first, "/a.nbt");
    const domEl = lastBuildCtx(first.build).renderer!.domElement;
    expect(domEl).toBeDefined();
    // 首次已挂载到 viewContainer（buildSharedInfra appendChild）
    const firstParent = domEl.parentNode as HTMLElement | null;
    expect(firstParent).not.toBeNull();
    expect(firstParent!.className).toContain("preview-view-container");

    // ESC 关闭 → fullCleanup：移除 viewContainer（含 canvas），canvas 脱离文档树
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // canvas 的 parentNode 仍是已被摘除的 viewContainer 本身（非 null），
    // 判定脱离标准是 isConnected=false（真实 DOM 语义）
    expect(domEl.isConnected).toBe(false);

    // 第二次 mount（用户再次进入 3D 预览）：canvas 必须重新挂载到新 viewContainer
    // （shared-infra：domElement.parentNode !== viewContainer → appendChild 重挂）
    const second = makeAdapter();
    await mount3D(second, "/b.nbt");
    const secondDom = lastBuildCtx(second.build).renderer!.domElement;
    expect(secondDom).toBe(domEl); // 复用同一 renderer 单例（fullCleanup 保留 renderer）
    expect(domEl.isConnected).toBe(true);
    const reParent = domEl.parentNode as HTMLElement | null;
    expect(reParent).not.toBeNull();
    expect(reParent!.className).toContain("preview-view-container");
    cleanupPreview();
  });
});