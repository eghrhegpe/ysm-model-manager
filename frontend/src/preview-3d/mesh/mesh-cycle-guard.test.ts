// @vitest-environment node
// ===== mesh 骨骼父链环兜底（特征测试：2026-10 认知复杂度战役第 4a 批补）=====
//
// buildSceneMesh 的环边兜底此前**无任何测试**：既有用例（model3d.test.ts）的骨骼树
// 全是合法无环链，故 `isCycle` 告警分支与「父骨不在本组件内」分支从未执行。而它挡的是
// Three.js 的静默致命路径——Three.js 只拦 `object === this` 的 self 环，不拦 A↔B 互指，
// `updateMatrixWorld` 首次遍历即无限递归 RangeError（Go spec.go 的 ParentID 直透不校验环）。
//
// 用**真 three**（非 model3d.test.ts 的 FakeGroup 桩——桩不维护 child.parent，环检测
// 根本无从触发）：① 环边被跳过并告警；② 畸形环 spec 下场景树仍无环、遍历不炸栈。
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Spec3D } from "./model3d.ts";
import { buildSceneMesh } from "./mesh.ts";

/** 单位骨骼（localRotation 为单位四元数 ⇒ 走 applyRotationIfNonIdentity 的零旋转快路） */
function bone(id: string, parentId?: string) {
  return {
    id,
    name: id,
    ...(parentId === undefined ? {} : { parentId }),
    localPosition: [0, 0, 0],
    localRotation: [0, 0, 0, 1],
  };
}

/** 沿 parent 上溯到顶（无环则必终止于无父根）；返回 true = 上溯终止（无环） */
function ancestorChainIsAcyclic(node: THREE.Object3D): boolean {
  const seen = new Set<THREE.Object3D>();
  let cursor: THREE.Object3D | null = node;
  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = cursor.parent;
  }
  return true;
}

describe("buildSceneMesh 环边兜底", () => {
  it("A↔B 互指父链：后到环边被跳过并告警，场景树无环（updateMatrixWorld 不炸栈）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec: Spec3D = {
      models: [{ id: "main", bones: [bone("a", "b"), bone("b", "a")] }],
    };

    const { boneGroupMap, rootGroup } = buildSceneMesh(spec);
    const a = boneGroupMap.get("0:a");
    const b = boneGroupMap.get("0:b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // 第二遍按骨骼序挂载：a 请求父 b（此时 b 未挂任何父 ⇒ 无环）→ a 挂到 b；
    // 轮到 b 请求父 a 时，a 已在 b 之下 ⇒ 命中环 ⇒ 跳过该边。
    // 注：现状语义下被跳过的 b 成为孤儿（既不在父下也不在组件组）——这是既有行为，
    // 本用例只钉「不构成环」这一安全不变量，不钉孤儿的去留（见报告「疑似缺陷」）。
    expect(b?.children).toContain(a);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("跳过骨骼父链环"));

    // 真正的不变量：整棵树无环——有环时这一行就是 RangeError: Maximum call stack size exceeded
    expect(() => rootGroup.updateMatrixWorld(true)).not.toThrow();
    if (a) expect(ancestorChainIsAcyclic(a)).toBe(true);
    if (b) expect(ancestorChainIsAcyclic(b)).toBe(true);
    warn.mockRestore();
  });

  it("self 父边（parentId === id）被拒：骨骼挂组件组，不构成自环", () => {
    const spec: Spec3D = { models: [{ id: "main", bones: [bone("solo", "solo")] }] };

    const { boneGroupMap, rootGroup, modelGroups } = buildSceneMesh(spec);
    const solo = boneGroupMap.get("0:solo");

    expect(modelGroups[0]?.children).toContain(solo);
    expect(solo?.parent).toBe(modelGroups[0]);
    expect(() => rootGroup.updateMatrixWorld(true)).not.toThrow();
  });

  it("父骨不在本组件内（同 id 存在于别的组件）→ 挂本组件组，不跨组件误挂", () => {
    const spec: Spec3D = {
      models: [
        { id: "compA", bones: [bone("root")] },
        { id: "compB", bones: [bone("child", "root")] }, // 组件 B 里没有 root 骨
      ],
    };

    const { modelGroups } = buildSceneMesh(spec);

    // 全局 key "root" 属于组件 A，但组件 B 查的是 compKey(1,"root")（不存在）
    // ⇒ 组件 B 的 child 挂组件 B 的组，组件 A 的组不受污染。
    expect(modelGroups[1]?.children).toHaveLength(1);
    expect(modelGroups[1]?.children[0]?.name).toBe("child");
    expect(modelGroups[0]?.children).toHaveLength(1);
    expect(modelGroups[0]?.children[0]?.name).toBe("root");
  });
});
