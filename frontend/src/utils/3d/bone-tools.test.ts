// @vitest-environment node
// ===== 通用骨骼工具层测试（bone-tools.ts）=====
// 覆盖：buildBoneTree 层级构建 / listBonesWithDepth 深度缩进 / getBonePath /
// getBonePosition / getBoneDetail / setBoneNodeVisible + toggleBoneVisible。
// （拾取不在此层：ysm 走 bone-raycast、mmd 走 pickMmdBone，见 bone-tools.ts 审核注记）
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  buildBoneTree,
  listBonesWithDepth,
  getBonePath,
  getBonePosition,
  getBoneDetail,
  setBoneNodeVisible,
  toggleBoneVisible,
  type BoneNode,
} from "./bone-tools.ts";

/** 标准 YSM 扁平骨骼（root/spine/head 三级 + 孤儿节点） */
const FLAT_BONES = [
  { id: "root", name: "root" },
  { id: "spine", name: "spine", parentId: "root" },
  { id: "head", name: "head", parentId: "spine" },
  { id: "orphan", name: "orphan", parentId: "missing-parent" }, // 父不存在 → 归根
];

function treeWithObjects(): { tree: ReturnType<typeof buildBoneTree>; nodes: Map<string, THREE.Object3D> } {
  const objects = new Map<string, THREE.Object3D>();
  for (const b of FLAT_BONES) {
    const g = new THREE.Group();
    g.name = b.id;
    objects.set(b.id, g);
  }
  objects.get("head")!.parent = objects.get("spine")!;
  objects.get("spine")!.parent = objects.get("root")!;
  const tree = buildBoneTree(
    FLAT_BONES.map((b) => ({ ...b, object: objects.get(b.id) })),
  );
  return { tree, nodes: objects };
}

describe("buildBoneTree", () => {
  it("扁平声明 → byId/childrenMap/roots（父不存在归根）", () => {
    const tree = buildBoneTree(FLAT_BONES);
    expect(tree.byId.size).toBe(4);
    expect(tree.roots).toEqual(["root", "orphan"]);
    expect(tree.childrenMap.get("root")).toEqual(["spine"]);
    expect(tree.childrenMap.get("spine")).toEqual(["head"]);
    expect(tree.byId.get("head")!.parentId).toBe("spine");
  });

  it("空输入 → 空树（不抛）", () => {
    const tree = buildBoneTree([]);
    expect(tree.byId.size).toBe(0);
    expect(tree.roots).toEqual([]);
  });
});

describe("listBonesWithDepth", () => {
  it("前序遍历 + 深度缩进（根 0，逐级 +1）", () => {
    const tree = buildBoneTree(FLAT_BONES);
    const list = listBonesWithDepth(tree);
    expect(list).toEqual([
      { id: "root", name: "root", depth: 0 },
      { id: "spine", name: "spine", depth: 1 },
      { id: "head", name: "head", depth: 2 },
      { id: "orphan", name: "orphan", depth: 0 },
    ]);
  });
});

describe("getBonePath", () => {
  it("沿父链拼接全路径（root / spine / head）", () => {
    const tree = buildBoneTree(FLAT_BONES);
    expect(getBonePath("head", tree)).toBe("root / spine / head");
    expect(getBonePath("root", tree)).toBe("root");
  });

  it("未知 id → null", () => {
    const tree = buildBoneTree(FLAT_BONES);
    expect(getBonePath("nope", tree)).toBeNull();
  });
});

describe("getBonePosition", () => {
  it("有 object → 世界坐标；无 object → null", () => {
    const { tree } = treeWithObjects();
    tree.byId.get("head")!.object!.position.set(1, 2, 3);
    const pos = getBonePosition("head", tree);
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(1);
    expect(pos!.y).toBe(2);
    expect(pos!.z).toBe(3);
    // 无 object 的树
    const plain = buildBoneTree(FLAT_BONES);
    expect(getBonePosition("head", plain)).toBeNull();
  });
});

describe("getBoneDetail", () => {
  it("路径/坐标/父/子完整组装", () => {
    const { tree } = treeWithObjects();
    const detail = getBoneDetail("spine", tree)!;
    expect(detail.path).toBe("root / spine");
    expect(detail.parent).toEqual({ id: "root", name: "root" });
    expect(detail.children).toEqual([{ id: "head", name: "head" }]);
    expect(detail.position).not.toBeNull();
  });

  it("根骨骼 parent=null；未知 id → null", () => {
    const tree = buildBoneTree(FLAT_BONES);
    expect(getBoneDetail("root", tree)!.parent).toBeNull();
    expect(getBoneDetail("nope", tree)).toBeNull();
  });
});

describe("setBoneNodeVisible / toggleBoneVisible", () => {
  it("setBoneNodeVisible：节点 + 子网格全设；无 object no-op", () => {
    const { tree } = treeWithObjects();
    const head = tree.byId.get("head")!;
    head.object!.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    head.object!.traverse((c) => (c.visible = true));
    setBoneNodeVisible(head, false);
    let allHidden = true;
    head.object!.traverse((c) => {
      if (c.visible) allHidden = false;
    });
    expect(allHidden).toBe(true);
    // no-op：无 object 节点
    expect(() => setBoneNodeVisible(undefined, false)).not.toThrow();
  });

  it("toggleBoneVisible：取反", () => {
    const { tree } = treeWithObjects();
    const spine = tree.byId.get("spine")!;
    spine.object!.visible = true;
    toggleBoneVisible(spine);
    expect(spine.object!.visible).toBe(false);
    toggleBoneVisible(spine);
    expect(spine.object!.visible).toBe(true);
  });
});

// 类型引用守卫：BoneNode 结构可被 YSM/VRM 两侧填充
const _shape: BoneNode = { id: "x", name: "x", parentId: null };
void _shape;
