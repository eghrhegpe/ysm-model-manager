// @vitest-environment node
// ===== NBT 类型守卫测试 =====
import { describe, it, expect } from "vitest";
import { isObj, asString, asNumber, asArray, getCompound } from "./nbt-guards.ts";

describe("isObj — 普通对象判定", () => {
  it("对象 → true", () => {
    expect(isObj({ a: 1 })).toBe(true);
    expect(isObj({})).toBe(true);
  });

  it("null / 数组 / 非对象 → false", () => {
    expect(isObj(null)).toBe(false);
    expect(isObj([1, 2])).toBe(false);
    expect(isObj("str")).toBe(false);
    expect(isObj(42)).toBe(false);
    expect(isObj(undefined)).toBe(false);
  });
});

describe("asString — 字符串守卫", () => {
  it("字符串 → 原值", () => {
    expect(asString("hello")).toBe("hello");
    expect(asString("")).toBe("");
  });

  it("非字符串 → undefined", () => {
    expect(asString(42)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
    expect(asString({})).toBeUndefined();
  });
});

describe("asNumber — 数值守卫", () => {
  it("有限数 → 原值", () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-3.14)).toBe(-3.14);
  });

  it("NaN / Infinity / 非数字 → undefined", () => {
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber(Infinity)).toBeUndefined();
    expect(asNumber(-Infinity)).toBeUndefined();
    expect(asNumber("42")).toBeUndefined();
    expect(asNumber(null)).toBeUndefined();
    expect(asNumber(undefined)).toBeUndefined();
  });
});

describe("asArray — 数组守卫", () => {
  it("数组 → 原值", () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3]);
    expect(asArray([])).toEqual([]);
  });

  it("非数组 → undefined", () => {
    expect(asArray({})).toBeUndefined();
    expect(asArray("arr")).toBeUndefined();
    expect(asArray(null)).toBeUndefined();
    expect(asArray(undefined)).toBeUndefined();
  });
});

describe("getCompound — 子对象安全提取", () => {
  it("键存在且为对象 → 返回该对象", () => {
    const src = { child: { x: 1 } };
    expect(getCompound(src, "child")).toEqual({ x: 1 });
  });

  it("键不存在 → undefined", () => {
    expect(getCompound({ a: 1 }, "missing")).toBeUndefined();
  });

  it("值非对象 → undefined", () => {
    expect(getCompound({ key: "str" }, "key")).toBeUndefined();
    expect(getCompound({ key: 42 }, "key")).toBeUndefined();
    expect(getCompound({ key: null }, "key")).toBeUndefined();
    expect(getCompound({ key: [1, 2] }, "key")).toBeUndefined();
  });

  it("输入非对象 → undefined（签名收窄保护）", () => {
    expect(getCompound(null, "key")).toBeUndefined();
    expect(getCompound(undefined, "key")).toBeUndefined();
    expect(getCompound("str", "key")).toBeUndefined();
    expect(getCompound(42, "key")).toBeUndefined();
    expect(getCompound([1, 2], "key")).toBeUndefined();
  });
});
