// ===== recycle-bin 过滤谓词测试（code_review P3 补测）=====
// 覆盖 isPathInRoot 的路径分隔符边界语义：ysm vs ysm2 误入、精确根匹配、
// 缺失 Path、尾部分隔符 root（specificRoot 返回用户配置原值可能带尾斜杠）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPathInRoot } from "./recycle-bin.ts";

describe("isPathInRoot — 回收站路径前缀过滤", () => {
  it("根目录内子文件命中", () => {
    expect(isPathInRoot("D:/games/ysm/a.ysm", "D:/games/ysm")).toBe(true);
    expect(isPathInRoot("D:/games/ysm/sub/b.ysm", "D:/games/ysm")).toBe(true);
  });

  it("精确根目录本身命中", () => {
    expect(isPathInRoot("D:/games/ysm", "D:/games/ysm")).toBe(true);
  });

  it("共享前缀的同名兄弟目录不误入（ysm2 vs ysm）", () => {
    expect(isPathInRoot("D:/games/ysm2/a.ysm", "D:/games/ysm")).toBe(false);
    expect(isPathInRoot("D:/games/ysm-extra/a.ysm", "D:/games/ysm")).toBe(false);
  });

  it("root 尾部带分隔符仍命中（specificRoot 用户配置原值）", () => {
    expect(isPathInRoot("D:/games/ysm/a.ysm", "D:/games/ysm/")).toBe(true);
    expect(isPathInRoot("D:/games/ysm/a.ysm", "D:/games/ysm//")).toBe(true);
  });

  it("Windows 反斜杠与正斜杠混用归一化", () => {
    expect(isPathInRoot("D:\\games\\ysm\\a.ysm", "D:/games/ysm")).toBe(true);
    expect(isPathInRoot("D:\\games\\ysm2\\a.ysm", "D:/games/ysm")).toBe(false);
  });
});
