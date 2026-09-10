// ===== Web Worker 池批量模型统计编排（SearchModels 数值条件的统计来源）=====
// 主线程只做消息编排：N 个 Worker（池大小 = hardwareConcurrency，上限 8）内独立加载
// WASM + open IndexedDB（同源）逐个模型解码统计——多模型**并行**处理（路 B Worker 池：
// 无 SharedArrayBuffer/COOP-COEP 依赖，GitHub Pages 可用），主线程零解析负载。
// 池并发契约（ADR-218 D1）：**批级单飞**——同一时刻池上至多一个 batch 在跑；
// 后续 batchStatsWebModels 经 batchChain 串行链排队（statsOneChunk 的 onmessage
// 单槽位由串行化机器保护，不再依赖调用方纪律）；terminateStatsWorker 升池代际，
// 排队（未启动）批弃置（降级 null），防"取消后又偷偷重跑"。
// 细粒度降级契约（ADR-219）：Worker 逐模型 partial 流回包 + result 结束标记；单 worker
// 静默 30s（挂死侦测信号 = partial 流中断）→ 只终止该 worker，专属 replacement 上
// 重试**剩余未回包**模型；静默杀预算（2）或 60s chunk 墙钟耗尽 → 剩余模型标
// hasError（EMPTY_ERROR），chunk 正常收尾，**整批不降级**。
// 批级降级契约（仅系统级故障）：Worker 不支持（new Worker 抛错）/ WASM 瞬态错误
// 重试耗尽 / 主动取消 → 返回 null 并置降级标记（consumeWebSearchDegraded 消费，
// 供 toolbar-search 提示）；web-fs.searchWebModels 收到 null 走「数值 0 + hasError:false」
// 降级路径。挂死类局部故障不经由此处（走上面的模型级 hasError 细粒度路径，D3 边界）。
// 测试注入：__setStatsRunnerForTest 替换 Worker 路径（browser-adapter.test.ts 用，不走串行链）。

import { EMPTY_ERROR } from "@/workers/stats-core.ts";
import {
  STATS_BATCH_LIMIT,
  type StatsWorkerRequest,
  type StatsWorkerResponse,
  type WebModelStats,
  type WebModelStatsWithPath,
} from "@/workers/stats-protocol.ts";

// 对外类型（web-fs 复用：SearchModels 数值字段形状对齐 go types.SearchResult）
export type { WebModelStats } from "@/workers/stats-protocol.ts";

/** chunk 墙钟预算（毫秒）：WASM 解码 + 200 模型，60s 已含余量；跨同 chunk 重试共享
 *  （ADR-219 D2：超预算 → 剩余模型 hasError 细粒度耗尽，不再杀整池） */
const STATS_CHUNK_TIMEOUT_MS = 60_000;

/** 单 worker 静默窗（毫秒，ADR-219 D2）：STATS_SILENCE_MS 内无 partial/result 回包 →
 *  判该 worker 挂死（同步 ccall 挂起不可抢占，唯一可靠侦测信号 = 逐模型流中断），
 *  只终止该 worker（不杀池），调用方在专属 replacement 上重试剩余未回包模型 */
const STATS_SILENCE_MS = 30_000;

/** 单 chunk 静默杀预算（ADR-219 D4）：至多 2 次静默杀；第 2 次即撞 60s 墙钟，
 *  预算是双保险。耗尽 → 剩余模型全部 hasError（EMPTY_ERROR），chunk 正常收尾 */
const CHUNK_SILENCE_KILLS = 2;

/** 池大小上限：防资源爆（8 个 worker × 每 worker 独立 WASM 实例内存可观） */
const POOL_MAX = 8;

let workers: Worker[] = [];
let requestSeq = 0;

/** 批串行链（ADR-218 D1）：池并发 = 批级单飞，第二批起排队等前批整体完成 */
let batchChain: Promise<unknown> = Promise.resolve();
/** 池代际：terminateStatsWorker 升代——排队（未启动）批出队时见代际已变 → 弃置（降级 null） */
let poolGen = 0;

/** 单 chunk 回包（statsOneChunk settle，ADR-219 D2）：
 *  complete = result 结束标记（逐模型结果已经 partial 流被调用方累积）；
 *  error = Worker error 回包 / onerror（瞬态：该 worker 已终止，调用方可新建专属 worker 重试剩余）；
 *  silence = 静默窗 30s 无回包（判挂死：该 worker 已终止，调用方重试剩余或细粒度耗尽）；
 *  deadline = chunk 60s 墙钟预算耗尽（该 worker 已终止，调用方强制耗尽剩余）；
 *  cancelled = terminateStatsWorker 主动取消（调用方 → 整批降级，保留既有语义）。 */
