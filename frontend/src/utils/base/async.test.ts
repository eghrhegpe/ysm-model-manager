// @vitest-environment node
// ===== 异步工具测试（async.ts）=====
// 覆盖：swallowError。
import { describe, it, expect, vi, beforeEach } from "vitest";

// async.ts 仅依赖 ./log.ts——mock 掉，断言错误不沉默
vi.mock("./log.ts", () => ({ logWarn: vi.fn() }));
import { logWarn } from "./log.ts";
import { swallowError } from "./async.ts";

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
