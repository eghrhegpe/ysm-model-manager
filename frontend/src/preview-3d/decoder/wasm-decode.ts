// ===== WASM 解码层 =====
// 从 index.ts 拆分：.ysm 文件的前端 WASM 解码逻辑

import { getApp } from "@/backend/app.ts";
import { parseBedrockAnimationJSON } from "@/utils/animation/animation.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { sniffTexSize } from "@/utils/base/pure/tex-size.ts";
import { decodeYsmFile, decodeYsmFileFromMemory, initYSMParser } from "@/wasm/ysm-parser.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import { type BedrockGeometry, parseBedrockGeometryFromJSON } from "./geometry.ts";
import { parseYsmJsonDirect } from "./parse-ysm-json.ts";
import { buildOrderedTexKeys } from "./texture-order.ts";
import { type DecodedYsm, devLog, stripYsgpTextHeader } from "./utils.ts";
import { type DecodedFile, parseYsmMetaFromFiles, type YsmMeta } from "./ysm-meta-parser.ts";

/** 并发去重：同一路径在途解码共享（Android 兜底与纹理并行触发时只解一次）。
 *  无此守卫时 preloadModel 并行发起的两次 decodeYsmViaWasm 会各自完整解码
 *  （atob 大字符串 ×2 + 解析 ×2，内存翻倍、时间翻倍、WASM 状态竞争——容错下降）。 */
const _decodeInFlight = new Map<string, Promise<DecodedYsm | null>>();

export function decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
  const inFlight = _decodeInFlight.get(modelPath);
  if (inFlight) return inFlight;
  const p = doDecodeYsmViaWasm(modelPath);
  _decodeInFlight.set(modelPath, p);
  void p
    .finally(() => _decodeInFlight.delete(modelPath))
    .catch((e) => devLog(`[YSM] in-flight 守卫异常: ${safeErrorMessage(e)}`));
  return p;
}

/** 纹理尺寸 */
interface TexDim {
  w: number;
  h: number;
}

// ===== 类型提级：解码阶段共享上下文 =====

/** 解码过程中共享的后端能力 + 路径上下文（原 doDecode 内多处 ReadFileBytes/baseDir 重复提取） */
interface InflightCtx {
  modelPath: string;
  baseDir: string;
  ReadFileBytes: (path: string) => Promise<string | null>;
}

/** WASM 输出的纹理累加器（collectTexturesAndAvatars 产出，供后续 model/anim 阶段读） */
interface TexAccum {
  textures: Record<string, string>;
  texNameMap: Record<string, string>;
  texLowerMap: Record<string, string>;
  texDimensions: Record<string, TexDim>;
  maxTexW: number;
  maxTexH: number;
  avatars: Record<string, string>;
}

/** 释放 TexAccum 中所有未被缓存引用的 blob URL（防提前返回路径泄漏） */
function RevokeTexAccumBlobs(acc: TexAccum): void {
  for (const u of Object.values(acc.textures)) if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  for (const u of Object.values(acc.avatars)) if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
}

/** processModelFile 升格后所需的只读上下文（原闭包内 8 个外部捕获 → 全参数量化） */
interface ProcessModelCtx {
  orderedTexKeys: string[];
  textures: Record<string, string>;
  texDimensions: Record<string, TexDim>;
  allBones: BedrockGeometry["bones"];
  processedModels: Set<string>;
  texMappingLog: Array<Record<string, string | number>>;
  geometryRef: { current: BedrockGeometry | null };
  firstGeometryRawRef: { current: string | null };
}

// ===== 基础工具：base64 → Uint8Array（消除 4 处 atob+for 循环重复） =====

function Base64ToBytes(b64: string): Uint8Array {
  const rawStr = atob(b64);
  const len = rawStr.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
  return arr;
}

function GetBaseDir(modelPath: string): string {
  const dir = modelPath.replace(/\\/g, "/");
  return dir.includes("/") ? dir.substring(0, dir.lastIndexOf("/")) : ".";
}

async function ReadBytesFromPath(
  ReadFileBytes: (p: string) => Promise<string | null>,
  relPath: string,
): Promise<Uint8Array | null> {
  const raw = await ReadFileBytes(relPath);
  return raw ? Base64ToBytes(raw) : null;
}

