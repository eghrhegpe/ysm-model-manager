// @vitest-environment node
// ===== FBX 骨骼适配层测试（utils/3d/fbx-bones.ts + bone-tools.ts 通用层集成）=====
// 覆盖：fbxBonesToBoneNodes 适配正确性（id=索引/parentId=父索引/object）、无 SkinnedMesh
// → 空数组（面板不注入 bones 项）、多 SkinnedMesh 收拢、与 bone-tools 通用层集成
// （buildBoneTree 树结构）——ADR-074 S2 通用骨骼面板扩展的 FBX 侧入口。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { fbxBonesToBoneNodes } from "./fbx-bones.ts";
import { buildBoneTree } from "./bone-tools.ts";

/** 构造层级骨骼链：parent → child（add 建立 Object3D 父子关系） */
function boneChain(names: string[]): THREE.Bone[] {
  const bones = names.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
  return bones;
}

/** 构造带骨骼的 SkinnedMesh（fbx-parser buildMesh 产物的最小等价：已 bind 的 SkinnedMesh） */
function skinnedMeshWith(bones: THREE.Bone[]): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

describe("fbxBonesToBoneNodes 适配", () => {
  it("单链层级：id=索引、parentId=父索引、根为 null、object=Bone 引用", () => {
    const bones = boneChain(["Hips", "Spine", "Head"]);
    const group = new THREE.Group();
    group.add(skinnedMeshWith(bones));

    const nodes = fbxBonesToBoneNodes(group);
    expect(nodes.length).toBe(3);
    expect(nodes[0]).toEqual({
      id: "0",
      name: "Hips",
      parentId: null,
      object: expect.any(THREE.Bone),
    });
    expect(nodes[1].parentId).toBe("0");
    expect(nodes[2].parentId).toBe("1");
    expect(nodes[0].object).toBe(bones[0]);
  });

  it("多根骨骼（FBX 可多根）：parent 非骨骼时 parentId=null", () => {
    const rootA = boneChain(["RootA", "ChildA"]);
    const rootB = boneChain(["RootB", "ChildB"]);
    const group = new THREE.Group();
    group.add(skinnedMeshWith([...rootA, ...rootB]));

    const nodes = fbxBonesToBoneNodes(group);
    const roots = nodes.filter((n) => n.parentId === null).map((n) => n.name).sort();
    expect(roots).toEqual(["RootA", "RootB"]);
  });

  it("骨骼名重复/为空：索引 id 恒唯一，显示名兜底", () => {
    const b1 = new THREE.Bone();
    b1.name = "bone";
    const b2 = new THREE.Bone();
    b2.name = "bone"; // 重名
    const b3 = new THREE.Bone();
    b3.name = "  "; // 空白名 → 兜底 bone-2
    const group = new THREE.Group();
    group.add(skinnedMeshWith([b1, b2, b3]));

    const nodes = fbxBonesToBoneNodes(group);
    expect(nodes.map((n) => n.id)).toEqual(["0", "1", "2"]); // 索引 id 恒唯一
    expect(nodes[0].name).toBe("bone");
    expect(nodes[1].name).toBe("bone");
    expect(nodes[2].name).toBe("bone-2");
  });

  it("无 SkinnedMesh → 空数组（面板不注入 bones 项）", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    expect(fbxBonesToBoneNodes(group)).toEqual([]);
  });

  it("多 SkinnedMesh 骨骼收拢合并（遍历全场景）", () => {
    const group = new THREE.Group();
    group.add(skinnedMeshWith(boneChain(["A1", "A2"])));
    group.add(skinnedMeshWith(boneChain(["B1", "B2"])));
    const nodes = fbxBonesToBoneNodes(group);
    expect(nodes.map((n) => n.name)).toEqual(["A1", "A2", "B1", "B2"]);
  });
});

describe("与 bone-tools 通用层集成", () => {
  it("buildBoneTree：FBX 层级 → 标准骨骼树（父/子/根与 FBX 一致）", () => {
    const bones = boneChain(["Hips", "Spine", "Head"]);
    const group = new THREE.Group();
    group.add(skinnedMeshWith(bones));

    const tree = buildBoneTree(fbxBonesToBoneNodes(group));
    expect([...tree.roots]).toEqual(["0"]);
    expect(tree.childrenMap.get("0")).toEqual(["1"]);
    expect(tree.childrenMap.get("1")).toEqual(["2"]);
  });
});
