import { describe, it, expect } from "vitest";
import { fmt, sizeColor, fmtDate } from "./fmt.ts";

describe("fmt", () => {
  it("formats bytes", () => expect(fmt(0)).toBe("0 B"));
  it("formats under 1KB", () => expect(fmt(512)).toBe("512 B"));
  it("formats KB", () => expect(fmt(2048)).toBe("2.0 KB"));
  it("formats MB", () => expect(fmt(3145728)).toBe("3.0 MB"));
  it("returns empty for null", () => expect(fmt(null)).toBe(""));
  it("returns empty for undefined", () => expect(fmt(undefined)).toBe(""));
});

describe("sizeColor", () => {
  it("green for <1MB", () => expect(sizeColor(512 * 1024)).toBe("sz-green"));
  it("empty for 1-3MB", () => expect(sizeColor(2 * 1048576)).toBe(""));
  it("red for >3MB", () => expect(sizeColor(5 * 1048576)).toBe("sz-red"));
  it("returns empty for null", () => expect(sizeColor(null)).toBe(""));
});

describe("fmtDate", () => {
  it("returns today as time", () => {
    const d = new Date();
    const result = fmtDate(d.getTime());
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
  it("returns month-day for this year", () => {
    const d = new Date();
    d.setMonth(5);
    d.setDate(15);
    d.setFullYear(d.getFullYear());
    const result = fmtDate(d.getTime());
    expect(result).toMatch(/月/);
  });
  it("returns YYYY/M/D for other year", () => {
    const result = fmtDate(new Date(2023, 0, 1).getTime());
    expect(result).toBe("2023/1/1");
  });
  it("returns empty for null", () => expect(fmtDate(null)).toBe(""));
});
