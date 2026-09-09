// ===== 主线程长任务观测单元测试 =====
// 覆盖：longtask 回调 → 报告、未超过阈值不报告、不支持 PerformanceObserver 时降级、stop 断开。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startMainThreadWatch } from "./main-thread-watch.ts";

// 手动 Mock PerformanceObserver：保存回调，测试可手动触发 longtask entry
type ObsCallback = (list: { getEntries: () => Array<Record<string, unknown>> }, observer: unknown) => void;
let mockCb: ObsCallback | null = null;
let mockDisconnect: ReturnType<typeof vi.fn>;

class MockPerformanceObserver {
  static instances: MockPerformanceObserver[] = [];
  disconnect = mockDisconnect;
  constructor(cb: ObsCallback) {
    mockCb = cb;
    MockPerformanceObserver.instances.push(this);
  }
  observe(): void { /* no-op */ }
}

/** 构造一个 longtask entry（duration 单位 ms） */
function makeEntry(durationMs: number, fnName?: string): Record<string, unknown> {
  return {
    name: "self",
    entryType: "longtask",
    duration: durationMs,
    startTime: 1234,
    attribution: fnName
      ? [{ name: fnName, containerType: "window", containerSrc: "", containerId: "", containerName: "" }]
      : [],
  };
}

/** 触发一次 longtask 回调 */
function fireLongTask(...entries: Array<Record<string, unknown>>): void {
  mockCb?.({ getEntries: () => entries }, {});
}

beforeEach(() => {
  mockCb = null;
  mockDisconnect = vi.fn();
  MockPerformanceObserver.instances = [];
  vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startMainThreadWatch", () => {
  it("longtask 触发 → 报告含耗时与函数名", () => {
    const report = vi.fn();
    const stop = startMainThreadWatch(report);
    expect(mockCb).toBeTruthy();

    fireLongTask(makeEntry(400, "onImageLoad"));

    expect(report).toHaveBeenCalledTimes(1);
    const info = report.mock.calls[0][0] as { durationMs: number; fnName: string };
    expect(info.durationMs).toBe(400);
    expect(info.fnName).toBe("onImageLoad");
    stop();
  });

  it("未超过阈值（<50ms）不报告", () => {
    const report = vi.fn();
    const stop = startMainThreadWatch(report);

    fireLongTask(makeEntry(30, "onImageLoad"));

    expect(report).not.toHaveBeenCalled();
    stop();
  });

  it("无 attribution 函数名时报告兜底（unknown）", () => {
    const report = vi.fn();
    const stop = startMainThreadWatch(report);

    fireLongTask(makeEntry(120));

    expect(report).toHaveBeenCalledTimes(1);
    const info = report.mock.calls[0][0] as { durationMs: number; fnName: string };
    expect(info.fnName).toBe("unknown");
    stop();
  });

  it("stop 后 disconnect 被调用", () => {
    const report = vi.fn();
    const stop = startMainThreadWatch(report);
    stop();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("stop 后不再报告（回调被清空）", () => {
    const report = vi.fn();
    const stop = startMainThreadWatch(report);
    stop();

    fireLongTask(makeEntry(400, "animate"));
    expect(report).not.toHaveBeenCalled();
  });

  it("不支持 PerformanceObserver 时降级（不抛错、可安全 stop）", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const report = vi.fn();
    expect(() => {
      const stop = startMainThreadWatch(report);
      stop();
    }).not.toThrow();
  });
});
