// @vitest-environment node
// ===== 日志出口测试（log.ts）=====
// 极简封装：断言 console.warn/error 正确转发 + setLogSink 注入链路。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logWarn, logError, setLogSink, type LogSink } from "./log.ts";

describe("logWarn / logError", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setLogSink(null); // 清除 sink，防止串扰
    vi.restoreAllMocks();
  });

  it("logWarn 输出 [tag] msg 格式（err 缺省不追加空参数槽）", () => {
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

  it("logError 缺省 err 时不追加空参数槽", () => {
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

describe("setLogSink — 注入式透写链路", () => {
  let sinkSpy: LogSink;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sinkSpy = vi.fn() as LogSink;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    setLogSink(null);
    vi.restoreAllMocks();
  });

  it("安装 sink 后 logWarn 同时转发到 sink（level='warn'）", () => {
    setLogSink(sinkSpy);
    logWarn("mod", "hi");
    // sink 调用时第4参数 err 未传，内部走 _sink?.("warn", tag, msg, err) → err 为 undefined
    expect(sinkSpy).toHaveBeenCalledWith("warn", "mod", "hi", undefined);
  });

  it("安装 sink 后 logError 同时转发到 sink（level='error'）", () => {
    setLogSink(sinkSpy);
    logError("mod", "crash", new Error("boom"));
    expect(sinkSpy).toHaveBeenCalledWith("error", "mod", "crash", expect.any(Error));
  });

  it("清除 sink（传 null）后恢复纯 console，sink 不再被调用", () => {
    setLogSink(sinkSpy);
    setLogSink(null);
    logWarn("mod", "after-clear");
    expect(sinkSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[mod] after-clear");
  });

  it("sink 被替换时旧 sink 不再接收新消息", () => {
    const oldSink = vi.fn() as LogSink;
    const newSink = vi.fn() as LogSink;
    setLogSink(oldSink);
    logWarn("mod", "to-old");
    expect(oldSink).toHaveBeenCalledTimes(1);

    setLogSink(newSink);
    logWarn("mod", "to-new");
    expect(oldSink).toHaveBeenCalledTimes(1); // 不被新消息触发
    expect(newSink).toHaveBeenCalledWith("warn", "mod", "to-new", undefined);
  });
});
