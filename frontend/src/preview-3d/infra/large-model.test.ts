// ===== 大文件解码内存风险警示测试 =====
// 验证：受限平台（网页版/Android，isViewerMode=true）超阈值才提示；
// 桌面端不提示（噪音）；同路径只提示一次；严格 > 阈值。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "@/bus";
import {
  LARGE_MODEL_WARN_BYTES,
  __resetLargeModelWarnForTest,
  warnLargeModelIfNeeded,
} from "./large-model.ts";

const isViewerModeMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/backend/platform.ts", () => ({
  isViewerMode: isViewerModeMock,
}));

beforeEach(() => {
  __resetLargeModelWarnForTest();
  isViewerModeMock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warnLargeModelIfNeeded", () => {
  it("桌面端（isViewerMode=false）→ 不提示（内存充裕，提示是噪音）", () => {
    isViewerModeMock.mockReturnValue(false);
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(200 * 1024 * 1024, "/huge.ysm");
    expect(spy).not.toHaveBeenCalled();
  });

  it("受限平台 + 小于阈值 → 不提示", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(10 * 1024 * 1024, "/small.ysm");
    expect(spy).not.toHaveBeenCalled();
  });

  it("恰好等于阈值 → 不提示（判据为严格 >）", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(LARGE_MODEL_WARN_BYTES, "/edge.ysm");
    expect(spy).not.toHaveBeenCalled();
  });

  it("受限平台 + 超阈值 → toast:show warn 一条", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    expect(spy).toHaveBeenCalledTimes(1);
    const [evt, payload] = spy.mock.calls[0] as [string, { type: string; msg: string }];
    expect(evt).toBe("toast:show");
    expect(payload.type).toBe("warn");
    expect(payload.msg).toContain("⚠️");
  });

  it("同路径重复调用 → 只提示一次（防 toast 轰炸）", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("不同路径 → 各自提示一次", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/a.ysm");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/b.ysm");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("__resetLargeModelWarnForTest 清空去重记录（下一会话可再次提示）", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    __resetLargeModelWarnForTest();
    warnLargeModelIfNeeded(100 * 1024 * 1024, "/huge.ysm");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("非有限字节数（NaN/Infinity）→ 不提示", () => {
    const spy = vi.spyOn(bus, "emit");
    warnLargeModelIfNeeded(Number.NaN, "/nan.ysm");
    warnLargeModelIfNeeded(Number.POSITIVE_INFINITY, "/inf.ysm");
    expect(spy).not.toHaveBeenCalled();
  });
});
