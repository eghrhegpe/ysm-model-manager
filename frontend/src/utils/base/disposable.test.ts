// @vitest-environment node
// ===== Disposable 模式测试（disposable.ts）=====
import { describe, it, expect, vi } from "vitest";
import { addDisposableListener } from "./disposable.ts";

describe("addDisposableListener — 事件监听 Disposable", () => {
  it("返回含 dispose 方法的对象", () => {
    const target = new EventTarget();
    const disposable = addDisposableListener(target, "click", () => {});
    expect(disposable).toHaveProperty("dispose");
    expect(typeof disposable.dispose).toBe("function");
  });

  it("dispose 前事件正常触发", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    addDisposableListener(target, "test", handler);
    target.dispatchEvent(new Event("test"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("dispose 后事件不再触发", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const disposable = addDisposableListener(target, "test", handler);
    target.dispatchEvent(new Event("test"));
    expect(handler).toHaveBeenCalledTimes(1);

    disposable.dispose();
    target.dispatchEvent(new Event("test"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("多次 dispose 不报错", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const disposable = addDisposableListener(target, "test", handler);
    disposable.dispose();
    expect(() => disposable.dispose()).not.toThrow();
  });

  it("多个 listener 独立 dispose", () => {
    const target = new EventTarget();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const d1 = addDisposableListener(target, "test", handler1);
    addDisposableListener(target, "test", handler2);

    d1.dispose();
    target.dispatchEvent(new Event("test"));

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("支持 capture 选项", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const disposable = addDisposableListener(target, "test", handler, { capture: true });

    target.dispatchEvent(new Event("test"));
    expect(handler).toHaveBeenCalled();

    // dispose 不应报错
    expect(() => disposable.dispose()).not.toThrow();
  });
});
