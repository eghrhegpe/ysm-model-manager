// 覆盖：readPmxStats Worker 解析取 counts + 模块级缓存 + 失败降级。
// ADR-131 P2：MMD 详情卡统计数据源（PMX 文件级口径，标注区分渲染实测）。

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readPmxStats, _clearPmxStatsCache, type PmxFileStats } from "./mmd-detail-stats.ts";
import type { PmxParseResponse } from "./mmd-pmx-parser.worker.ts";

const hoisted = vi.hoisted(() => ({
  parseMock: vi.fn(),
  disposeMock: vi.fn(),
}));

vi.mock("./mmd-pmx-parser.ts", () => ({
  createPmxParser: () => ({
    parse: hoisted.parseMock,
    dispose: hoisted.disposeMock,
  }),
}));

/** 构造一个 ok 的 PmxParseResponse（counts 来自各 section） */
function okResp(overrides: Partial<PmxParseResponse> = {}): PmxParseResponse {
  return {
    id: 1,
    ok: true,
    vertices: { count: 1200, positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), boneIndices: new Uint8Array(0), boneWeights: new Float32Array(0) },
    faces: { count: 2400, indices: new Uint32Array(0) },
    materials: [{ name: "m0", diffuse: [1, 1, 1, 1], specular: [1, 1, 1], shininess: 1, ambient: [1, 1, 1], textureIndex: -1, toonIndex: -1, flags: 0, edgeColor: [0, 0, 0, 1], edgeSize: 1, sphereIndex: -1, sphereMode: 0, sharedToon: 0 }],
    bones: [{ name: "b0", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false }],
    morphs: [{ name: "morph0", type: 1, elements: [] }],
    ...overrides,
  };
}

const readFn = (v: string | null) => vi.fn().mockResolvedValue(v ?? null) as (p: string) => Promise<string | null>;

describe("readPmxStats", () => {
  beforeEach(() => {
    _clearPmxStatsCache();
    hoisted.parseMock.mockReset();
    hoisted.disposeMock.mockReset();
  });

  it("Worker ok → 返回骨架 counts（顶点/面/骨骼/材质/表情）", async () => {
    hoisted.parseMock.mockResolvedValue(okResp());
    const stats = await readPmxStats("/m/miku.pmx", readFn(btoa("PMX")));
    expect(stats).toEqual({
      vertices: 1200,
      faces: 2400,
      bones: 1,
      materials: 1,
      morphs: 1,
    } satisfies PmxFileStats);
    expect(hoisted.disposeMock).toHaveBeenCalled();
  });

  it("模块级缓存：同 path 二次调用不重复解析（Worker 只调一次）", async () => {
    hoisted.parseMock.mockResolvedValue(okResp());
    const fn = readFn(btoa("PMX"));
    await readPmxStats("/m/cached.pmx", fn);
    await readPmxStats("/m/cached.pmx", fn);
    expect(hoisted.parseMock).toHaveBeenCalledTimes(1);
  });

  it("readFn 返回空 → null（不触发 Worker）", async () => {
    const stats = await readPmxStats("/m/missing.pmx", readFn(null));
    expect(stats).toBeNull();
    expect(hoisted.parseMock).not.toHaveBeenCalled();
  });

  it("Worker 解析失败（ok:false）→ null", async () => {
    hoisted.parseMock.mockResolvedValue({ id: 1, ok: false, error: "bad pmx" });
    const stats = await readPmxStats("/m/bad.pmx", readFn(btoa("BAD")));
    expect(stats).toBeNull();
  });
});