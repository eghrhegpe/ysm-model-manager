// ===== mmd-build-load.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { Ktx2TextureLoader } from "@/preview-3d/decoder/mmd-ktx2-texture-loader.ts";
import { renderLoadingState } from "@/preview-3d/infra/preview-loading.ts";
import { base64ToBytes, bytesToArrayBuffer, u8ToBase64 } from "@/utils/base/primitives/base64.ts";
import { formatLongTask, startMainThreadWatch } from "@/utils/base/primitives/main-thread-watch.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { createPmxParser } from "./mmd-pmx-parser.ts";
import { mmdDiag, trackAlloc } from "./mmd-shared.ts";
import { getTextureDecoder } from "./mmd-texture-decoder.ts";
import type { detectFormatCtx, Stage1bCtx, Stage1Ctx, Stage2Ctx } from "./mmd-types.ts";
import { concurrentMap, isLikelyTga, TEXTURE_EXTS } from "./mmd-utils.ts";
import { prepareMmdZipInput } from "./mmd-zip-overlay.ts";

export function detectFormat(c: detectFormatCtx): "pmx" | "pmd" {
  const ext = c.modelBase.split(".").pop()?.toLowerCase();
  if (ext === "pmd") return "pmd";
  return "pmx";
}

export async function Stage1Input(c: Stage1Ctx): Promise<void> {
  renderLoadingState(
    c.ctx.loadingEl,
    "🎭",
    "preview.loadingModel",
    "determinate",
    "ysm-mmd-progress",
  );
  c.stopLongTaskWatch = startMainThreadWatch((info) => {
    void mmdDiag(c.effectivePort, "main-thread", formatLongTask(info), "warn");
  });
  c.origPath = c.path;
  c.effectivePort = c.port;
  c.effectivePath = c.path;
  c.zipModelOverride = null;
  c.zipModelCandidates = [];
  if (c.path.toLowerCase().endsWith(".zip")) {
    const zip = await prepareMmdZipInput(c.effectivePath, c.port);
    c.effectivePort = zip.port;
    c.effectivePath = zip.rootPath + zip.modelEntry;
    // [doc:adr-132] 暴露全部 pmx/pmd 候选虚拟路径（模型面板切换用）；第一个 = 当前
    c.zipModelCandidates = zip.allModelEntries.map((key) => zip.rootPath + key);
    c.zipModelOverride = {
      bytes: zip.modelBytes,
      base: zip.modelBase,
      b64: u8ToBase64(zip.modelBytes),
    };
    void mmdDiag(
      c.effectivePort,
      "zip-preprocess",
      c.origPath,
      "ok",
      `model=${zip.modelBase} zip内文件已映射到虚拟路径`,
    );
  }
  c.modelB64 = c.zipModelOverride?.b64 ?? (await c.effectivePort.readFileBytes(c.effectivePath));
  await mmdDiag(
    c.effectivePort,
    "read-model",
    c.effectivePath,
    c.modelB64 ? "ok" : "fail",
    c.modelB64 ? `bytes=${c.modelB64.length}` : "ReadFileBytes 返回空",
  );
  if (!c.modelB64) throw new Error("ReadFileBytes 返回空");
  c.bytes = c.zipModelOverride?.bytes ?? (base64ToBytes(c.modelB64) as Uint8Array);
  c.modelBase =
    c.zipModelOverride?.base ?? (c.effectivePath.split(/[/\\]/).pop() || "").toLowerCase();
  c.usePmxWorker = safeGet("mmd-pmx-worker") === "1";
  c.pmxParser = null;
  c.pmxParsePromise = null;
  if (c.usePmxWorker) {
    c.pmxParser = createPmxParser();
    // 分配即登记失败释放（2026-09-03 注册表化；成功路径 parse 内已内联 dispose，此处兜底失败路径）
    trackAlloc(c, "pmxParser", () => c.pmxParser?.dispose?.());
    // worker parse 走 postMessage transfer——同步 detach 传入的 ArrayBuffer。必须给独立
    // 拷贝（slice），否则 c.bytes 的 buffer 被 detach 后，下方 573 行 Blob 构造拿到的
    // 是同源已 detach buffer（byteLength 0 → 异常或空模型 blob），zip 模式的 entries
    // 字节同样被连带清空（e7f20226 bytesToArrayBuffer 零拷贝与 transfer 的冲突点）
    c.pmxParsePromise = c.pmxParser.parse(bytesToArrayBuffer(c.bytes.slice()));
    void mmdDiag(
      c.effectivePort,
      "pmx-parse-dispatch",
      c.effectivePath,
      "ok",
      "PMX binary parse dispatched to worker (mmd-pmx-worker=1)",
    );
  } else {
    void mmdDiag(
      c.effectivePort,
      "pmx-parse-dispatch",
      c.effectivePath,
      "ok",
      "主线程 MMDLoader 路径（mmd-pmx-worker 默认关）",
    );
  }
  c.dirPath = c.effectivePath.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  c.texMap = new Map();
  c._traceFiles = 0;
  c._traceGpuMb = 0;
  c.blobUrls = [];
  c.vmdPaths = [];
  c.vpdPaths = [];
  c.texHashMap = new Map();
  c.decodeTasks = [];
  c.decodedTexturesPromise = null;
  c.modelBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(c.bytes)]));
  c.blobUrls.push(c.modelBlobUrl);
  c.texMap.set(c.modelBase, c.modelBlobUrl);
  c.blobUrlToRel = new Map();
  c.blobUrlToHash = new Map();
  await Stage1bFileScan(c);
}

