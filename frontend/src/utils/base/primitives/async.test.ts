// @vitest-environment node
// ===== 异步工具测试（async.ts）=====
// 覆盖：swallowError、withTimeout。
import { describe, it, expect, vi, beforeEach } from "vitest";

// async.ts 仅依赖 ./log.ts——mock 掉，断言错误不沉默
vi.mock("./log.ts", () => ({ logWarn: vi.fn() }));
import { logWarn } from "./log.ts";
import { TimeoutError, swallowError, withTimeout } from "./async.ts";

describe("swallowError", () => {
  beforeEach(() => {
    vi.mocked(logWarn).mockClear();
  });

  it("吞掉 reject 并记日志（不产生未处理异常）", async () => {
    const err = new Error("boom");
    swallowError(Promise.reject(err));
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
    expect(logWarn).toHaveBeenCalledWith("async", "swallowError 吞掉未处理异常", err);
  });

  it("对 resolve 的 promise 无副作用", async () => {
    swallowError(Promise.resolve(1));
    await Promise.resolve();
    expect(logWarn).not.toHaveBeenCalled();
  });
});

describe("withTimeout", () => {
  beforeEach(() => {
    vi.mocked(logWarn).mockClear();
  });

  it("ms 内 resolve → 原样透传结果", async () => {
    const p = new Promise<number>((r) => setTimeout(() => r(42), 10));
    expect(await withTimeout(p, 500, "ok")).toBe(42);
  });

  it("ms 内 reject → 原样透传错误（不吞业务错误）", async () => {
    const err = new Error("biz");
    await expect(withTimeout(Promise.reject(err), 500, "biz")).rejects.toBe(err);
  });

  it("超时 → reject TimeoutError，原 promise 晚到 resolve 无人消费且不再触发第二次 settle", async () => {
    let settle: (v: number) => void = () => {};
    const p = new Promise<number>((r) => {
      settle = r;
    });
    const start = Date.now();
    await expect(withTimeout(p, 20, "slow")).rejects.toBeInstanceOf(TimeoutError);
    // 晚到 resolve：已 reject 的 promise 二次 settle 是 no-op，不得复活或抛错
    settle(7);
    await Promise.resolve();
    expect(Date.now() - start).toBeLessThan(2_000); // 20ms 超时（远小于任何真实等待）
  });

  it("超时后原 promise 才 reject → 无 unhandled rejection（swallowError 兜底记日志）", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: Event): void => {
      e.preventDefault();
      unhandled.push(e);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let fail: (e: Error) => void = () => {};
      const p = new Promise<number>((_, rj) => {
        fail = rj;
      });
      await expect(withTimeout(p, 20, "late")).rejects.toBeInstanceOf(TimeoutError);
      fail(new Error("late-reject"));
      await new Promise((r) => setTimeout(r, 30));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
