// ===== ysm.json 直接解析（纯函数层）=====
// 从 views/app-preview/wasm.ts 抽出：纯 JSON 格式 ysm.json 的解压后直解析，
// 供单测覆盖（ADR-023 L3）。不依赖 WASM/IO，输入 unknown JSON，输出 DecodedYsm 或 null。
import type { DecodedYsm } from "./utils.ts";

/** 直接解析纯 JSON 格式的 ysm.json（解压后的 YSM 模型文件） */
export function parseYsmJsonDirect(json: unknown): DecodedYsm | null {
  const obj = json as {
    spec?: unknown;
    files?: { player?: { model?: unknown; texture?: unknown } };
    metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
    properties?: { texture_width?: number; texture_height?: number; default_texture?: string | null };
    minecraft?: { geometry?: unknown[] };
    geometry?: { model?: unknown };
  };
  // ysm.json 格式（spec/metadata/files）
  if (obj?.spec !== undefined && obj?.files) {
    // 从 files.player.model 提取 geometry 信息
    const playerFiles = obj.files?.player;
    if (!playerFiles) return null;
    const modelFiles = Array.isArray(playerFiles.model)
      ? playerFiles.model
      : playerFiles.model
        ? [playerFiles.model]
        : [];
    const texFiles = Array.isArray(playerFiles.texture)
      ? playerFiles.texture
      : playerFiles.texture
        ? [playerFiles.texture]
        : [];
    // ysm.json 本身不含 geometry 数据（geometry 在 separate model json 中）
    // 返回一个占位 geometry，让后续的 Go AnalyzeBedrockModel 处理
    // 解析作者信息（用于头像显示）
    const authors = (obj?.metadata?.authors || [])
      .filter((a) => a.name)
      .map((a) => ({
        name: a.name as string,
        role: a.role || "",
        avatarUrl: null,
        avatarPath: a.avatar || "",
      }));
    return {
      texture: null,
      geometry: {
        bones: [],
        boneCount: 0,
        cubeCount: 0,
        texWidth: obj.properties?.texture_width || 64,
        texHeight: obj.properties?.texture_height || 64,
        textures: [],
        _ysmMeta: {
          modelFiles,
          texFiles,
          defaultTexture: obj.properties?.default_texture || null,
        },
      },
      animations: [],
      authors,
    };
  }

  // 标准 Bedrock geometry 格式（minecraft.geometry）
  const root = (obj?.minecraft?.geometry?.[0] || obj?.geometry?.model || obj) as {
    description?: { texture_width?: number; texture_height?: number };
    bones?: Array<{
      name?: string;
      pivot?: number[];
      parent?: string;
      rotation?: number[];
      cubes?: Array<{
        origin?: number[];
        size?: number[];
        pivot?: number[];
        rotation?: number[];
        uv?: number[];
        inflate?: number;
        mirror?: boolean;
      }>;
    }>;
  };
  const desc = root?.description || {};
  const texW = desc.texture_width || 64;
  const texH = desc.texture_height || 64;
  const bones = (root?.bones || []).map((b) => ({
    name: b.name || "",
    pivot: b.pivot || [0, 0, 0],
    parent: b.parent || "",
    rotation: b.rotation || [0, 0, 0],
    cubes: (b.cubes || []).map((c) => ({
      origin: c.origin || [0, 0, 0],
      size: c.size || [0, 0, 0],
      pivot: c.pivot || [0, 0, 0],
      rotation: c.rotation || [0, 0, 0],
      uv: c.uv || [0, 0],
      faceUV: "",
      texSlot: 0,
      inflate: c.inflate || 0,
      mirror: !!c.mirror,
    })),
  }));
  if (!bones.length) return null;
  return {
    texture: null,
    geometry: {
      bones,
      boneCount: bones.length,
      cubeCount: 0,
      texWidth: texW,
      texHeight: texH,
      textures: [],
    },
    animations: [],
  };
}
