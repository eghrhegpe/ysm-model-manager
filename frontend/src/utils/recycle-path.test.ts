// @vitest-environment node
// ===== recycle-path 段判定测试（G5 收口：helper 单测，迁移自 community data.test.ts）=====
// 覆盖：.recycle 段命中（任意层级/大小写不敏感/反斜杠）、普通路径不误伤、
// 文件名含 .recycle 不误伤（段语义 vs 子串 Contains 的关键区分）、空串。
import { describe, it, expect } from "vitest";
import { hasRecycleSegment } from "./recycle-path.ts";

describe("hasRecycleSegment", () => {
  it("回收站目录段 .recycle 命中（任意层级/大小写不敏感）", () => {
    expect(hasRecycleSegment(".recycle/a.ysm")).toBe(true);
    expect(hasRecycleSegment(".recycle/[作者]/a.ysm")).toBe(true);
    expect(hasRecycleSegment("作者/.RECYCLE/a.ysm")).toBe(true); // EqualFold 对齐 Go
    expect(hasRecycleSegment("作者/a.ysm")).toBe(false); // 普通子目录不误伤
    expect(hasRecycleSegment("a.ysm")).toBe(false);
    expect(hasRecycleSegment("")).toBe(false);
  });

  it("Windows 反斜杠路径同样命中（拆 / 与 \\ 双分隔符）", () => {
    expect(hasRecycleSegment(".recycle\\a.ysm")).toBe(true);
    expect(hasRecycleSegment("作者\\.recycle\\子\\a.ysm")).toBe(true);
    expect(hasRecycleSegment("作者\\a.ysm")).toBe(false);
  });

  it("段语义：文件名含 .recycle 不误伤（my.recycle.backup.ysm 是文件名非目录段）", () => {
    expect(hasRecycleSegment("作者/my.recycle.backup.ysm")).toBe(false);
    expect(hasRecycleSegment("my.recycle")).toBe(false);
  });

  it("段边界：.recycle 子串但非独立段（如 x.recycle/ 前缀段）不命中", () => {
    expect(hasRecycleSegment("x.recycle/a.ysm")).toBe(false);
    expect(hasRecycleSegment("a.recyclex/b.ysm")).toBe(false);
  });
});
