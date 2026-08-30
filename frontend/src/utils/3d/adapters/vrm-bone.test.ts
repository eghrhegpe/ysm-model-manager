// @vitest-environment node
// ===== VRM Humanoid bones 提取适配测试（vrm-bone.ts）=====
// 覆盖：标准骨骼命名提取 / 沿 scene 父链推导 parentId / 无 humanoid 降级空树 /
// 层级树构建一步到位。用 fake VRM 对象（结构对齐 three-vrm VRMHumanoid）。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildVrmBoneNodes, buildVrmBoneTree } from "./vrm-bone.ts";
import { listBonesWithDepth } from "../bone-tools.ts";
import type { VRM } from "@pixiv/three-vrm";

/** 构造 fake VRM：humanBones 结构对齐 three-vrm（key=boneName，node=Object3D） */
function fakeVrm(boneNames: string[]): { vrm: { humanoid: unknown }; nodes: Map<string, THREE.Object3D> } {
  const nodes = new Map<string, THREE.Object3D>();
  for (const n of boneNames) {
    const g = new THREE.Group();
    g.name = n;
    nodes.set(n, g);
  }
  const humanBones: Record<string, { node: THREE.Object3D }> = {};
  for (const n of boneNames) humanBones[n] = { node: nodes.get(n)! };
  return {
    vrm: {
      humanoid: {
        humanBones,
        getNormalizedBone: () => null,
      },
    },
    nodes,
  };
}

describe("buildVrmBoneNodes", () => {
  it("标准 Humanoid 骨骼全量提取（id = boneName）", () => {
    const { vrm } = fakeVrm(["hips", "spine", "chest", "head", "leftUpperArm", "leftLowerArm", "leftHand"]);
    const bones = buildVrmBoneNodes(vrm as unknown as VRM);
    expect(bones.map((b) => b.id).sort()).toEqual(
      ["hips", "spine", "chest", "head", "leftUpperArm", "leftLowerArm", "leftHand"].sort(),
    );
    expect(bones.every((b) => b.name === b.id)).toBe(true);
  });

  it("沿 scene 父链推导 parentId（spine 父=hips；无骨骼祖先 → 根）", () => {
    const { vrm, nodes } = fakeVrm(["hips", "spine", "chest", "head"]);
    // 手动搭 Object3D 父链：head→chest→spine→hips
    nodes.get("head")!.parent = nodes.get("chest")!;
    nodes.get("chest")!.parent = nodes.get("spine")!;
    nodes.get("spine")!.parent = nodes.get("hips")!;
    const bones = buildVrmBoneNodes(vrm as unknown as VRM);
    const byId = new Map(bones.map((b) => [b.id, b]));
    expect(byId.get("head")!.parentId).toBe("chest");
    expect(byId.get("chest")!.parentId).toBe("spine");
    expect(byId.get("spine")!.parentId).toBe("hips");
    expect(byId.get("hips")!.parentId).toBeNull(); // 最顶无骨骼祖先 → 根
  });

  it("父链中间夹非骨骼节点 → 跨过找最近骨骼祖先", () => {
    const { vrm, nodes } = fakeVrm(["hips", "spine", "head"]);
    // head → (中间 rig 节点，非骨骼) → spine → hips
    const rig = new THREE.Group();
    rig.name = "rig";
    rig.parent = nodes.get("spine")!;
    nodes.get("head")!.parent = rig;
    const bones = buildVrmBoneNodes(vrm as unknown as VRM);
    const byId = new Map(bones.map((b) => [b.id, b]));
    expect(byId.get("head")!.parentId).toBe("spine");
  });

  it("无 humanoid / 空 humanBones → 空数组（不抛）", () => {
    expect(buildVrmBoneNodes({} as unknown as VRM)).toEqual([]);
    expect(buildVrmBoneNodes({ humanoid: { humanBones: {} } } as unknown as VRM)).toEqual([]);
  });
});

describe("buildVrmBoneTree", () => {
  it("一步到位构建树：层级深度正确（hips→spine→chest→head 深度 0-3）", () => {
    const { vrm, nodes } = fakeVrm(["hips", "spine", "chest", "head"]);
    nodes.get("head")!.parent = nodes.get("chest")!;
    nodes.get("chest")!.parent = nodes.get("spine")!;
    nodes.get("spine")!.parent = nodes.get("hips")!;
    const tree = buildVrmBoneTree(vrm as unknown as VRM);
    const list = listBonesWithDepth(tree);
    expect(list.map((b) => b.id)).toEqual(["hips", "spine", "chest", "head"]);
    expect(list.map((b) => b.depth)).toEqual([0, 1, 2, 3]);
  });
});
