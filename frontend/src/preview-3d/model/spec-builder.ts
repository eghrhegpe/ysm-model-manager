// spec-builder.ts — Go 端 Build3DSpecFromGeometryJSON 纯 TS 移植（ADR-049 P2-2）。
//
// 契约与 Go binding 完全一致：入参 bedrock geometry JSON 串，返回 spec JSON 串；
// 空串/解析失败/无 bones → 返回 "{}"。内部 = parseBedrockGeometry + BuildMulti 单组件。
//
// 源文件（只读参考）：
// - internal/app/app_model.go Build3DSpecFromGeometryJSON（L154-172）
// - go/geometry/parse.go ParseBedrockGeometry
// - go/threejs/spec.go 全量算法
// - go/types/bedrock.go 结构定义

// 消费方直接从 cube-mesh.ts / model-group-builder.ts import（2026-08-14 清理死 re-export）
import { buildModelGroup } from "./model-group-builder.ts";

// ===== 常量（对齐 Go spec.go / parse.go）=====

/** parseBedrockGeometry 接受的最大输入大小 — maxParseSize */
const MAX_PARSE_SIZE = 100 << 20; // 100MB

/** texture_width/height 合法上限 — 对齐 Go geometry/parse.go clampTexSize（越界归 0 哨兵） */
const MAX_TEX_DIM = 65536;

// ===== 内部数据结构（对齐 Go types/bedrock.go + threejs/spec.go）=====

/** vec3 — Go threejs/spec.go L55 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Cube2D — Go types/bedrock.go Cube2D */
export interface Cube2D {
  origin: [number, number, number];
  size: [number, number, number];
  pivot: [number, number, number];
  pivotSet: boolean; // pivot 是否显式声明（区分"缺席"与显式 [0,0,0]）
  uv: [number, number];
  faceUV: string; // 每面独立 UV（JSON 字符串）
  rotation: [number, number, number];
  texSlot: number; // 纹理槽（从 cube.texture 解析）
  inflate: number;
  mirror: boolean;
  cubeTexW: number; // 来源文件 texture_width，不序列化
  cubeTexH: number; // 来源文件 texture_height，不序列化
}

/** Bone2D — Go types/bedrock.go Bone2D */
interface Bone2D {
  name: string;
  parent: string;
  pivot: [number, number, number];
  rotation: [number, number, number];
  cubes: Cube2D[];
  groupId: string;
}

/** BedrockModel — Go types/bedrock.go BedrockModel */
export interface BedrockModel {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  sourceName: string;
  format: string;
  bones: Bone2D[];
  /** L0 清单派生的子模型列表（多角色包内切换用）；
   *  来源优先级：L0（maid_model.json model/model_list 权威清单）→ L1（geoFiles 枚举兜底）
   *  无多角色时可能缺省或长度为 1。 */
  subModels?: SubModel[];
}

/** SubModel 子模型条目（Go types/bedrock.go SubModel）。
 *  一个 zip/7z 包内含多角色时的切换单元。 */
export interface SubModel {
  /** 角色名（L0 取自清单 name；L1 取自 geometry 文件名 basename） */
  name: string;
  /** 条目的 zip 内相对路径（用于精确比对去重 / 按单条目重新解析） */
  sourcePath?: string;
  /** 默认绑定的纹理槽索引（对应 BedrockGeometry.textures / textureNames 数组下标） */
  texSlot?: number;
}

/** Model3DSpec — Go threejs/spec.go Model3DSpec */
interface Model3DSpec {
  models: ModelGroup[];
}

/** ModelGroup — Go threejs/spec.go ModelGroup */
export interface ModelGroup {
  id: string;
  name: string;
  defaultVisible: boolean;
  textureWidth: number;
  textureHeight: number;
  textureId: string | null;
  bones: BoneData[];
  meshGroups: MeshData[];
}

/** BoneData — Go threejs/spec.go BoneData */
export interface BoneData {
  id: string;
  name: string;
  parentId: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number, number]; // quaternion [x,y,z,w]
  _cubeCount: number;
}

/** MeshData — Go threejs/spec.go MeshData */
export interface MeshData {
  id: string;
  boneId: string;
  localPosition: [number, number, number];
  localRotation: [number, number, number, number]; // quaternion [x,y,z,w]
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx: number;
}

// ===== 入口：Build3DSpecFromGeometryJSON =====

/**
 * 从 bedrock geometry JSON 构建 3D spec（纯 TS，无 Go 依赖）。
 * 契约与 Go binding 完全一致：入参 geometry JSON 串，返回 spec JSON 串；
 * 空串/解析失败/无 bones → "{}"。
 */
