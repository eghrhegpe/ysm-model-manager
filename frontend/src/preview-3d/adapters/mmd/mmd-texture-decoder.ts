// ===== MMD 纹理解码器（Worker 池管理器）=====
// 与 mmd-ktx2-encoder.ts 的 Worker 池哲学一致：
// 1. 固定 Worker 池（默认 4 个，与 TEXTURE_READ_CHUNK_SIZE 对齐）
// 2. 每个 Worker 接收一个 TexDecodeRequest → 返回 TexDecodeResponse
// 3. 主线程 dispatch 所有解码任务 → 汇总结果 → 返回 Map<relPath, ImageBitmap>
// 4. 失败的纹理静默跳过，由主线程 fallback 处理

import * as THREE from "three";
import type { TexDecodeRequest, TexDecodeResponse } from "./mmd-texture-decode.worker.ts";
import { DISPOSE_TEX_KEYS, materialList, matTexSlots } from "./mmd-utils";

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
  decodeAll(
    tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>,
  ): Promise<Map<string, DecodedTexture>>;
  /** 释放 Worker 池 */
  dispose(): void;
}

/** 在途解码任务：结算回调 + 超时计时器 + 归属 worker */
interface PendingDecode {
  resolve: (r: TexDecodeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 任务归属的 worker（崩溃时据此精确清算，P2-4） */
  worker: Worker;
}

/** 单批解码的结算态：原嵌在 Promise 执行器闭包内，提为显式状态供顶层结算函数共享 */
interface DecodeBatch {
  results: Map<string, DecodedTexture>;
  completed: number;
  total: number;
  resolve: (r: Map<string, DecodedTexture>) => void;
}

/** 新建解码 Worker（池初建与崩溃重建共用同一构造口径） */
function spawnTextureDecodeWorker(): Worker {
  return new Worker(new URL("./mmd-texture-decode.worker.ts", import.meta.url), { type: "module" });
}

/** 任务结算一次（无论成功/失败/超时）：命中 total 则整批 resolve */
function completeDecodeTask(batch: DecodeBatch): void {
  batch.completed++;
  if (batch.completed >= batch.total) batch.resolve(batch.results);
}

/** 解码响应落账：ok 且带位图 → 收进结果；带位图但 ok=false（超时/异常回包）→ 位图已
 *  transfer 到主线程、无人 close，立即释放防 GPU 位图泄漏（P2-4 附带的超时迟到路径清理） */
function settleDecodeResponse(batch: DecodeBatch, resp: TexDecodeResponse): void {
  if (resp.ok && resp.bitmap) {
    batch.results.set(resp.relPath, {
      relPath: resp.relPath,
      bitmap: resp.bitmap,
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      width: resp.width!,
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      height: resp.height!,
      refCount: 0,
    });
  } else if (resp.bitmap) {
    resp.bitmap.close();
  }
  completeDecodeTask(batch);
}

/**
 * 处理 worker 回传：在途任务 → resolve；超时后迟到 response → close 位图。
 * 迟到路径：setTimeout 回调触发后主线程已结算该任务（completed++），但 worker 仍可能回传
 * 迟到 response——其携带的 ImageBitmap 已 transfer 到主线程，若无人 close 则 GPU 显存永久
 * 泄漏（GC 不感知 GPU 压力）。命中 timedOutIds 时须 bitmap.close() 并移除。
 */
function handleDecodeWorkerMessage(
  e: MessageEvent<TexDecodeResponse>,
  pending: Map<number, PendingDecode>,
  timedOutIds: Map<number, Worker>,
): void {
  const { id } = e.data;
  const entry = pending.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(e.data);
    return;
  }
  if (!timedOutIds.has(id)) return;
  timedOutIds.delete(id);
  if (e.data.bitmap) e.data.bitmap.close();
}

/** 崩溃 worker 名下在途任务全部立即清算（resolve ok:false → 批次 completed++ → 主线程
 *  fallback 接管）；原实现让它们空等到 8s 超时，每次加载被拖 8s */
function failWorkerPendingTasks(w: Worker, pending: Map<number, PendingDecode>): void {
  for (const [id, entry] of [...pending]) {
    if (entry.worker !== w) continue;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve({ id, ok: false, error: "Worker 崩溃", relPath: "", width: 0, height: 0 });
  }
}

/** 崩溃 worker 名下已超时的任务（terminate 后消息队列丢弃，迟到 response 永不抵达）——
 *  立即清除，防共享单例 Set 无限膨胀 */
function forgetWorkerTimedOutTasks(w: Worker, timedOutIds: Map<number, Worker>): void {
  for (const [id, owner] of [...timedOutIds]) {
    if (owner === w) timedOutIds.delete(id);
  }
}

