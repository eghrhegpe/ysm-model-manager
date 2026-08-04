import { describe, it, expect, vi, afterEach } from "vitest";
import { fmt, sizeColor, fmtDate } from "./format.ts";

describe("fmt", () => {
  it("formats bytes", () => expect(fmt(0)).toBe("0 B"));
  it("formats under 1KB", () => expect(fmt(512)).toBe("512 B"));
  it("formats KB", () => expect(fmt(2048)).toBe("2.0 KB"));
  it("formats MB", () => expect(fmt(3145728)).toBe("3.0 MB"));
  it("returns empty for null", () => expect(fmt(null as unknown as number)).toBe(""));
  it("returns empty for undefined", () => expect(fmt(undefined as unknown as number)).toBe(""));
});

describe("sizeColor", () => {
  it("green for <1MB", () => expect(sizeColor(512 * 1024)).toBe("sz-green"));
  it("empty for 1-3MB", () => expect(sizeColor(2 * 1048576)).toBe(""));
  it("red for >3MB", () => expect(sizeColor(5 * 1048576)).toBe("sz-red"));
  it("returns empty for null", () => expect(sizeColor(null as unknown as number)).toBe(""));
});

describe("fmtDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today as time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 14, 30));
    const result = fmtDate(new Date(2026, 7, 3, 10, 15).getTime());
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result).not.toContain("月");
  });
  it("returns month-day for this year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3));
    const result = fmtDate(new Date(2026, 5, 15).getTime());
    expect(result).toBe("6月15日");
  });
  it("returns YYYY/M/D for other year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3));
    const result = fmtDate(new Date(2023, 0, 1).getTime());
    expect(result).toBe("2023/1/1");
  });
  it("returns empty for null", () => expect(fmtDate(null as unknown as number)).toBe(""));
});
