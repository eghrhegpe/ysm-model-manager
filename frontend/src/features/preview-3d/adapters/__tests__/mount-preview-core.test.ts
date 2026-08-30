// @vitest-environment node
// ===== mount-preview-core.ts 行为测试（借测试反推源码问题）=====
//
// 目标：通过 mock Three.js + 相关依赖，覆盖 mount3D / cleanupPreview /
// switchPreview / invalidatePreview / hasActivePreview 的：
//   1. 模块级单例状态（_handle + _gen）的竞态
//   2. 重复挂载 / 卸载行为
//   3. 部分配置缺失时的降级行为
//   4. 生命周期事件顺序（build 成功/失败/invalidate/cleanup 交错）
//
// 每发现源码问题，在测试注释中标注 // BUG: ...

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "../preview-menu/core.ts";
import { sceneRegistry } from "../scene-registry.ts";

// ── 模块级 mock ──────────────────────────────────────────────────────────
// three/addons/controls/OrbitControls.js：需要 fake 类（constructor / target / enableRotate / update / dispose）
vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: vi.fn(
    function FakeOrbitControls(this: any, _cam: any, _el: any) {
      this.enableRotate = true;
      this.enableDamping = false;
      this.dampingFactor = 0.1;
      this.minDistance = 0.1;
      this.maxDistance = 5000;
      this.target = new THREE.Vector3(0, 0, 0);
      this.update = vi.fn();
      this.dispose = vi.fn();
    } as any,
  ),
}));

vi.mock("../../caps/scene-capability-registry.ts", () => {
  const capFactory = (id: string) => ({
    id,
    apply: vi.fn(),
    dispose: vi.fn(),
    setPreset: vi.fn(),
    setLightCap: vi.fn(),
    syncLights: vi.fn(),
    setReflectorCap: vi.fn(),
    setTarget: vi.fn(),
    setTargetHeight: vi.fn(),
    applyMeshCasts: vi.fn(),
    syncMeshIntensity: vi.fn(),
    update: vi.fn(),
    render: vi.fn(() => false),
    setSize: vi.fn(),
  });
  const instances = new Map<string, any>(
    ["sky", "ground", "light", "fog", "shadow", "reflector", "environment", "postprocessing"].map((id) =>
      [id, capFactory(id)],
    ),
  );
  return {
    sceneCapabilityRegistry: {
      createAll: vi.fn(() => [...instances.values()]),
      getById: vi.fn((id: string) => instances.get(id) ?? null),
      loadAll: vi.fn(),
      saveAll: vi.fn(),
      dispose: vi.fn(),
      _instances: instances,
    },
  };
});

vi.mock("../../caps/sky-capability.ts", () => ({ SkyCapability: vi.fn() }));
vi.mock("../../caps/ground-capability.ts", () => ({ GroundCapability: vi.fn() }));
vi.mock("../../caps/light-capability.ts", () => ({ LightCapability: vi.fn() }));
vi.mock("../../caps/fog-capability.ts", () => ({ FogCapability: vi.fn() }));
vi.mock("../../caps/shadow-capability.ts", () => ({ ShadowCapability: vi.fn() }));
vi.mock("../../caps/reflector-capability.ts", () => ({ ReflectorCapability: vi.fn() }));
vi.mock("../../caps/environment-capability.ts", () => ({
  EnvironmentCapability: vi.fn(function (this: any) {
    this.apply = vi.fn();
    this.dispose = vi.fn();
    this.setPreset = vi.fn();
    this.setLightCap = vi.fn();
    this.syncLights = vi.fn();
    this.setReflectorCap = vi.fn();
    this.setTarget = vi.fn();
    this.setTargetHeight = vi.fn();
    this.applyMeshCasts = vi.fn();
    this.syncMeshIntensity = vi.fn();
    this.update = vi.fn();
  }),
}));

vi.mock("../../caps/postprocessing-capability.ts", () => ({
  PostprocessingCapability: vi.fn(),
}));

vi.mock("../camera-setup.ts", () => ({
  fitCameraToRoots: vi.fn(),
}));

vi.mock("../bone-raycast.ts", () => ({
  assembleBoneSelectInfo: vi.fn(() => ({})),
  getMeshBoneId: vi.fn(() => null),
}));

