// @vitest-environment node
// ===== bone-visibility.ts 契约测试 =====
// 覆盖：setBoneVisible / toggleBone 的 traverse 递归显隐 + 缺键 no-op，
// showModelGroup 的单组件显示 / idx<0 全显 / NaN 防御 / 越界全隐 / 空数组。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  setBoneVisible,
  toggleBone,
  showModelGroup,
  type BoneGroupMap,
} from "./bone-visibility.ts";

/** root 组含一个子 Mesh（visible=false 初始），验证 traverse 递归生效 */
function makeBoneGroupMap(): BoneGroupMap {
  const root = new THREE.Group();
  const child = new THREE.Mesh(new THREE.BufferGeometry());
  child.visible = false;
  root.add(child);
  return new Map([["root", root]]);
}

describe("setBoneVisible", () => {
  it("true/false 设到组及所有子节点（traverse 递归）", () => {
    const map = makeBoneGroupMap();
    const root = map.get("root")!;

    setBoneVisible(map, "root", true);
    expect(root.visible).toBe(true);
    expect(root.children[0].visible).toBe(true);

    setBoneVisible(map, "root", false);
    expect(root.visible).toBe(false);
    expect(root.children[0].visible).toBe(false);
  });

  it("缺键 → no-op 不抛", () => {
    const map = makeBoneGroupMap();
    expect(() => setBoneVisible(map, "missing", true)).not.toThrow();
  });
});

describe("toggleBone", () => {
  it("组与子节点各自取反（混合初始态）", () => {
    const map = makeBoneGroupMap();
    const root = map.get("root")!;
    root.visible = true;
    root.children[0].visible = false; // 与组相反

    toggleBone(map, "root");
    expect(root.visible).toBe(false);
    expect(root.children[0].visible).toBe(true);
  });

  it("缺键 → no-op 不抛", () => {
    const map = makeBoneGroupMap();
    expect(() => toggleBone(map, "missing")).not.toThrow();
  });
});

describe("showModelGroup", () => {
  function makeGroups(): THREE.Group[] {
    return [new THREE.Group(), new THREE.Group(), new THREE.Group()];
  }

  it("idx>=0 → 仅该组件显示", () => {
    const groups = makeGroups();
    showModelGroup(groups, 1);
    expect(groups.map((g) => g.visible)).toEqual([false, true, false]);
  });

  it("idx=-1 → 全部显示", () => {
    const groups = makeGroups();
    showModelGroup(groups, -1);
    expect(groups.map((g) => g.visible)).toEqual([true, true, true]);
  });

  it("NaN 防御 → 按全部显示处理", () => {
    const groups = makeGroups();
    showModelGroup(groups, Number.NaN);
    expect(groups.map((g) => g.visible)).toEqual([true, true, true]);
  });

  it("idx 越界 → 全部隐藏（i === idx 恒 false 且 idx>=0）", () => {
    const groups = makeGroups();
    showModelGroup(groups, 5);
    expect(groups.map((g) => g.visible)).toEqual([false, false, false]);
  });

  it("空数组 → 不抛", () => {
    expect(() => showModelGroup([], 0)).not.toThrow();
  });
});
