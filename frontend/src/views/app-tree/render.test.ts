// ===== 树构建/扁平化纯函数测试（ADR-021 扩展）=====
// buildTree：排序（name/size/date）/ search 过滤 / filterPaths 交集 / Windows 路径归一。
// flattenVisible：目录展开/折叠 / 搜索自动展开 / 文件行 key 用 fullPath。
import { describe, it, expect, beforeEach } from "vitest";
import { buildTree, flattenVisible } from "./render.ts";
import { selectState } from "./data.ts";
import type { TreeEntry } from "./loader.ts";

function entry(
  name: string,
  path: string,
  size = 0,
  modTime = 0,
  fullPath?: string,
): TreeEntry {
  return {
    name,
    path,
    fullPath: fullPath || path,
    size,
    modTime,
    banned: false,
    type: "",
  };
}

function treeKeys(root: Record<string, unknown>): string[] {
  return Object.keys(root).sort();
}

describe("buildTree 排序", () => {
  it("name 排序按字典序", () => {
    const root = buildTree(
      [entry("b.ysm", "b.ysm"), entry("a.ysm", "a.ysm"), entry("c.ysm", "c.ysm")],
      "name",
      "",
      null,
    );
    expect(treeKeys(root)).toEqual(["a.ysm", "b.ysm", "c.ysm"]);
  });

  it("size 排序降序", () => {
    const root = buildTree(
      [entry("small.ysm", "small.ysm", 100), entry("big.ysm", "big.ysm", 5000)],
      "size",
      "",
      null,
    );
    expect(treeKeys(root)).toEqual(["big.ysm", "small.ysm"]);
  });

  it("date 排序降序", () => {
    const root = buildTree(
      [entry("old.ysm", "old.ysm", 0, 100), entry("new.ysm", "new.ysm", 0, 500)],
      "date",
      "",
      null,
    );
    expect(treeKeys(root)).toEqual(["new.ysm", "old.ysm"]);
  });

  it("文件夹始终排在文件前（name 模式）", () => {
    const root = buildTree(
      [entry("z.ysm", "folder/z.ysm"), entry("a.ysm", "a.ysm")],
      "name",
      "",
      null,
    );
    expect(treeKeys(root)).toEqual(["a.ysm", "folder"]);
  });
});

describe("buildTree 过滤", () => {
  it("search 关键字过滤文件名", () => {
    const root = buildTree(
      [entry("hero.ysm", "hero.ysm"), entry("villain.ysm", "villain.ysm")],
      "name",
      "hero",
      null,
    );
    expect(treeKeys(root)).toEqual(["hero.ysm"]);
  });

  it("filterPaths 只保留集合内的 fullPath", () => {
    const root = buildTree(
      [entry("a.ysm", "a.ysm", 0, 0, "/repo/a.ysm"), entry("b.ysm", "b.ysm", 0, 0, "/repo/b.ysm")],
      "name",
      "",
      new Set(["/repo/b.ysm"]),
    );
    expect(treeKeys(root)).toEqual(["b.ysm"]);
  });

  it("Windows 分隔符路径归一为嵌套目录", () => {
    const root = buildTree([entry("a.ysm", "folder\\sub\\a.ysm")], "name", "", null);
    const folder = root["folder"];
    expect(folder).toBeDefined();
    expect(Object.keys(folder as Record<string, unknown>)).toEqual(["sub"]);
  });
});

describe("flattenVisible", () => {
  beforeEach(() => {
    selectState.keys.clear();
    selectState.lastKey = null;
  });

  it("折叠的目录只输出文件夹行（不递归）", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm")],
      "name",
      "",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", {}, 0, "grid");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("folder");
    expect(rows[0].key).toBe("folder");
    expect(rows[0].isOpen).toBe(false);
  });

  it("展开的目录递归输出子文件行", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm"), entry("b.ysm", "folder/sub/b.ysm")],
      "name",
      "",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", { "folder": true, "folder/sub": true }, 0, "grid");
    const types = rows.map((r) => r.type);
    expect(types).toEqual(["folder", "folder", "file", "file"]);
  });

  it("搜索时目录自动展开（shouldOpen = hasSearch || dirOpen）", () => {
    const root = buildTree(
      [entry("target.ysm", "folder/target.ysm")],
      "name",
      "",
      null,
    );
    const rows = flattenVisible(root, "", "target", "name", {}, 0, "grid");
    const fileRow = rows.find((r) => r.type === "file");
    expect(fileRow).toBeDefined();
    expect(fileRow?.key).toBe("folder/target.ysm");
  });

  it("文件行 key 用 fullPath（选中匹配依据）", () => {
    const root = buildTree(
      [entry("a.ysm", "folder/a.ysm", 0, 0, "/repo/folder/a.ysm")],
      "name",
      "",
      null,
    );
    const rows = flattenVisible(root, "", "", "name", { "folder": true }, 0, "grid");
    const fileRow = rows.find((r) => r.type === "file");
    expect(fileRow?.key).toBe("/repo/folder/a.ysm");
  });
});
