// ===== entry-key 树行键空间契约测试（ADR-222 单一事实源；2026-09 锐评 P2 补测） =====
// 契约：fullPath 优先（磁盘完整路径），缺失回落 path（相对路径）。
// 三处消费（TreeRow.key / data-fullpath / selectState.keys）同源比对——
// 键漂移会让 Shift 范围选择、右键批量、全选、键盘导航、双击重命名全体静默失效。

import { describe, expect, it } from "vitest";
import { entryKey } from "./entry-key.ts";
import type { TreeEntry } from "./loader.ts";

function entry(partial: Partial<TreeEntry>): TreeEntry {
  return partial as TreeEntry;
}

describe("entryKey", () => {
  it("fullPath 存在时优先（磁盘完整路径为权威键）", () => {
    expect(entryKey(entry({ fullPath: "D:/repo/sub/a.model3.json", path: "sub/a.model3.json" }))).toBe(
      "D:/repo/sub/a.model3.json",
    );
  });

  it("fullPath 缺失（空串）时回落 path", () => {
    expect(entryKey(entry({ fullPath: "", path: "sub/b.model3.json" }))).toBe("sub/b.model3.json");
  });

  it("两者皆缺时返回 undefined（falsy，不抛错——真实数据中 Go 扫描恒带 path，此为防御边界）", () => {
    expect(entryKey(entry({}))).toBeUndefined();
  });

  it("fullPath 与 path 同值时键唯一（同源约束下无二义）", () => {
    const same = "D:/repo/c.model3.json";
    expect(entryKey(entry({ fullPath: same, path: same }))).toBe(same);
  });
});