export function buildSpecFromGeometryJSON(geometryJSON: string): string {
  if (!geometryJSON) {
    return "{}";
  }
  const model = parseBedrockGeometry(geometryJSON);
  if (!model || model.bones.length === 0) {
    return "{}";
  }
  const spec = buildMulti([model], null);
  if (!spec || spec === "{}") {
    return "{}";
  }
  return spec;
}

// ===== parseBedrockGeometry — Go geometry/parse.go =====

/**
 * 解析标准 Bedrock geometry JSON（minecraft:geometry 格式）。
 * 对齐 Go geometry/parse.go ParseBedrockGeometry。
 */
function parseBedrockGeometry(data: string): BedrockModel | null {
  if (data.length > MAX_PARSE_SIZE) {
    console.warn(`[spec-builder] ParseBedrockGeometry 输入过大: ${data.length} bytes`);
    return null;
  }
  let raw: RawGeometryJSON;
  try {
    raw = JSON.parse(data) as RawGeometryJSON;
  } catch {
    return null;
  }
  if (!raw?.["minecraft:geometry"] || raw["minecraft:geometry"].length === 0) {
    return null;
  }
  const g = raw["minecraft:geometry"][0];
  const desc = g.description;
  // texture_width/height 钳到 [0, MAX_TEX_DIM]（越界置 0）
  const texW = clampTexSize(desc.texture_width);
  const texH = clampTexSize(desc.texture_height);

  const model: BedrockModel = {
    boneCount: 0,
    cubeCount: 0,
    texWidth: texW,
    texHeight: texH,
    sourceName: "",
    format: raw.format_version || "",
    bones: [],
  };

  let cubeTotal = 0;
  for (const b of g.bones) {
    // P2-6 修复：畸形输入防护——骨骼缺失/cubes 非 null 非数组时返回 null（契约外输入不抛 TypeError）
    // 契约对齐 Go parse.go：cubes 缺席（undefined）或 null → 视为空数组（无 cube 的纯父骨骼合法），
    // 仅 cubes 存在但非数组（如字符串）才视为畸形输入拒绝。
    if (!b) return null;
    const boneCubes = b.cubes ?? [];
    if (!Array.isArray(boneCubes)) return null;
    const cubes = parseCubes(boneCubes, texW, texH);
    if (cubes === null) return null;
    model.bones.push({
      name: b.name,
      parent: b.parent || "",
      pivot: b.pivot || [0, 0, 0],
      rotation: parseRotationTriple(b.rotation),
      cubes,
      groupId: "",
    });
    cubeTotal += cubes.length;
  }
  model.boneCount = g.bones.length;
  model.cubeCount = cubeTotal;
  return model;
}

/**
 * 单骨骼的 cube 数组解析（Go parse.go 的 cube 循环）。
 * 畸形输入（缺 origin/size 数组）→ null，由调用方整条几何拒绝。
 */
function parseCubes(boneCubes: RawCube[], texW: number, texH: number): Cube2D[] | null {
  const cubes: Cube2D[] = [];
  for (const c of boneCubes) {
    // P2-6 修复：cube 缺 origin/size 数组时返回 null（契约外输入不抛 TypeError）
    if (!Array.isArray(c.origin) || !Array.isArray(c.size)) return null;
    const uvFields = parseCubeUv(c.uv);
    cubes.push({
      origin: [c.origin[0], c.origin[1], c.origin[2]],
      size: [c.size[0], c.size[1], c.size[2]],
      pivot: pivotOf(c.pivot),
      pivotSet: c.pivot !== undefined && c.pivot !== null,
      uv: uvFields.uv,
      faceUV: uvFields.faceUV,
      rotation: parseRotationTriple(c.rotation),
      texSlot: c.texture ?? 0, // 对齐 Go `Texture int` 缺省 0（未声明 texture 不丢 texIdx 键）
      inflate: c.inflate ?? 0,
      mirror: c.mirror ?? false,
      // 对齐 Go 端：per-cube 记住来源 geometry 的纹理尺寸——多组件不同
      // texture_width（如 main=256 / arrow=64 / foxcar=512）时 UV 归一化
      // 各用各的基准，恒 0 会全部退回第一个 geometry 的尺寸导致缩放错
      cubeTexW: texW,
      cubeTexH: texH,
    });
  }
  return cubes;
}