/** 终止崩溃实例（terminate 自身抛错 = 进程已死，忽略） */
function terminateWorkerQuietly(w: Worker): void {
  try {
    w.terminate();
  } catch {
    /* 已崩溃 */
  }
}

/** 在池中原地替换崩溃 worker（重建失败：资源耗尽/受限环境，池少一个仍可 round-robin 容错） */
function replaceWorkerInPool(workers: Worker[], w: Worker): void {
  const idx = workers.indexOf(w);
  if (idx === -1) return;
  try {
    const replacement = spawnTextureDecodeWorker();
    replacement.onmessage = w.onmessage;
    replacement.onerror = w.onerror;
    workers[idx] = replacement;
  } catch {
    /* 重建失败：池少一个 worker，仍可继续 */
  }
}

/** P2-4（审核）：Worker 崩溃不再静默等 8s 超时——立即清算该 worker 名下全部在途任务、
 *  清除其超时登记、terminate 崩溃实例并重建替补（原 `w.onerror = () => {}` 让崩溃 worker
 *  的任务全部空等到超时，且共享单例池从不重建崩溃 worker——越用越少、坏的不换）。 */
function handleDecodeWorkerError(
  w: Worker,
  workers: Worker[],
  pending: Map<number, PendingDecode>,
  timedOutIds: Map<number, Worker>,
): void {
  failWorkerPendingTasks(w, pending);
  forgetWorkerTimedOutTasks(w, timedOutIds);
  terminateWorkerQuietly(w);
  replaceWorkerInPool(workers, w);
}

/** 挂载消息/崩溃处理器（替换池内实例时经 w.onmessage / w.onerror 继承同一实现） */
function installDecodeWorkerHandlers(
  w: Worker,
  workers: Worker[],
  pending: Map<number, PendingDecode>,
  timedOutIds: Map<number, Worker>,
): void {
  w.onmessage = (e: MessageEvent<TexDecodeResponse>) =>
    handleDecodeWorkerMessage(e, pending, timedOutIds);
  w.onerror = () => handleDecodeWorkerError(w, workers, pending, timedOutIds);
}

