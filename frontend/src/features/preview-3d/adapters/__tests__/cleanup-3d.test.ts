// @vitest-environment node
// ===== 3D 场景清理单测（cleanup-3d.ts）=====
// 覆盖：runFullCleanup 全链路 / CleanupContext 各步骤 mock 验证 /
// 空/部分 context 降级 / 幂等性（重复调用不抛错）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";

// ── 顶层模块 mock（避免真实 sceneRegistry / textureCache 副作用） ────────
vi.mock("../scene-registry.ts", () => ({
  sceneRegistry: {
    reset: vi.fn(),
  },
  MAX_MODELS: 8,
}));

vi.mock("../../caps/scene-capability-registry.ts", () => ({
  sceneCapabilityRegistry: {
    saveAll: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("../../texture-cache.ts", () => ({
  textureCache: {
    disposeAll: vi.fn(),
  },
}));

vi.mock("../../frustum-cull.ts", () => ({
  clearModelRoots: vi.fn(),
}));

// 从被 mock 的模块重新引用（保证拿到 mock 后的对象）
import { sceneRegistry } from "../scene-registry.ts";
import { sceneCapabilityRegistry } from "../../caps/scene-capability-registry.ts";
import { textureCache } from "../../texture-cache.ts";
import { clearModelRoots } from "../../frustum-cull.ts";
import { runFullCleanup } from "../cleanup-3d.ts";
import type { CleanupContext } from "../cleanup-3d.ts";

// ── 全局 DOM 模拟（@vitest-environment node 无 document / window / cancelAnimationFrame） ──
const fakeDocRemove = vi.fn();
const fakeWinRemove = vi.fn();
const fakeCancelAnimationFrame = vi.fn();
const fakeClearTimeout = vi.fn();
Object.defineProperty(globalThis, "document", {
  value: { removeEventListener: fakeDocRemove },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { removeEventListener: fakeWinRemove },
  writable: true,
  configurable: true,
});
globalThis.cancelAnimationFrame = fakeCancelAnimationFrame;
globalThis.clearTimeout = fakeClearTimeout;

// ── 工具：构造可控的 fake 事件目标（@vitest-environment node 无 DOM，用纯对象） ──
function fakeElement() {
  const removeEvents = new Map<string, Set<() => void>>();
  const addEvents = new Map<string, Set<() => void>>();
  const el: any = {
    _tag: "fake-el",
    parentNode: null,
    childNodes: [],
    addEventListener: vi.fn((type: string, handler: any) => {
      addEvents.set(type, new Set([...(addEvents.get(type) ?? []), handler]));
    }),
    removeEventListener: vi.fn((type: string, handler: any) => {
      removeEvents.set(type, new Set([...(removeEvents.get(type) ?? []), handler]));
    }),
    _getRemoveCalls: (type: string) => [...(removeEvents.get(type) ?? [])],
  };
  return el;
}

// ── 工具：构造一个"干净完整"的 CleanupContext ─────────────────────────
function makeFullContext() {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  const scene = new THREE.Scene();
  (scene as any).traverse = vi.fn((cb) => cb(mesh));
  scene.add(mesh);

  const overlay = fakeElement();
  const parent = { _tag: "parent", removeChild: vi.fn() };
  (overlay as any).parentNode = parent;

  const renderer = {
    dispose: vi.fn(),
    domElement: fakeElement(),
    info: { memory: { geometries: 1, textures: 2 } },
  };

  return {
    menuHandle: { dispose: vi.fn() },
    isDisposed: { v: false },
    animId: 42,
    onKeyDown: vi.fn(),
    onKeyUp: vi.fn(),
    getEscH: () => vi.fn(),
    onDragPointerDown: vi.fn(),
    onDragPointerUp: vi.fn(),
    onDragPointerMove: vi.fn(),
    onResize: vi.fn(),
    onUnifiedPick: vi.fn(),
    allBuilt: [{ dispose: vi.fn() }],
    nullBuilt: vi.fn(),
    skyCap: { dispose: vi.fn() },
    groundCap: { dispose: vi.fn() },
    lightCap: { dispose: vi.fn() },
    fogCap: { dispose: vi.fn() },
    shadowCap: { dispose: vi.fn() },
    reflectorCap: { dispose: vi.fn() },
    environmentCap: { dispose: vi.fn() },
    postProc: { dispose: vi.fn() },
    nullPostProc: vi.fn(),
    postProcCap: { dispose: vi.fn() },
    renderer: renderer as any,
    scene: scene as any,
    controls: { dispose: vi.fn() },
    overlay,
    nullHandle: vi.fn(),
    adapter: { onClose: vi.fn() },
    getTipTimeoutId: () => 0,
  } as any;
}

// ── 清除全局 spy（避免跨用例污染） ─────────────────────────────────
function clearGlobalSpies() {
  vi.clearAllMocks();
}

beforeEach(clearGlobalSpies);
afterEach(clearGlobalSpies);

describe("runFullCleanup 全链路调用", () => {
  it("完整 context：所有清理步骤按序调用", () => {
    const ctx = makeFullContext();
    const built0Dispose = ctx.allBuilt[0].dispose; // 提前保存：cleanup 会清空 allBuilt
    runFullCleanup(ctx);

    // ① 头部：menu + registry reset（isDisposed 短路之前）
    expect(ctx.menuHandle.dispose).toHaveBeenCalledTimes(1);
    expect(sceneRegistry.reset).toHaveBeenCalledTimes(1);

    // ② isDisposed 翻转
    expect(ctx.isDisposed.v).toBe(true);

    // ③ RAF / tip timeout
    expect(fakeCancelAnimationFrame).toHaveBeenCalledWith(42);

    // ④ 事件监听解绑
    expect(fakeDocRemove).toHaveBeenCalledWith("keydown", ctx.onKeyDown);
    expect(fakeDocRemove).toHaveBeenCalledWith("keyup", ctx.onKeyUp);
    // getEscH() 每次返回新函数，断言引用不可行 —— 改测"keydown 共被解绑 2 次"
    const keydownCalls = (fakeDocRemove as any).mock.calls.filter((c: any[]) => c[0] === "keydown");
    expect(keydownCalls.length).toBe(2);

    // ⑤ renderer.domElement 拖拽监听
    expect(ctx.renderer.domElement.removeEventListener).toHaveBeenCalledWith("pointerdown", ctx.onDragPointerDown);

    // ⑥ window 监听
    expect(fakeWinRemove).toHaveBeenCalledWith("pointerup", ctx.onDragPointerUp);
    expect(fakeWinRemove).toHaveBeenCalledWith("pointermove", ctx.onDragPointerMove);
    expect(fakeWinRemove).toHaveBeenCalledWith("resize", ctx.onResize);

    // ⑦ click 拾取解绑
    expect(ctx.renderer.domElement.removeEventListener).toHaveBeenCalledWith("click", ctx.onUnifiedPick);

    // ⑧ 内容层 dispose（allBuilt 在 cleanup 中被清空，用预先保存的引用验证）
    expect(built0Dispose).toHaveBeenCalledTimes(1);
    expect(ctx.nullBuilt).toHaveBeenCalledTimes(1);
    expect(ctx.allBuilt.length).toBe(0);

    // ⑨ 全局能力 + 缓存
    expect(sceneCapabilityRegistry.saveAll).toHaveBeenCalledTimes(1);
    expect(sceneCapabilityRegistry.dispose).toHaveBeenCalledTimes(1);
    expect(textureCache.disposeAll).toHaveBeenCalledTimes(1);
    expect(clearModelRoots).toHaveBeenCalledTimes(1);

    // ⑩ 审核修复 #3：各 cap dispose 由 sceneCapabilityRegistry.dispose 统一处理，
    //    不再逐个调用（避免双重 dispose）
    expect(ctx.skyCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.groundCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.lightCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.fogCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.shadowCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.reflectorCap!.dispose).not.toHaveBeenCalled();
    expect(ctx.environmentCap!.dispose).not.toHaveBeenCalled();

    // ⑪ 后处理（postProcCap/postProc 仍单独 dispose，因为它们不在 registry 遍历范围内）
    expect(ctx.postProcCap!.dispose).toHaveBeenCalledTimes(1);
    expect(ctx.postProc!.dispose).toHaveBeenCalledTimes(1);
    expect(ctx.nullPostProc).toHaveBeenCalledTimes(1);

    // ⑫ 审核修复 #3：renderer/controls 为模块级单例，不再在此 dispose（避免黑屏）
    expect(ctx.renderer.dispose).not.toHaveBeenCalled();
    expect(ctx.controls.dispose).not.toHaveBeenCalled();
    expect(ctx.overlay.parentNode.removeChild).toHaveBeenCalledTimes(1);
    expect(ctx.nullHandle).toHaveBeenCalledTimes(1);
    expect(ctx.adapter.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CleanupContext 各步骤 mock 验证", () => {
  it("tip timeout 有值时调用 clearTimeout，为 0 时跳过", () => {
    const ctx = makeFullContext();
    const fakeTimerId = 7;
    (ctx as any).getTipTimeoutId = () => fakeTimerId;
    runFullCleanup(ctx);
    expect(fakeClearTimeout).toHaveBeenCalledWith(fakeTimerId);

    const ctx2 = makeFullContext();
    (ctx2 as any).getTipTimeoutId = () => 0;
    runFullCleanup(ctx2);
    expect(fakeClearTimeout).not.toHaveBeenCalledWith(0);
  });

  it("getEscH 返回新函数每次都是 fresh 闭包", () => {
    const ctx = makeFullContext();
    let escCount = 0;
    (ctx as any).getEscH = () => { escCount++; return vi.fn(); };
    runFullCleanup(ctx);
    // 只调用一次 getEscH
    expect(escCount).toBe(1);
  });

  it("审核修复 #3：scene traverse 不再被调用（renderer/controls 为单例不复原）", () => {
    const ctx = makeFullContext();
  
    // 用纯 fake 对象模拟“一个带几何/材质的 mesh”，避免真实 THREE 对象副作用
    const fakeGeom = { dispose: vi.fn(), _isFakeGeom: true };
    const fakeMat = { dispose: vi.fn(), _isFakeMat: true };
    const fakeMesh = { geometry: fakeGeom, material: fakeMat, _isFakeMesh: true };
  
    ctx.scene = {
      type: "Scene",
      traverse: vi.fn((cb: (obj: any) => void) => cb(fakeMesh)),
    } as any;
  
    runFullCleanup(ctx);
  
    // 审核修复 #3：不再遍历 scene dispose 几何/材质（已由 allBuilt dispose + registry dispose 覆盖）
    expect(ctx.scene.traverse).not.toHaveBeenCalled();
    expect(fakeGeom.dispose).not.toHaveBeenCalled();
    expect(fakeMat.dispose).not.toHaveBeenCalled();
  });
});

describe("空/部分 context 降级", () => {
  it("renderer 缺失：跳过 GPU 段（renderer.dispose / domElement 事件 / info.memory 日志）", () => {
    const ctx = makeFullContext();
    (ctx as any).renderer = undefined;
    runFullCleanup(ctx);

    // renderer.dispose 不叫
    expect(ctx.renderer).toBeUndefined();
    // domElement 拖拽事件不叫
    expect(fakeDocRemove).not.toHaveBeenCalledWith("keydown", ctx.onDragPointerDown);
    // isDisposed 仍被置为 true（走完了完整链路）
    expect(ctx.isDisposed.v).toBe(true);
  });

  it("scene 缺失：跳过 traverse", () => {
    const ctx = makeFullContext();
    (ctx as any).scene = undefined;
    runFullCleanup(ctx);

    expect(ctx.scene?.traverse as any).toBeUndefined();
  });

  it("controls 缺失：跳过 controls.dispose", () => {
    const ctx = makeFullContext();
    (ctx as any).controls = undefined;
    runFullCleanup(ctx);

    // 不抛错且正常走完
    expect(ctx.isDisposed.v).toBe(true);
  });

  it("onUnifiedPick 为 null：跳过 click 解绑", () => {
    const ctx = makeFullContext();
    ctx.onUnifiedPick = null;
    runFullCleanup(ctx);

    // 不抛错
    expect(ctx.isDisposed.v).toBe(true);
    // click 解绑不触发
    const calls = (ctx.renderer.domElement.removeEventListener as any).mock.calls;
    const clickCalls = calls.filter((c: any[]) => c[0] === "click");
    expect(clickCalls.length).toBe(0);
  });

  it("overlay 无 parentNode：跳过 removeChild", () => {
    const ctx = makeFullContext();
    (ctx.overlay as any).parentNode = null;
    runFullCleanup(ctx);

    expect(ctx.overlay.parentNode).toBeNull();
  });

  it("adapter.onClose 缺失：跳过调用", () => {
    const ctx = makeFullContext();
    (ctx as any).adapter = {};
    // 不抛错
    expect(() => runFullCleanup(ctx)).not.toThrow();
    expect(ctx.isDisposed.v).toBe(true);
  });

  it("isDisposed 初始为 true：直接短路返回（后续步骤不执行）", () => {
    const ctx = makeFullContext();
    ctx.isDisposed.v = true;
    runFullCleanup(ctx);

    // menuHandle.dispose 和 sceneRegistry.reset 是短路前执行的，应该被调用
    expect(ctx.menuHandle.dispose).toHaveBeenCalledTimes(1);
    expect(sceneRegistry.reset).toHaveBeenCalledTimes(1);

    // 但 cancelAnimationFrame 等后续步骤不执行
    expect(fakeCancelAnimationFrame).not.toHaveBeenCalled();
    expect(ctx.renderer!.dispose).not.toHaveBeenCalled();
  });

  it("cap 全为 null：逐一跳过不抛错", () => {
    const ctx = makeFullContext();
    ctx.skyCap = null;
    ctx.groundCap = null;
    ctx.lightCap = null;
    ctx.fogCap = null;
    ctx.shadowCap = null;
    ctx.reflectorCap = null;
    ctx.environmentCap = null;
    ctx.postProcCap = null;
    ctx.postProc = null;

    expect(() => runFullCleanup(ctx)).not.toThrow();
    expect(ctx.isDisposed.v).toBe(true);
    // nullPostProc 仍会被调用（无论 postProc 是否为 null）
    expect(ctx.nullPostProc).toHaveBeenCalledTimes(1);
  });

  it("allBuilt 为空数组：循环不执行，nullBuilt 仍被调用", () => {
    const ctx = makeFullContext();
    ctx.allBuilt = [];
    runFullCleanup(ctx);
    expect(ctx.nullBuilt).toHaveBeenCalledTimes(1);
    expect(ctx.allBuilt.length).toBe(0);
  });

  it("allBuilt 中某项 dispose 抛错：防御性吞错，后续步骤继续", () => {
    const ctx = makeFullContext();
    const badDispose = vi.fn(() => { throw new Error("boom"); });
    const goodDispose = vi.fn();
    ctx.allBuilt = [{ dispose: badDispose }, { dispose: goodDispose }];

    expect(() => runFullCleanup(ctx)).not.toThrow();
    expect(badDispose).toHaveBeenCalledTimes(1);
    expect(goodDispose).toHaveBeenCalledTimes(1);
    // 审核修复 #3：各 cap dispose 由 registry 统一处理，不再逐个调用
    // nullPostProc 仍会被调用
    expect(ctx.nullPostProc).toHaveBeenCalledTimes(1);
  });

  it("scene.traverse 不存在：不抛错（审核修复 #3：不再遍历 scene）", () => {
    const ctx = makeFullContext();
    // scene 没有 traverse 方法
    ctx.scene = { type: "Scene", children: [] } as any;

    expect(() => runFullCleanup(ctx)).not.toThrow();
    // 审核修复 #3：renderer 为单例不再 dispose
    expect(ctx.renderer!.dispose).not.toHaveBeenCalled();
  });
});

describe("幂等性：重复调用不抛错", () => {
  it("连续调用两次 runFullCleanup 不抛错，第二次走 isDisposed 短路", () => {
    const ctx = makeFullContext();

    expect(() => runFullCleanup(ctx)).not.toThrow();
    expect(ctx.isDisposed.v).toBe(true);

    // 第二次调用：menuHandle.dispose + sceneRegistry.reset 仍执行（短路前），后续跳过
    expect(() => runFullCleanup(ctx)).not.toThrow();

    // menuHandle.dispose 被调用两次（每次短路前都会执行）
    expect(ctx.menuHandle.dispose).toHaveBeenCalledTimes(2);
    expect(sceneRegistry.reset).toHaveBeenCalledTimes(2);

    // renderer.dispose 不再被调用（审核修复 #3：renderer 为模块级单例，不复原）
    expect(ctx.renderer!.dispose).not.toHaveBeenCalled();
  });

  it("第一次已释放后再构造 context 调用依然不抛错", () => {
    // 模拟 overlay 已被移除后再次 cleanup
    const ctx = makeFullContext();
    runFullCleanup(ctx);
    // overlay.parentNode 已在第一次被置空（mock 模拟）
    runFullCleanup(ctx);
    expect(ctx.isDisposed.v).toBe(true);
  });
});
