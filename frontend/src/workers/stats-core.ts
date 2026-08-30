// ===== 模型统计纯计算（Worker 可测核心：无 IO、无 WASM 依赖）=====
// 输入为 WASM 解码产物（.ysm）或 JSON 直读字节（.json 主文件），输出统计数值。
// 口径对齐 Go decodeYSMViaNodeJS（internal/app/wasm_decoder.go:224）与前端
// decodeYsmViaWasm（views/app-preview/wasm.ts）：
//  - boneCount/cubeCount：各 geometry JSON 合并求和（骨骼 = bones 数组长度；
//    立方体 = 各 bone.cubes 长度之和，递归收集）
//  - texWidth/texHeight：max(geometry description texture_width/height, 实际纹理嗅探)
//    （Go 只取 geometry 描述；前端 wasm.ts 取 max(嗅探, 描述)——本文件取大者，语义超集）
//  - sniffTexSize 与 Go imagePixelArea / wasm.ts sniffTexSize 同口径，勿单独改
import { parseBedrockGeometryFromJSON } from "../views/app-preview/geometry.ts";
import { sniffTexSize } from "../utils/tex-size.ts";

/** 解码/直读产物文件（Worker 与主线程共用形状） */
export interface StatsFileInput {
  path: string;
  data: Uint8Array;
}

/** 单模型统计结果（SearchResult 数值字段对齐） */
export interface ModelStatsResult {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  hasError: boolean;
}

const EMPTY_ERROR: ModelStatsResult = { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true };

/**
 * 宽松 geometry 解析：标准 `minecraft:geometry` 数组（parseBedrockGeometryFromJSON）
 * 之外，兼容 `minecraft.geometry[0]` / `geometry.model` / 直接 `{bones}` 根对象
 * （对齐 parseYsmJsonDirect 的 root 提取口径）。失败返回 null。
 */
function parseAnyGeometry(
  jsonStr: string,
): { boneCount: number; cubeCount: number; texWidth: number; texHeight: number } | null {
  const viaStandard = parseBedrockGeometryFromJSON(jsonStr);
  if (viaStandard) {
    return {
      boneCount: viaStandard.boneCount,
      cubeCount: viaStandard.cubeCount,
      texWidth: viaStandard.texWidth,
      texHeight: viaStandard.texHeight,
    };
  }
  try {
    const obj = JSON.parse(jsonStr) as {
      minecraft?: { geometry?: Array<{ bones?: unknown[]; description?: { texture_width?: number; texture_height?: number } }> };
      geometry?: { model?: { bones?: unknown[]; description?: { texture_width?: number; texture_height?: number } } };
      bones?: unknown[];
      description?: { texture_width?: number; texture_height?: number };
    };
    const root = obj?.minecraft?.geometry?.[0] || obj?.geometry?.model || (obj?.bones ? obj : null);
    if (!root?.bones?.length) return null;
    let cubeCount = 0;
    for (const b of root.bones as Array<{ cubes?: unknown[] }>) {
      cubeCount += (b.cubes || []).length;
    }
    return {
      boneCount: root.bones.length,
      cubeCount,
      texWidth: root.description?.texture_width || 0,
      texHeight: root.description?.texture_height || 0,
    };
  } catch {
    return null;
  }
}

/**
 * 从 WASM 解码产物计算统计（.ysm 主文件路径）。
 * 跳过 ysm.json（元信息，非 geometry）与 animations/（动画 JSON 解析恒 null，纯优化）。
 * hasError = 未解析到任何骨骼（对齐 Go BoneCount==0 语义：数值搜索中该模型不可用）。
 */