// ===== 阶段① 同步分派辅助：缺文件 / 直接 JSON / YSM spec JSON =====

function HandleEmptyBytes(modelPath: string): null {
  cacheSet(modelPath, { _wasmFailed: true });
  return null;
}

async function LoadAvatarsForJson(ctx: InflightCtx, result: DecodedYsm): Promise<void> {
  if (!result.authors?.length) return;
  for (const au of result.authors) {
    if (!au.avatarPath) continue;
    try {
      const avatarRel =
        au.avatarPath.startsWith("avatar/") || au.avatarPath.startsWith("avatar\\")
          ? au.avatarPath
          : `avatar/${au.avatarPath}`;
      const avatarBytes = await ReadBytesFromPath(ctx.ReadFileBytes, `${ctx.baseDir}/${avatarRel}`);
      if (avatarBytes?.length) {
        const blob = new Blob([avatarBytes.buffer as ArrayBuffer]);
        au.avatarUrl = URL.createObjectURL(blob);
      }
    } catch (e) {
      devLog(`[YSM] 头像读取失败: ${safeErrorMessage(e)}`);
    }
  }
}

function ComputeBoneTexRangeFromBones(bones: BedrockGeometry["bones"]): {
  uvMaxW: number;
  uvMaxH: number;
} {
  let uvMaxW = 2,
    uvMaxH = 2;
  for (const b of bones) {
    for (const c of b.cubes || []) {
      if (Array.isArray(c.uv) && c.uv.length >= 2) {
        const [u, v] = c.uv;
        if (u > uvMaxW) uvMaxW = u;
        if (v > uvMaxH) uvMaxH = v;
      }
    }
  }
  return { uvMaxW, uvMaxH };
}

async function HandleYsmJsonSpec(
  ctx: InflightCtx,
  result: DecodedYsm,
  ysmMeta: NonNullable<unknown>,
): Promise<DecodedYsm | null> {
  const meta = ysmMeta as {
    modelFiles?: unknown[];
    texFiles?: unknown[];
    defaultTexture?: string | null;
  };
  if (!meta.modelFiles?.length) return result;
  if (!result.geometry) return result;
  // 未入 result.geometry 的 blob URL 跟踪集（成功路径 clear；函数出口统一 revoke 残留）
  const pendingBlobUrls = new Set<string>();
  try {
    const allBones: BedrockGeometry["bones"] = [];
    let boneCount = 0,
      cubeCount = 0;
    let firstGeoRaw: string | null = null;
    const processed = new Set<string>();

    for (const mf of meta.modelFiles) {
      const mfStr = typeof mf === "string" ? mf : (mf as { path?: string })?.path || "";
      if (!mfStr || processed.has(mfStr)) continue;
      processed.add(mfStr);

      let modelRel = mfStr;
      if (!modelRel.startsWith("models/") && !modelRel.startsWith("models\\")) {
        modelRel = `models/${mfStr}`;
      }
      let modelBytes = await ReadBytesFromPath(ctx.ReadFileBytes, `${ctx.baseDir}/${modelRel}`);
      if (!modelBytes) {
        modelBytes = await ReadBytesFromPath(ctx.ReadFileBytes, `${ctx.baseDir}/${mfStr}`);
        if (!modelBytes) continue;
      }
      const jsonStr = new TextDecoder().decode(modelBytes);
      const parsed = parseBedrockGeometryFromJSON(jsonStr);
      if (parsed?.bones?.length) {
        if (!firstGeoRaw) firstGeoRaw = jsonStr;
        allBones.push(...parsed.bones);
        boneCount += parsed.boneCount;
        cubeCount += parsed.cubeCount;
      }
    }

    const textures: Record<string, string> = {};
    const texDimensions: Record<string, { w: number; h: number }> = {};
    const texKeys: string[] = [];
    let maxTexW = 0,
      maxTexH = 0;

    for (const tf of meta.texFiles || []) {
      const tfStr = typeof tf === "string" ? tf : (tf as { uv?: string })?.uv || "";
      if (!tfStr) continue;
      const texRel =
        tfStr.startsWith("textures/") || tfStr.startsWith("textures\\")
          ? tfStr
          : `textures/${tfStr}`;
      const texBytes = await ReadBytesFromPath(ctx.ReadFileBytes, `${ctx.baseDir}/${texRel}`);
      if (!texBytes) continue;

      const blob = new Blob([texBytes.buffer as ArrayBuffer], {
        type:
          tfStr.toLowerCase().endsWith(".jpg") || tfStr.toLowerCase().endsWith(".jpeg")
            ? "image/jpeg"
            : "image/png",
      });
      const key =
        tfStr
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.\w+$/, "") || "";
      const url = URL.createObjectURL(blob);
      textures[key] = url;
      pendingBlobUrls.add(url);
      texKeys.push(key);

      const sniffed = sniffTexSize(texBytes);
      if (sniffed) {
        texDimensions[key] = sniffed;
        if (sniffed.w > maxTexW) maxTexW = sniffed.w;
        if (sniffed.h > maxTexH) maxTexH = sniffed.h;
      }
    }

    if (allBones.length > 0 && result.geometry) {
      // 成功路径：URL 已赋给 result.geometry.textures，清空 pending 防误释放
      pendingBlobUrls.clear();
      const geo = result.geometry;
      const { uvMaxW, uvMaxH } = ComputeBoneTexRangeFromBones(allBones);
      const boneTexW = Math.max(maxTexW, geo.texWidth, uvMaxW) || 64;
      const boneTexH = Math.max(maxTexH, geo.texHeight, uvMaxH) || 64;
      for (const b of allBones) {
        b._texWidth = boneTexW;
        b._texHeight = boneTexH;
      }

      result.geometry = {
        ...geo,
        bones: allBones,
        boneCount,
        cubeCount,
        texWidth: Math.max(boneTexW, geo.texWidth),
        texHeight: Math.max(boneTexH, geo.texHeight),
        textures: texKeys.map((k) => textures[k]).filter(Boolean),
        texture: texKeys.length > 0 ? textures[texKeys[0]] : null,
        textureNames: texKeys,
      };
      if (firstGeoRaw) {
        result.geometryRaw = firstGeoRaw;
      }
    }
  } catch (e) {
    devLog(`[YSM] JSON 合并几何失败: ${safeErrorMessage(e)}`);
  }
  // 失败路径：释放未赋给 result.geometry 的 blob URL
  for (const u of pendingBlobUrls) URL.revokeObjectURL(u);
  return result;
}

