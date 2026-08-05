// ===== sidebar MMD 变体聚合纯函数测试 =====
// groupMmdVariants：按父文件夹聚合 .pmx 变体 / 单层路径自身为组 / Windows 分隔符归一 / 去重。
import { describe, it, expect, vi } from "vitest";
import { groupMmdVariants } from "./loader.ts";

// 阻断 Wails runtime 加载链：loader.ts 顶部静态 import bindings → @wailsio/runtime
// （其 drag.js 在模块加载时访问 window，jsdom teardown 后延迟回调触发
// "window is not defined" 环境噪声）。groupMmdVariants 是纯函数不依赖 bindings，mock 安全。
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn(),
  ListVersionInstances: vi.fn(),
  GetResourceInstanceStatus: vi.fn(),
  GetRepoRoot: vi.fn(),
}));

describe("groupMmdVariants", () => {
  it("按父文件夹聚合 missing/extra 变体", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups).toEqual(["char"]);
    expect(r.variantMap["char"]).toEqual({
      items: ["char/a.pmx", "char/b.pmx", "char/c.pmx"],
      count: 3,
    });
  });

  it("单层路径无父文件夹 → 自身为组", () => {
    const r = groupMmdVariants(["solo.pmx"], []);
    expect(r.missingGroups).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].items).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].count).toBe(1);
  });

  it("Windows 分隔符归一为 / 后聚合（items 保留原始路径供展示）", () => {
    const r = groupMmdVariants(["dir\\sub\\a.pmx"], []);
    expect(r.missingGroups).toEqual(["dir/sub"]);
    expect(r.variantMap["dir/sub"].items).toEqual(["dir\\sub\\a.pmx"]);
  });

  it("同父文件夹缺失+多余 → missing 与 extra 组都保留（seen 隔离）", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx", "other/d.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups.sort()).toEqual(["char", "other"]);
  });

  it("多个目录分别聚合，组列表去重", () => {
    const r = groupMmdVariants(["x/a.pmx", "x/b.pmx", "y/c.pmx"], []);
    expect(r.missingGroups.sort()).toEqual(["x", "y"]);
  });

  it("空列表 → 空组与空 map", () => {
    const r = groupMmdVariants([], []);
    expect(r.missingGroups).toEqual([]);
    expect(r.extraGroups).toEqual([]);
    expect(Object.keys(r.variantMap)).toHaveLength(0);
  });
});