export function statsFromDecodedFiles(files: StatsFileInput[]): ModelStatsResult {
  let boneCount = 0;
  let cubeCount = 0;
  let texW = 0;
  let texH = 0;
  for (const f of files) {
    const low = f.path.toLowerCase();
    if (low.endsWith(".json")) {
      if (low.endsWith("ysm.json")) continue;
      if (low.includes("/animations/") || low.startsWith("animations/")) continue;
      const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(f.data));
      if (!parsed) continue;
      boneCount += parsed.boneCount;
      cubeCount += parsed.cubeCount;
      if (parsed.texWidth > texW) texW = parsed.texWidth;
      if (parsed.texHeight > texH) texH = parsed.texHeight;
    } else if (low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg")) {
      // avatar/ 头像不参与模型纹理统计（对齐 Go decodeYSMViaNodeJS 跳过逻辑）
      if (low.includes("/avatar/") || low.startsWith("avatar/")) continue;
      const s = sniffTexSize(f.data);
      if (s) {
        if (s.w > texW) texW = s.w;
        if (s.h > texH) texH = s.h;
      }
    }
  }
  return {
    boneCount,
    cubeCount,
    texWidth: texW,
    texHeight: texH,
    hasError: boneCount === 0,
  };
}

/** 读取相对路径文件的回调（Worker 内 = IDB 读取；测试可注入内存 Map） */
export type StatsRelReader = (rel: string) => Promise<Uint8Array | null>;

/**
 * 从 .json 主文件字节计算统计（解压目录入口，ADR-038 ysm.json 语义）：
 *  - ysm.json spec 格式（spec+files）：按 files.player.model/texFiles 读关联文件统计
 *  - 标准 bedrock geometry JSON：直接解析
 * 失败/无骨骼 → hasError。
 */
export async function statsFromJsonBytes(
  bytes: Uint8Array,
  readRel: StatsRelReader,
): Promise<ModelStatsResult> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return EMPTY_ERROR;
  }
  const obj = json as {
    spec?: unknown;
    files?: { player?: { model?: unknown; texture?: unknown } };
  };
  // ysm.json spec：geometry 在独立 model 文件中，按声明读入合并（对齐 wasm.ts JSON 分支）
  if (obj?.spec !== undefined && obj?.files?.player) {
    const player = obj.files.player;
    const modelFiles = Array.isArray(player.model)
      ? player.model
      : player.model
        ? [player.model]
        : [];
    const texFiles = Array.isArray(player.texture)
      ? player.texture
      : player.texture
        ? [player.texture]
        : [];

    let boneCount = 0;
    let cubeCount = 0;
    let texW = 0;
    let texH = 0;
    const processed = new Set<string>();
    const filePathOf = (v: unknown): string =>
      typeof v === "string" ? v : (v as { path?: string; name?: string })?.path || (v as { name?: string })?.name || "";

    for (const mf of modelFiles) {
      const name = filePathOf(mf);
      if (!name || processed.has(name)) continue;
      processed.add(name);
      // 路径归一化：补 models/ 前缀，失败回退原始路径（对齐 wasm.ts JSON 分支）
      const prefixed = name.startsWith("models/") || name.startsWith("models\\") ? name : "models/" + name;
      const raw = (await readRel(prefixed)) ?? (await readRel(name));
      if (!raw) continue;
      const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(raw));
      if (!parsed) continue;
      boneCount += parsed.boneCount;
      cubeCount += parsed.cubeCount;
      if (parsed.texWidth > texW) texW = parsed.texWidth;
      if (parsed.texHeight > texH) texH = parsed.texHeight;
    }
    const texProcessed = new Set<string>();
    for (const tf of texFiles) {
      const name = filePathOf(tf);
      if (!name || texProcessed.has(name)) continue;
      texProcessed.add(name);
      const prefixed = name.startsWith("textures/") || name.startsWith("textures\\") ? name : "textures/" + name;
      const raw = (await readRel(prefixed)) ?? (await readRel(name));
      if (!raw) continue;
      const s = sniffTexSize(raw);
      if (s) {
        if (s.w > texW) texW = s.w;
        if (s.h > texH) texH = s.h;
      }
    }
    return { boneCount, cubeCount, texWidth: texW, texHeight: texH, hasError: boneCount === 0 };
  }

  // 标准 bedrock geometry JSON（minecraft:geometry / 兼容形态）→ 直接解析
  const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(bytes));
  if (!parsed) return EMPTY_ERROR;
  return {
    boneCount: parsed.boneCount,
    cubeCount: parsed.cubeCount,
    texWidth: parsed.texWidth,
    texHeight: parsed.texHeight,
    hasError: false,
  };
}