/**
 * 纹理字节读取：三级降级链（命名向行为诚实——本函数实际是「带降级的批量读取器」，
 * 而非单纯的批次读取）。
 *
 * ① `readFileBytesBatchWithMeta`（可选能力，带 hash——供纹理去重/缓存命中）
 * ② `readFileBytesBatch`（无 hash 的批量；仅补 ① 未覆盖的条目——① 返回部分结果时不浪费重读）
 * ③ `concurrentMap` + 单文件 `readFileBytes`（前两级**抛错**时的兜底；单条失败不阻塞其余）
 *
 * 降级触发语义不同，勿合并：①→② 是「① 成功但覆盖不全」的**补齐**（不抛错），
 * ②→③ 是「批量通道整体不可用」的**兜底**（抛错才走）。故 ①/② 同处一个 try。
 *
 * @returns texBatch（路径→base64|null）+ texHashBatch（路径→hash，仅 ① 提供）
 */
async function readTextureBytesWithFallback(
  c: Stage1bCtx,
  texFiles: string[],
): Promise<{ texBatch: Record<string, string | null>; texHashBatch: Record<string, string> }> {
  const texBatch: Record<string, string | null> = {};
  const texHashBatch: Record<string, string> = {};
  if (texFiles.length === 0) return { texBatch, texHashBatch };

  const port = c.effectivePort;
  try {
    // ① 带 meta（hash）的批量读取——可选能力，未实现则跳过
    if (port.readFileBytesBatchWithMeta) {
      const metaBatch = await port.readFileBytesBatchWithMeta(texFiles);
      if (metaBatch) {
        for (const p of texFiles) {
          const entry = metaBatch[p];
          if (!entry) continue;
          texBatch[p] = entry.data;
          if (entry.hash) texHashBatch[p] = entry.hash;
        }
      }
    }
    // ② 无 hash 的批量补齐（仅对 ① 未覆盖的条目）
    if (Object.keys(texBatch).length < texFiles.length) {
      const rest = await port.readFileBytesBatch(texFiles);
      for (const p of texFiles) {
        if (!(p in texBatch) && rest[p] !== undefined) texBatch[p] = rest[p];
      }
    }
    return { texBatch, texHashBatch };
  } catch {
    // ③ 批量通道整体不可用（RPC 失败等）→ 并发分片逐个读，单条失败不阻塞
    void mmdDiag(port, "batch-read", c.dirPath, "warn", "批量读取失败，降级并发分片读取");
    const fallbackResults = await concurrentMap(texFiles, async (p) => {
      try {
        return [p, await port.readFileBytes(p)] as const;
      } catch {
        return [p, null] as const;
      }
    });
    for (const [p, v] of fallbackResults) texBatch[p] = v;
    return { texBatch, texHashBatch };
  }
}

