// ===== FBX 骨骼 → 通用 BoneNode 适配（ADR-074 S2 通用骨骼面板扩展）=====
// FBX 是「模型 + 骨架 + 内嵌动画」完整容器，骨骼在 fbx-parser.ts 重建为 THREE.Bone[]
// （SkinnedMesh.skeleton.bones，bone.parent 形成层级，可多根）。本函数把场景中全部
// SkinnedMesh 的骨骼收拢为 BoneNode[]（对齐 mmd-bones.ts 索引模式：id=索引、parentId=父索引），
// 供 bone-tools.ts 的 buildBoneTree 直接消费——骨骼面板渲染复用 makeBonePanelRenderer，
// 不新增 FBX 专属面板代码（ADR-074 扩展模式：新格式 = 一个骨骼适配 + 复用面板）。
// 纯逻辑零 DOM（ADR-072 工具层纯净）；无 SkinnedMesh → 空数组（面板不注入 bones 项）。

import * as THREE from "three";
import type { BoneNode } from "./bone-tools.ts";

/** 遍历场景收拢全部 SkinnedMesh 的骨骼（去重由 THREE Skeleton 保证：同一 Bone 只属于一个骨架） */
function collectSkinnedBones(group: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  group.traverse((o) => {
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton?.bones) {
      bones.push(...sk.skeleton.bones);
    }
  });
  return bones;
}

/**
 * FBX 场景骨骼 → BoneNode[]（id=骨骼索引、parentId=父骨骼索引、object=Bone 引用）。
 * 索引做 id 而非名称：FBX 骨骼名可重复/为空，索引恒唯一；面板显示名用 bone.name 兜底。
 * @param group 已重建的 FBX 场景根（buildFbxScene 产物，worker/主线程两路径同构）
 */
export function fbxBonesToBoneNodes(group: THREE.Object3D): BoneNode[] {
  const bones = collectSkinnedBones(group);
  if (!bones.length) return [];

  // bone → 索引反查（父链推导用；FBX 多根骨骼，parent 非骨骼时 parentId=null）
  const idx = new Map<THREE.Bone, number>();
  bones.forEach((b, i) => idx.set(b, i));

  return bones.map((b, i) => ({
    id: String(i),
    name: b.name?.trim() || `bone-${i}`,
    parentId: b.parent && idx.has(b.parent as THREE.Bone) ? String(idx.get(b.parent as THREE.Bone)!) : null,
    object: b,
  }));
}
