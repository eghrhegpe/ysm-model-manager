import * as THREE from "three";
import type { MeshFragment } from "./face-split.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

const _position = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _rotation = new THREE.Quaternion();

/** Bake fragments once, then batch by animated bone, texture, and alpha mode. */
export function bakeMeshFragments(fragments: readonly MeshFragment[]): MeshFragment[] {
  const batches = new Map<string, MeshFragment[]>();
  for (const frag of fragments) {
    const key = `${frag.md.boneId}:${frag.md.texIdx ?? 0}:${frag.mode}`;
    const batch = batches.get(key);
    if (batch) batch.push(frag);
    else batches.set(key, [frag]);
  }
  return Array.from(batches.values(), bakeBatch);
}

/** 顶点坐标烘焙：localPosition 平移 + localRotation 旋转写进顶点（返回新数组） */
function bakedPositions(md: SpecMeshGroup3D, rotation: THREE.Quaternion): number[] {
  const tx = md.localPosition?.[0] ?? 0;
  const ty = md.localPosition?.[1] ?? 0;
  const tz = md.localPosition?.[2] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < md.positions.length; i += 3) {
    _position
      .set(md.positions[i] ?? 0, md.positions[i + 1] ?? 0, md.positions[i + 2] ?? 0)
      .applyQuaternion(rotation);
    out.push(_position.x + tx, _position.y + ty, _position.z + tz);
  }
  return out;
}

/** 法线烘焙：仅旋转（不平移） */
function bakedNormals(md: SpecMeshGroup3D, rotation: THREE.Quaternion): number[] {
  const out: number[] = [];
  for (let i = 0; i < md.normals.length; i += 3) {
    _normal
      .set(md.normals[i] ?? 0, md.normals[i + 1] ?? 0, md.normals[i + 2] ?? 0)
      .applyQuaternion(rotation);
    out.push(_normal.x, _normal.y, _normal.z);
  }
  return out;
}

function bakeBatch(batch: readonly MeshFragment[]): MeshFragment {
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  const first = batch[0]!.md;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const { md } of batch) {
    const rotation = md.localRotation;
    _rotation.set(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0, rotation?.[3] ?? 1);
    positions.push(...bakedPositions(md, _rotation));
    normals.push(...bakedNormals(md, _rotation));
    uvs.push(...md.uvs);
    for (const index of md.indices) indices.push(index + vertexOffset);
    vertexOffset += md.positions.length / 3;
  }

  return {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    mode: batch[0]!.mode,
    md: {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      id: `${first.boneId}_baked_${first.texIdx ?? 0}_${batch[0]!.mode}`,
      boneId: first.boneId,
      // texIdx 为 SpecMeshGroup3D 可选键（model3d，非本域）——仅真实存在时附带
      ...(first.texIdx !== undefined ? { texIdx: first.texIdx } : {}),
      localPosition: [0, 0, 0],
      localRotation: [0, 0, 0, 1],
      positions,
      normals,
      uvs,
      indices,
    },
  };
}
