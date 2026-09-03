// ===== mmd-build-load.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { safeGet } from "../../utils/dom/storage.ts";
import { formatLongTask, startMainThreadWatch } from "../../utils/main-thread-watch.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";
import { Ktx2TextureLoader } from "./mmd-ktx2-texture-loader.ts";
import { createPmxParser } from "./mmd-pmx-parser.ts";
import { getTextureDecoder } from "./mmd-texture-decoder.ts";
import { concurrentMap, isLikelyTga, TEXTURE_EXTS } from "./mmd-utils.ts";
import { prepareMmdZipInput } from "./mmd-zip-overlay.ts";
import { bytesToBase64 } from "../base64.ts";
import { renderLoadingState } from "./preview-loading.ts";
import { mmdDiag } from "./mmd-shared.ts";
import type { MdMmDetectFormatCtx, MdMmStage1Ctx, MdMmStage1bCtx, MdMmStage2Ctx } from "./mmd-types.ts";

export function mdMmDetectFormat(c: MdMmDetectFormatCtx): "pmx" | "pmd" {
  const ext = c.modelBase.split(".").pop()?.toLowerCase();
  if (ext === "pmd") return "pmd";
  return "pmx";
}

export async function mdMmStage1Input(c: MdMmStage1Ctx): Promise<void> {
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
      b64: bytesToBase64(zip.modelBytes),
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
  c.bytes = c.zipModelOverride?.bytes ?? b64ToBytes(c.modelB64);
  c.modelBase =
    c.zipModelOverride?.base ?? (c.effectivePath.split(/[/\\]/).pop() || "").toLowerCase();
  c.usePmxWorker = safeGet("mmd-pmx-worker") === "1";
  c.pmxParser = null;
  c.pmxParsePromise = null;
  if (c.usePmxWorker) {
    c.pmxParser = createPmxParser();
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
  await mdMmStage1bFileScan(c);
}

async function mdMmStage1bFileScan(c: MdMmStage1bCtx): Promise<void> {
  try {
    const files = (await c.effectivePort.listAllFilePaths(c.dirPath)) || [];
    c._traceFiles = files.length;
    const texFiles = files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext)));
    const texBatch: Record<string, string | null> = {};
    const texHashBatch: Record<string, string> = {};
    if (texFiles.length > 0) {
      try {
        if (c.effectivePort.readFileBytesBatchWithMeta) {
          const metaBatch = await c.effectivePort.readFileBytesBatchWithMeta(texFiles);
          if (metaBatch) {
            for (const p of texFiles) {
              const entry = metaBatch[p];
              if (entry) {
                texBatch[p] = entry.data;
                if (entry.hash) texHashBatch[p] = entry.hash;
              }
            }
          }
        }
        if (Object.keys(texBatch).length < texFiles.length) {
          const fallback = await c.effectivePort.readFileBytesBatch(texFiles);
          for (const p of texFiles) {
            if (!(p in texBatch) && fallback[p] !== undefined) {
              texBatch[p] = fallback[p];
            }
          }
        }
      } catch {
        void mmdDiag(
          c.effectivePort,
          "batch-read",
          c.dirPath,
          "warn",
          "批量读取失败，降级并发分片读取",
        );
        const fallbackResults = await concurrentMap(texFiles, async (p) => {
          try {
            return [p, await c.effectivePort.readFileBytes(p)] as const;
          } catch {
            return [p, null] as const;
          }
        });
        for (const [p, v] of fallbackResults) texBatch[p] = v;
      }
    }
    for (const p of texFiles) {
      const lower = p.toLowerCase().replace(/\\/g, "/");
      const dirNorm = c.dirPath.toLowerCase().replace(/\\/g, "/");
      const rel = lower.startsWith(dirNorm + "/") ? lower.slice(dirNorm.length + 1) : lower;
      const baseName = lower.split("/").pop() || "";
      const texB64 = texBatch[p] ?? null;
      if (!texB64) continue;
      const texBytes = b64ToBytes(texB64);
      if (p.toLowerCase().endsWith(".tga") && !isLikelyTga(texBytes)) continue;
      const blob = new Blob([bytesToArrayBuffer(texBytes)]);
      const url = URL.createObjectURL(blob);
      c.blobUrls.push(url);
      if (!p.toLowerCase().endsWith(".tga")) {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          bmp: "image/bmp",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mime = mimeMap[ext] || "image/png";
        c.decodeTasks.push({
          relPath: rel || baseName,
          bytes: bytesToArrayBuffer(texBytes),
          mimeType: mime,
        });
      }
      c.texMap.set(rel, url);
      c.texMap.set(baseName, url);
      c.blobUrlToRel.set(url, rel);
      if (texHashBatch[p] && !p.toLowerCase().endsWith(".tga")) {
        c.texHashMap.set(rel, texHashBatch[p]);
        c.blobUrlToHash.set(url, texHashBatch[p]);
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

export async function mdMmStage2LoadingManager(c: MdMmStage2Ctx): Promise<void> {
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
      ktx2Loader: (c.ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(c.ctx.renderer)),
      fallbackLoader: new THREE.TextureLoader(c.manager),
    });
    c.manager.addHandler(/\.(png|jpe?g|bmp|gif|webp)$/i, ktx2DirectLoader);
  }
}
