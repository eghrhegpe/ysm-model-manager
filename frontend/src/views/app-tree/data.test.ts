// @vitest-environment node
// ===== 树选择状态测试（ADR-021 扩展）=====
// toggleSelect：普通切换 / 全清重置 lastKey。Shift 范围选择由 events.ts 实现（需要可见行列表）。
// 重构：模块级 selectState → 实例级 SelectState（多实例隔离防串扰）
import { describe, it, expect, beforeEach } from "vitest";
import { toggleSelect, type SelectState } from "./data.ts";

function createState(): SelectState {
  return { keys: new Set(), lastKey: null };
}

describe("toggleSelect 普通切换", () => {
  let state: SelectState;
  beforeEach(() => { state = createState(); });

  it("未选中 → 加入 keys 并更新 lastKey", () => {
    toggleSelect(state, "/a.ysm");
    expect(state.keys.has("/a.ysm")).toBe(true);
    expect(state.lastKey).toBe("/a.ysm");
  });

  it("已选中 → 取消选中", () => {
    toggleSelect(state, "/a.ysm");
    toggleSelect(state, "/a.ysm");
    expect(state.keys.has("/a.ysm")).toBe(false);
  });

  it("多选累计", () => {
    toggleSelect(state, "/a.ysm");
    toggleSelect(state, "/b.ysm");
    toggleSelect(state, "/c.ysm");
    expect(state.keys.size).toBe(3);
  });

  it("删光后 lastKey 重置为 null", () => {
    toggleSelect(state, "/a.ysm");
    toggleSelect(state, "/b.ysm");
    toggleSelect(state, "/a.ysm");
    toggleSelect(state, "/b.ysm");
    expect(state.keys.size).toBe(0);
    expect(state.lastKey).toBeNull();
  });
});
