// ===== preview 工具函数（纯函数，无组件依赖） =====

/** Bedrock 方块 */
export interface BedrockCube {
  origin: number[];
  size: number[];
  pivot: number[];
  rotation: number[];
  uv: number[] | string;
  faceUV: string;
  texSlot: number;
}

/** Bedrock 骨骼 */
export interface BedrockBone {
  name: string;
  parent: string | null;
  pivot: number[];
  rotation: number[];
  cubes: BedrockCube[];
  /** WASM 解析附加字段（_texIdx/_texUrl/_texWidth/_texHeight 等） */
  _texIdx?: number;
  _texUrl?: string | null;
  _texWidth?: number;
  _texHeight?: number;
  [key: string]: unknown;
}

/** 解析后的 Bedrock geometry */
export interface BedrockGeometry {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  bones: BedrockBone[];
  /** WASM/Go 附加字段（作者/头像/路径/纹理映射日志等） */
  _authors?: Array<{
    name?: string;
    role?: string;
    avatarUrl?: string | null;
    avatarPath?: string;
  }>;
  _avatars?: Record<string, string>;
  _modelPath?: string;
  _texMappingLog?: unknown[];
  animations?: unknown[];
  textures?: string[];
  /** 纹理文件名（去扩展名），与 textures 同序（Go AnalyzeBedrockModel / WASM 解码填充） */
  textureNames?: string[];
  texture?: string | null;
  [key: string]: unknown;
}

/** 从 JSON 字符串解析 Bedrock geometry */
export function parseBedrockGeometryFromJSON(
  jsonStr: string,
): BedrockGeometry | null {
  const raw = JSON.parse(jsonStr) as {
    "minecraft:geometry"?: Array<{
      bones?: BedrockRawBone[];
      description?: { texture_width?: number; texture_height?: number };
    }>;
  };
  const geo = raw?.["minecraft:geometry"]?.[0];
  if (!geo?.bones?.length) return null;
  const bones: BedrockBone[] = [];
  let cubeCount = 0;
  for (const b of geo.bones) {
    const cubes: BedrockCube[] = [];
    for (const c of b.cubes || []) {
      let uv: number[] | string = [0, 0];
      let faceUV = "";
      if (Array.isArray(c.uv)) {
        uv = c.uv;
      } else if (typeof c.uv === "string" && c.uv.startsWith("{")) {
        faceUV = c.uv;
      } else if (typeof c.uv === "object" && c.uv !== null) {
        // 某些模型 UV 是对象格式（如 {uv:[0,0], uv_size:[16,16]}）
        // 优先取内层 uv 数组作为 expandBoxUV
        const uvObj = c.uv as { uv?: unknown };
        if (Array.isArray(uvObj.uv)) {
          uv = uvObj.uv;
        }
        faceUV = JSON.stringify(c.uv);
      }
      // 每个方块可指定纹理槽索引（YSMViewer 据此区分主纹理与发光/覆盖层）
      const texSlot = typeof c.texture === "number" ? c.texture : 0;
      // 统一对象→数组格式（某些导出工具输出 {x,y,z} 对象而非数组）
      const toArr = (v: unknown): number[] => {
        if (!v) return [0, 0, 0];
        if (Array.isArray(v)) return v as number[];
        if (typeof v === "object")
          return [(v as Vec3Obj).x || 0, (v as Vec3Obj).y || 0, (v as Vec3Obj).z || 0];
        return [0, 0, 0];
      };
      cubes.push({
        origin: toArr(c.origin),
        size: toArr(c.size),
        pivot: toArr(c.pivot),
        rotation: toArr(c.rotation),
        uv,
        faceUV,
        texSlot,
      });
    }
    // pivot 统一为数组格式（某些导出工具输出 {x,y,z} 对象）
    let pivot = b.pivot;
    if (pivot && !Array.isArray(pivot) && typeof pivot === "object") {
      pivot = [pivot.x || 0, pivot.y || 0, pivot.z || 0];
    }
    bones.push({
      name: b.name,
      parent: b.parent || null,
      pivot: pivot || [0, 0, 0],
      rotation: b.rotation || [0, 0, 0],
      cubes,
    });
    cubeCount += cubes.length;
  }
  return {
    boneCount: bones.length,
    cubeCount,
    texWidth: geo.description?.texture_width || 0,
    texHeight: geo.description?.texture_height || 0,
    bones,
  };
}

/** UV 对象格式（{x,y,z} 向量） */
interface Vec3Obj {
  x?: number;
  y?: number;
  z?: number;
}

/** 原始 JSON 骨骼（Bedrock 格式） */
interface BedrockRawBone {
  name: string;
  parent?: string;
  pivot?: number[] | Vec3Obj;
  rotation?: number[];
  cubes?: Array<{
    origin?: unknown;
    size?: unknown;
    pivot?: unknown;
    rotation?: unknown;
    uv?: unknown;
    texture?: unknown;
  }>;
}
