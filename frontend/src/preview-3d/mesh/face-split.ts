// ===== face-split — 按面（三角形 UV 区域）拆分网格的透明渲染路径（ADR-118 Phase B）=====
// ModernYSM TranslucencyScanner 的前端对应物：mesh 级整图判定升级为面级，
// blend 面隔离进透明批次，opaque/cutout 面继续烘合——根治「杂点/局部混合拖全模型」。
import type * as THREE from "three";
import { ALPHA_F_HOLE, ALPHA_F_TRANSLUCENT } from "@/preview-3d/materials/alpha-index.ts";
import type { TextureAlphaInfo, TextureAlphaMode } from "@/preview-3d/texture/texture-alpha.ts";
import { getTextureAlphaInfo } from "@/preview-3d/texture/texture-alpha.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

/** 网格碎片：同一 meshGroup 按 alpha 特征拆出的子几何 + 渲染路径 */
export interface MeshFragment {
  md: SpecMeshGroup3D;
  mode: TextureAlphaMode;
}

/** 计算三角形 UV 包围盒 [u0, v0, u1, v1] */
function computeTriBounds(md: SpecMeshGroup3D, t: number): [number, number, number, number] {
  let u0 = Infinity,
    v0 = Infinity,
    u1 = -Infinity,
    v1 = -Infinity;
  for (let k = 0; k < 3; k++) {
    const vi = (md.indices[t * 3 + k] ?? 0) * 2;
    const u = md.uvs[vi] ?? 0;
    const v = md.uvs[vi + 1] ?? 0;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  return [u0, v0, u1, v1];
}

/** 按 UV 包围盒查询 AlphaIndex，映射到渲染模式 */
function queryTriMode(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  info: TextureAlphaInfo,
): TextureAlphaMode {
  // biome-ignore lint/style/noNonNullAssertion: 调用方已判空（!index 早退）
  const flags = info.index!.query(
    Math.floor(u0 * info.width),
    Math.floor(v0 * info.height),
    Math.ceil(u1 * info.width) - 1,
    Math.ceil(v1 * info.height) - 1,
  );
  return flags & ALPHA_F_TRANSLUCENT ? "blend" : flags & ALPHA_F_HOLE ? "cutout" : "opaque";
}

/** 按 alpha 特征分桶所有三角形 */
function collectAlphaBuckets(
  md: SpecMeshGroup3D,
  info: TextureAlphaInfo,
): Map<TextureAlphaMode, number[]> {
  const buckets = new Map<TextureAlphaMode, number[]>();
  const triCount = Math.floor(md.indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const [u0, v0, u1, v1] = computeTriBounds(md, t);
    const mode = queryTriMode(u0, v0, u1, v1, info);
    const list = buckets.get(mode);
    if (list) list.push(t);
    else buckets.set(mode, [t]);
  }
  return buckets;
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

  const buckets = collectAlphaBuckets(md, info);
  if (buckets.size === 0) return null;

  const frags: MeshFragment[] = [];
  for (const [mode, tris] of buckets) frags.push({ md: extractFragment(md, tris), mode });
  return frags;
}

/** 收集三角形使用的顶点索引 */
function collectUsedVertices(md: SpecMeshGroup3D, tris: number[]): Set<number> {
  const used = new Set<number>();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) used.add(md.indices[t * 3 + k] ?? 0);
  }
  return used;
}

/** 重建顶点数据（positions/normals/uvs）并生成索引重映射 */
function rebuildVertexData(
  md: SpecMeshGroup3D,
  used: Set<number>,
): { positions: number[]; normals: number[]; uvs: number[]; remap: Map<number, number> } {
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
  return { positions, normals, uvs, remap };
}

/** 重映射三角形索引 */
function remapIndices(md: SpecMeshGroup3D, tris: number[], remap: Map<number, number>): number[] {
  const indices: number[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) indices.push(remap.get(md.indices[t * 3 + k] ?? 0) ?? 0);
  }
  return indices;
}

function extractFragment(md: SpecMeshGroup3D, tris: number[]): SpecMeshGroup3D {
  const used = collectUsedVertices(md, tris);
  const { positions, normals, uvs, remap } = rebuildVertexData(md, used);
  const indices = remapIndices(md, tris, remap);
  return { ...md, positions, normals, uvs, indices };
}