async function TryJsonDispatch(ctx: InflightCtx, bytes: Uint8Array): Promise<DecodedYsm | null> {
  const text = new TextDecoder("utf-8").decode(bytes);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON（二进制 .ysm）或畸形 JSON → 抛错让外层 catch 缓存 _wasmFailed
    // （非法 JSON 不可恢复，缓存跳过避免重复尝试）
    throw new Error("JSON parse failed");
  }
  const result = parseYsmJsonDirect(json);
  if (!result) return null;

  const ysmMeta = (
    result.geometry as {
      _ysmMeta?: {
        modelFiles?: unknown[];
        texFiles?: unknown[];
        defaultTexture?: string | null;
      };
    }
  )?._ysmMeta;

  const finalResult = ysmMeta?.modelFiles?.length
    ? await HandleYsmJsonSpec(ctx, result, ysmMeta)
    : result;
  if (!finalResult) return null;

  await LoadAvatarsForJson(ctx, finalResult);

  cacheSet(ctx.modelPath, { ...finalResult, _decodedBy: "🧠 JSON 直接解析" });
  swallowError(getApp().then(({ CacheModelAvatars }) => CacheModelAvatars(ctx.modelPath)));
  return finalResult;
}

// ===== 阶段③ WASM 初始化 + 策略表驱动解码（2026 锐评 P1：四重 fallback 收敛为策略模式）=====
// 每个策略：原始字节 / MEMFS 文件路径 / 剥离文本头部 V2(自动) / V3；成功（输出非空）即停。
// 成功策略经 devLog 落环形日志（tag=ysm-decode），供排查「哪种文件落在哪条路径」。

/** 单条解码策略（空数组 = 未命中，继续下一条） */
interface DecodeStrategy {
  name: string;
  attempt: (bytes: Uint8Array) => Promise<DecodedFile[]>;
}

