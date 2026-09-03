// ===== JS 兜底 Spec 构建（类型化版 — ADR-014 P2 大件收尾）=====
// 从 model3d.js 拆分：Go spec 不可用时 JS 端兜底算法
// 算法逻辑与 Go threejs.Build() 一致

/** 立方体几何 epsilon（0.001）——单点导出，cube-mesh.ts 的 THICKNESS_EPSILON/CUBE_EPSILON 同值收敛于此 */
export const CUBE_EPS = 0.001;

// ── 结构接口 ────────────────────────────────────────

/** 立方体（骨骼上的 box 元素） */
export interface SpecCube {
  origin?: number[];
  size?: number[];
  pivot?: number[];
  rotation?: number[];
  uv?: number[];
  faceUV?: string;
  inflate?: number; // Blockbench 膨胀（正=外扩，负=收缩），几何 origin-i、size+2i，UV 用原始尺寸
  mirror?: boolean; // Blockbench 镜像（UV 水平翻转，几何不翻转）
}

/** 骨骼 */
export interface SpecBone {
  name: string;
  parent?: string;
  pivot?: number[];
  cubes?: SpecCube[];
}

/** 模型输入（buildSpecFromModel 参数） */
export interface SpecModelInput {
  bones?: SpecBone[];
  texWidth?: number;
  texHeight?: number;
}

/** 构建产物：mesh data + bones */
export interface SpecBuildResult {
  bones: SpecBone[];
  meshes: SpecMeshData[];
  texWidth: number;
  texHeight: number;
}

/** 单 mesh 数据（Go spec meshGroups 结构近似） */
export interface SpecMeshData {
  boneID: string;
  origin: number[];
  size: number[];
  pivot: number[];
  rotation: number[];
  uv: number[][][];
  faceUV: boolean;
  texIdx: number;
  cubeIdx: number;
}

/** UV 解析结果 */
interface UVData {
  uv: number[][][];
  texIdx: number;
}

// ── 主流程 ──────────────────────────────────────────

/** 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } */
export function buildSpecFromModel(model: SpecModelInput): SpecBuildResult {
  const texW = model.texWidth || 64;
  const texH = model.texHeight || 64;
  const meshes: SpecMeshData[] = [];
  const boneIdx: Record<string, boolean> = {};
  const boneCubes: Record<string, SpecCube[]> = {}; // name → cube[] after merge
  const firstPivot: Record<string, number[]> = {};

  // Phase 1: 收集每个 bone 的 first pivot
  for (const b of model.bones || []) {
    if (!boneIdx.hasOwnProperty(b.name)) {
      boneIdx[b.name] = true;
      firstPivot[b.name] = b.pivot || [0, 0, 0];
    }
  }
  // 同名骨骼优先保留有 parent 的 pivot
  for (const b of model.bones || []) {
    if (b.parent && firstPivot[b.name]) {
      firstPivot[b.name] = b.pivot || firstPivot[b.name];
    }
  }

  // Phase 2: 每组同名骨骼收集所有 cube
  // 对齐 Go threejs.Build() 去重规则：同名骨骼首次无 parent、后续带 parent →
  // cube 整体替换（overwrite）；否则 mergeCubes（替换重叠、保留非重叠）。
  // （Go 端另有「双 parent 时按 rotation 完整性 overwrite」规则，SpecBone 无 rotation 字段，JS 不适用）
  const boneHasParent: Record<string, boolean> = {};
  for (const b of model.bones || []) {
    const cubes: SpecCube[] = (b.cubes || []).map((c) => {
      const origin = c.origin || [0, 0, 0];
      const size = c.size || [1, 1, 1];
      const pivot = c.pivot || [0, 0, 0];
      const rotation = c.rotation || [0, 0, 0];
      return { origin, size, pivot, rotation, uv: c.uv, faceUV: c.faceUV, inflate: c.inflate, mirror: c.mirror };
    });
    if (!boneCubes[b.name]) {
      boneCubes[b.name] = cubes;
      boneHasParent[b.name] = !!b.parent;
    } else if (!boneHasParent[b.name] && b.parent) {
      boneCubes[b.name] = cubes;
      boneHasParent[b.name] = true;
    } else {
      boneCubes[b.name] = mergeCubesJS(boneCubes[b.name], cubes);
    }
  }

  // Phase 3: 遍历 boneCubes 生成 mesh data
  let cubeIdx = 0;
  const boneNames = Object.keys(boneCubes);
  for (const boneID of boneNames) {
    const groupPivot = firstPivot[boneID] || [0, 0, 0];
    const cubes = boneCubes[boneID];
    if (!cubes || cubes.length === 0) continue;

    for (const c of cubes) {
      const data = buildCubeMeshDataJS(
        c,
        groupPivot,
        texW,
        texH,
        boneID,
        cubeIdx,
      );
      meshes.push(data);
      cubeIdx++;
    }
  }

  return { bones: model.bones || [], meshes, texWidth: texW, texHeight: texH };
}

// ── 工具函数 ────────────────────────────────────────

function mergeCubesJS(oldCubes: SpecCube[], newCubes: SpecCube[]): SpecCube[] {
  const result: SpecCube[] = [];
  for (const nc of newCubes) {
    let replaced = false;
    for (let i = 0; i < oldCubes.length; i++) {
      const oc = oldCubes[i];
      if (
        cubesOverlapJS(oc.origin, nc.origin) &&
        cubesOverlapJS(oc.size, nc.size) &&
        cubesOverlapJS(oc.rotation, nc.rotation)
      ) {
        oldCubes[i] = nc;
        replaced = true;
        break;
      }
    }
    if (!replaced) result.push(nc);
  }
  return [...oldCubes, ...result];
}

