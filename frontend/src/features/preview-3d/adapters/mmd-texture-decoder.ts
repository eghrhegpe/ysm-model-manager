// ===== MMD 纹理解码器（Worker 池管理器）=====
// 与 mmd-ktx2-encoder.ts 的 Worker 池哲学一致：
// 1. 固定 Worker 池（默认 4 个，与 TEXTURE_READ_CHUNK_SIZE 对齐）
// 2. 每个 Worker 接收一个 TexDecodeRequest → 返回 TexDecodeResponse
// 3. 主线程 dispatch 所有解码任务 → 汇总结果 → 返回 Map<relPath, ImageBitmap>
// 4. 失败的纹理静默跳过，由主线程 fallback 处理

import * as THREE from "three";
import type { TexDecodeRequest, TexDecodeResponse } from "./mmd-texture-decode.worker.ts";

/** Worker 池大小：4 个并行解码线程 */
const TEX_DECODE_WORKER_COUNT = 4;

/** 解码器配置 */
export interface TexDecodeConfig {
  /** 最大 Worker 数（默认 4） */
  maxWorkers?: number;
  /** 单纹理解码超时 ms（默认 8000） */
  timeoutMs?: number;
}

/** 解码结果条目 */
export interface DecodedTexture {
  relPath: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /**
   * 引用计数：每个包装该 bitmap 的 THREE.Texture 占 1。
   * 同一 relPath 可能被多材质/多纹理槽共享（如 map 与 emissiveMap 用同一贴图），
   * dispose 监听须计数递减、归零才 close——否则一个纹理释放会误伤仍在用的共享位图（review P2）。
   */
  refCount: number;
}

/**
 * 解码管理器：创建 Worker 池、分发任务、收集结果。
 * 使用方法：const decoder = createTextureDecoder(); const results = await decoder.decodeAll(tasks);
 */
export interface TextureDecoder {
  /** 解码一批纹理（并行 Worker 池处理） */
  decodeAll(tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>): Promise<Map<string, DecodedTexture>>;
  /** 释放 Worker 池 */
  dispose(): void;
}

/** 创建纹理解码器（Worker 池） */
function createTextureDecoder(config: TexDecodeConfig = {}): TextureDecoder {
  const maxWorkers = config.maxWorkers ?? TEX_DECODE_WORKER_COUNT;
  const timeoutMs = config.timeoutMs ?? 8000;

  // 创建 Worker 池
  const workers: Worker[] = [];
  for (let i = 0; i < maxWorkers; i++) {
    workers.push(new Worker(
      new URL("./mmd-texture-decode.worker.ts", import.meta.url),
      { type: "module" },
    ));
  }

  // 任务分配器：round-robin 到 Worker
  let workerIdx = 0;
  let nextId = 0;

  const pending = new Map<number, {
    resolve: (r: TexDecodeResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // Worker 消息处理
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<TexDecodeResponse>) => {
      const { id } = e.data;
      const entry = pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve(e.data);
      }
    };
    w.onerror = () => { /* Worker 错误由 timeout 兜底 */ };
  }

  function decodeAll(tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>): Promise<Map<string, DecodedTexture>> {
    if (tasks.length === 0) return Promise.resolve(new Map());

    const results = new Map<string, DecodedTexture>();
    let completed = 0;
    const total = tasks.length;

    return new Promise((resolve) => {
      for (const task of tasks) {
        const id = nextId++;
        const w = workers[workerIdx % workers.length];
        workerIdx++;

        const req: TexDecodeRequest = {
          id,
          relPath: task.relPath,
          bytes: task.bytes,
          mimeType: task.mimeType,
        };

        const timer = setTimeout(() => {
          // 超时：静默跳过（主线程 fallback 会覆盖）
          pending.delete(id);
          completed++;
          if (completed >= total) resolve(results);
        }, timeoutMs);

        pending.set(id, {
          resolve: (resp: TexDecodeResponse) => {
            if (resp.ok && resp.bitmap) {
              results.set(resp.relPath, {
                relPath: resp.relPath,
                bitmap: resp.bitmap,
                width: resp.width!,
                height: resp.height!,
                refCount: 0,
              });
            }
            completed++;
            if (completed >= total) resolve(results);
          },
          timer,
        });

        w.postMessage(req, [task.bytes]);
      }
    });
  }

  function dispose() {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, error: "Worker 已终止", relPath: "", width: 0, height: 0 });
    }
    pending.clear();
    for (const w of workers) w.terminate();
  }

  return { decodeAll, dispose };
}

/** 单例：全局复用同一个 Worker 池，避免每次加载都重建 */
let sharedDecoder: TextureDecoder | null = null;

/** 获取共享解码器（懒创建） */
export function getTextureDecoder(): TextureDecoder {
  if (!sharedDecoder) {
    sharedDecoder = createTextureDecoder();
  }
  return sharedDecoder;
}

/** 释放共享解码器 */
function disposeTextureDecoder(): void {
  if (sharedDecoder) {
    sharedDecoder.dispose();
    sharedDecoder = null;
  }
}

/**
 * 将 Worker 解码的 ImageBitmap 应用到 MMD 模型的材质纹理：
 * 1. 优先处理 Worker 路径材质（userData.pendingTexture），直接创建纹理赋值
 * 2. 再处理 Fallback 路径材质，将命中的 blob:HTMLImageElement 替换为 ImageBitmap
 */
