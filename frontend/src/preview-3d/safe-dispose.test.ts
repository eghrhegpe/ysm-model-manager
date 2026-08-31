// @vitest-environment node
// ===== safeDispose 契约测试 =====
// 覆盖：null/undefined 不抛、正常 dispose 被调用、dispose 抛错被吞（不阻塞）、
// 无 dispose 方法的对象不抛。
import { describe, it, expect, vi } from "vitest";
import { safeDispose } from "./safe-dispose.ts";

describe("safeDispose", () => {
  it("null / undefined 不抛错", () => {
    expect(() => safeDispose(null)).not.toThrow();
    expect(() => safeDispose(undefined)).not.toThrow();
  });

  it("正常对象 → 调用 dispose", () => {
    const dispose = vi.fn();
    safeDispose({ dispose });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose 抛错 → 被吞（不向调用方传播）", () => {
    const dispose = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => safeDispose({ dispose })).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("无 dispose 方法的对象 → 不抛错", () => {
    expect(() => safeDispose({})).not.toThrow();
  });
});
