// ===== 树选择状态测试（ADR-021 扩展）=====
// toggleSelect：普通切换 / 全清重置 lastKey。Shift 范围选择由 events.ts 实现（需要可见行列表）。
import { describe, it, expect, beforeEach } from "vitest";
import { toggleSelect, selectState } from "./data.ts";

/** 重置模块级共享状态（selectState 是导出的单例） */
function resetState() {
  selectState.keys.clear();
  selectState.lastKey = null;
}

describe("toggleSelect 普通切换", () => {
  beforeEach(resetState);

  it("未选中 → 加入 keys 并更新 lastKey", () => {
    toggleSelect("/a.ysm");
    expect(selectState.keys.has("/a.ysm")).toBe(true);
    expect(selectState.lastKey).toBe("/a.ysm");
  });

  it("已选中 → 取消选中", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/a.ysm");
    expect(selectState.keys.has("/a.ysm")).toBe(false);
  });

  it("多选累计", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/b.ysm");
    toggleSelect("/c.ysm");
    expect(selectState.keys.size).toBe(3);
  });

  it("删光后 lastKey 重置为 null", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/b.ysm");
    toggleSelect("/a.ysm");
    toggleSelect("/b.ysm");
    expect(selectState.keys.size).toBe(0);
    expect(selectState.lastKey).toBeNull();
  });
});