const DecodeStrategies: DecodeStrategy[] = [
  {
    name: "raw-mem",
    attempt: async (b) => (await decodeYsmFileFromMemory(b)) || [],
  },
  {
    name: "memfs",
    attempt: async (b) => (await decodeYsmFile(b)) || [],
  },
  {
    name: "strip-v2",
    attempt: async (b) => {
      const rebuilt = stripYsgpTextHeader(b, undefined);
      return rebuilt && rebuilt !== b ? (await decodeYsmFileFromMemory(rebuilt)) || [] : [];
    },
  },
  {
    name: "strip-v3",
    attempt: async (b) => {
      const rebuilt = stripYsgpTextHeader(b, 3);
      return rebuilt && rebuilt !== b ? (await decodeYsmFileFromMemory(rebuilt)) || [] : [];
    },
  },
];

async function InitAndDecodeWasm(modelPath: string, bytes: Uint8Array): Promise<DecodedFile[]> {
  devLog("[YSM] 加载 WASM 模块...");
  const ok = await initYSMParser();
  devLog(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
  if (!ok) {
    cacheSet(modelPath, { _wasmFailed: true });
    return [];
  }

  let files: DecodedFile[] = [];
  let successStrategy = "";
  for (const s of DecodeStrategies) {
    if (files.length) break;
    try {
      files = await s.attempt(bytes);
      if (files.length) successStrategy = s.name;
      else devLog(`[YSM] 策略 ${s.name} 未命中`);
    } catch (e) {
      devLog(`[YSM] 策略 ${s.name} 异常: ${safeErrorMessage(e)}`);
    }
  }

  if (files.length) {
    devLog(`[YSM] ✅ 解码成功（策略 ${successStrategy}）: ${files.length} 文件`);
    devLog(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);
  } else {
    devLog("[YSM] ❌ WASM 解码失败，无输出文件（跳过 callMain 直接回退 Go CLI）");
    cacheSet(modelPath, { _wasmFailed: true });
    return [];
  }
  return files;
}

// ===== 阶段④ 元数据/纹理/模型/动画 流水线 =====

function MatchTexKey(
  tn: string,
  textures: Record<string, string>,
  texLowerMap: Record<string, string>,
): string | null {
  if (!tn) return null;
  if (textures[tn]) return tn;
  const lower = tn.toLowerCase();
  return texLowerMap[lower] || null;
}

function CollectTexturesAndAvatars(files: DecodedFile[]): TexAccum {
  const textures: Record<string, string> = {};
  const texNameMap: Record<string, string> = {};
  const texLowerMap: Record<string, string> = {};
  const texDimensions: Record<string, TexDim> = {};
  const avatars: Record<string, string> = {};
  let maxTexW = 0,
    maxTexH = 0;

  for (const f of files) {
    if (!(f.path.endsWith(".png") || f.path.endsWith(".jpg"))) continue;
    if (f.path.toLowerCase().includes("gui/") || f.path.toLowerCase().includes("gui\\")) continue;
    if (f.path.startsWith("avatar/") || f.path.startsWith("avatar\\")) {
      const mime =
        f.path.toLowerCase().endsWith(".jpg") || f.path.toLowerCase().endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
      const blob = new Blob([f.data.buffer as ArrayBuffer], { type: mime });
      const name =
        f.path
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.\w+$/, "") || "";
      avatars[name] = URL.createObjectURL(blob);
      continue;
    }
    const blob = new Blob([f.data.buffer as ArrayBuffer]);
    const key =
      f.path
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.\w+$/, "") || "";
    textures[key] = URL.createObjectURL(blob);
    texNameMap[key] = f.path;
    texLowerMap[key.toLowerCase()] = key;
    const arr = new Uint8Array(f.data);
    const sniffed = sniffTexSize(arr);
    if (sniffed) {
      texDimensions[key] = sniffed;
      if (sniffed.w > maxTexW) maxTexW = sniffed.w;
      if (sniffed.h > maxTexH) maxTexH = sniffed.h;
    }
    const td = texDimensions[key];
    devLog(`[YSM] 纹理: ${f.path} → key="${key}"${td ? ` (${td.w}×${td.h})` : ""}`);
  }

  return { textures, texNameMap, texLowerMap, texDimensions, maxTexW, maxTexH, avatars };
}