/** 创建纹理解码器（Worker 池） */
export function createTextureDecoder(config: TexDecodeConfig = {}): TextureDecoder {
  const maxWorkers = config.maxWorkers ?? TEX_DECODE_WORKER_COUNT;
  const timeoutMs = config.timeoutMs ?? 8000;

  // 创建 Worker 池
  const workers: Worker[] = [];
  for (let i = 0; i < maxWorkers; i++) {
    workers.push(spawnTextureDecodeWorker());
  }

  // 任务分配器：round-robin 到 Worker
  let workerIdx = 0;
  let nextId = 0;

  const pending = new Map<number, PendingDecode>();

  /**
   * 已超时待清理集合：setTimeout 回调触发后，主线程已结算该任务（completed++），
   * 但 worker 仍可能回传迟到 response——其携带的 ImageBitmap 已 transfer 到主线程，
   * 若无人 close 则 GPU 显存永久泄漏（GC 不感知 GPU 压力）。
   * code_review ece0d4a4 #4/#5：Map<id, worker> 记录任务归属——worker 崩溃（onerror）
   * 后其消息队列被丢弃、迟到 response 永不抵达，名下超时 id 若不清除会随共享单例
   * 无限累积（每批解码都向已坏 worker 继续派发，Set 单调膨胀）
   */
  const timedOutIds = new Map<number, Worker>();

  // Worker 消息处理
  for (const w of workers) {
    installDecodeWorkerHandlers(w, workers, pending, timedOutIds);
  }

  function decodeAll(
    tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>,
  ): Promise<Map<string, DecodedTexture>> {
    if (tasks.length === 0) return Promise.resolve(new Map());

    return new Promise((resolve) => {
      const batch: DecodeBatch = {
        results: new Map<string, DecodedTexture>(),
        completed: 0,
        total: tasks.length,
        resolve,
      };

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
          // 超时：静默跳过（主线程 fallback 会覆盖）；登记待清理 id + 归属 worker，
          // 防 worker 迟到 response 携带的 ImageBitmap 无人 close 泄漏 GPU 显存；
          pending.delete(id);
          timedOutIds.set(id, w);
          completeDecodeTask(batch);
        }, timeoutMs);

        pending.set(id, {
          resolve: (resp: TexDecodeResponse) => settleDecodeResponse(batch, resp),
          timer,
          worker: w,
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
    timedOutIds.clear();
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

/** 释放共享解码器（适配器 dispose/清理路径调用，防 Worker 池越积越多） */
export function disposeTextureDecoder(): void {
  if (sharedDecoder) {
    sharedDecoder.dispose();
    sharedDecoder = null;
  }
}

/**
 * 关闭解码结果中未被任何纹理引用的 ImageBitmap（P2-5 审核）。
 * decodeAll 产物 refCount=0 起步；只有 applyWorkerDecodedTextures 命中并创建纹理
 * 后才 refCount>0（纹理 dispose 时归零 close）。构建中途抛错 / PMX 路径与磁盘不匹配 /
 * 替换数为 0 时，未命中的位图 refCount 恒 0、永不被 close → 每次失败加载泄漏 N 张
 * GPU 位图。本函数在 apply 收尾/失败路径调用，只关 refCount<=0 的（已应用的由
 * 纹理 dispose 监听负责，双保险幂等——ImageBitmap.close 重复调用无害）。
 */
export function closeUnusedDecodedBitmaps(decoded: Map<string, DecodedTexture>): void {
  for (const [, d] of decoded) {
    // refCount<0 = 已由本函数关过（-1 标记）；=0 未应用 → 关；>0 已应用 → 纹理 dispose 负责
    if (d.refCount === 0) {
      try {
        d.bitmap.close();
        d.refCount = -1; // 标记已关，防重复 close 路径再计数
      } catch {
        /* 已关闭/不可关：幂等 */
      }
    }
  }
}

/** Worker 路径挂的延迟纹理标记（buildPmxScene 建材质时写入 userData；解码完成后消费） */
interface PendingTexture {
  relPath: string;
  blobUrl: string;
}

/** 读取材质的 pendingTexture 标记（未挂标记 → undefined） */
function readPendingTexture(mat: THREE.Material): PendingTexture | undefined {
  return (mat.userData as Record<string, unknown>)?.pendingTexture as PendingTexture | undefined;
}

/** 位图引用计数契约：每个包装该 bitmap 的纹理占 1，dispose 时递减、归零才 close——
 *  同一 relPath 可能被多材质/多纹理槽共享（如 map 与 emissiveMap 用同一贴图），
 *  否则一个纹理释放会误伤仍在用的共享位图（review P2）。 */
function trackDecodedBitmapRef(newTex: THREE.Texture, decodedTex: DecodedTexture): void {
  decodedTex.refCount++;
  newTex.addEventListener("dispose", () => {
    decodedTex.refCount--;
    if (decodedTex.refCount <= 0) decodedTex.bitmap.close();
  });
}

/** Worker 路径命中：直接用已解码 ImageBitmap 建纹理。
 *  ImageBitmap 已按正确方向解码，flipY=true 会上下翻转 → flipY=false。 */
function attachDecodedBitmapTexture(mat: THREE.Material, decodedTex: DecodedTexture): void {
  const newTex = new THREE.Texture(decodedTex.bitmap);
  newTex.colorSpace = THREE.SRGBColorSpace;
  newTex.flipY = false;
  trackDecodedBitmapRef(newTex, decodedTex);
  newTex.needsUpdate = true;
  matTexSlots(mat).map = newTex;
  mat.needsUpdate = true;
}

/** Worker 路径 decode miss 兜底（防永久白模）：pendingTexture 自带 blobUrl，走主线程
 *  TextureLoader 异步补挂 map。flipY 保持默认 true（HTMLImageElement 方向，与 decode 路径
 *  flipY=false 的 ImageBitmap 预解码方向各归其位）；sRGB 色彩空间对齐 decode 路径。
 *  兜底纹理是标准 THREE.Texture，随材质进 disposeMmdMesh 既有释放链路，不引入新泄漏。 */
function attachFallbackBlobTexture(mat: THREE.Material, blobUrl: string): void {
  const loader = new THREE.TextureLoader();
  const fallbackTex = loader.load(blobUrl);
  fallbackTex.colorSpace = THREE.SRGBColorSpace;
  matTexSlots(mat).map = fallbackTex;
  mat.needsUpdate = true;
}

/** Worker 路径材质：PMX路径与磁盘rel路径不匹配时的三级查找——
 *  1. 直接匹配 PMX 路径（PMX记录与磁盘路径一致时命中）
 *  2. basename 兜底（PMX 子目录差异时命中）
 *  3. blobUrl→rel 反向映射（PMX 存"face.png"但磁盘在"textures/face.png"时通过 blobUrl 溯源）
 *  命中 → 直挂解码纹理（replaced）；未命中 → 主线程 TextureLoader 兜底（fallback）。 */
function applyPendingTexture(
  mat: THREE.Material,
  pending: PendingTexture,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): "replaced" | "fallback" {
  const basename = pending.relPath.split("/").pop() ?? "";
  const resolvedRel = blobUrlToRel.get(pending.blobUrl) ?? "";
  const decodedTex =
    decoded.get(pending.relPath) ?? decoded.get(basename) ?? decoded.get(resolvedRel);
  if (decodedTex) {
    attachDecodedBitmapTexture(mat, decodedTex);
    return "replaced";
  }
  attachFallbackBlobTexture(mat, pending.blobUrl);
  return "fallback";
}

/** blob URL 纹理 → 磁盘相对路径（非 HTMLImageElement / 非 blob: / 未登记 → undefined） */
function blobTextureRelPath(
  tex: THREE.Texture,
  blobUrlToRel: Map<string, string>,
): string | undefined {
  const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
  if (!img) return undefined;
  if (img instanceof HTMLImageElement && img.src?.startsWith("blob:")) {
    return blobUrlToRel.get(img.src);
  }
  return undefined;
}

/** Fallback 路径单槽替换：blob: 纹理命中原位替换为 ImageBitmap 纹理，沿用原 wrap/repeat/
 *  filter 等采样参数（跨格式一致性）。未命中（非 blob / 未登记 / 无解码位图）→ false 保留原纹理。
 *  不再复制旧 flipY（ImageElement 默认 true）——ImageBitmap 已按正确方向解码。 */
function replaceBlobTextureSlot(
  mat: THREE.Material,
  key: string,
  tex: THREE.Texture,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): boolean {
  const relPath = blobTextureRelPath(tex, blobUrlToRel);
  if (!relPath) return false;
  const decodedTex = decoded.get(relPath);
  if (!decodedTex) return false;

  const newTex = new THREE.Texture(decodedTex.bitmap);
  newTex.wrapS = tex.wrapS;
  newTex.wrapT = tex.wrapT;
  newTex.repeat = tex.repeat;
  newTex.offset = tex.offset;
  newTex.center = tex.center;
  newTex.rotation = tex.rotation;
  newTex.flipY = false;
  newTex.generateMipmaps = tex.generateMipmaps;
  newTex.minFilter = tex.minFilter;
  newTex.magFilter = tex.magFilter;
  newTex.anisotropy = tex.anisotropy;
  newTex.format = tex.format;
  newTex.type = tex.type;
  newTex.colorSpace = tex.colorSpace;
  trackDecodedBitmapRef(newTex, decodedTex);

  matTexSlots(mat)[key] = newTex;
  tex.dispose();
  return true;
}

/** Fallback 路径批量扫描：遍历材质纹理槽全集，替换其中可溯源的 blob: 纹理。
 *  total 只计「槽位确实是 Texture」的（与原 total++ 落点一致）。 */
function replaceBlobTextureSlots(
  mat: THREE.Material,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): { replaced: number; total: number } {
  let replaced = 0;
  let total = 0;
  for (const key of DISPOSE_TEX_KEYS) {
    const tex = matTexSlots(mat)[key];
    if (!(tex instanceof THREE.Texture)) continue;
    total++;
    if (replaceBlobTextureSlot(mat, key, tex, decoded, blobUrlToRel)) replaced++;
  }
  return { replaced, total };
}

/**
 * 将 Worker 解码的 ImageBitmap 应用到 MMD 模型的材质纹理：
 * 1. 优先处理 Worker 路径材质（userData.pendingTexture），直接创建纹理赋值
 * 2. 再处理 Fallback 路径材质，将命中的 blob:HTMLImageElement 替换为 ImageBitmap
 * 3. Worker 路径 decode miss 时用 pendingTexture.blobUrl 走主线程 TextureLoader 兜底（防永久白模）
 */
export function applyWorkerDecodedTextures(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): { replaced: number; total: number; fallback: number } {
  const allMats = materialList(mesh.material);

  let replaced = 0;
  let total = 0;
  let fallback = 0;

  for (const mat of allMats) {
    // Worker 路径：pendingTexture 标记，直接同步赋值
    const pending = readPendingTexture(mat);
    if (pending) {
      if (applyPendingTexture(mat, pending, decoded, blobUrlToRel) === "replaced") replaced++;
      else fallback++;
      continue;
    }

    // Fallback 路径：替换已有的 blob URL 纹理
    const slotStats = replaceBlobTextureSlots(mat, decoded, blobUrlToRel);
    total += slotStats.total;
    replaced += slotStats.replaced;
  }

  if (total > 0) {
    mesh.material = allMats.length > 1 ? allMats : allMats[0];
  }

  return { replaced, total, fallback };
}
