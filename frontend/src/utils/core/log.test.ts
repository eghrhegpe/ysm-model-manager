// @vitest-environment node
// ===== 日志出口测试（log.ts）=====
// 极简封装：仅断言 console.warn/error 被正确转发（tag/msg/err 拼接）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logWarn, logError } from "./log.ts";

describe("logWarn / logError", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logWarn 输出 [tag] msg 格式（err 缺省不追加空参数槽，code review #11）", () => {
    logWarn("cat", "hello");
    expect(warnSpy).toHaveBeenCalledWith("[cat] hello");
  });

  it("logWarn 携带 err 原样透传", () => {
    const err = new Error("e");
    logWarn("cat", "msg", err);
    expect(warnSpy).toHaveBeenCalledWith("[cat] msg", err);
  });

  it("logWarn err 为 0/false 等假值也原样透传（不吞假值）", () => {
    logWarn("cat", "msg", 0);
    expect(warnSpy).toHaveBeenCalledWith("[cat] msg", 0);
  });

  it("logError 输出到 console.error", () => {
    logError("cat", "fail", 42);
    expect(errorSpy).toHaveBeenCalledWith("[cat] fail", 42);
  });

  it("logError 缺省 err 时不追加空参数槽（code review #11）", () => {
    logError("cat", "x");
    expect(errorSpy).toHaveBeenCalledWith("[cat] x");
  });

  it("logWarn 与 logError 互不串台", () => {
    logWarn("a", "w");
    logError("a", "e");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
