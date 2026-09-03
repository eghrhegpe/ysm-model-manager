// ===== MMD VPD 纯逻辑（从 mmd-adapter 抽出，mmd-* 一族「一关注点一模块」惯例）=====
// applyVPDToMesh 自包含纯函数：0 依赖适配器 ctx，仅消费 mesh 骨骼 + VPD 数据，
// 可独立测试 / 独立消费。绕过 MMDLoader 的 worker 构建路径（c.workerResult 非空时
// 无 mmd 实例可用，需在 mesh 上直接应用 VPD 骨骼变形 + morph 权重）。
import type { VpdObject } from "@moeru/three-mmd";
import * as THREE from "three";

/** 直接在 SkinnedMesh 上应用 VPD pose（骨骼坐标转换 + morph 权重；worker 构建路径专用） */
export function applyVPDToMesh(mesh: THREE.SkinnedMesh, vpd: VpdObject): void {
  const vpdBones = vpd?.bones;
  if (!vpdBones) return;

  // 建立骨骼名 → bone 对象的映射（O(1) 查找）
  const bonesByName = new Map<string, THREE.Bone>();
  mesh.skeleton?.bones.forEach((b) => {
    if (b.name) bonesByName.set(b.name, b);
  });

  // VPD 骨骼变换（含坐标系转换）
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (const [name, transform] of Object.entries(vpdBones)) {
    const bone = bonesByName.get(name);
    if (!bone || !transform) continue;

    if (transform.position !== undefined) {
      position.set(transform.position[0], transform.position[1], -transform.position[2]);
      bone.position.add(position);
    }
    rotation.set(
      -transform.rotation[0],
      -transform.rotation[1],
      transform.rotation[2],
      transform.rotation[3],
    );
    bone.quaternion.multiply(rotation);
  }

  // Morph 影响
  if (vpd.morphs) {
    const dict = mesh.morphTargetDictionary;
    for (const [name, weight] of Object.entries(vpd.morphs)) {
      const index = dict?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = weight;
      }
    }
  }

  mesh.updateMatrixWorld(true);
  bonesByName.clear();
}