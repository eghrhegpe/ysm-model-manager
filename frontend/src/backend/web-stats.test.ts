// @vitest-environment node
// ===== web-stats 编排层测试（审核 B 缺口 #1，可测部分）=====
// 降级标记（consume 复位）、runner 注入的降级传播、terminate 幂等。
// Worker 池路径（分片/合并/超时/onerror/错误降级）经 vi.stubGlobal 注入 FakeWorker
// 全量覆盖（知识卡 vitest-env-switch 模式 1，无需 happy-dom / 真实 Worker）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  batchStatsWebModels,
  __setStatsRunnerForTest,
  consumeWebSearchDegraded,
  terminateStatsWorker,
  onStatsProgress,
  getStatsPoolSize,
  prefetchStatsWorker,
} from "./web-stats.ts";
import {
  STATS_BATCH_LIMIT,
  type StatsWorkerRequest,
  type StatsWorkerResponse,
  type WebModelStatsWithPath,
} from "@/workers/stats-protocol.ts";

beforeEach(() => {
  __setStatsRunnerForTest(null);
});

describe("web-stats 编排（可测部分）", () => {
  it("runner 注入：返回统计 → 不降级；consume 标记 false", async () => {
    __setStatsRunnerForTest(async (paths) =>
      paths.map(() => ({ boneCount: 10, cubeCount: 5, texWidth: 64, texHeight: 64, hasError: false })),
    );
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res?.[0]?.boneCount).toBe(10);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("runner 返回 null → 整批降级 + 降级标记置位（consume 一次后复位）", async () => {
    __setStatsRunnerForTest(async () => null);
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res).toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
    expect(consumeWebSearchDegraded()).toBe(false); // 一次消费复位
  });

  it("runner 抛错 → 降级（不向上抛，批返回 null）", async () => {
    __setStatsRunnerForTest(async () => {
      throw new Error("boom");
    });
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res).toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("空路径 → 空数组（不启动统计）", async () => {
    const res = await batchStatsWebModels([]);
    expect(res).toEqual([]);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("terminateStatsWorker 幂等（无 Worker 时不抛）", () => {
    expect(() => terminateStatsWorker()).not.toThrow();
    expect(() => terminateStatsWorker()).not.toThrow();
  });
});

// ===== Worker 池路径（vi.stubGlobal 注入 FakeWorker，知识卡模式 1）=====

/** 可编程 FakeWorker：捕获 postMessage 供测试手动回放 onmessage / onerror / 超时 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruct = false;
  static failTerminate = false;
  onmessage: ((ev: { data: StatsWorkerResponse | null }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: StatsWorkerRequest[] = [];
  terminated = false;
  constructor() {
    if (FakeWorker.failConstruct) throw new Error("Worker blocked");
    FakeWorker.instances.push(this);
  }
  postMessage(msg: StatsWorkerRequest): void {
    this.posted.push(msg);
  }
  terminate(): void {
    if (FakeWorker.failTerminate) throw new Error("terminate failed");
    this.terminated = true;
  }
}

/** 构造一条带 path 的 Worker 统计结果（boneCount 由调用方编码全局索引用于对齐断言） */
function mkResult(path: string, boneCount: number): WebModelStatsWithPath {
  return { path, boneCount, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false };
}

/** 回放 worker 正常应答流（ADR-219 D1）：每条 partial 逐模型 + result 结束标记。
 *  msgIdx = FakeWorker.posted 中的请求序号；boneBase = boneCount 编码基准（对齐断言用） */
function replayPartialStream(w: FakeWorker, msgIdx: number, boneBase = 0): void {
  const msg = w.posted[msgIdx];
  msg.paths.forEach((path, i) => {
    w.onmessage?.({ data: { type: "partial", requestId: msg.requestId, result: mkResult(path, boneBase + i) } });
  });
  w.onmessage?.({ data: { type: "result", requestId: msg.requestId } });
}

/** flush 微任务队列（等 runWorkerQueue 在 settle 后推进到下一次 postMessage） */
const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("web-stats Worker 池路径（FakeWorker 注入）", () => {
  afterEach(() => {
    terminateStatsWorker();
    onStatsProgress(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWorker.instances = [];
    FakeWorker.failConstruct = false;
    FakeWorker.failTerminate = false;
  });

  it("getStatsPoolSize：hardwareConcurrency 夹取 1..8，缺省 4", () => {
    const cases: Array<[unknown, number]> = [
      [{ hardwareConcurrency: 16 }, 8], // 超上限 → POOL_MAX
      [{ hardwareConcurrency: 1 }, 1], // 下限
      [{ hardwareConcurrency: 2.9 }, 2], // 向下取整
      [{ hardwareConcurrency: 0 }, 4], // 非法 → 缺省
      [{ hardwareConcurrency: NaN }, 4], // 非有限 → 缺省
      [{ hardwareConcurrency: -3 }, 4], // 非法 → 缺省
      [undefined, 4], // navigator 不存在 → 缺省（typeof undefined 分支）
    ];
    for (const [nav, expected] of cases) {
      vi.stubGlobal("navigator", nav);
      expect(getStatsPoolSize()).toBe(expected);
    }
  });

  it("prefetchStatsWorker：Worker 可用 → 预热创建即释放；不可用 → 静默跳过", () => {
    vi.stubGlobal("Worker", FakeWorker);
    prefetchStatsWorker();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    // Worker 不可用（typeof undefined）→ 不抛不创建
    vi.stubGlobal("Worker", undefined);
    prefetchStatsWorker();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("happy path：结果按 paths 对齐合并（path 字段剥离）+ 进度回调 + 不降级 + 池复用", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const progress: Array<[number, number]> = [];
    onStatsProgress((done, total) => progress.push([done, total]));
    const paths = ["/web/ysm/a.ysm", "/web/ysm/b.ysm", "/web/pmx/c.pmx"];
    const p1 = batchStatsWebModels(paths);
    await flushMicrotasks(); // 单飞链（ADR-218）：批执行延后一拍到微任务，worker 此刻才创建
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].type).toBe("stats");
    expect(w.posted[0].paths).toEqual(paths);
    const reqId = w.posted[0].requestId;
    // ADR-219 D1：正常应答流 = 逐模型 partial + result 结束标记
    paths.forEach((p, i) => {
      w.onmessage?.({ data: { type: "partial", requestId: reqId, result: mkResult(p, 10 + i) } });
    });
    w.onmessage?.({ data: { type: "result", requestId: reqId } });
    await expect(p1).resolves.toEqual([
      { boneCount: 10, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
      { boneCount: 11, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
      { boneCount: 12, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
    ]);
    expect(consumeWebSearchDegraded()).toBe(false);
    // 第二批：池复用（不新建 Worker），requestId 自增隔离批次
    const p2 = batchStatsWebModels(["/web/ysm/d.ysm"]);
    await flushMicrotasks();
    expect(FakeWorker.instances).toHaveLength(1);
    const posted2 = FakeWorker.instances[0].posted;
    expect(posted2).toHaveLength(2);
    expect(posted2[1].requestId).toBe(reqId + 1);
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "partial",
        requestId: posted2[1].requestId,
        result: { path: "/web/ysm/d.ysm", boneCount: 1, cubeCount: 2, texWidth: 16, texHeight: 16, hasError: true },
      },
    });
    FakeWorker.instances[0].onmessage?.({
      data: { type: "result", requestId: posted2[1].requestId },
    });
    await expect(p2).resolves.toEqual([
      { boneCount: 1, cubeCount: 2, texWidth: 16, texHeight: 16, hasError: true },
    ]);
    // ADR-219：进度升级为模型级（逐 partial 推进）+ 批末全部完成
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
      [3, 3],
      [1, 1],
      [1, 1],
    ]);
  });

  it("多分片 + offset 对齐：401 条路径切 200+200+1，双 Worker 轮询取片后按原索引合并", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    const paths = Array.from({ length: STATS_BATCH_LIMIT * 2 + 1 }, (_, i) => `/web/ysm/m${i}.ysm`);
    const p = batchStatsWebModels(paths);
    await flushMicrotasks();
    const [w0, w1] = FakeWorker.instances;
    expect(w0.posted[0].paths).toHaveLength(200);
    expect(w1.posted[0].paths).toHaveLength(200);
    replayPartialStream(w0, 0, 0); // chunk0：全局索引 = 片内偏移
    await flushMicrotasks(); // w0 队列推进取第 3 片
    expect(w0.posted).toHaveLength(2);
    expect(w0.posted[1].paths).toHaveLength(1);
    replayPartialStream(w1, 0, 200); // offset=200
    replayPartialStream(w0, 1, 400); // offset=400
    const res = await p;
    expect(res).toHaveLength(401);
    expect(res?.[0]?.boneCount).toBe(0);
    expect(res?.[199]?.boneCount).toBe(199);
    expect(res?.[200]?.boneCount).toBe(200); // 第 2 片 offset 对齐
    expect(res?.[399]?.boneCount).toBe(399);
    expect(res?.[400]?.boneCount).toBe(400); // 第 3 片 offset 对齐
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("requestId 隔离：空消息 / 异批 result 被忽略，正确回包才 settle", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const paths = ["/web/ysm/a.ysm", "/web/ysm/b.ysm"];
    const p = batchStatsWebModels(paths);
    await flushMicrotasks();
    const w = FakeWorker.instances[0];
    const reqId = w.posted[0].requestId;
    w.onmessage?.({ data: null }); // !data → 忽略
    w.onmessage?.({
      data: { type: "partial", requestId: reqId + 500, result: mkResult(paths[0], 999) }, // 异批 partial → 忽略
    });
    w.onmessage?.({
      data: { type: "result", requestId: reqId + 500 }, // 异批结束标记 → 忽略（若泄漏会以 999 污染结果）
    });
    w.onmessage?.({ data: { type: "partial", requestId: reqId, result: mkResult(paths[0], 2) } });
    w.onmessage?.({ data: { type: "partial", requestId: reqId, result: mkResult(paths[1], 2) } });
    w.onmessage?.({ data: { type: "result", requestId: reqId } });
    const res = await p;
    expect(res?.[0]?.boneCount).toBe(2);
    expect(res?.[1]?.boneCount).toBe(2);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("Worker error 响应（瞬态）→ 只终止出错 worker，换 worker 重试成功 → 不降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm", "/web/ysm/b.ysm"]);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    // w0 报 WASM 初始化失败（瞬态）→ 只 terminate w0，不杀池
    w0.onmessage?.({ data: { type: "error", requestId: w0.posted[0].requestId, message: "wasm init failed" } });
    // 重试：getWorkerPool 池空懒建新 worker w1
    await flushMicrotasks();
    const w1 = FakeWorker.instances[1];
    expect(w0.terminated).toBe(true); // 出错 worker 被终止
    expect(w1).toBeTruthy();
    expect(w1.terminated).toBe(false); // 新 worker 存活
    expect(w1.posted[0].paths).toEqual(["/web/ysm/a.ysm", "/web/ysm/b.ysm"]); // error 早于 partial → 剩余 = 全量
    replayPartialStream(w1, 0, 3);
    const res = await p;
    expect(res?.[0]?.boneCount).toBe(3);
    expect(res?.[1]?.boneCount).toBe(4);
    expect(consumeWebSearchDegraded()).toBe(false); // 重试成功 → 不降级
  });

  it("Worker error 响应 → 重试仍失败 → 整批降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    w0.onmessage?.({ data: { type: "error", requestId: w0.posted[0].requestId, message: "wasm init failed" } });
    await flushMicrotasks();
    const w1 = FakeWorker.instances[1];
    // 新 worker 也报错 → 重试耗尽 → 降级
    w1.onmessage?.({ data: { type: "error", requestId: w1.posted[0].requestId, message: "wasm init failed again" } });
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("Worker onerror（瞬态）→ 换 worker 重试成功 → 不降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    w0.onerror?.(new Error("trap escaped"));
    await flushMicrotasks();
    const w1 = FakeWorker.instances[1];
    expect(w0.terminated).toBe(true);
    expect(w1.terminated).toBe(false);
    replayPartialStream(w1, 0, 7);
    const res = await p;
    expect(res?.[0]?.boneCount).toBe(7);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("Worker onerror → 重试仍失败 → 整批降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    w0.onerror?.(new Error("trap escaped"));
    await flushMicrotasks();
    const w1 = FakeWorker.instances[1];
    w1.onerror?.(new Error("trap again"));
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("多 worker 瞬态 error → 重试新建专属 worker，不占用他队 worker 在途请求（hc≥2 回归）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    // 201 条 → 2 片（200+1）：w0 取 chunk0、w1 取 chunk1，两 worker 并发在途
    const paths = Array.from({ length: STATS_BATCH_LIMIT + 1 }, (_, i) => `/web/ysm/m${i}.ysm`);
    const p = batchStatsWebModels(paths);
    await flushMicrotasks();
    const [w0, w1] = FakeWorker.instances;
    expect(w0.posted[0].paths).toHaveLength(STATS_BATCH_LIMIT);
    expect(w1.posted[0].paths).toHaveLength(1);
    // w0 的 chunk0 瞬态 error → 终止 w0；重试必须新建专属 w2，不得复用池内 w1——
    // w1 正并发持有 chunk1 在途（单 onmessage 槽位契约，复用会覆盖致其回复被丢弃）
    w0.onmessage?.({ data: { type: "error", requestId: w0.posted[0].requestId, message: "wasm init failed" } });
    await flushMicrotasks();
    const w2 = FakeWorker.instances[2];
    expect(w0.terminated).toBe(true); // 出错 worker 被终止
    expect(w1.terminated).toBe(false); // w1 未被波及（关键：不杀健康 worker）
    expect(w2).toBeTruthy();
    expect(w2.terminated).toBe(false);
    expect(w2.posted[0].paths).toHaveLength(STATS_BATCH_LIMIT); // chunk0 在专属新 worker 上重试
    // w1 回自己的 chunk1 → 必须正常 settle（若被重试覆盖，此回包会被 requestId 过滤 → 批挂起）
    replayPartialStream(w1, 0, STATS_BATCH_LIMIT); // offset=200
    replayPartialStream(w2, 0, 0); // chunk0 offset=0
    const res = await p;
    expect(res).toHaveLength(STATS_BATCH_LIMIT + 1);
    expect(res?.[0]?.boneCount).toBe(0);
    expect(res?.[STATS_BATCH_LIMIT]?.boneCount).toBe(STATS_BATCH_LIMIT); // w1 的 chunk1 对齐成功
    expect(consumeWebSearchDegraded()).toBe(false); // 重试成功 + 他队 chunk 未丢 → 不降级
  });

  it("重试预算按次复位：前片重试成功后，后片再遇瞬态 error 仍享 1 次重试（hc=1 顺序队列）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const paths = Array.from({ length: STATS_BATCH_LIMIT + 1 }, (_, i) => `/web/ysm/m${i}.ysm`);
    const p = batchStatsWebModels(paths);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    // chunk0（200 条）瞬态 error → 重试到新 worker w1
    w0.onmessage?.({ data: { type: "error", requestId: w0.posted[0].requestId, message: "wasm init failed" } });
    await flushMicrotasks();
    const w1 = FakeWorker.instances[1];
    replayPartialStream(w1, 0, 0); // chunk0 重试成功（offset=0）
    await flushMicrotasks(); // w1 队列推进 → 取 chunk1（1 条）
    expect(w1.posted).toHaveLength(2);
    expect(w1.posted[1].paths).toHaveLength(1);
    // chunk1 再遇瞬态 error → 重试预算按 chunk 独立复位 → 应再享 1 次重试（新建 w2），而非直接降级
    w1.onmessage?.({ data: { type: "error", requestId: w1.posted[1].requestId, message: "wasm init again" } });
    await flushMicrotasks();
    const w2 = FakeWorker.instances[2];
    expect(w1.terminated).toBe(true);
    expect(w2).toBeTruthy();
    expect(w2.posted[0].paths).toHaveLength(1);
    replayPartialStream(w2, 0, STATS_BATCH_LIMIT); // chunk1 offset=200
    const res = await p;
    expect(res).toHaveLength(STATS_BATCH_LIMIT + 1);
    expect(res?.[0]?.boneCount).toBe(0);
    expect(res?.[STATS_BATCH_LIMIT]?.boneCount).toBe(STATS_BATCH_LIMIT);
    expect(consumeWebSearchDegraded()).toBe(false); // 两片都经重试成功 → 不降级
  });

  it("回包缺条目（结束标记到达但 partial 流缺条目，纯防御）→ 缺条目 hasError 细粒度补位，不整批降级（ADR-219 D1）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm", "/web/ysm/b.ysm"]);
    await flushMicrotasks();
    const w = FakeWorker.instances[0];
    // worker 只回结束标记（partial 全丢——postMessage 信道可靠，纯防御路径）
    w.onmessage?.({ data: { type: "result", requestId: w.posted[0].requestId } });
    const res = await p;
    expect(res).toEqual([
      { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true },
      { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true },
    ]);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("Worker 构造即抛（被 CSP/环境屏蔽）→ getWorkerPool null → 整批降级", async () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("blocked");
      }
    });
    await expect(batchStatsWebModels(["/web/ysm/a.ysm"])).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("terminateStatsWorker 主动取消：在途请求降级 settle，terminate 抛错被吞（幂等）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    FakeWorker.failTerminate = true;
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    expect(FakeWorker.instances).toHaveLength(1); // 池已建
    expect(() => terminateStatsWorker()).not.toThrow(); // terminate 抛错 → catch 吞掉
    await expect(p).resolves.toBeNull(); // 在途请求全部降级 settle，不挂起
    expect(consumeWebSearchDegraded()).toBe(true);
    FakeWorker.failTerminate = false;
    expect(() => terminateStatsWorker()).not.toThrow(); // 池已清空，再次幂等
  });

  // ===== ADR-218 D1：池并发 = 批级单飞（batchChain 串行链）=====

  it("双批并发 → 串行化：后批排队不覆写槽位，前批完成后接续（hc=1）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const pA = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    const w = FakeWorker.instances[0];
    const reqA = w.posted[0].requestId;
    // 前批在途时发起第二批 → 必须排队（不发包、不覆写 onmessage 槽位）
    const pB = batchStatsWebModels(["/web/ysm/b.ysm"]);
    await flushMicrotasks();
    expect(w.posted).toHaveLength(1); // B 尚未发包
    // 回包 A → A 完成（逐模型 partial + result 结束标记）
    w.onmessage?.({ data: { type: "partial", requestId: reqA, result: mkResult("/web/ysm/a.ysm", 1) } });
    w.onmessage?.({ data: { type: "result", requestId: reqA } });
    await expect(pA).resolves.toEqual([
      { boneCount: 1, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
    ]);
    // A 完成 → B 出队，同一 worker 接续发包，requestId 继续自增
    await flushMicrotasks();
    expect(w.posted).toHaveLength(2);
    expect(w.posted[1].requestId).toBe(reqA + 1);
    w.onmessage?.({ data: { type: "partial", requestId: w.posted[1].requestId, result: mkResult("/web/ysm/b.ysm", 2) } });
    w.onmessage?.({ data: { type: "result", requestId: w.posted[1].requestId } });
    await expect(pB).resolves.toEqual([
      { boneCount: 2, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
    ]);
    expect(w.terminated).toBe(false); // 无杀池
    expect(consumeWebSearchDegraded()).toBe(false); // 两批均完整
  });

  it("terminateStatsWorker 弃置排队批（池代际 +1）：在途批降级、未启动批直接 null", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const pA = batchStatsWebModels(["/web/ysm/a.ysm"]);
    const pB = batchStatsWebModels(["/web/ysm/b.ysm"]);
    await flushMicrotasks();
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1); // B 排队中
    terminateStatsWorker(); // 杀池 + 池代际 +1：A 在途 chunk 降级 settle，B 弃置
    const [ra, rb] = await Promise.all([pA, pB]);
    expect(ra).toBeNull(); // A：在途请求被终止 settle → 整批降级
    expect(rb).toBeNull(); // B：未启动 → 弃置（防"取消后又偷偷重跑"）
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("回包乱序 → 合并层按 path 对齐（Map 查表），结果序不再承担契约（ADR-218 D2）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const paths = ["/web/ysm/a.ysm", "/web/ysm/b.ysm"];
    const p = batchStatsWebModels(paths);
    await flushMicrotasks();
    const w = FakeWorker.instances[0];
    // Worker 逆序 partial 流（未来 worker 内并行解码可能乱序）
    w.onmessage?.({ data: { type: "partial", requestId: w.posted[0].requestId, result: mkResult(paths[1], 2) } });
    w.onmessage?.({ data: { type: "partial", requestId: w.posted[0].requestId, result: mkResult(paths[0], 1) } });
    w.onmessage?.({ data: { type: "result", requestId: w.posted[0].requestId } });
    const res = await p;
    expect(res?.[0]?.boneCount).toBe(1); // 按 path 对齐回输入序
    expect(res?.[1]?.boneCount).toBe(2);
    expect(consumeWebSearchDegraded()).toBe(false);
  });
});

