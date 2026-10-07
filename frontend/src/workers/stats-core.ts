// ===== 模型统计纯计算（Worker 可测核心：无 IO、无 WASM 运行时依赖）=====
// 输入为 WASM 解码产物（.ysm）或 JSON 直读字节（.json 主文件），输出统计数值。
// 口径对齐 Go decodeYSMViaNodeJS（internal/app/wasm_decoder.go:224）与前端
// decodeYsmViaWasm（preview-3d/decoder/wasm-decode.ts，ADR-137 归位）：
//  - boneCount/cubeCount：各 geometry JSON 合并求和（骨骼 = bones 数组长度；
//    立方体 = 各 bone.cubes 长度之和，非递归——与 parseBedrockGeometryFromJSON
//    （parsers/bedrock-geometry.ts）及 Go 侧同口径，勿误以为嵌套骨骼要递归）
//  - texWidth/texHeight：max(geometry description texture_width/height, 实际纹理嗅探)
//    （Go 只取 geometry 描述；前端 wasm.ts 取 max(嗅探, 描述)——本文件取大者，语义超集）
//  - sniffTexSize 与 Go imagePixelArea / wasm.ts sniffTexSize 同口径，勿单独改
// 结构去重（ADR-218 D3）：统计结果单一形状源 = stats-protocol.ts WebModelStats；
// 解码产物文件形状 = wasm/parser-shared.ts YsmDecodedFile（type-only import，无运行时耦合）
// geometry 解析直指 ADR-217 下沉后的纯 JSON 源点 parsers/（preview-3d/decoder/geometry.ts
// 仅是 re-export shim，新消费方不走 shim——shim 只减不增）
import { parseBedrockGeometryFromJSON } from "@/parsers/bedrock-geometry.ts";
import { sniffTexSize } from "@/utils/base/pure/tex-size.ts";
import type { YsmDecodedFile } from "@/wasm/parser-shared.ts";
import type { WebModelStats } from "./stats-protocol.ts";

/** 统计失败的错误标记（单模型级；整批致命错误走协议 StatsWorkerError） */
export const EMPTY_ERROR: WebModelStats = {
  boneCount: 0,
  cubeCount: 0,
  texWidth: 0,
  texHeight: 0,
  hasError: true,
};

/** 宽松 geometry root 形状（bones + 纹理描述；兼容形态见 parseAnyGeometry） */
type LooseGeometryRoot = {
  bones?: unknown[];
  description?: { texture_width?: number; texture_height?: number };
};

/** 宽松 geometry 文档形状（标准 minecraft:geometry 之外的兼容形态） */
type LooseGeometryDoc = {
  minecraft?: { geometry?: LooseGeometryRoot[] };
  geometry?: { model?: LooseGeometryRoot };
  bones?: unknown[];
  description?: { texture_width?: number; texture_height?: number };
};

/**
 * 宽松 geometry 解析：标准 `minecraft:geometry` 数组（parseBedrockGeometryFromJSON）
 * 之外，兼容 `minecraft.geometry[0]` / `geometry.model` / 直接 `{bones}` 根对象
 * （对齐 parseYsmJsonDirect 的 root 提取口径）。失败返回 null。
 * 导出供 stats-core.test.ts 对三条兼容形态做专项边界覆盖（不经 statsFromJsonBytes 间接触达）。
 */
export function parseAnyGeometry(
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
    const obj = JSON.parse(jsonStr) as LooseGeometryDoc;
    const root: LooseGeometryRoot | null =
      obj?.minecraft?.geometry?.[0] || obj?.geometry?.model || (obj?.bones ? obj : null);
    if (!root?.bones?.length) return null;
    let cubeCount = 0;
    // 非递归：与标准分支（parseBedrockGeometryFromJSON）同口径——Bedrock 骨骼不嵌套声明
    // cubes，仅顶层 bones 数组携带；嵌套关系由 parent 字段表达，不影响计数。
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
export function statsFromDecodedFiles(files: YsmDecodedFile[]): WebModelStats {
  let boneCount = 0;
  let cubeCount = 0;
  let texW = 0;
  let texH = 0;
  for (const f of files) {
    const low = f.path.toLowerCase();
    if (low.endsWith(".json")) {
      const parsed = geometryStatsOfDecodedFile(low, f.data);
      if (!parsed) continue;
      boneCount += parsed.boneCount;
      cubeCount += parsed.cubeCount;
      if (parsed.texWidth > texW) texW = parsed.texWidth;
      if (parsed.texHeight > texH) texH = parsed.texHeight;
      continue;
    }
    if (!isTexturePath(low)) continue;
    const s = textureStatsOfDecodedFile(low, f.data);
    if (!s) continue;
    if (s.w > texW) texW = s.w;
    if (s.h > texH) texH = s.h;
  }
  return {
    boneCount,
    cubeCount,
    texWidth: texW,
    texHeight: texH,
    hasError: boneCount === 0,
  };
}

/** 纹理扩展名判定（.png/.jpg/.jpeg；其余文件不参与纹理嗅探） */
function isTexturePath(low: string): boolean {
  return low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg");
}

/** 单个 .json 解码产物 → 统计（ysm.json 元信息 / animations 动画 JSON 跳过 → null） */
function geometryStatsOfDecodedFile(
  low: string,
  data: Uint8Array,
): { boneCount: number; cubeCount: number; texWidth: number; texHeight: number } | null {
  if (low.endsWith("ysm.json")) return null;
  if (low.includes("/animations/") || low.startsWith("animations/")) return null;
  const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(data));
  if (!parsed) return null;
  return {
    boneCount: parsed.boneCount,
    cubeCount: parsed.cubeCount,
    texWidth: parsed.texWidth,
    texHeight: parsed.texHeight,
  };
}

