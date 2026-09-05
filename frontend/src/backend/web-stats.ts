// ===== Web Worker 池批量模型统计编排（SearchModels 数值条件的统计来源）=====
// 主线程只做消息编排：N 个 Worker（池大小 = hardwareConcurrency，上限 8）内独立加载
// WASM + open IndexedDB（同源）逐个模型解码统计——多模型**并行**处理（路 B Worker 池：
// 无 SharedArrayBuffer/COOP-COEP 依赖，GitHub Pages 可用），主线程零解析负载。
// 降级契约：Worker 不支持（new Worker 抛错）/ 启动失败 / 运行时错误 / 超时
// → 返回 null 并置降级标记（consumeWebSearchDegraded 消费，供 toolbar-search 提示）；
// web-fs.searchWebModels 收到 null 走「数值 0 + hasError:false」降级路径。
// 测试注入：__setStatsRunnerForTest 替换 Worker 路径（browser-adapter.test.ts 用）。
import {
  STATS_BATCH_LIMIT,
  type StatsWorkerRequest,
  type StatsWorkerResponse,
  type WebModelStats,
  type WebModelStatsWithPath,
} from "../workers/stats-protocol.ts";

// 对外类型（web-fs 复用：SearchModels 数值字段形状对齐 go types.SearchResult）
export type { WebModelStats } from "../workers/stats-protocol.ts";

/** 单批超时（毫秒）：WASM 解码 + 200 模型，60s 已含余量；超时终止整个池防僵尸 */
const STATS_CHUNK_TIMEOUT_MS = 60_000;

/** 池大小上限：防资源爆（8 个 worker × 每 worker 独立 WASM 实例内存可观） */
const POOL_MAX = 8;

let workers: Worker[] = [];
let requestSeq = 0;

/** 单 chunk 结果：ok=true 携带结果；ok=false 携带是否可重试（瞬态 error 可换 worker 重试，超时/死循环不可） */
type StatsChunkResult =
  | { ok: true; results: Array<WebModelStatsWithPath> }
  | { ok: false; retryable: boolean };

/** 在途请求表（requestId → settle）：terminate 杀池时全部降级 settle，防 Promise.all 永久挂起 */
const inflight = new Map<number, (v: StatsChunkResult) => void>();

/** 降级标记：最近一次批量统计是否降级（一次消费，toolbar-search 读取后复位） */
let degradedFlag = false;

/** 进度回调（batchStatsWebModels 逐批推进时调用；null 注销）。UI 角标证明多线程统计 */
let statsProgressCb: ((done: number, total: number) => void) | null = null;

/** 注册批量统计进度回调（done/total 为该批已处理模型数；传 null 注销） */
export function onStatsProgress(cb: ((done: number, total: number) => void) | null): void {
  statsProgressCb = cb;
}

/** 批量统计函数签名（测试注入用；返回 null = 降级） */
type StatsRunner = (paths: string[]) => Promise<WebModelStats[] | null>;

let injectedRunner: StatsRunner | null = null;

/**
 * 测试注入统计实现（替换 Worker 路径）。传 null 恢复 Worker 真实路径。
 * 返回 null 等价 Worker 不可用 → batchStatsWebModels 整体降级。
 */
export function __setStatsRunnerForTest(runner: StatsRunner | null): void {
  injectedRunner = runner;
}

/** 消费「最近一次批量统计是否降级」标记（读完复位，避免跨搜索串扰） */
export function consumeWebSearchDegraded(): boolean {
  const d = degradedFlag;
  degradedFlag = false;
  return d;
}

/** 终止并回收整个 Worker 池（取消在途任务：调用方在超时/失败后使用；外部也可主动取消） */
export function terminateStatsWorker(): void {
  for (const w of workers) {
    try {
      w.terminate();
    } catch {
      /* 已终止 */
    }
  }
  workers = [];
  // 在途请求全部降级 settle（防 Promise.all 永久挂起；超时/主动取消不可重试）
  for (const [, settle] of inflight) settle({ ok: false, retryable: false });
  inflight.clear();
}

/**
 * 终止单个 Worker（瞬态 error / WASM trap 逃逸时用）并从池中移除。
 * 与 terminateStatsWorker 的区别：不杀整池——每 Worker 独立 WASM 实例（stats.worker.ts
 * 注释），单 worker 故障不应传染其他 worker；其余 worker 在途请求不受影响。
 */
