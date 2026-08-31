// @vitest-environment node
// ===== MMD 骨骼适配层测试（preview-3d/mmd-bones.ts + bone-tools.ts 通用层集成）=====
// 覆盖：mmdBonesToBoneNodes 适配正确性（id/parentId/object）、与 bone-tools 通用层集成
// （buildBoneTree / listBonesWithDepth / getBoneDetail / setBoneNodeVisible 作用于 MMD 数据）、
// pickMmdBone 拾取（射线距离命中 / 阈值 / 隐藏跳过）。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { mmdBonesToBoneNodes, pickMmdBone } from "./mmd-bones.ts";
import { buildBoneTree, listBonesWithDepth, getBoneDetail, setBoneNodeVisible } from "./bone-tools.ts";

// 骨骼数据：0 骨盆（根）、1 脊柱（0 子）、2 头（1 子）、3 左腿（0 子）、4 独立根（父越界 5 → 根）
const PMX = [
  { name: "骨盆", parentBoneIndex: -1, position: [0, 0, 0] },
  { name: "脊柱", parentBoneIndex: 0, position: [0, 1, 0] },
  { name: "头", parentBoneIndex: 1, position: [0, 2, 0] },
  { name: "左腿", parentBoneIndex: 0, position: [0.5, 0, 0] },
  { name: "独立根", parentBoneIndex: 5, position: [5, 5, 5] },
];

/** 构造与 PMX 索引对齐的 THREE.Bone 数组（position 同步，world = local） */
function makeBones(): THREE.Bone[] {
  return PMX.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.position[0], b.position[1], b.position[2]);
    bone.updateMatrixWorld(true);
    return bone;
  });
}

describe("mmdBonesToBoneNodes 适配", () => {
  it("id = pmx 索引字符串、parentId = 父索引/null、object = 对应 THREE.Bone", () => {
    const nodes = mmdBonesToBoneNodes(PMX, makeBones());
    expect(nodes.length).toBe(5);
    expect(nodes[0]).toEqual({
      id: "0",
      name: "骨盆",
      parentId: null,
      object: expect.any(THREE.Bone),
    });
    expect(nodes[1].parentId).toBe("0");
    expect(nodes[2].parentId).toBe("1");
    expect(nodes[4].parentId).toBe(null); // 越界父 → null 根
    expect(nodes[1].object).toBeInstanceOf(THREE.Bone);
  });
});

describe("与 bone-tools 通用层集成", () => {
  it("buildBoneTree：树结构与 MMD 父子一致（根 = 骨盆 + 独立根）", () => {
    const tree = buildBoneTree(mmdBonesToBoneNodes(PMX, makeBones()));
    expect([...tree.roots].sort()).toEqual(["0", "4"]);
    expect([...(tree.childrenMap.get("0") || [])].sort()).toEqual(["1", "3"]);
    expect(tree.childrenMap.get("1")).toEqual(["2"]);
  });

  it("listBonesWithDepth：深度缩进（头 depth 2 / 根 depth 0）", () => {
    const tree = buildBoneTree(mmdBonesToBoneNodes(PMX, makeBones()));
    const list = listBonesWithDepth(tree);
    const head = list.find((b) => b.id === "2")!;
    expect(head.depth).toBe(2);
    expect(head.name).toBe("头");
    expect(list.find((b) => b.id === "0")!.depth).toBe(0);
  });

  it("getBoneDetail：路径/父骨骼 + setBoneNodeVisible 作用于 MMD bone", () => {
    const bones = makeBones(); // 复用同一数组（tree 的 object 引用同一批 bone）
    const tree = buildBoneTree(mmdBonesToBoneNodes(PMX, bones));
    const d = getBoneDetail("2", tree)!;
    expect(d.path).toContain("骨盆");
    expect(d.path).toContain("脊柱");
    expect(d.path).toContain("头");
    expect(d.parent).toEqual({ id: "1", name: "脊柱" });
    expect(d.children).toEqual([]);
    expect(d.position?.y).toBeCloseTo(2, 5);
    // 显隐：setBoneNodeVisible 经 traverse 设置 THREE.Bone.visible（同一 bones 数组）
    setBoneNodeVisible(tree.byId.get("0"), false);
    expect(bones[0].visible).toBe(false);
  });
});

describe("pickMmdBone（MMD 特有拾取：Bone 无几何，网格归属拾取不适用）", () => {
  it("射线距离命中：取最近且 < maxDistance 的骨骼", () => {
    const bones = makeBones(); // 骨盆 y0 / 脊柱 y1 / 头 y2
    const ray = new THREE.Ray(new THREE.Vector3(0, 5, -5), new THREE.Vector3(0, 0, 1));
    const hit = pickMmdBone(bones, ray, 3.5);
    expect(hit?.index).toBe(2); // 头（y2，距离 3）
    expect(hit?.name).toBe("头");
    expect(hit?.distance).toBeCloseTo(3, 5);
  });

  it("阈值外不命中（null）+ maxDistance<=0 直接 null", () => {
    const bones = makeBones();
    const ray = new THREE.Ray(new THREE.Vector3(0, 5, -5), new THREE.Vector3(0, 0, 1));
    expect(pickMmdBone(bones, ray, 2)).toBeNull(); // 最近距离 3 > 2
    expect(pickMmdBone(bones, ray, 0)).toBeNull();
  });

  it("隐藏骨骼不参与拾取", () => {
    const bones = makeBones();
    bones[2].visible = false; // 隐藏头（原本最近，距离 3）
    const ray = new THREE.Ray(new THREE.Vector3(0, 5, -5), new THREE.Vector3(0, 0, 1));
    expect(pickMmdBone(bones, ray, 3.5)).toBeNull(); // 隐藏后最近 = 脊柱（距离 4）> 3.5
    const hit = pickMmdBone(bones, ray, 4.5);
    expect(hit?.index).toBe(1); // 脊柱
  });
});
