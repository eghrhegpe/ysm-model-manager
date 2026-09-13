// @vitest-environment node
// ===== focus-pending.ts 仓库搜索框焦点一次性 pending 标志测试 =====
// 纯模块级布尔态，无 DOM 依赖；node 环境最快。模块级状态跨用例存活，
// 故每个用例内显式 set 初值，避免与相邻用例串扰。
import { describe, it, expect } from "vitest";
import {
  setRepoSearchFocusPending,
  takeRepoSearchFocusPending,
} from "./focus-pending.ts";

describe("repo search focus pending — 一次性标志", () => {
  it("从未 set 时 take 返回 false", () => {
    setRepoSearchFocusPending(false);
    expect(takeRepoSearchFocusPending()).toBe(false);
  });

  it("set(true) 后 take 返回 true 并清零", () => {
    setRepoSearchFocusPending(true);
    expect(takeRepoSearchFocusPending()).toBe(true);
    // 清零：再次 take 为 false
    expect(takeRepoSearchFocusPending()).toBe(false);
  });

  it("set(false) 后 take 返回 false", () => {
    setRepoSearchFocusPending(false);
    expect(takeRepoSearchFocusPending()).toBe(false);
  });

  it("take 即清：连续 take 只在首次命中", () => {
    setRepoSearchFocusPending(true);
    expect(takeRepoSearchFocusPending()).toBe(true);
    expect(takeRepoSearchFocusPending()).toBe(false);
  });

  it("set(true) 后 set(false) 覆盖为 false", () => {
    setRepoSearchFocusPending(true);
    setRepoSearchFocusPending(false);
    expect(takeRepoSearchFocusPending()).toBe(false);
  });
});