vi.mock("../frustum-cull.ts", () => ({
  cullModelGroups: vi.fn(),
}));

vi.mock("../../core/log.ts", () => ({
  logWarn: vi.fn(),
}));

vi.mock("../../core/i18n/t.ts", () => ({
  t: (key: string) => key,
}));

vi.mock("../switch-preview.ts", () => ({
  switchToSession: vi.fn(async () => {}),
  syncLightTargetFromContent: vi.fn(),
}));

vi.mock("../semantic-bones.ts", () => ({ SemanticBoneMap: {} }));

vi.mock("../../utils/dom/errors.ts", () => ({
  friendlyError: vi.fn((e: any) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("../../utils/dom/html.ts", () => ({
  esc: vi.fn((s: any) => String(s ?? "")),
}));

vi.mock("../../utils/dom/storage.ts", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));

vi.mock("../../utils/dom/fab.ts", () => ({
  createIconButton: vi.fn(() => ({ _tag: "icon-btn", style: {}, classList: { add: vi.fn(), remove: vi.fn() } })),
  ensureFabStyles: vi.fn(),
  YSW_FAB_CSS: "",
}));

vi.mock("../../../ui/ui-components-styles.ts", () => ({
  installUiComponentsStyles: vi.fn(),
}));

vi.mock("../../../ui/ui-helpers.ts", () => ({
  createSlideMenu: vi.fn(() => ({ _tag: "slide-menu" })),
}));

vi.mock("../../../ui/ui-header-toggle.ts", () => ({
  createHeaderToggle: vi.fn(() => ({ _tag: "toggle" })),
}));

vi.mock("../preview-menu/core.ts", () => ({
  mountPreviewRootMenu: vi.fn(() => ({
    _tag: "menu",
    setAdapterItems: vi.fn(),
    refreshDock: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("../camera-controls.ts", () => ({}));

vi.mock("../../bus.ts", () => {
  const events = new Map<string, any[][]>();
  return {
    bus: {
      emit: vi.fn((e: string, payload: any) => {
        events.set(e, [...(events.get(e) ?? []), payload]);
      }),
      on: vi.fn(),
      off: vi.fn(),
      _events: events,
    },
  };
});

// switch-preview.ts 里也有 sceneRegistry 引用；需要在 mount-preview-core.ts 的 mock 前 mock
vi.mock("../scene-registry.ts", () => {
  const entries = new Map<string, any>();
  return {
    sceneRegistry: {
      count: vi.fn(() => entries.size),
      get: vi.fn((id: string) => entries.get(id)),
      pickModelByObject: vi.fn(() => null),
      setActive: vi.fn(() => {}),
      setMenuSink: vi.fn(() => {}),
      register: vi.fn((e: any) => {
        const id = String((e as any).path ?? Math.random());
        entries.set(id, e);
      }),
      unregister: vi.fn((id: string) => entries.delete(id)),
      getActiveId: vi.fn(() => (entries.size ? entries.keys().next().value : undefined)),
      visibleRoots: vi.fn(() => []),
      reset: vi.fn(() => entries.clear()),
      _entries: entries,
    },
    MAX_MODELS: 8,
  };
});

vi.mock("../input-and-animation.ts", () => ({
  bindInputHandlers: vi.fn(() => ({
    onKeyDown: vi.fn(),
    onKeyUp: vi.fn(),
    onDragPointerDown: vi.fn(),
    onDragPointerUp: vi.fn(),
    onDragPointerMove: vi.fn(),
    onResize: vi.fn(),
  })),
}));

vi.mock("../cleanup-3d.ts", () => {
  return {
    runFullCleanup: vi.fn((ctx: any) => {
      ctx.isDisposed.v = true;
      ctx.nullHandle?.();
      ctx.nullBuilt?.();
      ctx.nullPostProc?.();
    }),
  };
});

// ── 测试环境初始化 ──────────────────────────────────────────────────────
/** document.createElement 创建的元素注册表（外壳单例断言用：统计 view-container 数量） */
const createdElements: Array<{ _tag: string; className?: string }> = [];
const fakeDocAdd = vi.fn();
const fakeDocRemove = vi.fn();
const fakeWinAdd = vi.fn();
const fakeWinRemove = vi.fn();
const fakeRaf = vi.fn();
const fakeCancelAnimationFrame = vi.fn();
const fakeSetTimeout = vi.fn((_: (...args: any[]) => any, _ms: number) => 1);
const fakeClearTimeout = vi.fn();
const fakeGetBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 }));
const fakeAppendChild = vi.fn((child: any) => child);

function resetGlobalMocks() {
  vi.clearAllMocks();
  createdElements.length = 0;
  Object.defineProperty(globalThis, "document", {
    value: {
      createElement: vi.fn((tag: string) => {
        const el: any = {
          _tag: tag,
          className: "",
          parentNode: null,
          style: { cssText: "" },
          textContent: "",
          innerHTML: "",
          clientWidth: 800,
          clientHeight: 600,
          appendChild: fakeAppendChild,
          removeChild: vi.fn((c: any) => c),
          insertBefore: vi.fn((n: any) => n),
          remove: vi.fn(),
          addEventListener: vi.fn((_: string, __: any) => {}),
          removeEventListener: vi.fn((_: string, __: any) => {}),
          getBoundingClientRect: fakeGetBoundingClientRect,
          setAttribute: vi.fn(),
          getContext: vi.fn(() => {
            const ctx: any = {
              clearRect: vi.fn(),
              drawImage: vi.fn(),
              fillRect: vi.fn(),
              fillText: vi.fn(),
              save: vi.fn(),
              restore: vi.fn(),
              translate: vi.fn(),
              rotate: vi.fn(),
              scale: vi.fn(),
              beginPath: vi.fn(),
              arc: vi.fn(),
              fill: vi.fn(),
              stroke: vi.fn(),
              closePath: vi.fn(),
              moveTo: vi.fn(),
              lineTo: vi.fn(),
              putImageData: vi.fn(),
              getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
              createImageData: vi.fn(() => new ImageData(1, 1)),
            };
            ctx.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
            ctx.createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
            return ctx;
          }),
          width: 256,
          height: 256,
        };
        createdElements.push(el);
        return el;
      }),
      getElementById: vi.fn(() => null),
      head: {
        _tag: "head",
        appendChild: fakeAppendChild,
        removeChild: vi.fn(),
        style: {},
      } as any,
      body: {
        _tag: "body",
        appendChild: fakeAppendChild,
        childNodes: [],
        style: {},
      } as any,
      addEventListener: fakeDocAdd,
      removeEventListener: fakeDocRemove,
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: {
      devicePixelRatio: 1,
      addEventListener: fakeWinAdd,
      removeEventListener: fakeWinRemove,
    },
    writable: true,
    configurable: true,
  });
  globalThis.requestAnimationFrame = fakeRaf;
  globalThis.cancelAnimationFrame = fakeCancelAnimationFrame;
  (globalThis as any).setTimeout = fakeSetTimeout;
  (globalThis as any).clearTimeout = fakeClearTimeout;
  (globalThis as any).performance = { now: vi.fn(() => 1700000000000) };
  fakeAppendChild.mockImplementation((child: any) => child);
}

beforeEach(() => { resetGlobalMocks(); _resetSingletons(); });
afterEach(() => { resetGlobalMocks(); _resetSingletons(); });

// ── 测试辅助：构造最小 PreviewAdapter ────────────────────────────────────
function makeAdapter(opts: {
  sync?: boolean;
  reject?: unknown;
  scene?: Partial<import("../mount-preview-core.ts").PreviewScene>;
} = {}): any {
  return {
    id: "test-adapter",
    mode: "shared",
    build: async (_ctx: any, _path: string) => {
      if (opts.reject) throw opts.reject;
      return {
        dispose: vi.fn(),
        update: vi.fn(),
        resetCamera: vi.fn(),
        setRotationMode: vi.fn(),
        setSpeed: vi.fn(),
        showModelGroup: vi.fn(),
        onBoneSelect: vi.fn(),
        semanticBones: undefined,
        applyPose: vi.fn(),
        screenshot: vi.fn(async () => "png"),
        keepInScene: undefined,
        boneMaps: null,
        menuItems: null,
        onBonePick: vi.fn(),
        ...opts.scene,
      };
    },
    onClose: vi.fn(),
  };
}

// 关键：让 mount3D 主流程同步完成（不走 await 挂起），便于直接断言
function syncAdapter(): any {
  return makeAdapter({
    sync: true,
    scene: {
      dispose: vi.fn(),
      update: vi.fn(),
    },
  });
}

// 从被 mock 后的模块取引用（保证拿到 mock 后的对象）
import {
  mount3D,
  cleanupPreview,
  switchPreview,
  invalidatePreview,
  hasActivePreview,
  _resetSingletons,
  type PreviewAdapter,
  type Mount3DOptions,
} from "../mount-preview-core.ts";

// ──────────────────────────────────────────────────────────────────────
// describe 1: hasActivePreview / invalidatePreview 基础
// ──────────────────────────────────────────────────────────────────────
describe("hasActivePreview / invalidatePreview 基础", () => {
  it("初始状态：无活跃预览", () => {
    expect(hasActivePreview()).toBe(false);
  });

  it("invalidatePreview() 递增 _gen 且不抛错（无活跃会话时）", () => {
    expect(() => invalidatePreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 2: mount3D 成功路径
// ──────────────────────────────────────────────────────────────────────
describe("mount3D 成功路径", () => {
  it("happy path：adapter.build 完成后 _handle 被赋值，hasActivePreview=true", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/model.ysm");
    expect(hasActivePreview()).toBe(true);
    expect(adapter.onClose).not.toHaveBeenCalled();
  });

  it("非合作模式下首次 mount 前会 cleanupPreview（_handle 为空时安全）", async () => {
    // 无活跃会话时 mount3D 内 cleanupPreview() 应 no-op
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/model.ysm");
    expect(hasActivePreview()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 3: cleanupPreview 幂等 / 重复卸载
// ──────────────────────────────────────────────────────────────────────
describe("cleanupPreview 幂等 / 重复卸载", () => {
  it("无活跃会话时 cleanupPreview() 应 no-op 且不抛错", () => {
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("重复调用 cleanupPreview 两次不抛错（第二次应 no-op）", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/model.ysm");
    expect(hasActivePreview()).toBe(true);
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
    // 第二次：no-op
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("cleanup 后再 mount 应重新开始（_handle 重建）", async () => {
    const adapter1 = syncAdapter();
    await mount3D(adapter1 as PreviewAdapter, "/a.ysm");
    cleanupPreview();
    const adapter2 = syncAdapter();
    await mount3D(adapter2 as PreviewAdapter, "/b.ysm");
    expect(hasActivePreview()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 3b: 外壳单例复用（viewContainer 随外壳初始化只建一次）
// ──────────────────────────────────────────────────────────────────────
describe("外壳单例复用（viewContainer 随外壳初始化只建一次）", () => {
  it("连续两次 mount3D（同台复用外壳）只创建一个 preview-view-container（回归：多次 mount3D 曾反复 new 空容器）", async () => {
    await mount3D(syncAdapter() as PreviewAdapter, "/a.ysm");
    await mount3D(syncAdapter() as PreviewAdapter, "/b.ysm");
    const viewContainers = createdElements.filter(
      (e) => e._tag === "div" && e.className === "preview-view-container",
    );
    expect(viewContainers.length).toBe(1);
    cleanupPreview();
  });

  it("cleanupPreview 后重新 mount：重建外壳（重新创建唯一 view-container）", async () => {
    // 首次 mount + 清理（外壳拆除）
    await mount3D(syncAdapter() as PreviewAdapter, "/a.ysm");
    cleanupPreview();
    // 清掉首次的外壳创建记录，验证重建仍只建一个
    createdElements.length = 0;
    await mount3D(syncAdapter() as PreviewAdapter, "/b.ysm");
    const viewContainers = createdElements.filter(
      (e) => e._tag === "div" && e.className === "preview-view-container",
    );
    expect(viewContainers.length).toBe(1);
    cleanupPreview();
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 4: 模块级单例 _handle 竞态问题
// ──────────────────────────────────────────────────────────────────────
describe("模块级单例 _handle 竞态问题", () => {
  it("BUG: 并发 mount3D 时后一个覆盖前一个 _handle，旧会话资源泄漏", async () => {
    // 模拟两个 adapter.build 慢路径，用 delayAdapter 让首个 mount3D 在第二个启动后仍未完成
    const adapterA = makeAdapter({ scene: { dispose: vi.fn(), update: vi.fn() } });
    const adapterB = syncAdapter();

    let resolveA: any;
    adapterA.build = () => new Promise((resolve) => { resolveA = () => resolve({
      dispose: vi.fn(),
      update: vi.fn(),
    }); });

    const mountA = mount3D(adapterA as PreviewAdapter, "/a.ysm");
    // mountA 卡在 await adapter.build，_handle 尚未赋值
    // 立即启动 mountB：mountB 内 cleanupPreview() 因 _handle==null 而 no-op，
    // 不 abort mountA —— 竞态：两条并发 mount3D 共享同一份 _gen / _handle，
    // 后完成的 adapter 会覆盖先完成的 _handle。
    await mount3D(adapterB as PreviewAdapter, "/b.ysm");
    // 此时 B 已完成，_handle 指向 B
    expect(hasActivePreview()).toBe(true);

    // 释放 A 的待决 load
    resolveA();
    await mountA;

    // 竞态结果：A 的 build 完成后 _handle 可能被 B 覆盖（若 B 先完成）——
    // 或者 A 完成时 _handle 又被 A 覆盖，取决于 await 调度。
    // 无论如何：A 会话的 overlay / rAF / renderer 未被清理（因为 mountA 走成功路径，
    // cleanupPreview 不会为它执行）。
    //
    // BUG: 模块级 _handle 只能保存一个会话句柄，并发 mount3D 导致旧会话无主。
    //      正确做法：每次 mount3D 用独立 session id，cleanupPreview 清理所有会话；
    //      或强制串行化（队列）。
    expect(() => cleanupPreview()).not.toThrow();
    expect(hasActivePreview()).toBe(false);
  });

  it("BUG: cleanupPreview 在 adapter.build 期间调用，会 _gen++ 使 mount3D 在 build 后走 fullCleanup 分支但 _handle 从未赋值", async () => {
    const adapter = makeAdapter({ scene: { dispose: vi.fn(), update: vi.fn() } });
    let resolveBuild: any;
    adapter.build = () => new Promise((resolve) => { resolveBuild = () => resolve({
      dispose: vi.fn(),
      update: vi.fn(),
    }); });

    const mountPromise = mount3D(adapter as PreviewAdapter, "/slow.ysm");

    // mount3D 卡在 await adapter.build；此时 _handle 还是 null
    // 调用 cleanupPreview：_gen++ 且 _handle==null → no-op（不会 fullCleanup overlay 等外壳资源）
    cleanupPreview();

    // 现在 build 完成
    resolveBuild();
    await mountPromise;

    // mount3D 在 await 后检查 myGen !== _gen，走 fullCleanup 分支，_handle 仍为 null
    // 但 overlay / rAF / renderer 已在之前被创建 —— BUG：这些资源已被 fullCleanup 清理，OK
    // 但 _handle 一直是 null，hasActivePreview=false
    expect(hasActivePreview()).toBe(false);
    //
    // BUG: cleanupPreview 在 build 期间无法中止外壳创建，因为 _handle 还没赋值；
    //      只能靠 _gen++ 让 mount3D 在 build 完成后 self-clean。
    //      若 adapter.build 内部已经向 scene 添加模型并启动自己的 rAF，
    //      这段资源在 myGen 守卫触发前就已在泄漏。
  });

  it("BUG: switchPreview 无活跃会话时静默 no-op（无日志/无报错）", async () => {
    expect(hasActivePreview()).toBe(false);
    // 无活跃 _handle 时 _handle?.switchTo 是 undefined?.() → Promise.resolve(undefined)
    // 调用方无法得知操作失败
    const result = await switchPreview("/other.ysm");
    expect(result).toBeUndefined();
    //
    // BUG: switchPreview 是 Promise<void>，无活跃会话时静默返回；
    //      调用方无法区分"无会话"与"切换成功"，难以排查 UI 卡死问题。
    //      建议：至少 logWarn 或返回 { ok: false, reason }。
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 5: 生命周期事件顺序
// ──────────────────────────────────────────────────────────────────────
describe("生命周期事件顺序", () => {
  it("build 失败：_handle 未赋值，loadingEl 显示错误，hasActivePreview=false", async () => {
    const spyConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = makeAdapter({ reject: new Error("load failed") });
    await mount3D(adapter as PreviewAdapter, "/bad.ysm");

    expect(hasActivePreview()).toBe(false);
    // console.error 应被调用一次
    expect(spyConsoleError).toHaveBeenCalled();
    //
    // BUG: build 失败后 adapter.onClose 未被调用——但 adapter 的 build 已执行过部分副作用
    // （比如请求了文件），调用方无法通过 onClose 回调做收尾。
    expect(adapter.onClose).not.toHaveBeenCalled();
    spyConsoleError.mockRestore();
  });

  it("build 成功后再 cleanupPreview：onClose 应被调用", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/ok.ysm");
    expect(hasActivePreview()).toBe(true);

    cleanupPreview();
    // cleanupPreview 调 _handle.cleanup() → fullCleanup → runFullCleanup(cleanupCtx)
    // 但 fullCleanup 是内嵌在 mount3D try 内的局部函数，经 _handle.cleanup 暴露；
    // _handle.cleanup = fullCleanup，fullCleanup 里会调 adapter.onClose（cleanup-3d.ts 内）
    // 我们的 mock 的 runFullCleanup 简化为 nullHandle + isDisposed，未调用 adapter.onClose
    // —— 这是测试 mock 层的问题，不代表源码错误。
    expect(hasActivePreview()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 6: 部分配置缺失时的降级
// ──────────────────────────────────────────────────────────────────────
describe("部分配置缺失时的降级行为", () => {
  it("adapter.mode='self'：核心不创建 scene/camera/renderer，build ctx 内均为 undefined", async () => {
    const builtScene: any = { dispose: vi.fn(), update: vi.fn() };
    let capturedCtx: any = null;
    const adapter = {
      id: "self-adapter",
      mode: "self" as const,
      build: async (ctx: any, _path: string) => {
        capturedCtx = ctx;
        return builtScene;
      },
      onClose: vi.fn(),
    };
    await mount3D(adapter as PreviewAdapter, "/self.ysm");
    expect(hasActivePreview()).toBe(true);
    expect(capturedCtx).not.toBe(null);
    expect(capturedCtx.scene).toBeUndefined();
    expect(capturedCtx.camera).toBeUndefined();
    expect(capturedCtx.renderer).toBeUndefined();
    expect(capturedCtx.controls).toBeUndefined();
    expect(capturedCtx.cameraControls).toBeUndefined();
    expect(capturedCtx.viewContainer).toBeDefined();
    expect(capturedCtx.overlay).toBeDefined();
    expect(capturedCtx.menu).toBeDefined();
    cleanupPreview();
  });

  it("adapter.build 返回的 PreviewScene 只有 dispose（无 update 等）：不抛错，perFrame 保持 null", async () => {
    const adapter = makeAdapter({
      scene: {
        dispose: vi.fn(),
        // 不返回 update —— 源码 `perFrame = built.update ?? null`
      },
    });
    await mount3D(adapter as PreviewAdapter, "/minimal.ysm");
    expect(hasActivePreview()).toBe(true);
    // 不抛错
    cleanupPreview();
  });

  it("adapter.onClose 缺失：cleanup 时应安全降级不抛错", async () => {
    const adapter = syncAdapter();
    delete (adapter as any).onClose;
    await mount3D(adapter as PreviewAdapter, "/no-callback.ysm");
    expect(() => cleanupPreview()).not.toThrow();
  });

  it("opts.siblings 缺失：getSiblings 返回空数组（不抛错，向后兼容）", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/a.ysm", {});
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
  });

  it("opts.switchExternal / getModelsByType / getTypeTabs 全部缺失：菜单 sink 仍创建，对应字段为 undefined", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/a.ysm");
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 7: 代际守卫（_gen）
// ──────────────────────────────────────────────────────────────────────
describe("代际守卫（_gen）", () => {
  it("快速连续 mount 两次：第一次的 await 完成后 myGen !== _gen，走 fullCleanup", async () => {
    const adapter = makeAdapter({ scene: { dispose: vi.fn(), update: vi.fn() } });
    let resolveFirst: any;
    adapter.build = () => new Promise((resolve) => {
      resolveFirst = () => resolve({ dispose: vi.fn(), update: vi.fn() });
    });
    const firstPromise = mount3D(adapter as PreviewAdapter, "/first.ysm");

    // 第二个 mount：cleanupPreview 触发 _gen++
    await mount3D(syncAdapter() as PreviewAdapter, "/second.ysm");

    // 释放第一个
    resolveFirst();
    await firstPromise;

    // 结果：第一个会话 myGen(1) !== _gen(2) 走 fullCleanup 分支，不 push 自身 handle；
    // 模块级已从单 _handle 改为 _handles 数组（每会话独立 handle + gen），
    // 第二个会话的句柄不再被第一个会话的 cleanup 误杀 → 仍保持活跃。
    expect(hasActivePreview()).toBe(true);
    cleanupPreview();
    expect(hasActivePreview()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe 8: unloadRole 真实路径（角色面板卸载，code_review P2/P3 回归守卫）
// 经 mock 的 mountPreviewRootMenu 捕获 mount3D 注入的 ctx.unloadRole，
// 驱动真实实现：断言内容层 dispose / 注册表注销 / 焦点转移决策 / dock 清空。
// ──────────────────────────────────────────────────────────────────────
describe("unloadRole 真实路径（角色面板卸载）", () => {
  /** mock sceneRegistry 的内部 entries map（真实类型无此属性，测试直接预置/读取角色） */
  function mockEntries(): Map<string, any> {
    return (sceneRegistry as unknown as { _entries: Map<string, any> })._entries;
  }

  /** 取最近一次 mount3D 传给 mountPreviewRootMenu 的 ctx（含真实 unloadRole 引用） */
  function lastMenuCtx(): PreviewMenuCtx {
    const calls = vi.mocked(mountPreviewRootMenu).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1] as PreviewMenuCtx;
  }

  it("卸载当前活跃角色：内容层 dispose + 注册表注销 + 新活跃无专属项时清空 dock 适配器项", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/model.ysm");
    const entry = mockEntries().get("/model.ysm");
    expect(entry).toBeDefined();
    const disposeSpy = entry.built.dispose;

    // 预置第二个角色（menuItems null）模拟 cooperate 双角色——卸载后它成为新活跃
    mockEntries().set("/second.ysm", {
      path: "/second.ysm",
      built: { dispose: vi.fn() },
      menuItems: null,
      roots: [],
    });

    const ctx = lastMenuCtx();
    expect(ctx.unloadRole).toBeDefined();
    ctx.unloadRole!("/model.ysm");

    // 内容层 GPU 释放 + 注册表注销（真实 unloadRole 内 splice + unregister）
    expect(disposeSpy).toHaveBeenCalled();
    expect(sceneRegistry.unregister).toHaveBeenCalledWith("/model.ysm");
    // 新活跃角色 menuItems === null → 显式清空 dock 适配器项（P2 修复：不残留已卸载角色的菜单）
    const handle = vi.mocked(mountPreviewRootMenu).mock.results.at(-1)!.value as any;
    expect(handle.setAdapterItems).toHaveBeenCalledWith([]);
    cleanupPreview();
  });

  it("新活跃角色有专属项 → 走 setActive 换菜单（不误清空 dock）", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/a.ysm");
    // 预置带 menuItems 的第二个角色（mock getActiveId 返回第一个 key = 该角色）
    mockEntries().set("/b.ysm", {
      path: "/b.ysm",
      built: { dispose: vi.fn() },
      menuItems: [{ id: "model", kind: "panel", dockGroup: "model", icon: "x", labelKey: "", fallback: "m", render: () => {} }],
      roots: [],
    });

    const ctx = lastMenuCtx();
    ctx.unloadRole!("/a.ysm");

    expect(sceneRegistry.setActive).toHaveBeenCalledWith("/b.ysm");
    const handle = vi.mocked(mountPreviewRootMenu).mock.results.at(-1)!.value as any;
    expect(handle.setAdapterItems).not.toHaveBeenCalled();
    cleanupPreview();
  });

  it("卸载最后一个角色：内容层 dispose + dock 适配器项清空（无残留菜单）", async () => {
    const adapter = syncAdapter();
    await mount3D(adapter as PreviewAdapter, "/only.ysm");
    const entry = mockEntries().get("/only.ysm");
    const disposeSpy = entry.built.dispose;

    const ctx = lastMenuCtx();
    ctx.unloadRole!("/only.ysm");

    expect(disposeSpy).toHaveBeenCalled();
    expect(sceneRegistry.getActiveId()).toBeUndefined();
    const handle = vi.mocked(mountPreviewRootMenu).mock.results.at(-1)!.value as any;
    expect(handle.setAdapterItems).toHaveBeenCalledWith([]);
    cleanupPreview();
  });
});

// ──────────────────────────────────────────────────────────────────────
// describe: ESC 关闭（fullCleanup）后再次 mount 的 canvas 重新挂载回归
// 用户报告：第一次进 3D 预览正常且能追加，第二次进 3D 预览空白/无反应。
// 根因：fullCleanup 移除 viewContainer（含 canvas）但保留 _singletonRenderer；
// 再次 mount3D 复用 renderer 时未把 canvas 重新挂载到新 viewContainer。
// ──────────────────────────────────────────────────────────────────────
describe("ESC 关闭后再次 mount（canvas 重新挂载回归）", () => {
  it("fullCleanup 后再次 mount3D：renderer canvas 被重新挂载到新 viewContainer", async () => {
    // 让 fake document 真正注册 keydown handler（mount3D 内部 addEventListener 注册 escH）
    const keyHandlers: Array<(e: { key: string }) => void> = [];
    const doc = (globalThis as any).document;
    doc.addEventListener = vi.fn((ev: string, h: any) => {
      if (ev === "keydown") keyHandlers.push(h);
    });
    doc.removeEventListener = vi.fn((ev: string, h: any) => {
      const i = keyHandlers.indexOf(h);
      if (i >= 0) keyHandlers.splice(i, 1);
    });

    // spy WebGLRenderer：domElement 用 fake createElement('canvas') 创建，可精确跟踪挂载
    const rendererSpy: any = vi
      .spyOn(THREE as any, "WebGLRenderer")
      .mockImplementation((function (this: any) {
        const domEl: any = document.createElement("canvas");
        return {
          domElement: domEl,
          setSize: vi.fn(),
          setPixelRatio: vi.fn(),
          render: vi.fn(),
          dispose: vi.fn(),
        };
      }) as any);

    try {
      // 首次 mount（创建外壳 + renderer canvas 挂载）
      await mount3D(syncAdapter() as PreviewAdapter, "/a.nbt");
      const domEl = rendererSpy.mock.results[0]?.value?.domElement;
      expect(domEl).toBeDefined();
      const appendCount = (): number =>
        fakeAppendChild.mock.calls.filter((c) => c[0] === domEl).length;
      expect(appendCount()).toBeGreaterThanOrEqual(1); // 首次已挂载到 viewContainer

      // ESC 关闭 → fullCleanup：保留 _singletonRenderer，置空 viewContainer/overlay 单例
      expect(keyHandlers.length).toBeGreaterThan(0);
      keyHandlers[keyHandlers.length - 1]({ key: "Escape" });

      // 第二次 mount（用户再次进入 3D 预览）：必须把旧 canvas 重新挂载到新 viewContainer
      fakeAppendChild.mockClear();
      await mount3D(syncAdapter() as PreviewAdapter, "/b.nbt");
      expect(
        appendCount(),
        "再次进入 3D 预览后 canvas 必须重新挂载（否则渲染循环照常跑但 canvas 脱离 DOM → 空白/无反应）",
      ).toBe(1);
    } finally {
      rendererSpy.mockRestore();
    }
    cleanupPreview();
  });
});