function ComputeBoneTexRange(parsed: BedrockGeometry): { uvMaxW: number; uvMaxH: number } {
  let uvMaxW = 2,
    uvMaxH = 2;
  for (const b of parsed.bones) {
    for (const c of b.cubes || []) {
      const [sx, sy, sz] = c.size;
      if (Array.isArray(c.uv) && c.uv.length >= 2) {
        const [u, v] = c.uv;
        const maxU = u + 2 * (Math.abs(sx) + Math.abs(sz));
        const maxV = v + Math.abs(sy) + Math.abs(sz);
        if (maxU > uvMaxW) uvMaxW = maxU;
        if (maxV > uvMaxH) uvMaxH = maxV;
      } else if (c.faceUV) {
        try {
          const fd = JSON.parse(c.faceUV) as Record<string, { uv?: number[]; uv_size?: number[] }>;
          for (const fn of ["east", "west", "up", "down", "south", "north"]) {
            const f = fd[fn];
            if (!f?.uv) continue;
            const fw = Math.abs(f.uv_size?.[0] || 0);
            const fh = Math.abs(f.uv_size?.[1] || 0);
            const uEnd = f.uv[0] + fw;
            const vEnd = f.uv[1] + fh;
            if (uEnd > uvMaxW) uvMaxW = uEnd;
            if (vEnd > uvMaxH) uvMaxH = vEnd;
          }
        } catch (_e) {
          /* faceUV 解析失败由调用方 devLog，此处只算范围 */
        }
      }
    }
  }
  return { uvMaxW, uvMaxH };
}

function ProcessModelFile(f: DecodedFile, ctx: ProcessModelCtx, forcedTexIdx?: number): void {
  if (!f || ctx.processedModels.has(f.path)) return;
  ctx.processedModels.add(f.path);
  devLog(`[YSM] 解析 ${f.path}...`);
  try {
    const jsonStr = new TextDecoder().decode(f.data);
    const parsed = parseBedrockGeometryFromJSON(jsonStr);
    if (!parsed?.bones?.length) return;
    devLog(`[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`);
    if (!ctx.firstGeometryRawRef.current) ctx.firstGeometryRawRef.current = jsonStr;

    const texIdx = forcedTexIdx ?? 0;
    const texKey =
      ctx.orderedTexKeys.length > texIdx
        ? ctx.orderedTexKeys[texIdx]
        : ctx.orderedTexKeys[0] || null;
    const texUrl = texKey ? ctx.textures[texKey] : null;

    const { uvMaxW, uvMaxH } = ComputeBoneTexRange(parsed);

    const texDim = texKey ? ctx.texDimensions[texKey] : null;
    const actualTexW = texDim ? texDim.w : 0;
    const actualTexH = texDim ? texDim.h : 0;
    const boneTexW = Math.max(actualTexW, parsed.texWidth, uvMaxW) || 64;
    const boneTexH = Math.max(actualTexH, parsed.texHeight, uvMaxH) || 64;

    ctx.texMappingLog.push({
      file: f.path.split(/[/\\]/).pop() || "",
      texKey: texKey || "—",
      texIdx,
      pngSize: actualTexW > 0 ? `${actualTexW}×${actualTexH}` : "—",
      geoSize: parsed.texWidth > 0 ? `${parsed.texWidth}×${parsed.texHeight}` : "—",
      uvSize: `${uvMaxW}×${uvMaxH}`,
      finalSize: `${boneTexW}×${boneTexH}`,
    });
    for (const b of parsed.bones) {
      b._texIdx = texIdx;
      b._texUrl = texUrl;
      b._texWidth = boneTexW;
      b._texHeight = boneTexH;
    }
    ctx.allBones.push(...parsed.bones);
    if (!ctx.geometryRef.current) {
      ctx.geometryRef.current = parsed;
    } else {
      ctx.geometryRef.current.boneCount += parsed.boneCount;
      ctx.geometryRef.current.cubeCount += parsed.cubeCount;
      if (parsed.texWidth > ctx.geometryRef.current.texWidth) {
        ctx.geometryRef.current.texWidth = parsed.texWidth;
      }
      if (parsed.texHeight > ctx.geometryRef.current.texHeight) {
        ctx.geometryRef.current.texHeight = parsed.texHeight;
      }
    }
  } catch (e) {
    devLog(`[YSM] ❌ ${f.path}: ${safeErrorMessage(e)}`);
  }
}

function GetModelName(mp: unknown): string {
  return (
    (typeof mp === "string"
      ? mp
      : (mp as { path?: string; name?: string })?.path || (mp as { name?: string })?.name || ""
    )
      .split(/[/\\]/)
      .pop() || ""
  );
}