// ===== ADR-219 细粒度降级（静默看门狗 + 剩余模型重试 + 挂死模型 hasError）=====
// 静默窗 30s / chunk 墙钟 60s / 静默杀预算 2（源码常量，未导出，测试经 fake timers 推进）。
describe("web-stats ADR-219 细粒度降级（FakeWorker + fake timers）", () => {
  afterEach(() => {
    terminateStatsWorker();
    onStatsProgress(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWorker.instances = [];
    FakeWorker.failConstruct = false;
    FakeWorker.failTerminate = false;
  });

  it("静默 30s → 只杀挂死 worker（不杀池）+ 专属 replacement 重试剩余 → 其余 worker 结果不受影响、整批不降级", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    // 2 片：w0 取 chunk0（模拟挂死），w1 取 chunk1（正常完成）
    const paths = Array.from({ length: STATS_BATCH_LIMIT + 1 }, (_, i) => `/web/ysm/m${i}.ysm`);
    const p = batchStatsWebModels(paths);
    await vi.advanceTimersByTimeAsync(0); // flush 单飞链 + 池创建
    const [w0, w1] = FakeWorker.instances;
    // w1 正常：逐模型 partial + result（offset=200）
    replayPartialStream(w1, 0, STATS_BATCH_LIMIT);
    // w0 挂死：发前 10 条 partial 后中断（不再回包）
    const req0 = w0.posted[0].requestId;
    w0.posted[0].paths.slice(0, 10).forEach((path, i) => {
      w0.onmessage?.({ data: { type: "partial", requestId: req0, result: mkResult(path, i) } });
    });
    // 静默 30s 到点 → 只杀 w0（w1 不受影响），w0 的 chunk 在专属 replacement 上重试剩余
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w0.terminated).toBe(true); // 挂死 worker 被终止
    expect(w1.terminated).toBe(false); // 健康 worker 未波及（关键）
    const w2 = FakeWorker.instances[2]; // 专属 replacement
    expect(w2).toBeTruthy();
    // w0 的 chunk0 剩余 = 200 - 10 = 190 条（已回包不重放）
    expect(w2.posted[0].paths).toHaveLength(STATS_BATCH_LIMIT - 10);
    // w2 补完剩余 → 该 chunk 收尾（10 条已回包 + 190 条重试回包 = 200 条全量）
    replayPartialStream(w2, 0, 10);
    const res = await p;
    expect(res).toHaveLength(STATS_BATCH_LIMIT + 1);
    expect(res?.[0]?.boneCount).toBe(0); // chunk0 第 1 条（已回包）
    expect(res?.[10]?.boneCount).toBe(10); // 重试后首条（m10..m199 经 replacement 回包，全局编码对齐）
    expect(res?.[STATS_BATCH_LIMIT]?.boneCount).toBe(STATS_BATCH_LIMIT); // chunk1 未受 w0 挂死影响
    expect(res?.every((s) => !s.hasError)).toBe(true); // 全部真统计，无 hasError
    expect(consumeWebSearchDegraded()).toBe(false); // 细粒度恢复 → 整批不降级
  });

  it("静默杀预算 + 墙钟耗尽 → 挂死 chunk 剩余模型 hasError（细粒度耗尽），其余 chunk 正常、整批不降级", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    // 单 worker：chunk0 全程挂死（无任何 partial）
    const p = batchStatsWebModels(["/web/ysm/hang.ysm"]);
    await vi.advanceTimersByTimeAsync(0);
    const w0 = FakeWorker.instances[0];
    // 静默 30s → 杀 w0，replacement w1 重试（仍挂死）
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w0.terminated).toBe(true);
    const w1 = FakeWorker.instances[1];
    expect(w1).toBeTruthy();
    // 再静默 → 但撞 60s 墙钟（deadline 先于第 2 次静默杀预算生效）→ 强制耗尽
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;
    // 挂死模型 → EMPTY_ERROR（hasError=true）；整批正常返回（不降级 null）
    expect(res).toEqual([{ boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true }]);
    expect(consumeWebSearchDegraded()).toBe(false); // 细粒度耗尽 ≠ 整批降级
  });

  it("瞬态 error 重试耗尽（无 replacement 可用）→ 整批降级（系统级边界，保留既有语义）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    await flushMicrotasks();
    const w0 = FakeWorker.instances[0];
    // 构造 replacement 失败（池已占满 poolSize=1，w0 被 terminate 后池空 → 但 failConstruct 强制构造抛错）
    FakeWorker.failConstruct = true;
    w0.onmessage?.({ data: { type: "error", requestId: w0.posted[0].requestId, message: "wasm init failed" } });
    await flushMicrotasks();
    // error 重试（需 spawn replacement）→ failConstruct 使 spawn 返回 null → chunkBroken → 整批降级
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });
});

