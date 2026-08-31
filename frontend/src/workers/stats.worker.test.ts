// @vitest-environment node
// ===== stats.worker 测试：mt 初始化失败 → 单线程 WASM 回退（P2 审核修复）=====
// crossOriginIsolated=true 但 pthread 环境瞬态异常（worker spawn 失败等）时，
// 不得整批 error → 主线程永久降级；应回退单线程 init 再判 error。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    initYsmParserInWorker: vi.fn(),
    initYsmParserInWorkerMt: vi.fn(),
  },
}));

vi.mock("../wasm/ysm-worker-loader.ts", () => ({
  initYsmParserInWorker: mocks.initYsmParserInWorker,
  initYsmParserInWorkerMt: mocks.initYsmParserInWorkerMt,
  decodeYsmInWorker: vi.fn(),
  decodeYsmInWorkerMemfs: vi.fn(),
}));

vi.mock("../backend/idb.ts", () => ({ idbGet: vi.fn().mockResolvedValue(null) }));
vi.mock("../features/preview-3d/decoder/utils.ts", () => ({ stripYsgpTextHeader: vi.fn() }));
vi.mock("./stats-core.ts", () => ({
  statsFromDecodedFiles: vi.fn(),
  statsFromJsonBytes: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // worker 顶层读 self（node 环境无）：注入桩，onmessage 由被测模块回填
  vi.stubGlobal("self", {
    onmessage: null,
    postMessage: (m: { type: string; message?: string }) => posts.push(m),
  });
});

const posts: Array<{ type: string; message?: string }> = [];

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

    await handler({ data: { type: "stats", requestId: "r1", paths: ["/web/ysm/a.ysm"] } });

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

    await handler({ data: { type: "stats", requestId: "r2", paths: ["/web/ysm/a.ysm"] } });

    expect(posts.some((p) => p.type === "error" && p.message?.includes("wasm 二进制损坏"))).toBe(true);
  });
});
