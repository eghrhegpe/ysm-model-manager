// @vitest-environment node
// ===== search-pending.ts 仓库树搜索词一次性 pending 测试（focus-pending 同族）=====
// 纯模块级状态，无 DOM 依赖；模块级状态跨用例存活，每个用例显式置初值防串扰。
import { describe, it, expect } from "vitest";
import { setPendingTreeSearch, takePendingTreeSearch } from "./search-pending.ts";

describe("tree search pending — 一次性词槽", () => {
  it("从未 set 时 take 返回 null", () => {
    setPendingTreeSearch(null);
    expect(takePendingTreeSearch()).toBe(null);
  });

  it("set(word) 后 take 返回词并清零", () => {
    setPendingTreeSearch("miko");
    expect(takePendingTreeSearch()).toBe("miko");
    expect(takePendingTreeSearch()).toBe(null);
  });

  it("take 即清：连续 take 只在首次命中", () => {
    setPendingTreeSearch("miko");
    expect(takePendingTreeSearch()).toBe("miko");
    expect(takePendingTreeSearch()).toBe(null);
  });

  it("后写覆盖先写；set(null) 清残", () => {
    setPendingTreeSearch("a");
    setPendingTreeSearch("b");
    expect(takePendingTreeSearch()).toBe("b");
    setPendingTreeSearch("c");
    setPendingTreeSearch(null);
    expect(takePendingTreeSearch()).toBe(null);
  });
});
