// ===== multi-model.test.ts — 多模型选择菜单原语测试（ADR-132）=====
// 覆盖：
//   1. 单候选 → 返回 null（无「选择」语义，调用方不注入）
//   2. 多候选 → 返回 kind:"select" 节点，options/get/set 装配齐全
//   3. get：读 activeId 闭包；闭包返回不在 entries 的 id → 回退首项
//   4. set：调 onSelect(id) 副作用 + 返回 id
//   5. 自定义 labelKey / fallback / nodeId 生效
import { describe, it, expect, vi } from "vitest";
import { multiModelSelectNode } from "./multi-model.ts";

const entries = [
  { id: "/a.pmx", label: "a.pmx" },
  { id: "/b.pmx", label: "b.pmx" },
  { id: "/c.pmx", label: "c.pmx" },
];

describe("multiModelSelectNode（ADR-132 多模型选择原语）", () => {
  it("单候选 → 返回 null（无选择语义）", () => {
    const node = multiModelSelectNode({
      entries: [{ id: "/a.pmx", label: "a.pmx" }],
      activeId: () => "/a.pmx",
      onSelect: () => {},
    });
    expect(node).toBeNull();
  });

  it("空候选 → 返回 null", () => {
    const node = multiModelSelectNode({ entries: [], activeId: () => "", onSelect: () => {} });
    expect(node).toBeNull();
  });

  it("多候选 → kind:select 节点，options 含全部候选", () => {
    const node = multiModelSelectNode({
      entries,
      activeId: () => "/a.pmx",
      onSelect: () => {},
    })!;
    expect(node.kind).toBe("select");
    expect(node.id).toBe("multi-model-select");
    expect(node.labelKey).toBe("preview.component");
    expect(node.fallback).toBe("模型");
    expect(node.control?.options?.map((o) => o.value)).toEqual(["/a.pmx", "/b.pmx", "/c.pmx"]);
    expect(node.control?.options?.[0].label).toBe("a.pmx");
  });

  it("get：读 activeId 闭包（返回当前选中）", () => {
    const node = multiModelSelectNode({
      entries,
      activeId: () => "/b.pmx",
      onSelect: () => {},
    })!;
    expect(node.control?.get?.(undefined)).toBe("/b.pmx");
  });

  it("get：activeId 返回不在 entries 的 id → 回退首项", () => {
    const node = multiModelSelectNode({
      entries,
      activeId: () => "/ghost.pmx",
      onSelect: () => {},
    })!;
    expect(node.control?.get?.(undefined)).toBe("/a.pmx");
  });

  it("set：调 onSelect(id) 副作用，返回 id", () => {
    const onSelect = vi.fn();
    const node = multiModelSelectNode({ entries, activeId: () => "/a.pmx", onSelect })!;
    const ret = node.control?.set?.("/c.pmx");
    expect(onSelect).toHaveBeenCalledWith("/c.pmx");
    expect(ret).toBe("/c.pmx");
  });

  it("set：非法 id（不在 entries）→ 不调 onSelect，仅返回原值", () => {
    const onSelect = vi.fn();
    const node = multiModelSelectNode({ entries, activeId: () => "/a.pmx", onSelect })!;
    const ret = node.control?.set?.("/ghost.pmx");
    expect(onSelect).not.toHaveBeenCalled();
    expect(ret).toBe("/ghost.pmx");
  });

  it("自定义 labelKey / fallback / nodeId 生效", () => {
    const node = multiModelSelectNode({
      entries,
      activeId: () => "/a.pmx",
      onSelect: () => {},
      labelKey: "preview.multiModel",
      fallback: "多模型",
      nodeId: "pack-model-select",
    })!;
    expect(node.labelKey).toBe("preview.multiModel");
    expect(node.fallback).toBe("多模型");
    expect(node.id).toBe("pack-model-select");
  });
});