type ChunkOutcome = "complete" | "error" | "silence" | "deadline" | "cancelled";

/** 在途请求表（requestId → settle）：terminate 杀池时全部以 cancelled settle，防 Promise.all 永久挂起 */
const inflight = new Map<number, (kind: ChunkOutcome) => void>();

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

/** 终止并回收整个 Worker 池（调用方主动取消在途任务；ADR-219 后超时不再走此路——
 *  静默看门狗只杀挂死 worker，整池终止仅用于取消语义）
 *  ADR-218 D1：升池代际——排队（未启动）的批出队时见代际已变，直接弃置（降级 null），
 *  防"取消后又偷偷重跑"；在途批的 chunk 经在途表以 cancelled settle。 */
export function terminateStatsWorker(): void {
  poolGen++;
  for (const w of workers) {
    try {
      w.terminate();
    } catch {
      /* 已终止 */
    }
  }
  workers = [];
  // 在途请求全部以 cancelled settle（防 Promise.all 永久挂起；主动取消不可重试）
  for (const [, settle] of inflight) settle("cancelled");
  inflight.clear();
}

/**
 * 终止单个 Worker（瞬态 error / WASM trap 逃逸 / 静默看门狗判挂死，ADR-219 D2）并从池中移除。
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
 * 新建专属 worker 并补入池（瞬态 error / 静默看门狗重试用，ADR-219 D4：沿用 poolSize
 * 并发槽位上限，不另加总量闸）。
 * 绝不复用池内既有 worker：多 worker 池里其他 worker 正被并发 runWorkerQueue 持有在途
 * 请求（单 onmessage 槽位契约），复用会把对方在途回复覆盖丢弃 → 对方 chunk 坐等静默窗/
 * 墙钟到点（细粒度降级，重试特性反而伤自己人）。
 * P0 修复：池大小受 poolSize() 硬上限保护，超限不再 push，返回 null 让调用方决策
 * （瞬态 → 整批降级保留既有；挂死类 → 细粒度耗尽，ADR-219 D3）。
 * （ADR-218 D1：跨批互踩已由 batchChain 单飞机制机器强制，本规则守护的是批内
 * 「每 worker 单在途」资源预算 + 槽位契约。）
 */
function spawnReplacementWorker(): Worker | null {
  try {
    if (workers.length >= poolSize()) return null; // 池满拒扩，防瞬态错误下无限增长
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
    const w = createStatsWorker();
    w.terminate();
  } catch {
    // 不支持/被屏蔽 → 静默降级，首次搜索时正常下载
  }
}

/**
 * 单 chunk 统计（一个 worker 一个在途任务；requestId 隔离旧消息/并发批）。
 * 双计时器（ADR-219 D2）：
 *  - 静默窗（STATS_SILENCE_MS，每条 partial 重置）：挂死 worker 永不产出后续 partial
 *    → 只终止该 worker（不杀池），返回 silence 让调用方在专属 replacement 上重试剩余；
 *  - chunk 墙钟（hooks.deadline = chunk 首起 + STATS_CHUNK_TIMEOUT_MS，跨重试共享）
 *    → 返回 deadline，调用方强制耗尽（剩余模型 hasError，整批不降级）。
 * 瞬态 error（WASM 初始化失败/trap 逃逸）只终止出错 worker → 返回 error，调用方换 worker 重试剩余。
 */
