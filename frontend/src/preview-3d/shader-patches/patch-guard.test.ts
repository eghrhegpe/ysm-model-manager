// ===== shader-patches/patch-guard 契约测试（2026-09-14 锐评 P1-3 落地）=====
// 覆盖：checkRevision 纯函数（脱离 three 直测版本范围）、assertRevisionRange 范围外 throw、
// reportPatchIssue 的 ringLog→console 兜底（无 __ysmRingLog 挂载时 console 兜底、有挂载走 logger）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertRevisionRange,
  checkRevision,
  reportPatchIssue,
} from "./patch-guard.ts";

describe("checkRevision 纯函数", () => {
  it("rev 在 allowed 内 → null（无失配）", () => {
    expect(checkRevision("185", ["185"])).toBeNull();
    expect(checkRevision("186", ["185", "186", "187"])).toBeNull();
  });

  it("rev 不在 allowed 内 → 失配说明（含允许列表，便于升级审计定位）", () => {
    const msg = checkRevision("186", ["185"]);
    expect(msg).toContain("186");
    expect(msg).toContain("185");
    expect(msg).toContain("拒绝静默降级");
  });

  it("unknown（REVISION 缺失）→ 失配", () => {
    expect(checkRevision("unknown", ["185"])).not.toBeNull();
  });
});

describe("assertRevisionRange", () => {
  it("范围内 → 不抛（185 为当前已审计版本）", () => {
    expect(() => assertRevisionRange({ module: "sky-patch", allowed: ["185"] })).not.toThrow();
  });

  it("范围外 → 抛错（升级显式化），且 console.error 有兜底留痕", async () => {
    // 临时篡改 REVISION 模拟升级（restoreAllMocks 还原）
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const threeMod = await import("three");
    const orig = (threeMod as { REVISION?: string }).REVISION;
    (threeMod as { REVISION?: string }).REVISION = "199";
    try {
      expect(() => assertRevisionRange({ module: "sky-patch", allowed: ["185"] })).toThrow(
        /sky-patch/,
      );
      expect(spy).toHaveBeenCalled(); // 无 __ysmRingLog 挂载 → console 兜底
    } finally {
      const three = threeMod as { REVISION?: string };
      if (orig !== undefined) three.REVISION = orig;
      else delete three.REVISION;
      spy.mockRestore();
    }
  });
});

describe("reportPatchIssue console 兜底", () => {
  beforeEach(() => {
    delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
    vi.restoreAllMocks();
  });

  it("无 __ysmRingLog 挂载 → console.warn 兜底（生产告警不再落空）", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportPatchIssue("water", "锚点失配", "warn");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[water]"));
    spy.mockRestore();
  });

  it("有 __ysmRingLog 挂载 → 走 logger（console 不兜底）", () => {
    const logger = vi.fn();
    (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog = logger;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportPatchIssue("sky", "失配", "warn");
    expect(logger).toHaveBeenCalledWith("sky", expect.stringContaining("失配"), "warn");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
