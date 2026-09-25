// ===== morph-controls 契约测试（[doc:adr-126-p5-收尾] morphNodes 声明式节点）=====
// 覆盖：toggle 节点结构 / get-set 闭包读写 mesh / 空态 / 缺 morphTargetInfluences 静默。

import { describe, it, expect } from "vitest";
import { renderCapToggle } from "@/preview-3d/menu/render/cap-controls.ts";
import { nodeControlToView } from "@/preview-3d/menu/render/render.ts";
import { findNodeById, nodeIds } from "@/preview-3d/menu/menu-test-helpers.ts";
import { morphNodes, type MorphMeshLike } from "./morph-controls.ts";

/** 三表情 mesh：微笑(0)/怒(1)/哀(2)，怒已激活（1），其余 0 */
function makeMesh(): MorphMeshLike {
  return {
    morphTargetDictionary: { 微笑: 0, 怒: 1, 哀: 2 },
    morphTargetInfluences: [0, 1, 0],
  };
}

describe("morphNodes（声明式 toggle 节点）", () => {
  it("每表情一个 toggle 节点，id 稳定，label = 表情名", () => {
    const nodes = morphNodes(makeMesh());
    // 3 节点成员（精确集合，不测顺序；三表情的 id 由 morphTargetDictionary 键生成）
    expect(nodeIds(nodes).sort()).toEqual(["morph-微笑", "morph-怒", "morph-哀"].sort());
    expect(nodes.every((n) => n.kind === "toggle")).toBe(true);
    const smile = findNodeById(nodes, "morph-微笑");
    expect(smile.label).toBe("微笑");
    // 无 labelKey（动态名不走 i18n）
    expect(smile.labelKey).toBeUndefined();
  });

  it("get 读当前权重（>0.5 活跃），set 切换 0/1", () => {
    const mesh = makeMesh();
    const nodes = morphNodes(mesh);
    // 怒已激活（1）→ get true（与 rmAppendToggle 一致传 undefined 参数）
    const angry = findNodeById(nodes, "morph-怒");
    expect(angry.control?.get?.(undefined)).toBe(true);
    // 微笑未激活（0）→ get false
    const smile = findNodeById(nodes, "morph-微笑");
    expect(smile.control?.get?.(undefined)).toBe(false);
    // set 微笑为 true → influences[0] = 1
    smile.control?.set?.(true);
    expect(mesh.morphTargetInfluences?.[0]).toBe(1);
    expect(smile.control?.get?.(undefined)).toBe(true);
    // set 怒为 false → influences[1] = 0
    angry.control?.set?.(false);
    expect(mesh.morphTargetInfluences?.[1]).toBe(0);
  });

  it("无 morph → 空态 field", () => {
    const nodes = morphNodes({ morphTargetDictionary: {}, morphTargetInfluences: [] });
    // 空态成员（精确集合）
    expect(nodeIds(nodes).sort()).toEqual(["morph-empty"].sort());
    const empty = findNodeById(nodes, "morph-empty");
    expect(empty).toMatchObject({ kind: "field", labelKey: "preview.noOtherMorph" });
  });

  it("缺 morphTargetInfluences → set 静默不崩", () => {
    const mesh: MorphMeshLike = { morphTargetDictionary: { 微笑: 0 } };
    const nodes = morphNodes(mesh);
    const smile = findNodeById(nodes, "morph-微笑");
    expect(() => smile.control?.set?.(true)).not.toThrow();
    // get 安全缺省 false
    expect(smile.control?.get?.(undefined)).toBe(false);
  });
});

describe("morphNodes → cap 栈渲染：表情名必须上屏（2026-09 空白行回归锁）", () => {
  // 链路 = renderMenu 的 toggle 分支：nodeControlToView（labelKey 空 / fallback = 表情名）
  // → renderCapToggle。渲染器曾只读 labelKey → tOf("") = "" → 整列无文字。
  it("三行 toggle 的 .slide-label 依次为 微笑 / 怒 / 哀", () => {
    const list = document.createElement("div");
    for (const n of morphNodes(makeMesh())) renderCapToggle(list, nodeControlToView(n));
    const labels = [...list.querySelectorAll(".slide-label")].map((el) => el.textContent);
    expect(labels).toEqual(["微笑", "怒", "哀"]);
  });

  it("开关行为不因取文本而失（点 label 区→ set 写回权重）", () => {
    const mesh = makeMesh();
    const list = document.createElement("div");
    const nodes = morphNodes(mesh);
    const smile = findNodeById(nodes, "morph-微笑");
    renderCapToggle(list, nodeControlToView(smile));
    (list.querySelector(".cc-labelbox") as HTMLElement).click();
    expect(mesh.morphTargetInfluences?.[0]).toBe(1);
  });
});
