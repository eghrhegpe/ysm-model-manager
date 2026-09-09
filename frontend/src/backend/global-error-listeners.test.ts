// @vitest-environment happy-dom
// ===== 全局错误监听测试（backend/global-error-listeners.ts）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 模拟 @/core/error-diary：pushToDiary 是全局错误监听的唯一出口
const pushToDiary = vi.fn();
vi.mock("@/core/error-diary.ts", () => ({
  pushToDiary: (...args: unknown[]) => pushToDiary(...args),
}));

import { installGlobalErrorListeners } from "./global-error-listeners.ts";

beforeEach(() => {
  pushToDiary.mockClear();
  // 清理可能残留的监听（每个测试重新安装）
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installGlobalErrorListeners — 错误转发", () => {
  it("window error 事件 → pushToDiary 收到消息 + failed", () => {
    const dispose = installGlobalErrorListeners();
    window.dispatchEvent(new ErrorEvent("error", { message: "script boom" }));
    expect(pushToDiary).toHaveBeenCalledWith("script boom", "failed");
    dispose();
  });

  it("unhandledrejection 事件 → pushToDiary 收到 reason 消息", () => {
    const dispose = installGlobalErrorListeners();
    const ev = new Event("unhandledrejection") as Event & { reason: unknown };
    ev.reason = new Error("promise rejected");
    window.dispatchEvent(ev);
    expect(pushToDiary).toHaveBeenCalledWith("promise rejected", "failed");
    dispose();
  });

  it("rejection reason 非 Error 对象 → String(reason) 兜底", () => {
    const dispose = installGlobalErrorListeners();
    const ev = new Event("unhandledrejection") as Event & { reason: unknown };
    ev.reason = 42;
    window.dispatchEvent(ev);
    expect(pushToDiary).toHaveBeenCalledWith("42", "failed");
    dispose();
  });

  it("rejection reason 为 null → 兜底文案", () => {
    const dispose = installGlobalErrorListeners();
    const ev = new Event("unhandledrejection") as Event & { reason: unknown };
    ev.reason = null;
    window.dispatchEvent(ev);
    expect(pushToDiary).toHaveBeenCalledWith("未处理的 Promise 拒绝", "failed");
    dispose();
  });
});

describe("installGlobalErrorListeners — 幂等守卫", () => {
  it("重复安装不叠加监听（第二次安装返回 no-op，不重复注册）", () => {
    const dispose1 = installGlobalErrorListeners();
    const dispose2 = installGlobalErrorListeners();
    window.dispatchEvent(new ErrorEvent("error", { message: "once" }));
    // 只注册了一次监听 → pushToDiary 只收到一条
    expect(pushToDiary).toHaveBeenCalledTimes(1);
    dispose1();
    dispose2();
  });

  it("dispose 后重新安装可再次生效", () => {
    const dispose = installGlobalErrorListeners();
    dispose();
    // 重新安装
    const dispose2 = installGlobalErrorListeners();
    window.dispatchEvent(new ErrorEvent("error", { message: "reinstalled" }));
    expect(pushToDiary).toHaveBeenCalledWith("reinstalled", "failed");
    dispose2();
  });
});