/**
 * cube.uv 双形态解析（对齐 Go parse.go 的 raw 判定）：
 * `'{'` 开头字符串 → FaceUV 字符串；数组 → [2]float64（缺位补 0）；
 * 其余（缺席/空串/非 `'{'` 开头/非法类型）→ 零值 [0,0]（不抛错）。
 */
function parseCubeUv(uv: [number, number] | string | null | undefined): {
  uv: [number, number];
  faceUV: string;
} {
  if (uv === undefined || uv === null) return { uv: [0, 0], faceUV: "" };
  // raw 判断：'{' 开头 → FaceUV 字符串，否则 [2]float64
  if (typeof uv === "string") {
    // 空字符串或非 '{' 开头：uv 保持 [0,0]
    return { uv: [0, 0], faceUV: uv.length > 0 && uv[0] === "{" ? uv : "" };
  }
  // [2]float64
  if (Array.isArray(uv)) return { uv: [uv[0] ?? 0, uv[1] ?? 0], faceUV: "" };
  return { uv: [0, 0], faceUV: "" };
}

/**
 * rotation 三元组解析（bone / cube 两处同口径）：
 * 缺席（undefined/null）或非数组 → [0,0,0]；数组 → 前三位，缺位补 0。
 */
function parseRotationTriple(r: unknown): [number, number, number] {
  if (!Array.isArray(r)) return [0, 0, 0];
  const at = (i: number): number => (r[i] as number | undefined) ?? 0;
  return [at(0), at(1), at(2)];
}

/** pivotOf — 解引用 cube 的 pivot；JSON 缺席（undefined）→ 零值 [0,0,0] */
function pivotOf(p: [number, number, number] | undefined): [number, number, number] {
  if (!p) return [0, 0, 0];
  return [p[0], p[1], p[2]];
}

/** clampToInt — 把任意 JSON number 安全截断为 int（NaN/Inf→0） */
function clampToInt(v: number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

/** clampTexSize — texture 尺寸钳制（对齐 Go geometry/parse.go clampTexSize）：
 *  clampToInt 截断后验范围 [0, MAX_TEX_DIM]，越界归 0 哨兵（调用方再落默认 64）。 */
function clampTexSize(v: number | undefined): number {
  const n = clampToInt(v);
  if (n < 0 || n > MAX_TEX_DIM) return 0;
  return n;
}

// ===== buildMulti — Go threejs/spec.go BuildMulti =====

/**
 * 多组件 spec：每个组件独立构建为 spec.models 元素。
 * 对齐 Go threejs/spec.go BuildMulti（L74-99）。
 */
function buildMulti(models: BedrockModel[], texIdxBase: number[] | null): string {
  if (!models || models.length === 0) {
    return "{}";
  }
  const groups: ModelGroup[] = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m.bones || m.bones.length === 0) {
      continue;
    }
    let base = i;
    if (texIdxBase && i < texIdxBase.length) {
      base = texIdxBase[i];
    }
    const mg = buildModelGroup(m, `comp_${i}`, base);
    groups.push(mg);
  }
  if (groups.length === 0) {
    return "{}";
  }
  const spec: Model3DSpec = { models: groups };
  return JSON.stringify(spec);
}

// ===== Raw geometry JSON 类型（parseBedrockGeometry 用）=====

interface RawGeometryJSON {
  format_version?: string;
  "minecraft:geometry"?: RawGeometry[];
}

/** minecraft:geometry 数组元素（对齐 Bedrock geometry 规范） */
interface RawGeometry {
  description: {
    /** @non-ui Bedrock 几何标识符（第三方规格字段，MC 格式里为可选）。
     * 本仓用不到它（骨骼/纹理尺寸才是所需），但类型要忠于规范，
     * 否则 `description` 的可选性会与真实 JSON 不符。 */
    identifier?: string;
    texture_width?: number;
    texture_height?: number;
  };
  bones: RawBone[];
}

/** 骨骼声明（cubes 缺席/null 视为空数组，非数组才是畸形输入） */
interface RawBone {
  name: string;
  parent?: string;
  pivot?: [number, number, number];
  rotation?: [number, number, number] | null;
  cubes?: RawCube[] | null;
}

/** cube 声明（origin/size 必填；uv 双形态：box [2]float64 或 FaceUV JSON 字符串） */
interface RawCube {
  origin: [number, number, number];
  size: [number, number, number];
  pivot?: [number, number, number];
  uv?: [number, number] | string | null;
  rotation?: [number, number, number] | null;
  texture?: number;
  inflate?: number;
  mirror?: boolean;
}
