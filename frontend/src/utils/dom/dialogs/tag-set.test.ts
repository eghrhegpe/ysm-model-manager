// ===== 标签集合操作纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { addTagToSet, MAX_TAG_LENGTH } from "./tag-set.ts";

describe("addTagToSet", () => {
  it("合法标签：trim 后排序插入，返回新数组", () => {
    const r = addTagToSet(["a"], "  c ");
    expect(r).toEqual({ tags: ["a", "c"], error: null });
    // 不原地修改入参
    expect(r.tags).not.toBe(["a"]);
  });

  it("空输入：原样返回无错误", () => {
    const base = ["a"];
    expect(addTagToSet(base, "   ")).toEqual({ tags: base, error: null });
  });

  it("重复标签：报「标签已存在」且不改变集合", () => {
    const r = addTagToSet(["a", "b"], "b");
    expect(r.error).toBe("⚠️ 标签已存在");
    expect(r.tags).toEqual(["a", "b"]);
  });

  it("超长标签：报「最多 20 个字符」", () => {
    const r = addTagToSet([], "x".repeat(MAX_TAG_LENGTH + 1));
    expect(r.error).toBe("⚠️ 标签最多 20 个字符");
  });

  it("恰好 20 字符：合法", () => {
    const r = addTagToSet([], "x".repeat(MAX_TAG_LENGTH));
    expect(r.error).toBeNull();
    expect(r.tags[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  it("排序按字典序（Unicode：联动<装甲<角色）", () => {
    const r = addTagToSet(["角色", "联动"], "装甲");
    expect(r.tags).toEqual(["联动", "装甲", "角色"]);
  });
});
