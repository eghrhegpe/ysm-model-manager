// ===== VRM Humanoid bones 提取适配（通用骨骼工具层，ADR-072 工具层纯净）=====
// 从 vrm.humanoid 提取标准人形骨骼（hips/spine/chest/head/leftUpperArm…~52 个），
// 输出为通用 BoneNode[]（features/preview-3d/bone-tools.ts 的 buildBoneTree 直接消费）。
// 层级来源：VRM humanoid 不直接暴露 parent 字段——沿 vrm.scene 的 Object3D 父链
// 向上找最近的人类骨骼节点推导 parentId（rig 层级即真实父子关系）。
// 纯数据提取：无 backend import、无 DOM、不渲染 UI。

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { buildBoneTree, type BoneNode, type BoneTree } from "../bone-tools.ts";

/** 标准 Humanoid bones 数量上限（VRMSpec 定义 52 个；防御守卫用） */
const MAX_HUMANOID_BONES = 52;

/**
 * 从 vrm.humanoid 提取标准人形骨骼列表（id = HumanoidBoneName 如 "leftUpperArm"）。
 * parentId 沿 scene 父链推导：node.parent 向上找最近的人类骨骼节点。
 * 空 humanoid / 无骨骼 → []（VRM 缺少 humanoid 扩展时降级为空树，不抛错）。
 */
export function buildVrmBoneNodes(vrm: VRM): BoneNode[] {
  const humanoid = vrm.humanoid;
  if (!humanoid?.humanBones) return [];

  // 节点 → boneName 反查表（父链推导用；node 即 THREE.Object3D 引用）
  const nodeToName = new Map<THREE.Object3D, string>();
  for (const [name, bone] of Object.entries(humanoid.humanBones)) {
    if (bone?.node) nodeToName.set(bone.node, name);
  }

  const nodes: BoneNode[] = [];
  let guard = 0;
  for (const [name, bone] of Object.entries(humanoid.humanBones)) {
    if (!bone?.node) continue;
    if (++guard > MAX_HUMANOID_BONES) break; // 防御：异常数据不无限膨胀
    // 沿 Object3D 父链向上找最近的人类骨骼节点 → 其 boneName 即 parentId
    let parentId: string | null = null;
    let cur: THREE.Object3D | null = bone.node.parent;
    while (cur) {
      const pName = nodeToName.get(cur);
      if (pName) {
        parentId = pName;
        break;
      }
      cur = cur.parent;
    }
    nodes.push({ id: name, name, parentId, object: bone.node });
  }
  return nodes;
}

/** 从 vrm.humanoid 直接构建通用骨骼树（buildBoneNodes → buildBoneTree 一步到位） */
export function buildVrmBoneTree(vrm: VRM): BoneTree {
  return buildBoneTree(buildVrmBoneNodes(vrm));
}