/** 单个图片解码产物 → 纹理尺寸。
 *  avatar/ 头像不参与模型纹理统计（对齐 Go decodeYSMViaNodeJS 跳过逻辑） */
function textureStatsOfDecodedFile(low: string, data: Uint8Array): { w: number; h: number } | null {
  if (low.includes("/avatar/") || low.startsWith("avatar/")) return null;
  return sniffTexSize(data);
}

/** 读取相对路径文件的回调（Worker 内 = IDB 读取；测试可注入内存 Map） */
export type StatsRelReader = (rel: string) => Promise<Uint8Array | null>;

/** 单值/数组归一为数组（ysm.json spec 的 model / texture 两字段同规则） */
function asSpecArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}

/** ysm.json spec 条目取文件路径：字符串或 {path|name} 对象。
 *  路径归一化：ysm.json spec 可能声明 Windows 风格路径分隔符（反斜杠），
 *  统一转正斜杠，避免补前缀/读关联文件时与正斜杠 IDB key 错位。 */
function specFilePathOf(v: unknown): string {
  const raw =
    typeof v === "string"
      ? v
      : (v as { path?: string })?.path || (v as { name?: string })?.name || "";
  return raw.replace(/\\/g, "/");
}

/** spec 声明的 model 文件逐一读入 → 宽松 geometry 解析 → 累加骨骼/立方体/纹理尺寸。
 *  路径归一化：补 models/ 前缀，失败回退原始路径（对齐 wasm.ts JSON 分支）。 */
async function accumulateSpecModels(
  modelFiles: unknown[],
  readRel: StatsRelReader,
): Promise<{ boneCount: number; cubeCount: number; texW: number; texH: number }> {
  let boneCount = 0;
  let cubeCount = 0;
  let texW = 0;
  let texH = 0;
  const processed = new Set<string>();
  for (const mf of modelFiles) {
    const name = specFilePathOf(mf);
    if (!name || processed.has(name)) continue;
    processed.add(name);
    const prefixed = name.startsWith("models/") ? name : `models/${name}`;
    const raw = (await readRel(prefixed)) ?? (await readRel(name));
    if (!raw) continue;
    const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(raw));
    if (!parsed) continue;
    boneCount += parsed.boneCount;
    cubeCount += parsed.cubeCount;
    if (parsed.texWidth > texW) texW = parsed.texWidth;
    if (parsed.texHeight > texH) texH = parsed.texHeight;
  }
  return { boneCount, cubeCount, texW, texH };
}

/** spec 声明的 texture 文件逐一读入 → 纹理尺寸嗅探（路径补 textures/ 前缀，失败回退原始路径） */
async function accumulateSpecTextures(
  texFiles: unknown[],
  readRel: StatsRelReader,
): Promise<{ texW: number; texH: number }> {
  let texW = 0;
  let texH = 0;
  const texProcessed = new Set<string>();
  for (const tf of texFiles) {
    const name = specFilePathOf(tf);
    if (!name || texProcessed.has(name)) continue;
    texProcessed.add(name);
    const prefixed = name.startsWith("textures/") ? name : `textures/${name}`;
    const raw = (await readRel(prefixed)) ?? (await readRel(name));
    if (!raw) continue;
    const s = sniffTexSize(raw);
    if (!s) continue;
    if (s.w > texW) texW = s.w;
    if (s.h > texH) texH = s.h;
  }
  return { texW, texH };
}

/**
 * 从 .json 主文件字节计算统计（解压目录入口，ADR-038 ysm.json 语义）：
 *  - ysm.json spec 格式（spec+files）：按 files.player.model/texFiles 读关联文件统计
 *  - 标准 bedrock geometry JSON：直接解析
 * 失败/无骨骼 → hasError。
 */
export async function statsFromJsonBytes(
  bytes: Uint8Array,
  readRel: StatsRelReader,
): Promise<WebModelStats> {
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
    const models = await accumulateSpecModels(asSpecArray(player.model), readRel);
    const tex = await accumulateSpecTextures(asSpecArray(player.texture), readRel);
    return {
      boneCount: models.boneCount,
      cubeCount: models.cubeCount,
      texWidth: Math.max(models.texW, tex.texW),
      texHeight: Math.max(models.texH, tex.texH),
      hasError: models.boneCount === 0,
    };
  }

  // 标准 bedrock geometry JSON（minecraft:geometry / 兼容形态）→ 直接解析
  const parsed = parseAnyGeometry(new TextDecoder("utf-8").decode(bytes));
  if (!parsed) return EMPTY_ERROR;
  return {
    boneCount: parsed.boneCount,
    cubeCount: parsed.cubeCount,
    texWidth: parsed.texWidth,
    texHeight: parsed.texHeight,
    // hasError 口径与 spec 分支（statsFromJsonBytes 上行）及 Go BoneCount==0 语义统一：
    // 当前 parseAnyGeometry 对空 bones 返回 null（geometry.ts 挡空）→ 本行恒 false 不可达；
    // 但显式写 boneCount === 0 保持自文档化——防未来 parseAnyGeometry 放宽空 bones 时静默漂移。
    hasError: parsed.boneCount === 0,
  };
}
