import * as THREE from "three";
import type { MeshFragment } from "./face-split.ts";

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

function bakeBatch(batch: readonly MeshFragment[]): MeshFragment {
  const first = batch[0]!.md;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const { md } of batch) {
    const rotation = md.localRotation;
    _rotation.set(
      rotation?.[0] ?? 0,
      rotation?.[1] ?? 0,
      rotation?.[2] ?? 0,
      rotation?.[3] ?? 1,
    );
    const tx = md.localPosition?.[0] ?? 0;
    const ty = md.localPosition?.[1] ?? 0;
    const tz = md.localPosition?.[2] ?? 0;

    for (let i = 0; i < md.positions.length; i += 3) {
      _position
        .set(md.positions[i] ?? 0, md.positions[i + 1] ?? 0, md.positions[i + 2] ?? 0)
        .applyQuaternion(_rotation);
      positions.push(_position.x + tx, _position.y + ty, _position.z + tz);
    }
    for (let i = 0; i < md.normals.length; i += 3) {
      _normal
        .set(md.normals[i] ?? 0, md.normals[i + 1] ?? 0, md.normals[i + 2] ?? 0)
        .applyQuaternion(_rotation);
      normals.push(_normal.x, _normal.y, _normal.z);
    }
    uvs.push(...md.uvs);
    for (const index of md.indices) indices.push(index + vertexOffset);
    vertexOffset += md.positions.length / 3;
  }

  return {
    mode: batch[0]!.mode,
    md: {
      id: `${first.boneId}_baked_${first.texIdx ?? 0}_${batch[0]!.mode}`,
      boneId: first.boneId,
      texIdx: first.texIdx,
      localPosition: [0, 0, 0],
      localRotation: [0, 0, 0, 1],
      positions,
      normals,
      uvs,
      indices,
    },
  };
}
