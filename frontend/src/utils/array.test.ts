// ===== 通用数组操作纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { moveItem } from "./array.ts";

describe("moveItem", () => {
  it("前移：arr[2] → arr[0]", () => {
    expect(moveItem(["a", "b", "c", "d"], 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("后移：arr[0] → arr[2]", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("原地修改并返回同一引用", () => {
    const arr = [1, 2, 3];
    const r = moveItem(arr, 0, 2);
    expect(r).toBe(arr);
    expect(arr).toEqual([2, 3, 1]);
  });

  it("from===to 原样返回", () => {
    const arr = ["a", "b"];
    expect(moveItem(arr, 1, 1)).toBe(arr);
    expect(arr).toEqual(["a", "b"]);
  });

  it("越界索引原样返回", () => {
    expect(moveItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("单元素数组 no-op", () => {
    expect(moveItem(["x"], 0, 0)).toEqual(["x"]);
  });
});
