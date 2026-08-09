// ===== debug.safeStr 纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { safeStr } from "./debug.ts";

describe("safeStr", () => {
  it("null/undefined 原样转字符串", () => {
    expect(safeStr(null)).toBe("null");
    expect(safeStr(undefined)).toBe("undefined");
  });

  it("短字符串原样返回", () => {
    expect(safeStr("hi")).toBe("hi");
  });

  it("恰好 200 字符不截断", () => {
    const s = "a".repeat(200);
    expect(safeStr(s)).toBe(s);
  });

  it("超 200 字符截断并加省略号", () => {
    const s = "a".repeat(201);
    expect(safeStr(s)).toBe("a".repeat(200) + "…");
  });

  it("Error 短 message 原样", () => {
    expect(safeStr(new Error("boom"))).toBe("boom");
  });

  it("Error 超长 message 截断", () => {
    const s = "x".repeat(300);
    expect(safeStr(new Error(s))).toBe("x".repeat(200) + "…");
  });

  it("Set 空集", () => {
    expect(safeStr(new Set())).toBe("Set(0)[]");
  });

  it("Set ≤3 元素列出全部", () => {
    expect(safeStr(new Set(["a", "b", "c"]))).toBe("Set(3)[a, b, c]");
  });

  it("Set 超 3 元素截断加省略号（括号内）", () => {
    expect(safeStr(new Set([1, 2, 3, 4, 5]))).toBe("Set(5)[1, 2, 3…]");
  });

  it("Array 只报长度", () => {
    expect(safeStr([1, 2, 3])).toBe("Array(3)");
  });

  it("普通对象 JSON 序列化", () => {
    expect(safeStr({ a: 1 })).toBe('{"a":1}');
  });

  it("对象超长 JSON 截断", () => {
    const obj = { a: "x".repeat(300) };
    expect(safeStr(obj)).toBe(safeStr(obj).slice(0, 200) + "…");
  });

  it("循环引用对象兜底为 String(v)", () => {
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(safeStr(c)).toBe("[object Object]");
  });

  it("bigint（JSON.stringify 抛错）兜底为 String(v)", () => {
    expect(safeStr(123n)).toBe("123");
  });
});
