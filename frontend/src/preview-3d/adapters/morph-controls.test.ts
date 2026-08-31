// ===== morph-controls 契约测试（[doc:adr-126-p5-收尾] morphNodes 声明式节点）=====
// 覆盖：toggle 节点结构 / get-set 闭包读写 mesh / 空态 / 缺 morphTargetInfluences 静默。

import { describe, it, expect } from "vitest";
import { morphNodes, type MorphMeshLike } from "./morph-controls.ts";

/** 三表情 mesh：微笑(0)/怒(1)/哀(2)，怒已激活（1），其余 0 */
function makeMesh(): MorphMeshLike {
  return {
    morphTargetDictionary: { 微笑: 0, 怒: 1, 哀: 2 },
    morphTargetInfluences: [0, 1, 0],
  };
}

describe("morphNodes（声明式 toggle 节点）", () => {
  it("每表情一个 toggle 节点，id 稳定，fallback = 表情名", () => {
    const nodes = morphNodes(makeMesh());
    expect(nodes.length).toBe(3);
    expect(nodes.map((n) => n.id)).toEqual(["morph-微笑", "morph-怒", "morph-哀"]);
    expect(nodes.every((n) => n.kind === "toggle")).toBe(true);
    expect(nodes[0].fallback).toBe("微笑");
    // 无 labelKey（动态名不走 i18n）
    expect(nodes[0].labelKey).toBeUndefined();
  });

  it("get 读当前权重（>0.5 活跃），set 切换 0/1", () => {
    const mesh = makeMesh();
    const nodes = morphNodes(mesh);
    // 怒已激活（1）→ get true（与 rmAppendToggle 一致传 undefined 参数）
    expect(nodes[1].control?.get?.(undefined)).toBe(true);
    // 微笑未激活（0）→ get false
    expect(nodes[0].control?.get?.(undefined)).toBe(false);
    // set 微笑为 true → influences[0] = 1
    nodes[0].control?.set?.(true);
    expect(mesh.morphTargetInfluences?.[0]).toBe(1);
    expect(nodes[0].control?.get?.(undefined)).toBe(true);
    // set 怒为 false → influences[1] = 0
    nodes[1].control?.set?.(false);
    expect(mesh.morphTargetInfluences?.[1]).toBe(0);
  });

  it("无 morph → 空态 field", () => {
    const nodes = morphNodes({ morphTargetDictionary: {}, morphTargetInfluences: [] });
    expect(nodes).toEqual([
      expect.objectContaining({ id: "morph-empty", kind: "field", labelKey: "preview.noOtherMorph" }),
    ]);
  });

  it("缺 morphTargetInfluences → set 静默不崩", () => {
    const mesh: MorphMeshLike = { morphTargetDictionary: { 微笑: 0 } };
    const nodes = morphNodes(mesh);
    expect(() => nodes[0].control?.set?.(true)).not.toThrow();
    // get 安全缺省 false
    expect(nodes[0].control?.get?.(undefined)).toBe(false);
  });
});
