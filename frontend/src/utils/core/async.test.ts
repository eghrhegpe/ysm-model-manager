// @vitest-environment node
// ===== 异步工具测试（async.ts）=====
// 覆盖：swallowError/fireAndForget/delay/waitForFrame。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// async.ts 仅依赖 ./log.ts——mock 掉，断言错误不沉默
vi.mock("./log.ts", () => ({ logWarn: vi.fn() }));
import { logWarn } from "./log.ts";
import { swallowError, fireAndForget, delay, waitForFrame } from "./async.ts";

describe("swallowError / fireAndForget", () => {
  beforeEach(() => {
    vi.mocked(logWarn).mockClear();
  });

  it("swallowError 吞掉 reject 并记日志（不产生未处理异常）", async () => {
    const err = new Error("boom");
    swallowError(Promise.reject(err));
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
    expect(logWarn).toHaveBeenCalledWith("swallow", "", err);
  });

  it("swallowError 对 resolve 的 promise 无副作用", async () => {
    swallowError(Promise.resolve(1));
    await Promise.resolve();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("fireAndForget 调用 fn 且异常被兜底", async () => {
    const err = new Error("x");
    fireAndForget(async () => { throw err; });
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
    expect(logWarn).toHaveBeenCalledWith("swallow", "", err);
  });
});

describe("delay / waitForFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delay 在 ms 之后 resolve", async () => {
    const spy = vi.fn();
    delay(100).then(spy);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("waitForFrame 在 rAF 回调后 resolve", async () => {
    // 直接 stub 全局 rAF 为立即执行回调（node 无 rAF；stubGlobal 的 unknown
    // 参数推断会把闭包变量收窄成 never，绕开它手动赋值）
    const orig = globalThis.requestAnimationFrame;
    (globalThis as { requestAnimationFrame?: (fn: (t: number) => void) => number }).requestAnimationFrame = (fn) => {
      fn(16);
      return 1;
    };
    try {
      const spy = vi.fn();
      waitForFrame().then(spy);
      await Promise.resolve();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      // 断言失败也须恢复全局 rAF，避免泄漏 stub 污染同 worker 后续 rAF 依赖测试
      (globalThis as { requestAnimationFrame?: (fn: (t: number) => void) => number }).requestAnimationFrame = orig;
    }
  });
});
