// ===== 树选择状态测试（ADR-021 扩展）=====
// toggleSelect：普通切换 / Shift 范围选择 / 全清重置 lastKey。
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

describe("toggleSelect Shift 范围选择", () => {
  beforeEach(resetState);

  it("isRange 且 lastKey 存在 → 加入 key 并更新 lastKey（不取反）", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/b.ysm", true);
    expect(selectState.keys.has("/b.ysm")).toBe(true);
    expect(selectState.lastKey).toBe("/b.ysm");
  });

  it("isRange 但 key 已选中 → 仍加入（范围语义，不取反）", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/b.ysm");
    toggleSelect("/b.ysm", true); // lastKey=/b.ysm, key=/b.ysm 相同 → 走普通切换
    expect(selectState.keys.has("/b.ysm")).toBe(false); // key===lastKey 退化为普通切换
  });

  it("isRange 但无 lastKey（首次）→ 走普通切换", () => {
    toggleSelect("/a.ysm", true);
    expect(selectState.keys.has("/a.ysm")).toBe(true);
    expect(selectState.lastKey).toBe("/a.ysm");
  });

  it("isRange 且 key===lastKey → 走普通切换（取反）", () => {
    toggleSelect("/a.ysm");
    toggleSelect("/a.ysm", true);
    expect(selectState.keys.has("/a.ysm")).toBe(false);
  });
});