function statsOneChunk(
  w: Worker,
  requestId: number,
  paths: string[],
  hooks: {
    /** 逐模型结果送达（worker partial 流，ADR-219 D1）：调用方按 path 累积 + 静默计时重置 */
    onPartial: (r: WebModelStatsWithPath) => void;
    /** chunk 墙钟预算（ms 时间戳 = chunk 首起 + STATS_CHUNK_TIMEOUT_MS，跨重试共享） */
    deadline: number;
  },
): Promise<ChunkOutcome> {
  return new Promise((resolve) => {
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = (kind: ChunkOutcome): void => {
      if (done) return;
      done = true;
      if (silenceTimer) clearTimeout(silenceTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      inflight.delete(requestId);
      resolve(kind);
    };
    inflight.set(requestId, finish);
    const armSilence = (): void => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // 静默窗：挂死 worker 永不产出后续 partial → 只终止该 worker（调用方重试剩余/耗尽，ADR-219 D2）
      silenceTimer = setTimeout((): void => {
        silenceTimer = null;
        terminateWorker(w);
        finish("silence");
      }, STATS_SILENCE_MS);
    };
    armSilence();
    const left = hooks.deadline - Date.now();
    if (left <= 0) {
      // 墙钟已耗尽（调用方派发前已检，此处为防御）→ 终止该 worker 判 deadline
      terminateWorker(w);
      finish("deadline");
    } else {
      deadlineTimer = setTimeout((): void => {
        deadlineTimer = null;
        terminateWorker(w);
        finish("deadline");
      }, left);
    }

    w.onmessage = (ev: MessageEvent<StatsWorkerResponse>): void => {
      const data = ev.data as StatsWorkerResponse;
      if (!data || data.requestId !== requestId) return; // 旧批消息忽略
      if (data.type === "partial") {
        hooks.onPartial(data.result);
        armSilence(); // 逐模型结果送达 → 重置静默窗（挂死侦测信号，ADR-219 D2）
      } else if (data.type === "result") {
        // 流结束标记 → chunk 收尾（逐模型结果已经 partial 累积，缺条目由调用方细粒度补位，D1）
        finish("complete");
      } else {
        // Worker 内 WASM 初始化失败等瞬态 → 终止出错 worker（可重试），不杀整池；
        // 不置降级标记——重试成功后该 chunk 仍完整（批级降级由 runPoolBatch 最终 failed 决定，D3）
        terminateWorker(w);
        finish("error");
      }
    };

    w.onerror = (): void => {
      // 运行时错误（WASM trap 逃逸等）→ 终止出错 worker（瞬态可重试），防在途请求永久挂起
      terminateWorker(w);
      finish("error");
    };

    w.postMessage({ type: "stats", paths, requestId } satisfies StatsWorkerRequest);
  });
}

/**
 * 批量统计模型（骨骼/立方体/纹理尺寸）。返回数组与输入 paths 一一对应；
 * 系统级故障（Worker 池不可用 / WASM 瞬态错误重试耗尽 / 主动取消）→ 返回 null（整体降级）；
 * 挂死类局部故障（单模型 ccall 挂起）→ 该模型标 hasError、其余真统计，整批正常返回
 * （ADR-219 D2/D3 细粒度降级，不再 60s 杀整池）。
 * 池并发契约（ADR-218 D1）：同一时刻池上至多一个 batch 在跑——第二起调用经
 * batchChain 串行链排队等前批完成；等待期间 terminateStatsWorker 升代则本批弃置。
 */