function terminateWorker(w: Worker): void {
  try {
    w.terminate();
  } catch {
    /* 已终止 */
  }
  const i = workers.indexOf(w);
  if (i >= 0) workers.splice(i, 1);
}

function markDegraded(): void {
  degradedFlag = true;
}

/** 池大小：hardwareConcurrency（缺省 4）夹取 1..8 */
function poolSize(): number {
  const hc = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4;
  const n = Number.isFinite(hc) && hc > 0 ? Math.floor(hc) : 4;
  return Math.min(Math.max(n, 1), POOL_MAX);
}

/** 当前池大小（Worker 池并行线程数，供 UI 角标显示 🧵×N） */
export function getStatsPoolSize(): number {
  return poolSize();
}

/** 创建单个 stats worker（池懒建 / 瞬态 error 重试 replacement 共用）。 */
function createStatsWorker(): Worker {
  return new Worker(new URL("../workers/stats.worker.ts", import.meta.url), { type: "module" });
}

/**
 * 新建专属 worker 并补入池（瞬态 error 重试用）。
 * 绝不复用池内既有 worker：多 worker 池里其他 worker 正被并发 runWorkerQueue 持有在途
 * 请求（单 onmessage 槽位契约），复用会把对方在途回复覆盖丢弃 → 挂 60s 超时杀整池。
 * 失败返回 null（调用方按不可重试降级处理）。
 */
function spawnReplacementWorker(): Worker | null {
  try {
    const w = createStatsWorker();
    workers.push(w);
    return w;
  } catch {
    return null;
  }
}

/** 懒创建 Worker 池；不支持（非浏览器/被屏蔽）返回 null */
function getWorkerPool(): Worker[] | null {
  if (workers.length) return workers;
  try {
    const n = poolSize();
    for (let i = 0; i < n; i++) workers.push(createStatsWorker());
    return workers;
  } catch {
    workers = [];
    return null;
  }
}

/** 预加载 stats.worker chunk（页面加载后后台静默下载，让首次搜索秒开）。
 *  创建一个 Worker 后立即释放——触发浏览器下载并缓存 chunk，用户无感知。
 *  后续 getWorkerPool() 正常创建新 Worker（chunk 已在缓存中，几乎瞬间）。 */
export function prefetchStatsWorker(): void {
  if (typeof Worker === "undefined") return;
  try {
    const w = new Worker(new URL("../workers/stats.worker.ts", import.meta.url), {
      type: "module",
    });
    w.terminate();
  } catch {
    // 不支持/被屏蔽 → 静默降级，首次搜索时正常下载
  }
}

/**
 * 单 chunk 统计（一个 worker 一个在途任务；requestId 隔离旧消息/并发批）。
 * 超时杀整个池（任一 worker 挂起可能同批传染）→ 整批降级；
 * 瞬态 error（WASM 初始化失败/trap 逃逸）只终止出错 worker → 调用方换 worker 重试。
 */
function statsOneChunk(w: Worker, requestId: number, paths: string[]): Promise<StatsChunkResult> {
  return new Promise((resolve) => {
    inflight.set(requestId, resolve);
    const timer = setTimeout(() => {
      // 超时：杀整个池防僵尸（WASM 死循环/挂起）；terminate 会 settle 全部在途 → 整批降级
      terminateStatsWorker();
      markDegraded();
      inflight.delete(requestId);
      resolve({ ok: false, retryable: false });
    }, STATS_CHUNK_TIMEOUT_MS);

    const settle = (v: StatsChunkResult): void => {
      clearTimeout(timer);
      inflight.delete(requestId);
      resolve(v);
    };

    w.onmessage = (ev: MessageEvent<StatsWorkerResponse>): void => {
      const data = ev.data as StatsWorkerResponse;
      if (!data || data.requestId !== requestId) return; // 旧批/进度消息忽略
      if (data.type === "result") {
        settle({ ok: true, results: data.results });
      } else if (data.type === "error") {
        // Worker 内 WASM 初始化失败等 → 终止出错 worker（瞬态可重试），不杀整池；
        // 不置降级标记——重试成功后该批仍完整（降级由 batchStatsWebModels 最终 failed 决定）
        terminateWorker(w);
        settle({ ok: false, retryable: true });
      }
      // progress：当前无 UI 消费，忽略
    };

    w.onerror = (): void => {
      // 运行时错误（WASM trap 逃逸等）→ 终止出错 worker（瞬态可重试），防在途请求永久挂起
      terminateWorker(w);
      settle({ ok: false, retryable: true });
    };

    w.postMessage({ type: "stats", paths, requestId } satisfies StatsWorkerRequest);
  });
}

