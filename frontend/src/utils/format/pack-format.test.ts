// ===== describeVersionRange 测试：pack_format → 版本号描述 =====
// 覆盖：supported_formats 优先 / min-max（数字与数组）/ 9999 上限 / 单体 pack_format / 未知回退
import { describe, it, expect } from "vitest";
import { describeVersionRange } from "./pack-format.ts";

describe("describeVersionRange", () => {
  it("supported_formats 双元素 → 范围描述（版本用 / 分隔，避免范围串歧义）", () => {
    expect(describeVersionRange({ supported_formats: [46, 50] })).toEqual({
      format: "46 ~ 50",
      version: "1.21.4 / 1.21.5",
    });
  });

  it("supported_formats max ≥ 9999 → 仅下限", () => {
    expect(describeVersionRange({ supported_formats: [46, 9999] })).toEqual({
      format: "≥ 46",
      version: "≥ 1.21.4",
    });
  });

  it("min_format/max_format 数字 → 范围描述（minVer 自身含范围时用 / 分隔）", () => {
    expect(describeVersionRange({ min_format: 3, max_format: 4 })).toEqual({
      format: "3 ~ 4",
      version: "1.11 ~ 1.12.2 / 1.13 ~ 1.14.4",
    });
  });

  it("min_format/max_format 为 [min,max] 双值数组 → min 取首、max 取末", () => {
    expect(describeVersionRange({ min_format: [46, 46], max_format: [46, 50] })).toEqual({
      format: "46 ~ 50",
      version: "1.21.4 / 1.21.5",
    });
  });

  it("max_format ≥ 9999 → 仅下限", () => {
    expect(describeVersionRange({ min_format: 46, max_format: 9999 })).toEqual({
      format: "≥ 46",
      version: "≥ 1.21.4",
    });
  });

  it("min === max → 落到 pack_format 兜底", () => {
    // min_format === max_format 不提前 return，交给 pack_format
    expect(describeVersionRange({ min_format: 3, max_format: 3, pack_format: 4 })).toEqual({
      format: "4",
      version: "1.13 ~ 1.14.4",
    });
  });

  it("单体 pack_format 兜底（已知）", () => {
    expect(describeVersionRange({ pack_format: 22 })).toEqual({
      format: "22",
      version: "1.20.5",
    });
  });

  it("单体 pack_format 兜底（未知编号 → 空版本）", () => {
    expect(describeVersionRange({ pack_format: 90 })).toEqual({
      format: "90",
      version: "",
    });
  });

  it("超 map 上限的格式号描述为「最新版本」", () => {
    // supported_formats 中 max=90（>88）→ fmtVer 返回"最新版本"
    expect(describeVersionRange({ supported_formats: [46, 90] })).toEqual({
      format: "46 ~ 90",
      version: "1.21.4 / 最新版本",
    });
  });

  it("无任何格式字段 → 占位", () => {
    expect(describeVersionRange({})).toEqual({ format: "?", version: "" });
  });
});
