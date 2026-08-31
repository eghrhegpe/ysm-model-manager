// ===== preview 工具函数（纯函数，无组件依赖） =====

import type { AnimationClip } from "../../utils/animation/animation.ts";

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

/** SubModel 子模型条目（Go types/bedrock.go SubModel）。
 *  与 spec-builder.ts 的 SubModel 定义保持一致；这里重复声明是为了
 *  geometry.ts 不反向依赖 preview-3d（边界清晰）。 */
export interface BedrockSubModel {
  name: string;
  sourcePath?: string;
  texSlot?: number;
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
  /** Go FileInventory 权威归属清单（go/types/bedrock.go，zip 内文件只识别不解析）。
   *  统计卡「包内文件」行直接消费，不再按文件名猜。 */
  fileInventory?: {
    animations?: string[];
    controllers?: string[];
    langFiles?: string[];
    incFiles?: string[];
    legacyModels?: string[];
    avatars?: string[];
  };
  /** WASM/Go 附加字段（作者/头像/路径/纹理映射日志等） */
  _authors?: Array<{
    name?: string;
    role?: string;
    avatarUrl?: string | null;
    avatarPath?: string;
    /** 作者 bilibili 主页（Go SummaryAuthor.Bilibili 透传，统计卡作者列表渲染 📺 链接） */
    bilibili?: string;
  }>;
  _avatars?: Record<string, string>;
  _modelPath?: string;
  _texMappingLog?: unknown[];
  /** 已解析动画 clips（WASM 内嵌解码 / Go 兜底 / 缓存回填统一挂载，供 ysm-adapter 播放；
   *  区别于 `animations`（Go 透传的原始 JSON 字符串数组） */
  _animClips?: AnimationClip[];
  animations?: unknown[];
  textures?: string[];
  /** 纹理文件名（去扩展名），与 textures 同序（Go AnalyzeBedrockModel / WASM 解码填充） */
  textureNames?: string[];
  /** 纹理分类标记，与 textureNames 同序同长度。
   * "player" = 可切换皮肤；"projectile"/"vehicle"/"arrow" = 组件专属纹理；
   * "" = 未分类。Go 端按 ysm.json 声明填充，前端面板据此区分显示。 */
  textureCategories?: string[];
  texture?: string | null;
  /** L0 清单派生的子模型列表（多角色包内切换用） */
  subModels?: BedrockSubModel[];
  [key: string]: unknown;
}

/** Bedrock geometry JSON 结构（minecraft:geometry 数组第一项为有效模型） */
interface BedrockRawGeometry {
  "minecraft:geometry"?: Array<{
    bones?: BedrockRawBone[];
    description?: { texture_width?: number; texture_height?: number };
  }>;
}

/** 从 JSON 字符串解析 Bedrock geometry */
export function parseBedrockGeometryFromJSON(
  jsonStr: string,
): BedrockGeometry | null {
  // 畸形输入 JSON.parse 会抛 SyntaxError——解析函数自身兜底返回 null，避免调用链未捕获
  let raw: BedrockRawGeometry | null = null;
  try {
    raw = JSON.parse(jsonStr) as BedrockRawGeometry;
  } catch {
    return null;
  }
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