function MatchModelFilesByOrder(
  files: DecodedFile[],
  meta: YsmMeta,
  orderedTexKeys: string[],
  ctx: ProcessModelCtx,
): void {
  if (!meta.ysmModelOrder) return;
  const texKeyToIdx: Record<string, number> = {};
  orderedTexKeys.forEach((k, i) => {
    texKeyToIdx[k] = i;
  });
  for (const mp of meta.ysmModelOrder) {
    const mn = GetModelName(mp);
    if (!mn) continue;
    const lowerBase = mn.replace(/\.json$/i, "").toLowerCase();
    let matchedKey: string | null = null;
    for (const k of Object.keys(texKeyToIdx)) {
      if (k.toLowerCase().includes(lowerBase) || lowerBase.includes(k.toLowerCase())) {
        matchedKey = k;
        break;
      }
    }
    const texIdx = matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
    const f = files.find(
      (ff) => ff.path.endsWith(`/${mn}`) || ff.path.endsWith(`\\${mn}`) || ff.path === mn,
    );
    if (f) ProcessModelFile(f, ctx, texIdx);
  }
}

function ProcessRemainingModelFiles(
  files: DecodedFile[],
  meta: YsmMeta,
  ctx: ProcessModelCtx,
): void {
  for (const f of files) {
    if (!f.path.startsWith("models/")) continue;
    const modelName = f.path.split("/").pop();
    const matched = meta.ysmModelOrder?.some((mp) => {
      const mn = GetModelName(mp).split("/").pop();
      return mn === modelName;
    });
    if (!matched) ProcessModelFile(f, ctx, 0);
  }
}

function ParseAnimations(files: DecodedFile[]): unknown[] {
  const animations: unknown[] = [];
  for (const f of files) {
    if (!f.path.startsWith("animations/") || !f.path.endsWith(".json")) continue;
    devLog(`[YSM] 动画 ${f.path}...`);
    try {
      const jsonStr = new TextDecoder().decode(f.data);
      const { clips } = parseBedrockAnimationJSON(jsonStr);
      if (clips.length > 0) animations.push(...clips);
    } catch (e) {
      devLog(`[YSM] ❌ ${f.path}: ${safeErrorMessage(e)}`);
    }
  }
  return animations;
}

function AssembleFinalGeometry(
  ctx: ProcessModelCtx,
  orderedTexKeys: string[],
  textures: Record<string, string>,
  maxTexW: number,
  maxTexH: number,
): BedrockGeometry | null {
  const geo = ctx.geometryRef.current as BedrockGeometry | null;
  if (geo) {
    geo.bones = ctx.allBones;
    geo.textures = orderedTexKeys.map((k) => textures[k]).filter(Boolean);
    geo.textureNames = orderedTexKeys;
    geo.texture = orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null;
    if (maxTexW > geo.texWidth) geo.texWidth = maxTexW;
    if (maxTexH > geo.texHeight) geo.texHeight = maxTexH;
    geo._texMappingLog = ctx.texMappingLog;
  }
  return geo;
}

function FinalizeAuthorsWithAvatars(
  meta: YsmMeta,
  avatars: Record<string, string>,
): YsmMeta["authors"] {
  return meta.authors.map((au) => {
    const avatarKey =
      au.avatarPath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.\w+$/, "") || "";
    return { ...au, avatarUrl: avatars[avatarKey] || au.avatarUrl };
  });
}