/**
 * 批量统计模型（骨骼/立方体/纹理尺寸）。返回数组与输入 paths 一一对应；
 * Worker 池不可用 / 任一片失败 / 超时 → 返回 null（整体降级）。
 */
export async function batchStatsWebModels(paths: string[]): Promise<WebModelStats[] | null> {
  if (injectedRunner) {
    try {
      const res = await injectedRunner(paths);
      if (res === null) markDegraded();
      return res;
    } catch {
      // 注入 runner 抛错（对齐 Worker error 语义）→ 整批降级，不向上抛
      markDegraded();
      return null;
    }
  }
  if (!paths.length) return [];
  const ws = getWorkerPool();
  if (!ws || ws.length === 0) {
    markDegraded();
    return null;
  }
  // 分片：paths → ≤200 的 chunks（记录原起始索引）；任务队列轮询分给池内 worker（每 worker 同时 1 片）
  const chunks: Array<{ slice: string[]; offset: number }> = [];
  for (let i = 0; i < paths.length; i += STATS_BATCH_LIMIT) {
    chunks.push({ slice: paths.slice(i, i + STATS_BATCH_LIMIT), offset: i });
  }
  const results: Array<Array<WebModelStatsWithPath> | null> = new Array(chunks.length).fill(null);
  let nextChunk = 0;
  let progressDone = 0;
  let failed = false;

  const runWorkerQueue = async (w: Worker): Promise<void> => {
    let currentW = w;
    let retried = false;
    while (!failed) {
      const ci = nextChunk++;
      if (ci >= chunks.length) return;
      let res = await statsOneChunk(currentW, ++requestSeq, chunks[ci].slice);
      // 瞬态 error（可重试）→ 换 worker 重试 1 次。出错 worker 已被 statsOneChunk 内
      // terminateWorker 移除出池；重试必须新建专属 worker（spawnReplacementWorker），
      // 不可复用池内既有 worker——多 worker 池里其余 worker 正被并发 runWorkerQueue
      // 持有在途请求（单 onmessage 槽位契约），复用会覆盖对方槽位致其回复被
      // requestId 过滤丢弃 → 挂 60s 超时杀整池（重试特性反而降级）。
      if (!res.ok && res.retryable && !retried) {
        retried = true;
        const retryW = spawnReplacementWorker();
        if (retryW) {
          currentW = retryW;
          res = await statsOneChunk(currentW, ++requestSeq, chunks[ci].slice);
        }
      }
      if (!res.ok) {
        failed = true; // 重试仍失败（或不可重试/无 replacement 可用）→ 该片降级 → 整体降级
        results[ci] = null;
        return;
      }
      results[ci] = res.results;
      retried = false; // 重试预算按「每次瞬态 error 一次」计：本片成功后复位，后续片独立享 1 次
      progressDone += chunks[ci].slice.length;
      statsProgressCb?.(Math.min(progressDone, paths.length), paths.length);
    }
  };

  await Promise.all(ws.map(runWorkerQueue));

  if (failed || results.some((r) => r === null)) {
    markDegraded();
    return null;
  }
  // 合并（chunks 顺序 = paths 顺序）：按原起始索引对齐
  const out: Array<WebModelStats | null> = new Array(paths.length);
  for (let ci = 0; ci < chunks.length; ci++) {
    const { slice, offset } = chunks[ci];
    const res = results[ci] as Array<WebModelStatsWithPath>;
    for (let i = 0; i < slice.length; i++) {
      const s = res[i];
      out[offset + i] = s
        ? {
            boneCount: s.boneCount,
            cubeCount: s.cubeCount,
            texWidth: s.texWidth,
            texHeight: s.texHeight,
            hasError: s.hasError,
          }
        : null;
    }
  }
  if (out.some((s) => s === null)) {
    // 防御：结果对齐失败（worker 缺条目）→ 整体降级，不返回半截统计
    markDegraded();
    return null;
  }
  statsProgressCb?.(paths.length, paths.length); // 全部完成
  return out as WebModelStats[];
}
