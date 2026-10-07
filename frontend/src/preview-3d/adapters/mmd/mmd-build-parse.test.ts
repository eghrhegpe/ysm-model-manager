// ===== mmd-build-parse 单元测试 =====
// P0 review 修复：worker 路径伪造 mmd 的 updateWithMixer 曾是 no-op，
// c.mixer.update(dt) 无人调用 → worker 路径 VMD 动画永不播放（mmd-build-result.ts:58 每帧
// 只走 c.mmd?.updateWithMixer(dt, c.mixer, ...)）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { workerMmdUpdateWithMixer, parsePmxStage } from "./mmd-build-parse.ts";
import type { ParsePmxCtx } from "./mmd-types.ts";
import type { PmxParseResponse } from "./mmd-pmx-parser.worker.ts";



describe("workerMmdUpdateWithMixer（P0：worker 路径动画静止修复）", () => {
  it("转发 delta 到 mixer.update（对齐真实 MMD.updateWithMixer 的 mixer.update(dt) 语义）", () => {
    const mixer = { update: vi.fn() };
    workerMmdUpdateWithMixer(0.016, mixer);
    expect(mixer.update).toHaveBeenCalledTimes(1);
    expect(mixer.update).toHaveBeenCalledWith(0.016);
  });

  it("多次调用每次都推进 mixer（非 no-op）", () => {
    const mixer = { update: vi.fn() };
    workerMmdUpdateWithMixer(0.016, mixer);
    workerMmdUpdateWithMixer(0.032, mixer);
    expect(mixer.update).toHaveBeenCalledTimes(2);
  });
});

const { buildPmxSceneMock, mmdDiagMock } = vi.hoisted(() => ({
  buildPmxSceneMock: vi.fn(),
  mmdDiagMock: vi.fn(),
}));

vi.mock("./mmd-pmx-parser.ts", () => ({
  buildPmxScene: buildPmxSceneMock,
}));

vi.mock("./mmd-shared.ts", () => ({
  mmdDiag: mmdDiagMock,
  disposeMmdMesh: vi.fn(),
  trackAlloc: vi.fn(),
}));

/** worker 响应夹具：仅构造 parsePmxStage 实际读取的字段（ok/vertices/faces/morphs/error/id） */
function pmxResponse(over: Record<string, unknown>): PmxParseResponse {
  return over as unknown as PmxParseResponse;
}

describe("parsePmxStage（worker 路径装配 + 诊断）", () => {
  function pmxCtx(over: Partial<ParsePmxCtx> = {}): ParsePmxCtx {
    return {
      effectivePath: "/repo/model.pmx",
      effectivePort: { emit: vi.fn() } as unknown as ParsePmxCtx["effectivePort"],
      pmxParsePromise: null,
      pmxParsedData: null,
      texMap: new Map<string, string>(),
      usePmxWorker: false,
      workerResult: null,
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    buildPmxSceneMock.mockResolvedValue({
      mesh: {},
      morphBuilt: 0,
      morphSkipped: 0,
    });
  });

  it("usePmxWorker=false → 直接返回（不等待 promise、不动 workerResult）", async () => {
    const c = pmxCtx({
      usePmxWorker: false,
      pmxParsePromise: Promise.resolve({ id: 1, ok: true }),
    });
    await parsePmxStage(c);
    expect(c.workerResult).toBeNull();
    expect(c.pmxParsedData).toBeNull();
    expect(buildPmxSceneMock).not.toHaveBeenCalled();
    expect(mmdDiagMock).not.toHaveBeenCalled();
  });

  it("worker ok + vertices/faces → buildPmxScene(sliced) + ok 诊断（morphSkipped=0 不追加 warn）", async () => {
    const pmxResult = pmxResponse({
      id: 1,
      ok: true,
      vertices: { count: 3 },
      faces: { count: 1 },
      bones: [{ name: "b" }],
      materials: [],
      morphs: [],
    });
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.resolve(pmxResult),
    });
    await parsePmxStage(c);

    expect(c.pmxParsedData).toBe(pmxResult);
    expect(buildPmxSceneMock).toHaveBeenCalledWith(pmxResult, {
      texUrlMap: c.texMap,
      sliced: true,
    });
    expect(c.workerResult).toEqual({ mesh: {}, morphBuilt: 0, morphSkipped: 0 });
    expect(mmdDiagMock).toHaveBeenCalledWith(
      c.effectivePort,
      "pmx-worker-build",
      "/repo/model.pmx",
      "ok",
      expect.stringContaining("(Worker path)"),
    );
    expect(mmdDiagMock).not.toHaveBeenCalledWith(
      c.effectivePort,
      "worker-limit",
      expect.anything(),
      "warn",
      expect.anything(),
    );
  });

  it("worker ok + morphSkipped>0 → 追加 worker-limit warn（非顶点 morph 降级可见化）", async () => {
    buildPmxSceneMock.mockResolvedValue({
      mesh: {},
      morphBuilt: 1,
      morphSkipped: 2,
    });
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.resolve(
        pmxResponse({
          id: 1,
          ok: true,
          vertices: { count: 3 },
          faces: { count: 1 },
          morphs: [{ name: "m0" }, { name: "m1" }, { name: "m2" }],
        }),
      ),
    });
    await parsePmxStage(c);

    expect(mmdDiagMock).toHaveBeenCalledWith(
      c.effectivePort,
      "worker-limit",
      "/repo/model.pmx",
      "warn",
      expect.stringContaining("non-vertex morphs skipped: 2/3"),
    );
  });

  it("worker ok=true 但缺 vertices/faces → 静默（不 build、不诊断）", async () => {
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.resolve({ id: 1, ok: true }),
    });
    await parsePmxStage(c);
    expect(buildPmxSceneMock).not.toHaveBeenCalled();
    expect(mmdDiagMock).not.toHaveBeenCalled();
  });

  it("worker ok=false + error → pmx-worker-build warn（fallback 提示含错误原文）", async () => {
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.resolve({ id: 1, ok: false, error: "parse boom" }),
    });
    await parsePmxStage(c);

    expect(buildPmxSceneMock).not.toHaveBeenCalled();
    expect(mmdDiagMock).toHaveBeenCalledWith(
      c.effectivePort,
      "pmx-worker-build",
      "/repo/model.pmx",
      "warn",
      expect.stringContaining("Worker parse failed: parse boom"),
    );
  });

  it("worker ok=false 无 error → warn 用 unknown 兜底", async () => {
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.resolve({ id: 1, ok: false }),
    });
    await parsePmxStage(c);
    expect(mmdDiagMock).toHaveBeenCalledWith(
      c.effectivePort,
      expect.anything(),
      expect.anything(),
      "warn",
      expect.stringContaining("Worker parse failed: unknown"),
    );
  });

  it("promise reject → warn（Worker parse threw，不逸出）", async () => {
    const c = pmxCtx({
      usePmxWorker: true,
      pmxParsePromise: Promise.reject(new Error("worker crash")),
    });
    await expect(parsePmxStage(c)).resolves.toBeUndefined();
    expect(mmdDiagMock).toHaveBeenCalledWith(
      c.effectivePort,
      "pmx-worker-build",
      "/repo/model.pmx",
      "warn",
      expect.stringContaining("Worker parse threw"),
    );
  });
});