/** 纹理扩展名 → MIME（解码 worker 需要；模块级常量——原为循环内每张纹理重建一次） */
const TEX_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  gif: "image/gif",
  webp: "image/webp",
};

/** 单张纹理的登记产物：blob URL + 相对路径（供调用方写 texMap / blobUrlToRel） */
interface RegisteredTexture {
  url: string;
  rel: string;
}

/**
 * 登记单张纹理：建 blob URL → 推入待解码任务 → 累计归属映射。
 * TGA 特殊：非真 TGA 直接跳过（返回 null）；真 TGA 不解码（走 MMDLoader 原生路径）。
 * @returns 登记结果；null 表示该纹理被跳过（无字节 / 伪 TGA）
 */
function registerTexture(c: Stage1bCtx, p: string, texB64: string): RegisteredTexture | null {
  const lower = p.toLowerCase().replace(/\\/g, "/");
  const dirNorm = c.dirPath.toLowerCase().replace(/\\/g, "/");
  const rel = lower.startsWith(`${dirNorm}/`) ? lower.slice(dirNorm.length + 1) : lower;
  const baseName = lower.split("/").pop() || "";
  const isTga = p.toLowerCase().endsWith(".tga");

  const texBytes = base64ToBytes(texB64) as Uint8Array;
  if (isTga && !isLikelyTga(texBytes)) return null;

  const url = URL.createObjectURL(new Blob([bytesToArrayBuffer(texBytes)]));
  c.blobUrls.push(url);
  if (!isTga) {
    const mime = TEX_MIME_BY_EXT[p.split(".").pop()?.toLowerCase() || ""] || "image/png";
    c.decodeTasks.push({
      relPath: rel || baseName,
      bytes: bytesToArrayBuffer(texBytes),
      mimeType: mime,
    });
  }
  c.texMap.set(rel, url);
  c.texMap.set(baseName, url);
  c.blobUrlToRel.set(url, rel);
  return { url, rel };
}

async function Stage1bFileScan(c: Stage1bCtx): Promise<void> {
  try {
    const files = (await c.effectivePort.listAllFilePaths(c.dirPath)) || [];
    c._traceFiles = files.length;
    const texFiles = files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext)));
    const { texBatch, texHashBatch } = await readTextureBytesWithFallback(c, texFiles);
    for (const p of texFiles) {
      const texB64 = texBatch[p] ?? null;
      if (!texB64) continue;
      const registered = registerTexture(c, p, texB64);
      if (!registered) continue;
      const { url, rel } = registered;
      // hash 仅对非 TGA 有意义（TGA 不走解码通道，hash 无处消费）
      const hash = texHashBatch[p];
      if (hash && !p.toLowerCase().endsWith(".tga")) {
        c.texHashMap.set(rel, hash);
        c.blobUrlToHash.set(url, hash);
      }
    }
    if (c.decodeTasks.length > 0) {
      const decoder = getTextureDecoder();
      c.decodedTexturesPromise = decoder.decodeAll(c.decodeTasks);
      void mmdDiag(
        c.effectivePort,
        "tex-decode-dispatch",
        c.dirPath,
        "ok",
        `dispatched=${c.decodeTasks.length} textures to decode workers`,
      );
    }
    c.vmdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vmd")));
    c.vpdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vpd")));
    await mmdDiag(
      c.effectivePort,
      "list-files",
      c.dirPath,
      "ok",
      `files=${files.length} tex=${files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext))).length} vmd=${c.vmdPaths.length}`,
    );
  } catch (e) {
    await mmdDiag(c.effectivePort, "list-files", c.dirPath, "fail", safeErrorMessage(e));
  }
}

