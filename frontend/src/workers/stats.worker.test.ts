// @vitest-environment node
// ===== stats.worker 测试：mt 初始化失败 → 单线程 WASM 回退（P2 审核修复）+
// 逐模型流式回包（partial × N + result 结束标记，ADR-219 D1）=====
// crossOriginIsolated=true 但 pthread 环境瞬态异常（worker spawn 失败等）时，
// 不得整批 error → 主线程永久降级；应回退单线程 init 再判 error。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as statsCore from "./stats-core.ts";
import { idbGet } from "@/utils/storage/idb.ts";
import { decodeYsmInWorker } from "@/wasm/ysm-worker-loader.ts";
import type { WebModelStatsWithPath } from "./stats-protocol.ts";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    initYsmParserInWorker: vi.fn(),
    initYsmParserInWorkerMt: vi.fn(),
    // ADR-153：loadMtAssets 是内部函数，通过 mock initYsmParserInWorkerMt 间接覆盖
  },
}));

vi.mock("@/wasm/ysm-worker-loader.ts", () => ({
  initYsmParserInWorker: mocks.initYsmParserInWorker,
  initYsmParserInWorkerMt: mocks.initYsmParserInWorkerMt,
  decodeYsmInWorker: vi.fn(),
  decodeYsmInWorkerMemfs: vi.fn(),
}));

// ADR-153：mock 动态 import 返回 stub 模块（测试环境无需真实 WASM 数据）
// base 与 mt 均需桩：loader 内两组数据都是动态 import，缺桩会在 vitest 解析时报错
vi.mock("@/wasm/ysm-wasm-data.js", () => ({
  _getWasmBinary: () => new ArrayBuffer(0),
}));
vi.mock("@/wasm/ysm-glue-data.js", () => ({
  _getGlueCode: () => "",
}));
vi.mock("@/wasm/ysm-wasm-data-mt.js", () => ({
  _getWasmBinaryMt: () => new ArrayBuffer(0),
}));
vi.mock("@/wasm/ysm-glue-data-mt.js", () => ({
  _getGlueCodeMt: () => "",
}));

vi.mock("@/utils/storage/idb.ts", () => ({ idbGet: vi.fn().mockResolvedValue(null) }));
vi.mock("@/preview-3d/decoder/utils.ts", () => ({ stripYsgpTextHeader: vi.fn() }));
vi.mock("./stats-core.ts", () => ({
  statsFromDecodedFiles: vi.fn(),
  statsFromJsonBytes: vi.fn(),
  // ADR-218 D3：EMPTY_ERROR 收敛至 stats-core 单处导出（worker 经值 import 引入）
  EMPTY_ERROR: { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true },
}));

beforeEach(() => {
  vi.clearAllMocks();
  posts.length = 0; // 用例间隔离（posts 为模块级数组，clearAllMocks 不清）
  // worker 顶层读 self（node 环境无）：注入桩，onmessage 由被测模块回填
  vi.stubGlobal("self", {
    onmessage: null,
    postMessage: (m: { type: string; message?: string; result?: WebModelStatsWithPath }) =>
      posts.push(m),
  });
});

const posts: Array<{
  type: string;
  requestId?: number;
  message?: string;
  result?: WebModelStatsWithPath;
}> = [];

let workerHandler: ((ev: { data: unknown }) => Promise<void>) | null = null;

/** node 环境下 self 已被 stubGlobal 覆盖为纯对象，cast 绕开 Window self 类型 */
function selfStub(): { onmessage: (ev: { data: unknown }) => Promise<void> } {
  return (globalThis as unknown as { self: { onmessage: (ev: { data: unknown }) => Promise<void> } })
    .self;
}

async function loadHandler(): Promise<(ev: { data: unknown }) => Promise<void>> {
  await import("./stats.worker.ts");
  // 模块只执行一次（缓存）：首次 import 时回填 onmessage，缓存后复用
  workerHandler ??= selfStub().onmessage;
  return workerHandler;
}

describe("stats.worker — mt 初始化失败回退", () => {
  it("mt init 失败 → 回退单线程 init，整批正常出 result", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    mocks.initYsmParserInWorkerMt.mockRejectedValue(new Error("pthread spawn 失败"));
    mocks.initYsmParserInWorker.mockResolvedValue(true);

    const handler = await loadHandler();

    // requestId 与协议类型对齐（StatsWorkerRequest.requestId: number，主线程自增序号）
    await handler({ data: { type: "stats", requestId: 1, paths: ["/web/ysm/a.ysm"] } });

    expect(mocks.initYsmParserInWorkerMt).toHaveBeenCalledTimes(1);
    expect(mocks.initYsmParserInWorker).toHaveBeenCalledTimes(1);
    expect(posts.some((p) => p.type === "result")).toBe(true);
    expect(posts.some((p) => p.type === "error")).toBe(false);
  });

  it("单线程回退也失败 → 才发 error（主线程整体降级）", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    mocks.initYsmParserInWorkerMt.mockRejectedValue(new Error("pthread spawn 失败"));
    mocks.initYsmParserInWorker.mockRejectedValue(new Error("wasm 二进制损坏"));

    const handler = await loadHandler();

    await handler({ data: { type: "stats", requestId: 2, paths: ["/web/ysm/a.ysm"] } });

    expect(posts.some((p) => p.type === "error" && p.message?.includes("wasm 二进制损坏"))).toBe(true);
  });
});

