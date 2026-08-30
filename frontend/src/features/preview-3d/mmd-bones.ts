// ===== MMD 骨骼适配层（配合 bone-tools.ts 通用骨骼工具层，ADR-072 工具层纯净）=====
// 通用能力（树/列表/路径/详情/显隐）由 bone-tools.ts 提供（BoneNode 抽象，跨 YSM/VRM/MMD）；
// 本层只做两件事：
//  1) mmdBonesToBoneNodes：pmx.bones（索引结构）+ mesh.skeleton.bones（THREE.Bone）
//     → bone-tools.BoneNode[]（id = pmx 索引字符串，object = 对应 THREE.Bone）
//  2) pickMmdBone：MMD 特有骨骼拾取——THREE.Bone 无几何，bone-tools.pickBone 的
//     「网格面片归属拾取」（findAncestorBoneId 沿 mesh 父链找骨骼名）不适用于 MMD
//     （骨骼是 SkinnedMesh.skeleton.bones，不在 mesh 场景父链），改为射线到骨骼
//     worldPosition 的距离命中。
// 纯逻辑零 DOM——UI 渲染不在本层（对齐 ADR-072）。

import * as THREE from "three";
import type { BoneNode } from "./bone-tools.ts";

/** MMD 骨骼 → bone-tools BoneNode[]（id = pmx 索引字符串；越界父/自引用 → null 根） */
export function mmdBonesToBoneNodes(
  pmxBones: readonly { name: string; parentBoneIndex: number }[],
  meshBones: readonly THREE.Bone[],
): BoneNode[] {
  return pmxBones.map((b, i) => ({
    id: String(i),
    name: b.name,
    parentId:
      b.parentBoneIndex >= 0 && b.parentBoneIndex < pmxBones.length && b.parentBoneIndex !== i
        ? String(b.parentBoneIndex)
        : null,
    object: meshBones[i] ?? undefined,
  }));
}

/** 拾取结果（pickMmdBone 命中） */
export interface MmdBonePickResult {
  index: number;
  name: string;
  distance: number; // 射线到骨骼 worldPosition 的距离
}

/** MMD 骨骼拾取：射线到骨骼 worldPosition 距离命中（Bone 无几何，网格归属拾取不适用） */
export function pickMmdBone(
  meshBones: readonly THREE.Bone[],
  ray: THREE.Ray,
  maxDistance: number,
): MmdBonePickResult | null {
  if (maxDistance <= 0) return null;
  const maxSq = maxDistance * maxDistance;
  let best: MmdBonePickResult | null = null;
  let bestSq = Infinity;
  const wp = new THREE.Vector3();
  for (let i = 0; i < meshBones.length; i++) {
    const bone = meshBones[i];
    if (!bone || !bone.visible) continue; // 隐藏骨骼不参与拾取
    bone.getWorldPosition(wp);
    const d = ray.distanceSqToPoint(wp);
    if (d <= maxSq && d < bestSq) {
      bestSq = d;
      best = { index: i, name: bone.name || "", distance: Math.sqrt(d) };
    }
  }
  return best;
}
