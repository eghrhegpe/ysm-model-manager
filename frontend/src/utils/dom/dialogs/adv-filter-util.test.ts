// ===== 高级筛选条件解析/校验纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import {
  parseFilterNumber,
  validateAdvFilter,
  type AdvFilterValue,
} from "./adv-filter-util.ts";

describe("parseFilterNumber", () => {
  it("空串/空白 → null", () => {
    expect(parseFilterNumber("")).toBeNull();
    expect(parseFilterNumber("   ")).toBeNull();
  });
  it("非数字 → null", () => {
    expect(parseFilterNumber("abc")).toBeNull();
  });
  it("负数 → null", () => {
    expect(parseFilterNumber("-3")).toBeNull();
  });
  it("合法数字解析", () => {
    expect(parseFilterNumber(" 12 ")).toBe(12);
    expect(parseFilterNumber("0")).toBe(0);
  });
  it("带前导空格 trim 后解析", () => {
    expect(parseFilterNumber(" 8")).toBe(8);
  });
});

const base: AdvFilterValue = {
  keyword: "",
  minBones: null,
  maxBones: null,
  minCubes: null,
  maxCubes: null,
  minTex: null,
  maxTex: null,
  tag: "",
};

describe("validateAdvFilter", () => {
  it("全部不限制 → null", () => {
    expect(validateAdvFilter(base)).toBeNull();
  });

  it("min≤max → null", () => {
    expect(
      validateAdvFilter({ ...base, minBones: 2, maxBones: 8 }),
    ).toBeNull();
    expect(validateAdvFilter({ ...base, minBones: 8, maxBones: 8 })).toBeNull();
  });

  it("骨骼 min>max → 报错", () => {
    expect(validateAdvFilter({ ...base, minBones: 9, maxBones: 3 })).toBe(
      "骨骼数：最小值不能大于最大值",
    );
  });

  it("立方体 min>max → 报错", () => {
    expect(validateAdvFilter({ ...base, minCubes: 9, maxCubes: 3 })).toBe(
      "立方体：最小值不能大于最大值",
    );
  });

  it("纹理 min>max → 报错", () => {
    expect(validateAdvFilter({ ...base, minTex: 9, maxTex: 3 })).toBe(
      "纹理尺寸：最小值不能大于最大值",
    );
  });

  it("仅填一端 → 不校验（null 表示不限制）", () => {
    expect(validateAdvFilter({ ...base, minBones: 5 })).toBeNull();
    expect(validateAdvFilter({ ...base, maxBones: 5 })).toBeNull();
  });
});
