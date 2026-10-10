// @vitest-environment node
// ===== wasm-decode 纹理/头像同名键覆盖归属补测（decoder 轮 F5，2026-10-11）=====
// F5：collectTexturesAndAvatars 以「去扩展名文件名」为键，同名不同目录纹理静默互相
// 覆盖——被覆盖的 blob URL 无登记、无释放（revokeTexAccumBlobs 只扫最终值），
// 成功/失败路径都泄漏。collectJsonSpecTextures 同族（pendingBlobUrls 失败路径
// 全登记，但成功路径 clear 后覆盖者同样逃逸）。
// 修法：覆盖发生时立即 revoke 被覆盖者（交付者仍按既有归属走）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm-decode.ts";

const { initMock, decodeMemoryMock, readFileBytesMock, memfsMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
  memfsMock: vi.fn(),
}));

vi.mock("@/wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: memfsMock,
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: readFileBytesMock,
    CacheModelAvatars: vi.fn().mockResolvedValue(undefined),
  }),
}));

const encoder = new TextEncoder();

/** 构造一个可被 parseBedrockGeometryFromJSON 解析的 main.json（1 bone，成功路径） */
const MAIN_JSON = JSON.stringify({
  format_version: "1.16.0",
  "minecraft:geometry": [
    {
      description: { identifier: "geometry.test" },
      bones: [{ name: "root", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }] }],
    },
  ],
});

function spyBlobUrls(): { created: string[]; revoked: string[] } {
  const created: string[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const u = `blob:test-${created.length}`;
    created.push(u);
    return u;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
    revoked.push(u);
  });
  return { created, revoked };
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = URL.createObjectURL || (() => "blob:mock");
  URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
  readFileBytesMock.mockResolvedValue("AQID");
  decodeMemoryMock.mockResolvedValue([]);
  memfsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("wasm-decode — 同名纹理键覆盖（F5）", () => {
  it("同名不同目录纹理 → 被覆盖者立即 revoke，交付者保留并落到 geometry", async () => {
    const ysmJson = {
      spec: {},
      files: { player: { model: "models/main.json", texture: null } },
      metadata: { authors: [] },
      properties: { texture_width: 64, texture_height: 64 },
      minecraft: { geometry: [] },
    };
    const files = [
      { path: "ysm.json", data: encoder.encode(JSON.stringify(ysmJson)) },
      { path: "models/main.json", data: encoder.encode(MAIN_JSON) },
      { path: "textures/skin/main.png", data: encoder.encode("PNG1") },
      { path: "arm/textures/main.png", data: encoder.encode("PNG2") },
    ];
    decodeMemoryMock.mockResolvedValue(files);

    const { created, revoked } = spyBlobUrls();
    const result = await decodeYsmViaWasm("/repo/collide.ysm");

    expect(created).toHaveLength(2); // 两个同名纹理各创建一次
    expect(revoked, "被覆盖者必须立即释放（F5：不释放则 blob 永久泄漏）").toEqual([
      created[0],
    ]);
    // 交付者（最后覆盖者）保留：已挂到 geometry.textures 供纹理加载消费
    expect(result?.geometry?.textures).toEqual([created[1]]);
  });

  it("同名不同目录头像 → 被覆盖者立即 revoke，最终 avatarUrl 用交付者", async () => {
    const ysmJson = {
      spec: {},
      files: { player: { model: "models/main.json", texture: null } },
      metadata: {
        authors: [{ name: "alice", role: "author", avatar: "avatar/a.png" }],
      },
      properties: {},
      minecraft: { geometry: [] },
    };
    const files = [
      { path: "ysm.json", data: encoder.encode(JSON.stringify(ysmJson)) },
      { path: "models/main.json", data: encoder.encode(MAIN_JSON) },
      { path: "avatar/a.png", data: encoder.encode("PNG1") },
      { path: "avatar/old/a.png", data: encoder.encode("PNG2") },
    ];
    decodeMemoryMock.mockResolvedValue(files);

    const { created, revoked } = spyBlobUrls();
    const result = await decodeYsmViaWasm("/repo/collide-avatar.ysm");

    expect(created).toHaveLength(2);
    expect(revoked, "被覆盖头像必须立即释放").toEqual([created[0]]);
    expect(result?.authors?.[0]?.avatarUrl).toBe(created[1]); // 交付者保留（由缓存 evict 释放）
  });
});
