// @vitest-environment node
// ===== nbt-guards.ts 类型守卫测试 =====
import { describe, it, expect } from "vitest";
import { isObj, asString, asNumber, asArray, getCompound } from "./nbt-guards.ts";

describe("isObj", () => {
  it("普通对象返回 true", () => {
    expect(isObj({ a: 1 })).toBe(true);
  });
  it("null 返回 false", () => {
    expect(isObj(null)).toBe(false);
  });
  it("数组返回 false", () => {
    expect(isObj([1, 2])).toBe(false);
  });
  it("字符串返回 false", () => {
    expect(isObj("hello")).toBe(false);
  });
  it("undefined 返回 false", () => {
    expect(isObj(undefined)).toBe(false);
  });
  it("数字返回 false", () => {
    expect(isObj(42)).toBe(false);
  });
  it("空对象返回 true", () => {
    expect(isObj({})).toBe(true);
  });
});

describe("asString", () => {
  it("字符串原样返回", () => {
    expect(asString("hello")).toBe("hello");
  });
  it("null 返回 undefined", () => {
    expect(asString(null)).toBeUndefined();
  });
  it("数字返回 undefined", () => {
    expect(asString(42)).toBeUndefined();
  });
  it("undefined 返回 undefined", () => {
    expect(asString(undefined)).toBeUndefined();
  });
  it("空字符串返回空字符串", () => {
    expect(asString("")).toBe("");
  });
  it("包装对象 String 返回 undefined（typeof 不匹配）", () => {
    expect(asString(new String("x"))).toBeUndefined();
  });
});

describe("asNumber", () => {
  it("有限数字原样返回", () => {
    expect(asNumber(42)).toBe(42);
  });
  it("0 返回 0", () => {
    expect(asNumber(0)).toBe(0);
  });
  it("负数返回负数", () => {
    expect(asNumber(-3.14)).toBe(-3.14);
  });
  it("NaN 返回 undefined", () => {
    expect(asNumber(NaN)).toBeUndefined();
  });
  it("Infinity 返回 undefined", () => {
    expect(asNumber(Infinity)).toBeUndefined();
  });
  it("-Infinity 返回 undefined", () => {
    expect(asNumber(-Infinity)).toBeUndefined();
  });
  it("字符串返回 undefined", () => {
    expect(asNumber("42")).toBeUndefined();
  });
  it("null 返回 undefined", () => {
    expect(asNumber(null)).toBeUndefined();
  });
});

describe("asArray", () => {
  it("数组原样返回", () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("空数组返回空数组", () => {
    expect(asArray([])).toEqual([]);
  });
  it("null 返回 undefined", () => {
    expect(asArray(null)).toBeUndefined();
  });
  it("对象返回 undefined", () => {
    expect(asArray({})).toBeUndefined();
  });
  it("字符串返回 undefined", () => {
    expect(asArray("abc")).toBeUndefined();
  });
});

describe("getCompound", () => {
  it("key 存在且为对象返回该对象", () => {
    expect(getCompound({ a: { x: 1 } }, "a")).toEqual({ x: 1 });
  });
  it("key 不存在返回 undefined", () => {
    expect(getCompound({ a: 1 }, "b")).toBeUndefined();
  });
  it("key 值为 null 返回 undefined", () => {
    expect(getCompound({ a: null }, "a")).toBeUndefined();
  });
  it("key 值为数组返回 undefined", () => {
    expect(getCompound({ a: [1] }, "a")).toBeUndefined();
  });
  it("key 值为字符串返回 undefined", () => {
    expect(getCompound({ a: "hi" }, "a")).toBeUndefined();
  });
  it("空对象参数", () => {
    expect(getCompound({}, "any")).toBeUndefined();
  });
});
