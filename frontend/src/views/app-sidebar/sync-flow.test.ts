// ===== sync-flow 叶函数直测 =====
// ADR-340 去总线化（2026-10-14）：原 waitBusQuiet（总线静默宽限）与 nextPushToken
// （回执 token 单调序号）两段直测随协议补丁实现退役——Promise 直调天然具备
// 请求-响应匹配与错误传播，它们守护的是补丁本身。现留守：pruneCheckedSets。
import { describe, it, expect } from "vitest";

import { pruneCheckedSets } from "./sync-flow.ts";
import type { SidebarInstance } from "./data.ts";

// P1 修复回归锁（2026-10 锐评）：勾选集合按 rtype 存实例名，实例被删除后名字
// 永远留在集合里（幽灵名）——重名实例再现时会被静默勾选，集合也只涨不消。
// pruneCheckedSets 在每次成功 reload 后把不在最新列表里的名字修剪掉。
describe("pruneCheckedSets（幽灵名修剪）", () => {
  function inst(name: string): SidebarInstance {
    return {
      name,
      dir: `/mc/instances/${name}`,
      exists: true,
      hasMod: true,
      status: "complete",
      synced: 1,
      missing: 0,
      extra: 0,
      disabled: 0,
      rtype: "ysm",
    };
  }

  function makeSets(entries: Array<[string, string[]]>): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const [rtype, names] of entries) m.set(rtype, new Set(names));
    return m;
  }

  it("已删除实例名被修剪，存活实例名保留", () => {
    const sets = makeSets([
      ["ysm", ["live", "ghost"]],
      ["vrm", ["other"]],
    ]);
    pruneCheckedSets("ysm", [inst("live")], () => sets);

    expect([...sets.get("ysm")!]).toEqual(["live"]);
    // 其他 rtype 的集合不受影响（按 rtype 隔离修剪）
    expect([...sets.get("vrm")!]).toEqual(["other"]);
  });

  it("空实例列表 → 不修剪（可能是加载失败/未配置 mcRoot 的空结果，保守保留）", () => {
    const sets = makeSets([["ysm", ["live"]]]);
    pruneCheckedSets("ysm", [], () => sets);
    expect([...sets.get("ysm")!]).toEqual(["live"]);
  });

  it("无该 rtype 的集合 / 空集合 → 无操作不建桶", () => {
    // 空集合场景：有桶但无名字 → 不建新桶、不报错
    const emptySets = new Map<string, Set<string>>([["ysm", new Set()]]);
    pruneCheckedSets("ysm", [inst("a")], () => emptySets);
    expect(emptySets.has("vrm")).toBe(false);

    // 完全不存在的 rtype：不得创建新桶
    const noBucket = makeSets([["ysm", ["a"]]]);
    pruneCheckedSets("vrm", [inst("a")], () => noBucket);
    expect(noBucket.has("vrm")).toBe(false);
  });
});
