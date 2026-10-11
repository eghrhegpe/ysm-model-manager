// ===== WebGL context lost/restored 守卫测试（锐评 2026-10-11 P2 落地）=====
// 病症：renderer 全生命周期零监听 contextlost——GPU 进程重置/驱动切换时 three 静默挂起
// 渲染，用户只见黑场且无提示。本守卫把 lost/restored 变成可观测事件（标志位 + hooks）。
//
// ⚠️ 判据选择：不 mock WebGLRenderer（真实 renderer 构造在 node/happy-dom 不可达），
// 用最小桩（{ domElement: 真实 canvas }）——守卫只依赖 domElement 的 addEventListener，
// 事件走真实 EventTarget 派发，行为可观察（dispatchEvent → hooks 调用/标志翻转）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetWebGlContextLostForTest,
  defaultContextLostHooks,
  installWebGlContextGuard,
  isWebGlContextLost,
} from "./webgl-context-guard.ts";

function makeRendererStub() {
  return { domElement: document.createElement("canvas") };
}

describe("installWebGlContextGuard（锐评 2026-10-11 P2）", () => {
  afterEach(() => {
    __resetWebGlContextLostForTest();
  });

  it("lost 事件：preventDefault + 置 lost 标志 + 触发 onLost hook", () => {
    const renderer = makeRendererStub();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const guard = installWebGlContextGuard(renderer as never, { onLost, onRestored });

    const ev = new Event("webglcontextlost", { cancelable: true });
    renderer.domElement.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true); // preventDefault 是恢复前提
    expect(isWebGlContextLost()).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
    guard.uninstall();
  });

  it("restored 事件：清 lost 标志 + 触发 onRestored hook", () => {
    const renderer = makeRendererStub();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const guard = installWebGlContextGuard(renderer as never, { onLost, onRestored });
    renderer.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(isWebGlContextLost()).toBe(true);

    renderer.domElement.dispatchEvent(new Event("webglcontextrestored"));

    expect(isWebGlContextLost()).toBe(false);
    expect(onRestored).toHaveBeenCalledTimes(1);
    guard.uninstall();
  });

  it("uninstall：摘除监听后事件不再触发 hooks/标志", () => {
    const renderer = makeRendererStub();
    const onLost = vi.fn();
    const guard = installWebGlContextGuard(renderer as never, { onLost });
    guard.uninstall();

    renderer.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    expect(onLost).not.toHaveBeenCalled();
    expect(isWebGlContextLost()).toBe(false);
  });

  it("uninstall 幂等：重复调用不抛错", () => {
    const renderer = makeRendererStub();
    const guard = installWebGlContextGuard(renderer as never, {});
    guard.uninstall();
    expect(() => guard.uninstall()).not.toThrow();
  });

  it("无 domElement 的异常 renderer：返回空守卫，不抛错", () => {
    const guard = installWebGlContextGuard({} as never, { onLost: vi.fn() });
    expect(() => guard.uninstall()).not.toThrow();
  });

  it("restored 在无 lost 前置时保持安全（标志不变）", () => {
    const renderer = makeRendererStub();
    const guard = installWebGlContextGuard(renderer as never, {});
    renderer.domElement.dispatchEvent(new Event("webglcontextrestored"));
    expect(isWebGlContextLost()).toBe(false);
    guard.uninstall();
  });

  it("defaultContextLostHooks：lost/restored 都有日志钩子（不抛错）", () => {
    const hooks = defaultContextLostHooks();
    expect(hooks.onLost).toBeTypeOf("function");
    expect(hooks.onRestored).toBeTypeOf("function");
    expect(() => hooks.onLost()).not.toThrow();
    expect(() => hooks.onRestored()).not.toThrow();
  });
});