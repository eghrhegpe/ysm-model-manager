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
} from "../workers/stats-protocol.ts";

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
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].type).toBe("stats");
    expect(w.posted[0].paths).toEqual(paths);
    const reqId = w.posted[0].requestId;
    w.onmessage?.({
      data: {
        type: "result",
        requestId: reqId,
        results: paths.map((p, i) => mkResult(p, 10 + i)),
      },
    });
    await expect(p1).resolves.toEqual([
      { boneCount: 10, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
      { boneCount: 11, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
      { boneCount: 12, cubeCount: 1, texWidth: 64, texHeight: 64, hasError: false },
    ]);
    expect(consumeWebSearchDegraded()).toBe(false);
    expect(progress).toEqual([[3, 3], [3, 3]]); // 逐批 (done,total) + 全部完成
    // 第二批：池复用（不新建 Worker），requestId 自增隔离批次
    const p2 = batchStatsWebModels(["/web/ysm/d.ysm"]);
    expect(FakeWorker.instances).toHaveLength(1);
    const posted2 = FakeWorker.instances[0].posted;
    expect(posted2).toHaveLength(2);
    expect(posted2[1].requestId).toBe(reqId + 1);
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "result",
        requestId: posted2[1].requestId,
        results: [{ path: "/web/ysm/d.ysm", boneCount: 1, cubeCount: 2, texWidth: 16, texHeight: 16, hasError: true }],
      },
    });
    await expect(p2).resolves.toEqual([
      { boneCount: 1, cubeCount: 2, texWidth: 16, texHeight: 16, hasError: true },
    ]);
  });

  it("多分片 + offset 对齐：401 条路径切 200+200+1，双 Worker 轮询取片后按原索引合并", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    const paths = Array.from({ length: STATS_BATCH_LIMIT * 2 + 1 }, (_, i) => `/web/ysm/m${i}.ysm`);
    const p = batchStatsWebModels(paths);
    const [w0, w1] = FakeWorker.instances;
    expect(w0.posted[0].paths).toHaveLength(200);
    expect(w1.posted[0].paths).toHaveLength(200);
    w0.onmessage?.({
      data: {
        type: "result",
        requestId: w0.posted[0].requestId,
        results: w0.posted[0].paths.map((path, i) => mkResult(path, i)), // 全局索引 = 片内偏移
      },
    });
    await flushMicrotasks(); // w0 队列推进取第 3 片
    expect(w0.posted).toHaveLength(2);
    expect(w0.posted[1].paths).toHaveLength(1);
    w1.onmessage?.({
      data: {
        type: "result",
        requestId: w1.posted[0].requestId,
        results: w1.posted[0].paths.map((path, i) => mkResult(path, 200 + i)), // offset=200
      },
    });
    w0.onmessage?.({
      data: {
        type: "result",
        requestId: w0.posted[1].requestId,
        results: w0.posted[1].paths.map((path, i) => mkResult(path, 400 + i)), // offset=400
      },
    });
    const res = await p;
    expect(res).toHaveLength(401);
    expect(res?.[0]?.boneCount).toBe(0);
    expect(res?.[199]?.boneCount).toBe(199);
    expect(res?.[200]?.boneCount).toBe(200); // 第 2 片 offset 对齐
    expect(res?.[399]?.boneCount).toBe(399);
    expect(res?.[400]?.boneCount).toBe(400); // 第 3 片 offset 对齐
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("requestId 隔离：空消息 / 异批 result / progress 消息均被忽略，正确回包才 settle", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const paths = ["/web/ysm/a.ysm", "/web/ysm/b.ysm"];
    const p = batchStatsWebModels(paths);
    const w = FakeWorker.instances[0];
    const reqId = w.posted[0].requestId;
    w.onmessage?.({ data: null }); // !data → 忽略
    w.onmessage?.({
      data: {
        type: "result",
        requestId: reqId + 500, // 异批 requestId → 忽略（若泄漏会以 999 污染结果）
        results: [mkResult(paths[0], 999), mkResult(paths[1], 999)],
      },
    });
    w.onmessage?.({ data: { type: "progress", requestId: reqId, done: 1, total: 2 } }); // 无消费 → 忽略
    w.onmessage?.({
      data: {
        type: "result",
        requestId: reqId,
        results: [mkResult(paths[0], 2), mkResult(paths[1], 2)],
      },
    });
    const res = await p;
    expect(res?.[0]?.boneCount).toBe(2);
    expect(res?.[1]?.boneCount).toBe(2);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("Worker error 响应（WASM 初始化失败）→ 终止整池 + 整批降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm", "/web/ysm/b.ysm", "/web/ysm/c.ysm"]);
    const w = FakeWorker.instances[0];
    w.onmessage?.({ data: { type: "error", requestId: w.posted[0].requestId, message: "wasm init failed" } });
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
    for (const inst of FakeWorker.instances) expect(inst.terminated).toBe(true);
  });

  it("Worker onerror（WASM trap 逃逸）→ 终止整池 + 降级", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    FakeWorker.instances[0].onerror?.(new Error("trap escaped"));
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("单批超时（60s 无回包）→ 杀池防僵尸 + 降级", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm"]);
    const w = FakeWorker.instances[0];
    expect(w.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000); // STATS_CHUNK_TIMEOUT_MS（源码常量，未导出）
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
    expect(w.terminated).toBe(true); // 超时杀整个池
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
    expect(FakeWorker.instances).toHaveLength(1); // 池已建
    expect(() => terminateStatsWorker()).not.toThrow(); // terminate 抛错 → catch 吞掉
    await expect(p).resolves.toBeNull(); // 在途请求全部降级 settle，不挂起
    expect(consumeWebSearchDegraded()).toBe(true);
    FakeWorker.failTerminate = false;
    expect(() => terminateStatsWorker()).not.toThrow(); // 池已清空，再次幂等
  });

  it("worker 回包缺条目 → 防御性整体降级，不返回半截统计", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const p = batchStatsWebModels(["/web/ysm/a.ysm", "/web/ysm/b.ysm"]);
    const w = FakeWorker.instances[0];
    w.onmessage?.({
      data: {
        type: "result",
        requestId: w.posted[0].requestId,
        results: [mkResult("/web/ysm/a.ysm", 1)], // 缺第 2 条
      },
    });
    await expect(p).resolves.toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });
});