export async function Stage2LoadingManager(c: Stage2Ctx): Promise<void> {
  c.manager = new THREE.LoadingManager();
  c.textureLoadedAt = 0;
  c.tParseStart = 0;
  c.tParseEnd = 0;
  c.tBuildEnd = 0;
  c.mmd = null;
  c.manager.onProgress = (_url: string, loaded: number, total: number): void => {
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    const bar = c.ctx.loadingEl.querySelector<HTMLElement>("#ysm-mmd-progress");
    if (bar) bar.style.width = `${Math.max(5, pct)}%`;
  };
  c.manager.onLoad = (): void => {
    c.textureLoadedAt = performance.now();
    if (c.tParseEnd === 0) return;
    const buildMs = c.tBuildEnd > 0 ? Math.max(0, c.tBuildEnd - c.tParseEnd) : 0;
    const dimCount = new Map<string, number>();
    const mmdMesh = c.mmd?.mesh;
    const mats = Array.isArray(mmdMesh?.material)
      ? mmdMesh.material
      : mmdMesh?.material
        ? [mmdMesh.material]
        : [];
    for (const m of mats) {
      const img = (m as { map?: { image?: HTMLImageElement } })?.map?.image;
      if (img?.width && img?.height) {
        const key = `${img.width}x${img.height}`;
        dimCount.set(key, (dimCount.get(key) ?? 0) + 1);
      }
    }
    const texSizes = [...dimCount.entries()].map(([k, n]) => `${k}x${n}`).join(",") || "none";
    let gpuBytes = 0;
    for (const [dim, n] of dimCount) {
      const [w, h] = dim.split("x").map(Number);
      if (w && h) gpuBytes += w * h * 4 * n;
    }
    const gpuMb = (gpuBytes / (1024 * 1024)).toFixed(1);
    c._traceGpuMb = parseFloat(gpuMb);
    void mmdDiag(
      c.effectivePort,
      "perf",
      c.effectivePath,
      "ok",
      `parse=${Math.round(c.tParseEnd - c.tParseStart)}ms texture=${Math.round(c.textureLoadedAt - c.tParseEnd)}ms build=${Math.round(buildMs)}ms tex=${texSizes} gpu≈${gpuMb}MB`,
    );
  };
  c.manager.setURLModifier((url: string): string => {
    const lower = url.toLowerCase().replace(/\\/g, "/");
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, blobUrl] of c.texMap) {
      if (key.length > bestLen && lower.endsWith(key)) {
        best = blobUrl;
        bestLen = key.length;
      }
    }
    return best ?? url;
  });
  if (c.ctx.renderer) {
    const ktx2DirectLoader = new Ktx2TextureLoader({
      resolveHash: (url: string): string | undefined => {
        const lower = url.toLowerCase().replace(/\\/g, "/");
        const base = lower.split("/").pop() ?? "";
        if (base.startsWith("toon") || lower.includes("/toon/")) return undefined;
        let best: string | undefined;
        let bestLen = -1;
        for (const [rel, hash] of c.texHashMap) {
          const rl = rel.toLowerCase();
          if (rl.endsWith(base) && rl.length > bestLen) {
            best = hash;
            bestLen = rl.length;
          }
        }
        return best;
      },
      getCachedTextureByHash: async (hash: string): Promise<string | null> => {
        try {
          // ADR-072：适配器 0 backend import——KTX2 缓存经 port 注入（壳层实现），
          // port 未提供该方法（可选）→ undefined || null；空串/缺绑定均归一 null（保留原守卫语义）
          return (await c.effectivePort.getCachedTextureByHash?.(hash)) || null;
        } catch {
          return null;
        }
      },
      // biome-ignore lint/suspicious/noAssignInExpressions: ktx2Loader 惰性初始化 + 写回缓存
      ktx2Loader: (c.ktx2Loader = new KTX2Loader()
        .setTranscoderPath("/basis/")
        .detectSupport(c.ctx.renderer)),
      fallbackLoader: new THREE.TextureLoader(c.manager),
    });
    // KTX2 直读 loader 是 GPU 资源——分配即登记失败释放（2026-09-03 注册表化）
    trackAlloc(c, "ktx2Loader", () => c.ktx2Loader?.dispose());
    c.manager.addHandler(/\.(png|jpe?g|bmp|gif|webp)$/i, ktx2DirectLoader);
  }
}