async function HandleWasmDecode(modelPath: string, bytes: Uint8Array): Promise<DecodedYsm | null> {
  const files = await InitAndDecodeWasm(modelPath, bytes);
  if (!files?.length) return null;

  const { meta, hasYsmMeta } = parseYsmMetaFromFiles(files);
  const texAccum = CollectTexturesAndAvatars(files);
  meta.avatars = texAccum.avatars;

  const orderedTexKeys = buildOrderedTexKeys({
    texKeys: Object.keys(texAccum.textures),
    areaOf: (k) =>
      texAccum.texDimensions[k] ? texAccum.texDimensions[k].w * texAccum.texDimensions[k].h : 0,
    ysmTexOrder: meta.ysmTexOrder,
    ysmDefaultTex: meta.ysmDefaultTex,
    matchTexKey: (tn) => MatchTexKey(tn, texAccum.textures, texAccum.texLowerMap),
  });

  const processCtx: ProcessModelCtx = {
    orderedTexKeys,
    textures: texAccum.textures,
    texDimensions: texAccum.texDimensions,
    allBones: [],
    processedModels: new Set(),
    texMappingLog: [],
    geometryRef: { current: null },
    firstGeometryRawRef: { current: null },
  };

  MatchModelFilesByOrder(files, meta, orderedTexKeys, processCtx);
  ProcessRemainingModelFiles(files, meta, processCtx);

  const geometry = processCtx.geometryRef.current;
  if (!geometry && !hasYsmMeta) {
    devLog("[YSM] 无 ysm.json 引导，移交 Go 确保纹理正确映射");
    RevokeTexAccumBlobs(texAccum);
    cacheSet(modelPath, { _wasmFailed: true });
    return null;
  }
  if (!geometry && files?.length > 0) {
    devLog(`[YSM] ⚠️ WASM 解码成功但几何体解析为空，回退 Go CLI`);
    RevokeTexAccumBlobs(texAccum);
    cacheSet(modelPath, { _wasmFailed: true });
    return null;
  }

  const finalGeo = AssembleFinalGeometry(
    processCtx,
    orderedTexKeys,
    texAccum.textures,
    texAccum.maxTexW,
    texAccum.maxTexH,
  );
  const animations = ParseAnimations(files);
  const finalAuthors = FinalizeAuthorsWithAvatars(meta, texAccum.avatars);

  const texUrl =
    (finalGeo as BedrockGeometry | null)?.texture ||
    (orderedTexKeys.length > 0 ? texAccum.textures[orderedTexKeys[0]] : null) ||
    null;
  const result: DecodedYsm = {
    texture: texUrl,
    geometry: finalGeo,
    // geometryRaw / animGroups / configMenus 为 DecodedYsm 可选键（utils，非本域）——
    // 仅真实存在时附带，避免显式 undefined 流入
    ...(processCtx.firstGeometryRawRef.current != null
      ? { geometryRaw: processCtx.firstGeometryRawRef.current }
      : {}),
    animations,
    avatars: texAccum.avatars,
    authors: finalAuthors,
    ...(meta.animGroups !== undefined ? { animGroups: meta.animGroups } : {}),
    ...(meta.configMenus !== undefined ? { configMenus: meta.configMenus } : {}),
  };
  cacheSet(modelPath, { ...result, _decodedBy: "🧠 WASM 内置解码" });
  swallowError(getApp().then(({ CacheModelAvatars }) => CacheModelAvatars(modelPath)));
  return result;
}

// ===== 主流程：分派 + LRU 守卫（≤70 行） =====

async function doDecodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) return cached as DecodedYsm;
  if (cached?._wasmFailed) return null;

  let ReadFileBytes: (path: string) => Promise<string | null>;
  let raw: string | null;
  try {
    ({ ReadFileBytes } = await getApp());
    raw = await ReadFileBytes(modelPath);
  } catch (e) {
    // 读文件/后端瞬时失败：不缓存 _wasmFailed（那是解码失败标记），仅记日志返回 null，
    // 下次调用可重试读文件——避免后端短暂不可用导致本会话永久跳过该模型。
    devLog(`[YSM] ❌ ${safeErrorMessage(e)}`);
    return null;
  }
  const bytes = raw ? Base64ToBytes(raw) : new Uint8Array(0);
  devLog(`[YSM] 读取 ${bytes?.length || 0} bytes`);

  if (!bytes?.length) return HandleEmptyBytes(modelPath);

  const ctx: InflightCtx = {
    modelPath,
    baseDir: GetBaseDir(modelPath),
    ReadFileBytes,
  };

  try {
    if (/\.json$/i.test(modelPath)) {
      return await TryJsonDispatch(ctx, bytes);
    }
  } catch (e) {
    devLog(`[YSM] ❌ ${safeErrorMessage(e)}`);
    cacheSet(modelPath, { _wasmFailed: true });
    return null;
  }

  try {
    return await HandleWasmDecode(modelPath, bytes);
  } catch (e) {
    devLog(`[YSM] ❌ ${safeErrorMessage(e)}`);
    return null;
  }
}
