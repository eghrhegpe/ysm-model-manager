// ===== cube-mesh.ts — 立方体几何构建 + UV解析 + 旋转工具 =====
// 从 spec-builder.ts 拆出（ADR-040 P1），仅含自包含的立方体处理函数。
// 对齐 Go threejs/spec.go buildCubeMeshData / parseUV / eulerToQuaternion 等。
// 旋转工具已进一步拆至 quaternion.ts（ADR-040 ≤400 行红线），此处 re-export 保兼容。
// ADR-052 P3: 坐标口径收敛——骨骼位置计算统一为此模块导出工具。

import type { Cube2D, MeshData, Vec3 } from "./spec-builder.ts";
import { eulerToQuaternion, isIdentityQuat, hasBoneRotation } from "./quaternion.ts";
import { CUBE_EPS } from "./model3d-spec.ts";

/**
 * 计算骨骼本地位置（对齐 YSMViewer/C# ConvertBones 口径）。
 * 
 * 公式：
 * - 有父骨骼：localPos = (parent.pivot.x - bone.pivot.x, bone.pivot.y - parent.pivot.y, bone.pivot.z - parent.pivot.z)
 * - 无父骨骼：localPos = (-bone.pivot.x, bone.pivot.y, bone.pivot.z)
 * 
 * X 轴翻转是 ysmview 口径的关键特征（trap #11 反复修的根源）。
 * 
 * @param bonePivot 骨骼自身 pivot
 * @param parentPivot 父骨骼 pivot（null 表示根骨骼）
 * @returns [x, y, z] 本地位置
 */
export function computeBoneLocalPos(bonePivot: Vec3, parentPivot: Vec3 | null): [number, number, number] {
  if (parentPivot) {
    return [parentPivot.x - bonePivot.x, bonePivot.y - parentPivot.y, bonePivot.z - parentPivot.z];
  }
  return [-bonePivot.x, bonePivot.y, bonePivot.z];
}

// 旋转工具 re-export（spec-builder.ts / model-group-builder.ts 仍自本文件取，消费方零改动）
export { eulerToQuaternion, isIdentityQuat, hasBoneRotation } from "./quaternion.ts";

/** 零厚度面修正值（避免 Three.js 渲染零面积面）——收敛于 model3d-spec.ts 的 CUBE_EPS 单点 */
const THICKNESS_EPSILON = CUBE_EPS;

/**
 * 有限性守卫：任一值为 NaN/±Infinity 则 warn 并返回 false。
 * 收敛 buildCubeMeshData 内三处同构的 `Number.isNaN || !Number.isFinite` 检查链
 * （入口 / inflate 运算后 / 顶点派生后，原 33-44、62-73、92-100 行）。
 * @param vals 待检数值数组
 * @param label 失败时的诊断前缀（含 bone/cube 标识）
 * @returns true 全通过；false 有非法值（调用方 return null）
 */
function assertFinite(vals: number[], label: string): boolean {
  for (const v of vals) {
    if (Number.isNaN(v) || !Number.isFinite(v)) {
      console.warn(`[spec-builder] 跳过非法 cube（${label}）val=${v}`);
      return false;
    }
  }
  return true;
}

/** 同名骨骼 cube 合并的浮点 epsilon ——收敛于 model3d-spec.ts 的 CUBE_EPS 单点 */
const CUBE_EPSILON = CUBE_EPS;

type FaceUV8 = [number, number, number, number, number, number, number, number];
type FaceKey = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';
interface OriginSizeResult { ox: number; oy: number; oz: number; sx: number; sy: number; sz: number; }
interface PivotVerticesResult { cp: [number, number, number]; lx: number; ly: number; lz: number; hx: number; hy: number; hz: number; }