function cubesOverlapJS(a?: number[], b?: number[]): boolean {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (!floatEqualJS(a[i] || 0, b[i] || 0)) return false;
  }
  return true;
}

function floatEqualJS(a: number, b: number): boolean {
  return Math.abs(a - b) < CUBE_EPS;
}

function buildCubeMeshDataJS(
  c: SpecCube,
  bonePivot: number[],
  texW: number,
  texH: number,
  boneID: string,
  cubeIdx: number,
): SpecMeshData {
  const origin = c.origin || [0, 0, 0];
  const size = c.size || [1, 1, 1];
  const pivot = c.pivot || [0, 0, 0];
  const [sx, sy, sz] = size;
  // Blockbench inflate：几何 origin 各轴 -i、size 各轴 +2i（对齐 Go buildCubeMeshData）；
  // UV 展开基于**原始尺寸**（对齐 C# 黄金参考 expandBoxUV(原始 sz) 再 inflate）。
  const inflate = c.inflate || 0;
  const geoOrigin = inflate
    ? [origin[0] - inflate, origin[1] - inflate, origin[2] - inflate]
    : origin;
  const geoSize = inflate ? [sx + 2 * inflate, sy + 2 * inflate, sz + 2 * inflate] : size;
  const cubeOrigin = [
    geoOrigin[0] - bonePivot[0],
    geoOrigin[1] - bonePivot[1],
    geoOrigin[2] - bonePivot[2],
  ];
  const cubePivot = [
    pivot[0] - bonePivot[0],
    pivot[1] - bonePivot[1],
    pivot[2] - bonePivot[2],
  ];
  const rot = c.rotation || [0, 0, 0];
  const faceUV = c.faceUV;
  const uvData = faceUV
    ? parseUVFromObject(faceUV, sx, sy, sz, texW, texH)
    : parseUVJS(c, sx, sy, sz, texW, texH);
  // Blockbench mirror：UV 水平翻转（u 交换，对齐 Go/Java GeoQuad；几何不翻转）
  if (c.mirror && uvData.uv) {
    for (const face of uvData.uv) {
      if (face.length === 4) {
        const t = face[0][0];
        face[0][0] = face[1][0];
        face[1][0] = t;
        const t2 = face[2][0];
        face[2][0] = face[3][0];
        face[3][0] = t2;
      }
    }
  }
  const texIdx = uvData.texIdx || 0;
  return {
    boneID,
    origin: cubeOrigin,
    size: geoSize,
    pivot: cubePivot,
    rotation: rot,
    uv: uvData.uv, // 6 faces × 4 vertices × 2 coords
    faceUV: !!faceUV,
    texIdx,
    cubeIdx,
  };
}

function parseUVJS(
  c: SpecCube,
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
): UVData {
  const uv = c.uv || [0, 0];
  const [u, v] = uv;
  // 标准 box UV 映射
  const fw = sx / texW;
  const fh = sz / texH;
  const v0 = v;
  const v1 = v + sz / texH;
  const v2 = v + (sz + sy) / texH;
  const v3 = v + (sz + sy + sz) / texH;
  const uBase = u / texW;
  const uEast = uBase + fw;
  const uWest = uEast + fw;
  const uUp = uWest + fw;
  const uDown = uUp + fw;
  const uSouth = uDown + fw;
  const uNorth = uSouth + fw;

  return {
    uv: [
      // East  (右)
      [
        [uEast, v1],
        [uEast + fh, v1],
        [uEast + fh, v0],
        [uEast, v0],
      ],
      // West  (左)
      [
        [uWest, v1],
        [uWest + fh, v1],
        [uWest + fh, v0],
        [uWest, v0],
      ],
      // Up    (上)
      [
        [uUp, v2],
        [uUp + fw, v2],
        [uUp + fw, v1],
        [uUp, v1],
      ],
      // Down  (下)
      [
        [uDown, v2],
        [uDown + fw, v2],
        [uDown + fw, v1],
        [uDown, v1],
      ],
      // South (前)
      [
        [uSouth, v0],
        [uSouth + fw, v0],
        [uSouth + fw, v3],
        [uSouth, v3],
      ],
      // North (后)
      [
        [uNorth, v0],
        [uNorth + fw, v0],
        [uNorth + fw, v3],
        [uNorth, v3],
      ],
    ],
    texIdx: 0,
  };
}

interface FaceUVEntry {
  uv?: number[];
  uv_size?: number[];
  texture?: number;
}

interface FaceUVData {
  east?: FaceUVEntry;
  west?: FaceUVEntry;
  up?: FaceUVEntry;
  down?: FaceUVEntry;
  south?: FaceUVEntry;
  north?: FaceUVEntry;
}

function parseUVFromObject(
  jsonStr: string,
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
): UVData {
  try {
    const faceData = JSON.parse(jsonStr) as FaceUVData;
    const faces = ["east", "west", "up", "down", "south", "north"] as const;
    const uv: number[][][] = [];
    let texIdx = 0;
    for (const face of faces) {
      const fd =
        faceData[face] || faceData[face.toUpperCase() as keyof FaceUVData];
      if (fd?.uv && fd?.uv_size) {
        const [fu, fv] = fd.uv;
        const [fw, fh] = fd.uv_size;
        uv.push([
          [fu / texW, (fv + fh) / texH],
          [(fu + fw) / texW, (fv + fh) / texH],
          [(fu + fw) / texW, fv / texH],
          [fu / texW, fv / texH],
        ]);
      } else {
        uv.push([
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]);
      }
      if (fd?.texture !== undefined) texIdx = fd.texture;
    }
    return { uv, texIdx };
  } catch (_) {
    return parseUVJS({ uv: [0, 0] }, sx, sy, sz, texW, texH);
  }
}


