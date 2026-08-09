// ===== fmt / sizeColor / fmtDate 格式化工具测试 =====
// 覆盖：fmt 边界（NaN/0/各量级）、sizeColor 三分区、fmtDate 的 NaN 守卫与三种日期形态
import { describe, it, expect, vi, afterEach } from "vitest";
import { fmt, sizeColor, fmtDate } from "./format.ts";

describe("fmt — 文件大小格式化", () => {
  it("NaN / undefined / null → 空串", () => {
    expect(fmt(NaN)).toBe("");
    expect(fmt(undefined as unknown as number)).toBe("");
    expect(fmt(null as unknown as number)).toBe("");
  });

  // P3 补测：±Infinity 与负值——原 P2 修复（Number.isFinite）无回归锁定，
  // 且负值经 Number.isFinite 放行输出 "-5 B"（文件大小不可能为负，违反「非法输入一律返回空串」）
  it("±Infinity → 空串（P2 回归锁定）", () => {
    expect(fmt(Infinity)).toBe("");
    expect(fmt(-Infinity)).toBe("");
  });

  it("负值 → 空串（P3 修复）", () => {
    expect(fmt(-5)).toBe("");
    expect(fmt(-1048576)).toBe("");
  });

  it("0 → '0 B'", () => {
    expect(fmt(0)).toBe("0 B");
  });

  it("B 级：< 1024 直接显示", () => {
    expect(fmt(512)).toBe("512 B");
    expect(fmt(1023)).toBe("1023 B");
  });

  it("KB 级：1KB ≤ b < 1MB", () => {
    expect(fmt(1024)).toBe("1.0 KB");
    expect(fmt(1536)).toBe("1.5 KB");
    expect(fmt(1048575)).toBe("1024.0 KB");
  });

  it("MB 级：1MB ≤ b < 1GB", () => {
    expect(fmt(1048576)).toBe("1.0 MB");
    expect(fmt(1572864)).toBe("1.5 MB");
  });

  it("GB 级：≥ 1GB", () => {
    expect(fmt(1073741824)).toBe("1.0 GB");
    expect(fmt(2147483648)).toBe("2.0 GB");
  });
});

describe("sizeColor — 大小颜色分区", () => {
  it("非法值 → 空串", () => {
    expect(sizeColor(NaN)).toBe("");
  });

  // P3 补测：±Infinity 与负值——与 fmt 同守卫（Number.isFinite + 负值拒绝）
  it("±Infinity → 空串（P2 回归锁定）", () => {
    expect(sizeColor(Infinity)).toBe("");
    expect(sizeColor(-Infinity)).toBe("");
  });

  it("负值 → 空串（P3 修复）", () => {
    expect(sizeColor(-5)).toBe("");
    expect(sizeColor(-1048576)).toBe("");
  });

  it("< 1MB → sz-green", () => {
    expect(sizeColor(1024)).toBe("sz-green");
    expect(sizeColor(1048575)).toBe("sz-green");
  });

  it("1MB ~ 3MB → 空（默认色）", () => {
    expect(sizeColor(1048576)).toBe("");
    expect(sizeColor(3145727)).toBe("");
  });

  it("≥ 3MB → sz-red", () => {
    expect(sizeColor(3145728)).toBe("sz-red");
    expect(sizeColor(10485760)).toBe("sz-red");
  });
});

describe("fmtDate — 友好日期", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("NaN / 0 / 非法时间戳 → 空串", () => {
    expect(fmtDate(NaN)).toBe("");
    expect(fmtDate(0)).toBe("");
    expect(fmtDate(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("今天 → 显示 HH:mm 时间", () => {
    const now = new Date();
    now.setHours(10, 30, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const ts = now.getTime();
    const out = fmtDate(ts);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it("今年非今天 → M月D日", () => {
    const now = new Date(2026, 6, 15, 12, 0, 0); // 2026-07-15
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const past = new Date(2026, 2, 8, 9, 0, 0).getTime(); // 2026-03-08
    expect(fmtDate(past)).toBe("3月8日");
  });

  it("往年 → YYYY/M/D", () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const old = new Date(2024, 11, 25, 9, 0, 0).getTime(); // 2024-12-25
    expect(fmtDate(old)).toBe("2024/12/25");
  });
});
