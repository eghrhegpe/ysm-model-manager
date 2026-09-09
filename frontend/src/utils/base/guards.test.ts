// @vitest-environment node
// ===== 通用类型守卫测试（guards.ts）=====
import { describe, it, expect } from "vitest";
import { isObj, asRecord, toInt } from "./guards.ts";

describe("isObj — 普通对象判定", () => {
  it("普通对象 → true", () => {
    expect(isObj({ a: 1 })).toBe(true);
    expect(isObj({})).toBe(true);
  });

  it("null → false", () => {
    expect(isObj(null)).toBe(false);
  });

  it("数组 → false（数组不是普通对象）", () => {
    expect(isObj([1, 2, 3])).toBe(false);
    expect(isObj([])).toBe(false);
  });

  it("原始类型 → false", () => {
    expect(isObj(42)).toBe(false);
    expect(isObj("str")).toBe(false);
    expect(isObj(true)).toBe(false);
    expect(isObj(undefined)).toBe(false);
    expect(isObj(Symbol())).toBe(false);
  });

  it("Date / RegExp 等对象 → true（非数组非 null 的对象）", () => {
    expect(isObj(new Date())).toBe(true);
    expect(isObj(/x/)).toBe(true);
  });
});

describe("asRecord — 窄化返回", () => {
  it("普通对象 → 返回同引用", () => {
    const o = { x: 1 };
    expect(asRecord(o)).toBe(o);
  });

  it("null / undefined / 数组 → undefined", () => {
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord(undefined)).toBeUndefined();
    expect(asRecord([1])).toBeUndefined();
    expect(asRecord(42)).toBeUndefined();
  });
});

describe("toInt — 对齐 Go int", () => {
  it("有限 number → 取整（Math.trunc）", () => {
    expect(toInt(3.7)).toBe(3);
    expect(toInt(-3.7)).toBe(-3);
    expect(toInt(0)).toBe(0);
    expect(toInt(42)).toBe(42);
  });

  it("非 number → 0", () => {
    expect(toInt("5")).toBe(0);
    expect(toInt(null)).toBe(0);
    expect(toInt(undefined)).toBe(0);
    expect(toInt({})).toBe(0);
    expect(toInt([])).toBe(0);
    expect(toInt(true)).toBe(0);
  });

  it("非有限 number → 0（NaN / Infinity）", () => {
    expect(toInt(NaN)).toBe(0);
    expect(toInt(Infinity)).toBe(0);
    expect(toInt(-Infinity)).toBe(0);
  });
});