export function batchStatsWebModels(paths: string[]): Promise<WebModelStats[] | null> {
  if (injectedRunner) {
    // 测试 seam：不占串行链，立即执行
    return (async (): Promise<WebModelStats[] | null> => {
      try {
        const res = await injectedRunner(paths);
        if (res === null) markDegraded();
        return res;
      } catch {
        // 注入 runner 抛错（对齐 Worker error 语义）→ 整批降级，不向上抛
        markDegraded();
        return null;
      }
    })();
  }
  if (!paths.length) return Promise.resolve([]); // 空批纯快路径，不占串行链
  const gen = poolGen;
  const job = batchChain.then((): Promise<WebModelStats[] | null> => {
    if (gen !== poolGen) {
      // 排队期间 terminateStatsWorker 升代 → 弃置本批（防"取消后又偷偷重跑"）
      markDegraded();
      return Promise.resolve(null);
    }
    return runPoolBatch(paths);
  });
  batchChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

/** 池执行体：分片 → 池内轮询分发 → 合并（由 batchChain 保证单批在途） */
async function runPoolBatch(paths: string[]): Promise<WebModelStats[] | null> {
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

  /** 跑完一个 chunk（ADR-219 D2/D3/D4）：逐模型累积 + 静默看门狗 + 剩余模型重试。
   *  收尾三路：① 正常/细粒度耗尽 → results[ci] = 已回包 ∪ 剩余全标 EMPTY_ERROR（hasError，
   *  整批不降级）；② 瞬态 error 重试耗尽 / 主动取消 → failed + results[ci]=null（系统级
   *  边界，整批降级保留既有语义）；③ 返回本轮存活 worker（专属 replacement 已入池），
   *  供该队列后续 chunk 接续（原 worker 可能已被静默杀）。 */
  const runChunk = async (
    w: Worker,
    ci: number,
    slice: string[],
  ): Promise<{ broken: boolean; lastWorker: Worker }> => {
    let currentW = w;
    let errorRetries = 0; // 瞬态 error 重试预算（每次 1 次，ADR-218 既有契约；chunk 内独立）
    let silenceKills = 0; // 静默杀计数（每 chunk 至多 CHUNK_SILENCE_KILLS 次，ADR-219 D4）
    // 逐模型累积（同 chunk 跨重试共享：重试只发「剩余未回包」模型，已回包不重放，D1）
    const accounted = new Map<string, WebModelStatsWithPath>();
    let remaining = slice;
    // chunk 墙钟预算：自首起算、跨重试共享（超预算 → 强制耗尽，D4）
    const deadline = Date.now() + STATS_CHUNK_TIMEOUT_MS;
    let chunkBroken = false; // 瞬态耗尽/取消 → 整批降级（系统级故障边界，D3）

    while (remaining.length > 0 && !failed) {
      const outcome = await statsOneChunk(currentW, ++requestSeq, remaining, {
        onPartial: (r) => {
          // 防御去重（chunk 内 paths 唯一是契约；跨请求隔离由 requestId 保证）
          if (accounted.has(r.path)) return;
          accounted.set(r.path, r);
          progressDone++;
          statsProgressCb?.(Math.min(progressDone, paths.length), paths.length);
        },
        deadline,
      });
      if (outcome === "complete") break; // 流结束（逐模型结果已累积；缺条目走下方防御补位）
      if (outcome === "cancelled") {
        chunkBroken = true; // 主动取消 → 整批降级（保留既有语义）
        break;
      }
      // 重试派发：remaining = 尚未回包模型
      remaining = slice.filter((p) => !accounted.has(p));
      if (!remaining.length) break; // 防御：全部已回包（仅结束标记缺失）→ 收尾补位
      if (outcome === "error") {
        // 瞬态 error（WASM 初始化失败等）：预算耗尽 → 系统级 → 整批降级（保留既有语义）
        if (errorRetries >= 1) {
          chunkBroken = true;
          break;
        }
        errorRetries++;
      } else {
        // silence / deadline：挂死类局部故障（D3）→ 专属新 worker 重试剩余，或细粒度耗尽。
        // 出错 worker 已被 statsOneChunk 内 terminateWorker 移出池；重试必须新建专属
        // replacement，不可复用池内既有 worker——其余 worker 正被并发 runWorkerQueue
        // 持有在途请求（单 onmessage 槽位契约），复用会覆盖对方槽位致其回复被
        // requestId 过滤丢弃（重试特性反而整体降级）。
        if (outcome === "silence") silenceKills++;
        if (silenceKills >= CHUNK_SILENCE_KILLS || Date.now() >= deadline) {
          break; // 静默杀预算耗尽 / 墙钟到点 → 细粒度耗尽：剩余全 hasError，整批不降级
        }
      }
      const retryW = spawnReplacementWorker();
      if (!retryW) {
        // 无 replacement 可用（池上限/构造失败）：瞬态 error → 整批降级（保留既有）；
        // 挂死类 → 细粒度耗尽（不拖整批，D3 边界）
        chunkBroken = outcome === "error";
        break;
      }
      currentW = retryW;
    }

    if (chunkBroken || failed) {
      failed = true;
      results[ci] = null;
      return { broken: true, lastWorker: currentW };
    }
    // 正常收尾/细粒度耗尽：逐模型结果 = 已回包 ∪ 剩余全标 EMPTY_ERROR（hasError——
    // 统计失败在数值搜索中被排除，与 Go BoneCount==0 口径一致，D3）
    results[ci] = slice.map((p) => accounted.get(p) ?? { ...EMPTY_ERROR, path: p });
    return { broken: false, lastWorker: currentW };
  };

  const runWorkerQueue = async (w: Worker): Promise<void> => {
    let currentW = w;
    while (!failed) {
      const ci = nextChunk++;
      if (ci >= chunks.length) return;
      const r = await runChunk(currentW, ci, chunks[ci].slice);
      if (r.broken) return; // 整批已判降级（failed=true），本队列退出
      currentW = r.lastWorker; // 后续 chunk 接续最近存活 worker（原 worker 可能已被静默杀）
    }
  };

  await Promise.all(ws.map(runWorkerQueue));

  if (failed || results.some((r) => r === null)) {
    markDegraded();
    return null;
  }
  // 合并（chunks 顺序 = paths 顺序）：按 path 对齐（ADR-218 D2——Map 查表，结果回包序
  // 不承担契约，为未来 worker 内并行解码留口；chunk 内 paths 唯一，重复输入不在契约内）
  const out: Array<WebModelStats | null> = new Array(paths.length);
  for (let ci = 0; ci < chunks.length; ci++) {
    const { slice, offset } = chunks[ci];
    const res = results[ci] as Array<WebModelStatsWithPath>;
    const byPath = new Map(res.map((r) => [r.path, r]));
    for (let i = 0; i < slice.length; i++) {
      const s = byPath.get(slice[i]);
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
    // 防御（ADR-219 后近乎不可达：chunk 收尾已把缺条目细粒度补 EMPTY_ERROR）：
    // 结果对齐仍失败 → 整体降级，不返回半截统计
    markDegraded();
    return null;
  }
  statsProgressCb?.(paths.length, paths.length); // 全部完成
  return out as WebModelStats[];
}