// ===== 子函数：origin/size 预处理 =====
function mdCmPrepOriginSize(c: Cube2D, boneID: string, cubeIdx: number): OriginSizeResult | null {
  if (!assertFinite(
    [c.origin[0], c.origin[1], c.origin[2], c.size[0], c.size[1], c.size[2], c.pivot[0], c.pivot[1], c.pivot[2], c.inflate],
    `非有限数值 bone=${boneID} cube=${cubeIdx}`,
  )) return null;

  let ox = c.origin[0];
  let oy = c.origin[1];
  let oz = c.origin[2];
  let sx = c.size[0];
  let sy = c.size[1];
  let sz = c.size[2];

  ox = -(ox + sx);

  if (c.inflate !== 0) {
    ox -= c.inflate;
    oy -= c.inflate;
    oz -= c.inflate;
    sx += 2 * c.inflate;
    sy += 2 * c.inflate;
    sz += 2 * c.inflate;
  }
  if (!assertFinite(
    [ox, oy, oz, sx, sy, sz],
    `inflate 运算溢出 bone=${boneID} cube=${cubeIdx}`,
  )) return null;
  if (sx < THICKNESS_EPSILON) sx = THICKNESS_EPSILON;
  if (sy < THICKNESS_EPSILON) sy = THICKNESS_EPSILON;
  if (sz < THICKNESS_EPSILON) sz = THICKNESS_EPSILON;

  return { ox, oy, oz, sx, sy, sz };
}

// ===== 子函数：pivot 处理 + 顶点派生 =====
function mdCmPrepPivotAndVertices(
  c: Cube2D, boneID: string, cubeIdx: number,
  os: OriginSizeResult,
): PivotVerticesResult | null {
  const { ox, oy, oz, sx, sy, sz } = os;

  let cp: [number, number, number] = [c.pivot[0], c.pivot[1], c.pivot[2]];
  cp[0] = -cp[0];
  if (!c.pivotSet) {
    cp = [ox + sx * 0.5, oy + sy * 0.5, oz + sz * 0.5];
  }

  const fx = ox, fy = oy, fz = oz;
  const tx = ox + sx, ty = fy + sy, tz = fz + sz;
  if (!assertFinite(
    [tx, ty, tz],
    `顶点派生溢出 bone=${boneID} cube=${cubeIdx}`,
  )) return null;

  const cx = (fx + tx) * 0.5;
  const cy = (fy + ty) * 0.5;
  const cz = (fz + tz) * 0.5;
  const hx2 = (tx - fx) * 0.5;
  const hy2 = (ty - fy) * 0.5;
  const hz2 = (tz - fz) * 0.5;

  let lx = cx - hx2 - cp[0];
  let ly = cy - hy2 - cp[1];
  let lz = cz - hz2 - cp[2];
  let hx = cx + hx2 - cp[0];
  let hy = cy + hy2 - cp[1];
  let hz = cz + hz2 - cp[2];

  if (lx === hx) hx += THICKNESS_EPSILON;
  if (ly === hy) hy += THICKNESS_EPSILON;
  if (lz === hz) hz += THICKNESS_EPSILON;

  return { cp, lx, ly, lz, hx, hy, hz };
}

// ===== 子函数：单立方体面通用装配（消除 faceUV/uv 双写法）=====
function mdCmBuildFace(
  faceKey: FaceKey,
  pts: { lx: number; ly: number; lz: number; hx: number; hy: number; hz: number },
  uvData: FaceUV8,
  out: { positions: number[]; normals: number[]; uvs: number[]; indices: number[] },
): void {
  const { lx, ly, lz, hx, hy, hz } = pts;
  let v: number[];
  let n: [number, number, number];

  switch (faceKey) {
    case 'east':
      v = [hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz];
      n = [1, 0, 0];
      break;
    case 'west':
      v = [lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz];
      n = [-1, 0, 0];
      break;
    case 'up':
      v = [lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz];
      n = [0, 1, 0];
      break;
    case 'down':
      v = [lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz];
      n = [0, -1, 0];
      break;
    case 'south':
      v = [lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz];
      n = [0, 0, 1];
      break;
    case 'north':
      v = [hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz];
      n = [0, 0, -1];
      break;
  }

  const bi = out.positions.length / 3;
  for (let k = 0; k < v.length; k++) out.positions.push(v[k]);
  for (let r = 0; r < 4; r++) {
    out.normals.push(n[0], n[1], n[2]);
  }
  out.uvs.push(uvData[0], uvData[1], uvData[2], uvData[3], uvData[4], uvData[5], uvData[6], uvData[7]);
  out.indices.push(bi, bi + 2, bi + 1, bi + 2, bi + 3, bi + 1);
}

