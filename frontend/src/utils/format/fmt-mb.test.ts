// fmtMB 单测 —— 自 modal.test.ts 迁移（实现同批下沉至 format/fmt-mb.ts）。
import { describe, expect, it } from "vitest";
import { fmtMB } from "./fmt-mb.ts";

describe("fmtMB — 字节格式化", () => {
  it("常规字节换算 MB", () => {
    expect(fmtMB(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fmtMB(1024 * 1024 * 1.25)).toBe("1.3 MB");
  });

  it("非法输入回退 0.0 MB", () => {
    expect(fmtMB(NaN)).toBe("0.0 MB");
    expect(fmtMB(Infinity)).toBe("0.0 MB");
    expect(fmtMB(-1)).toBe("0.0 MB");
    expect(fmtMB(0)).toBe("0.0 MB");
  });
});