describe("stats.worker — 逐模型流式回包（ADR-219 D1）", () => {
  it("每模型统计完成立即回 partial（按 path 对齐）+ 循环走完发 result 结束标记（不再携带 results）", async () => {
    // 解码/统计桩：2 个模型都成功出真统计
    vi.mocked(idbGet).mockResolvedValue({ data: new ArrayBuffer(4) });
    vi.mocked(decodeYsmInWorker).mockResolvedValue([
      { path: "models/g.json", data: new Uint8Array(8) },
    ]);
    vi.mocked(statsCore.statsFromDecodedFiles).mockReturnValue({
      boneCount: 2,
      cubeCount: 4,
      texWidth: 64,
      texHeight: 32,
      hasError: false,
    });
    mocks.initYsmParserInWorker.mockResolvedValue(true);

    const handler = await loadHandler();
    const paths = ["/web/ysm/a.ysm", "/web/ysm/b.ysm"];
    await handler({ data: { type: "stats", requestId: 42, paths } });

    // 消息序列：partial × 2（逐模型）+ result 结束标记 × 1（无 results 字段）
    expect(posts.map((p) => p.type)).toEqual(["partial", "partial", "result"]);
    expect(posts[0]).toEqual({
      type: "partial",
      requestId: 42,
      result: { path: "/web/ysm/a.ysm", boneCount: 2, cubeCount: 4, texWidth: 64, texHeight: 32, hasError: false },
    });
    expect(posts[1].result?.path).toBe("/web/ysm/b.ysm");
    expect(posts[2]).toEqual({ type: "result", requestId: 42, doneCount: 2 });
  });

  it("解码失败模型仍逐模型回 partial（EMPTY_ERROR 形状，hasError）+ 流末尾 result", async () => {
    // 清掉上一用例的实现残留（clearAllMocks 不清 implementation）：idbGet 读空 → readModelBytes null → EMPTY_ERROR
    vi.mocked(idbGet).mockReset().mockResolvedValue(null);
    vi.mocked(decodeYsmInWorker).mockReset();
    mocks.initYsmParserInWorker.mockResolvedValue(true);

    const handler = await loadHandler();
    await handler({ data: { type: "stats", requestId: 43, paths: ["/web/ysm/x.ysm", "/web/ysm/y.ysm"] } });

    expect(posts.map((p) => p.type)).toEqual(["partial", "partial", "result"]);
    expect(posts[0].result).toEqual({
      path: "/web/ysm/x.ysm",
      boneCount: 0,
      cubeCount: 0,
      texWidth: 0,
      texHeight: 0,
      hasError: true,
    });
    expect(posts[2]).toEqual({ type: "result", requestId: 43, doneCount: 2 });
  });

  it("paths 非数组 → error（协议守卫拒收，不进 partial 流）", async () => {
    const handler = await loadHandler();
    await handler({ data: { type: "stats", requestId: 44, paths: "not-an-array" } });
    expect(posts.map((p) => p.type)).toEqual(["error"]);
    expect(posts[0].requestId).toBe(-1); // 哨兵：主线程 requestId 对账过滤丢弃，静默窗自愈
  });

  it("requestId 非数字（字符串）→ error（协议守卫：防类型漂移进入看门狗计数）", async () => {
    const handler = await loadHandler();
    await handler({ data: { type: "stats", requestId: "bad", paths: ["/web/ysm/a.ysm"] } });
    expect(posts.map((p) => p.type)).toEqual(["error"]);
  });

  it("paths 含非字符串元素 → error（协议守卫：元素级形状校验）", async () => {
    const handler = await loadHandler();
    await handler({ data: { type: "stats", requestId: 45, paths: ["/web/ym/a.ysm", 42] } });
    expect(posts.map((p) => p.type)).toEqual(["error"]);
  });
});

describe("stats.worker — mt 路径泵并发（1 泵串行）", () => {
  it("COI=true + mt init 成功 → 多模型仍全量 partial + result（1 泵串行处理，行为正确）", async () => {
    // mt 路径：crossOriginIsolated=true + initYsmParserInWorkerMt 成功 → concurrency 强制 1 泵
    vi.stubGlobal("crossOriginIsolated", true);
    vi.mocked(idbGet).mockReset().mockResolvedValue({ data: new ArrayBuffer(4) });
    vi.mocked(decodeYsmInWorker).mockReset().mockResolvedValue([
      { path: "models/g.json", data: new Uint8Array(8) },
    ]);
    vi.mocked(statsCore.statsFromDecodedFiles).mockReset().mockReturnValue({
      boneCount: 2,
      cubeCount: 4,
      texWidth: 64,
      texHeight: 32,
      hasError: false,
    });
    mocks.initYsmParserInWorkerMt.mockResolvedValue(true);

    const handler = await loadHandler();
    const paths = ["/web/ysm/mt-a.ysm", "/web/ysm/mt-b.ysm", "/web/ysm/mt-c.ysm"];
    await handler({ data: { type: "stats", requestId: 60, paths } });

    // mt 模式 1 泵串行：3 模型全部处理完 + result；C 层并行由 web-stats.ts Worker 池负责
    expect(posts.map((p) => p.type)).toEqual(["partial", "partial", "partial", "result"]);
    expect(posts.filter((p) => p.type === "partial").map((p) => p.result?.path)).toEqual(paths);
    expect(posts.at(-1)).toEqual({ type: "result", requestId: 60, doneCount: 3 });
    // mt 路径只调 mt init，不调 base init
    expect(mocks.initYsmParserInWorkerMt).toHaveBeenCalledTimes(1);
    expect(mocks.initYsmParserInWorker).not.toHaveBeenCalled();
  });
});
