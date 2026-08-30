// ===== face-split — 按面（三角形 UV 区域）拆分网格的透明渲染路径（ADR-118 Phase B）=====
// ModernYSM TranslucencyScanner 的前端对应物：mesh 级整图判定升级为面级，
// blend 面隔离进透明批次，opaque/cutout 面继续烘合——根治「杂点/局部混合拖全模型」。
import * as THREE from "three";
import {
  ALPHA_F_HOLE,
  ALPHA_F_TRANSLUCENT,
} from "./alpha-index.ts";
import { getTextureAlphaInfo } from "./texture-alpha.ts";
import type { TextureAlphaMode } from "./texture-alpha.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

/** 网格碎片：同一 meshGroup 按 alpha 特征拆出的子几何 + 渲染路径 */
export interface MeshFragment {
  md: SpecMeshGroup3D;
  mode: TextureAlphaMode;
}

/**
 * 按三角形 UV 包围盒查询 AlphaIndex，把 md 拆成 ≤3 个 mode 碎片。
 * 返回 null = 无法面级判定（flipY 纹理 / 像素不可读），调用方回退整图模式。
 * UV 域约定：YSM 主链路 flipY=false，v 直接映射图像行（top-down）。
 */
export function splitMeshByFaceAlpha(
  md: SpecMeshGroup3D,
  texture: THREE.Texture,
): MeshFragment[] | null {
  if (texture.flipY) return null;
  const info = getTextureAlphaInfo(texture);
  const index = info.index;
  if (!index || index.width === 0 || info.width === 0) return null;

  const buckets = new Map<TextureAlphaMode, number[]>();
  const triCount = Math.floor(md.indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const vi = (md.indices[t * 3 + k] ?? 0) * 2;
      const u = md.uvs[vi] ?? 0;
      const v = md.uvs[vi + 1] ?? 0;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const flags = index.query(
      Math.floor(u0 * info.width),
      Math.floor(v0 * info.height),
      Math.ceil(u1 * info.width) - 1,
      Math.ceil(v1 * info.height) - 1,
    );
    const mode: TextureAlphaMode = flags & ALPHA_F_TRANSLUCENT
      ? "blend"
      : flags & ALPHA_F_HOLE
      ? "cutout"
      : "opaque";
    const list = buckets.get(mode);
    if (list) list.push(t);
    else buckets.set(mode, [t]);
  }
  if (buckets.size === 0) return null;

  const frags: MeshFragment[] = [];
  for (const [mode, tris] of buckets) frags.push({ md: extractFragment(md, tris), mode });
  return frags;
}

function extractFragment(md: SpecMeshGroup3D, tris: number[]): SpecMeshGroup3D {
  const used = new Set<number>();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) used.add(md.indices[t * 3 + k] ?? 0);
  }
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  let next = 0;
  for (const src of used) {
    remap.set(src, next++);
    positions.push(
      md.positions[src * 3] ?? 0,
      md.positions[src * 3 + 1] ?? 0,
      md.positions[src * 3 + 2] ?? 0,
    );
    normals.push(
      md.normals[src * 3] ?? 0,
      md.normals[src * 3 + 1] ?? 0,
      md.normals[src * 3 + 2] ?? 0,
    );
    uvs.push(md.uvs[src * 2] ?? 0, md.uvs[src * 2 + 1] ?? 0);
  }
  const indices: number[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) indices.push(remap.get(md.indices[t * 3 + k] ?? 0) ?? 0);
  }
  return { ...md, positions, normals, uvs, indices };
}