export function applyWorkerDecodedTextures(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): { replaced: number; total: number } {
  const allMats: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];

  const texKeys = [
    "map", "emissiveMap", "normalMap", "roughnessMap",
    "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap",
    "sphereMap", "toonMap", "displacementMap", "bumpMap",
  ] as const;

  let replaced = 0;
  let total = 0;
  let pendingCount = 0;

  for (const mat of allMats) {
    // Worker 路径：pendingTexture 标记，直接同步赋值
    const pending = (mat.userData as Record<string, unknown>)?.pendingTexture as
      | { relPath: string; blobUrl: string }
      | undefined;
    if (pending) {
      pendingCount++;
      // PMX路径与磁盘rel路径不匹配时的三级查找：
      // 1. 直接匹配 PMX 路径（PMX记录与磁盘路径一致时命中）
      // 2. basename 兜底（PMX 子目录差异时命中）
      // 3. blobUrl→rel 反向映射（PMX 存"face.png"但磁盘在"textures/face.png"时通过 blobUrl 溯源）
      const basename = pending.relPath.split("/").pop() ?? "";
      const resolvedRel = blobUrlToRel.get(pending.blobUrl) ?? "";
      const decodedTex = decoded.get(pending.relPath)
        ?? decoded.get(basename)
        ?? decoded.get(resolvedRel);
      if (!decodedTex && pending.blobUrl && decoded.size > 0) {
        // 临时诊断：三级查找全部失败时 dump 实际 key 供排查
        const sampleDecoded = [...decoded.keys()].slice(0, 5);
        console.warn("[tex-match-debug]", {
          pendingRelPath: pending.relPath,
          basename,
          resolvedRel,
          decodedSampleKeys: sampleDecoded,
          blobUrlPrefix: pending.blobUrl.slice(0, 40),
        });
      }
      if (decodedTex) {
        const newTex = new THREE.Texture(decodedTex.bitmap);
        newTex.colorSpace = THREE.SRGBColorSpace;
        // P2 修复（审计 Unit 3）：ImageBitmap 已按正确方向解码，flipY=true 会上下翻转
        newTex.flipY = false;
        // P1/P2 修复（审计 Unit 3）：three Texture.dispose() 不关闭 ImageBitmap → GPU 位图泄漏。
        // 同一 relPath 可能被多纹理共享（map/emissiveMap 等），引用计数归零才 close——
        // 否则一个纹理释放会误伤仍在用的共享位图。
        decodedTex.refCount++;
        newTex.addEventListener("dispose", () => {
          decodedTex.refCount--;
          if (decodedTex.refCount <= 0) decodedTex.bitmap.close();
        });
        newTex.needsUpdate = true;
        (mat as unknown as Record<string, unknown>)["map"] = newTex;
        mat.needsUpdate = true;
        replaced++;
      }
      continue;
    }

    // Fallback 路径：替换已有的 blob URL 纹理
    for (const key of texKeys) {
      const texVal = (mat as unknown as Record<string, unknown>)[key];
      if (!(texVal instanceof THREE.Texture)) continue;
      const tex: THREE.Texture = texVal;
      total++;

      const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
      if (!img) continue;

      let relPath: string | undefined;
      if (img instanceof HTMLImageElement && img.src?.startsWith("blob:")) {
        relPath = blobUrlToRel.get(img.src);
      }
      if (!relPath) continue;

      const decodedTex = decoded.get(relPath);
      if (!decodedTex) continue;

      const newTex = new THREE.Texture(decodedTex.bitmap);
      newTex.wrapS = tex.wrapS;
      newTex.wrapT = tex.wrapT;
      newTex.repeat = tex.repeat;
      newTex.offset = tex.offset;
      newTex.center = tex.center;
      newTex.rotation = tex.rotation;
      // P2 修复（审计 Unit 3）：不再复制旧 flipY（ImageElement 默认 true）——
      // ImageBitmap 已按正确方向解码，flipY=true 会上下翻转
      newTex.flipY = false;
      newTex.generateMipmaps = tex.generateMipmaps;
      newTex.minFilter = tex.minFilter;
      newTex.magFilter = tex.magFilter;
      newTex.anisotropy = tex.anisotropy;
      newTex.format = tex.format;
      newTex.type = tex.type;
      newTex.colorSpace = tex.colorSpace;
      // P1/P2 修复（审计 Unit 3）：纹理释放时 close ImageBitmap，防 GPU 位图泄漏；
      // 引用计数归零才 close（共享位图防误伤）
      decodedTex.refCount++;
      newTex.addEventListener("dispose", () => {
        decodedTex.refCount--;
        if (decodedTex.refCount <= 0) decodedTex.bitmap.close();
      });

      (mat as unknown as Record<string, unknown>)[key] = newTex;
      tex.dispose();
      replaced++;
    }
  }

  if (total > 0) {
    mesh.material = allMats.length > 1 ? allMats : allMats[0];
  }

  // 临时诊断：汇总 pendingTexture 匹配情况
  if (pendingCount > 0 && replaced === 0) {
    console.warn("[tex-match-debug] summary:", {
      pendingCount,
      replaced,
      totalFallback: total,
      decodedKeys: [...decoded.keys()],
      allMatsCount: allMats.length,
    });
  }

  return { replaced, total };
}