// ===== 公开导出 =====

/**
 * 从 Bedrock cube 数据构建 THREE.Mesh 几何数据。
 * 对齐 Go threejs/spec.go buildCubeMeshData（L397-586）。
 */
export function buildCubeMeshData(
  c: Cube2D,
  bonePivot: Vec3,
  texW: number,
  texH: number,
  boneID: string,
  cubeIdx: number,
): MeshData | null {
  const os = mdCmPrepOriginSize(c, boneID, cubeIdx);
  if (!os) return null;

  if (c.cubeTexW > 0) texW = c.cubeTexW;
  if (c.cubeTexH > 0) texH = c.cubeTexH;

  const pv = mdCmPrepPivotAndVertices(c, boneID, cubeIdx, os);
  if (!pv) return null;
  const { cp, lx, ly, lz, hx, hy, hz } = pv;

  const faceUVs: FaceUV8[] = [
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const hasUV = parseUV(c, faceUVs, c.size[0], c.size[1], c.size[2], texW, texH);
  if (c.mirror) {
    for (let fi = 0; fi < 6; fi++) {
      const tmp0 = faceUVs[fi][0];
      faceUVs[fi][0] = faceUVs[fi][2];
      faceUVs[fi][2] = tmp0;
      const tmp4 = faceUVs[fi][4];
      faceUVs[fi][4] = faceUVs[fi][6];
      faceUVs[fi][6] = tmp4;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const out = { positions, normals, uvs, indices };
  const faceKeys: FaceKey[] = ['east', 'west', 'up', 'down', 'south', 'north'];
  const pts = { lx, ly, lz, hx, hy, hz };

  for (let fi = 0; fi < faceKeys.length; fi++) {
    const uvData: FaceUV8 = hasUV ? faceUVs[fi] : [0, 0, 0, 0, 0, 0, 0, 0];
    mdCmBuildFace(faceKeys[fi], pts, uvData, out);
  }

  const meshID = boneID + "_" + cubeIdx;
  const localPos: [number, number, number] = [bonePivot.x + cp[0], cp[1] - bonePivot.y, cp[2] - bonePivot.z];
  const localRot = eulerToQuaternion(-c.rotation[0], -c.rotation[1], c.rotation[2]);

  return {
    id: meshID,
    boneId: boneID,
    localPosition: localPos,
    localRotation: localRot,
    positions,
    normals,
    uvs,
    indices,
    texIdx: c.texSlot,
  };
}

/**
 * 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加。
 * 对齐 Go threejs/spec.go mergeCubes（L593-614）。
 */
export function mergeCubes(oldCubes: Cube2D[], newCubes: Cube2D[]): Cube2D[] {
  const result: Cube2D[] = oldCubes.slice();
  const matched: boolean[] = new Array(oldCubes.length).fill(false);

  for (const nc of newCubes) {
    let found = -1;
    for (let i = 0; i < oldCubes.length; i++) {
      if (!matched[i] && cubesOverlap(oldCubes[i], nc)) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      result[found] = nc;
      matched[found] = true;
    } else {
      result.push(nc);
    }
  }
  return result;
}

// ===== parseUV — Go threejs/spec.go parseUV（L639-656）=====

/**
 * 解析 UV：faceUV 优先、失败回退 expandBoxUV、c.UV 回退。
 * 对齐 Go threejs/spec.go parseUV（L639-656）。
 */
function parseUV(
  c: Cube2D,
  faces: [number, number, number, number, number, number, number, number][],
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
): boolean {
  if (c.faceUV !== "") {
    if (parseFaceUV(c.faceUV, faces, texW, texH)) {
      return true;
    }
    // P3 修复：parseFaceUV 失败，若 c.UV 存在则回退 expandBoxUV
    if (c.uv.length >= 2) {
      return expandBoxUV(c.uv, sx, sy, sz, texW, texH, faces);
    }
    return false;
  }
  if (c.uv.length >= 2) {
    return expandBoxUV(c.uv, sx, sy, sz, texW, texH, faces);
  }
  return false;
}

// ===== 内部辅助函数 =====

function cubesOverlap(a: Cube2D, b: Cube2D): boolean {
  return floatEqual(a.origin, b.origin, CUBE_EPSILON) &&
    floatEqual(a.size, b.size, CUBE_EPSILON) &&
    floatEqual(a.rotation, b.rotation, CUBE_EPSILON);
}

function floatEqual(a: [number, number, number], b: [number, number, number], eps: number): boolean {
  for (let i = 0; i < 3; i++) {
    let v = a[i] - b[i];
    if (v < 0) v = -v;
    if (v > eps) return false;
  }
  return true;
}

function expandBoxUV(
  uv: [number, number],
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
  faces: [number, number, number, number, number, number, number, number][],
): boolean {
  // P3 修复：texW/texH ≤ 0 守卫
  if (texW <= 0 || texH <= 0) return false;
  const u = uv[0];
  const v = uv[1];
  const x = sx, y = sy, z = sz;

  const uvData: { fu: number; fv: number; fw: number; fh: number; f: number }[] = [
    { fu: u, fv: v + z, fw: z, fh: y, f: 0 },             // East
    { fu: u + z + x, fv: v + z, fw: z, fh: y, f: 1 },     // West
    { fu: u + z + x, fv: v + z, fw: -x, fh: -z, f: 2 },   // Up
    { fu: u + z + x + x, fv: v, fw: -x, fh: z, f: 3 },    // Down
    { fu: u + z + z + x, fv: v + z, fw: x, fh: y, f: 4 }, // South
    { fu: u + z, fv: v + z, fw: x, fh: y, f: 5 },         // North
  ];

  for (const d of uvData) {
    const u0 = d.fu / texW;
    const v0 = d.fv / texH;
    const u1 = (d.fu + d.fw) / texW;
    const v1 = (d.fv + d.fh) / texH;
    faces[d.f] = [u0, v0, u1, v0, u0, v1, u1, v1];
  }
  return true;
}

function parseFaceUV(
  faceUVStr: string,
  faces: [number, number, number, number, number, number, number, number][],
  texW: number,
  texH: number,
): boolean {
  let faceData: Record<string, { uv: number[]; uv_size?: number[] }>;
  try {
    faceData = JSON.parse(faceUVStr) as Record<string, { uv: number[]; uv_size?: number[] }>;
  } catch {
    console.warn("[spec-builder] parseFaceUV 失败: JSON 解析错误");
    return false;
  }

  const faceNames = ["east", "west", "up", "down", "south", "north"];
  for (let fi = 0; fi < faceNames.length; fi++) {
    const fd = faceData[faceNames[fi]];
    if (!fd || !fd.uv || fd.uv.length < 2) continue;
    const fu = fd.uv[0];
    const fv = fd.uv[1];
    let fw = 0, fh = 0;
    if (fd.uv_size && fd.uv_size.length >= 2) {
      fw = fd.uv_size[0];
      fh = fd.uv_size[1];
    }
    // P3 修复：与 expandBoxUV 的守卫对齐——texW/texH ≤ 0 时除零
    if (texW <= 0 || texH <= 0) return false;

    const u0 = fu / texW;
    const v0 = fv / texH;
    const u1 = (fu + fw) / texW;
    const v1 = (fv + fh) / texH;
    faces[fi] = [u0, v0, u1, v0, u0, v1, u1, v1];
  }
  return true;
}
