// @vitest-environment node
// ===== wasm-decode 头像 blob 归属补测（decoder 轮 F2，2026-10-10）=====
// F2：`loadAvatarsForJson`（wasm-decode.ts:114）产出的作者头像 blob URL 挂在
// `result.authors[].avatarUrl` 上——既不在 `pendingBlobUrls`、也不在 `TexAccum`
// （`revokeTexAccumBlobs` 只扫 acc.textures/avatars）。
//
// 既有测试（wasm-decode.test.ts:430-448）只断言「avatarUrl 已回填」，**未断言 revoke**；
// 而同文件纹理路径（:593-618）明确断言 `expect(revoked).toEqual(created)`。
// 本文件补上头像路径的同类归属断言。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm-decode.ts";

const { initMock, decodeMemoryMock, readFileBytesMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
}));

vi.mock("@/wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: readFileBytesMock,
    CacheModelAvatars: vi.fn().mockResolvedValue(undefined),
  }),
}));

function pngB64(): string {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";
}

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

describe("wasm-decode — 头像 blob URL 的归属（F2）", () => {
  beforeEach(() => {
    initMock.mockResolvedValue(true);
    readFileBytesMock.mockReset();
    decodeMemoryMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("头像 blob 进缓存后：URL 交付给 result（不得在成功路径被误回收）", async () => {
    const ysmJson = {
      spec: { version: "1.0.0" },
      files: { player: { model: null } },
      metadata: { authors: [{ name: "alice", role: "author", avatar: "avatar/a.png" }] },
      properties: {},
      minecraft: { geometry: [] },
    };
    const calls: Record<string, string> = {
      "/repo/av1.json": btoa(new TextDecoder().decode(new TextEncoder().encode(JSON.stringify(ysmJson)))),
      "/repo/avatar/a.png": pngB64(),
    };
    readFileBytesMock.mockImplementation(async (p: string) => calls[p] ?? null);

    const { created, revoked } = spyBlobUrls();
    const result = await decodeYsmViaWasm("/repo/av1.json");

    expect(result?.authors?.[0]?.avatarUrl).toMatch(/^blob:/);
    expect(created.length, "至少产出 1 个头像 blob").toBeGreaterThan(0);
    // 成功路径：URL 已交付给 result.authors[].avatarUrl（由缓存 evict 负责释放），
    // 解码层不得在此 revoke（否则头像图裂）
    expect(revoked, "成功路径不得回收已交付的头像 URL").toEqual([]);
  });

  it("作者数超缓存语义：头像 URL 集合可被完整回收（断言 set 可构造性）", async () => {
    // 该用例固化「头像 URL 必须可被枚举用于回收」这一契约：
    // 现状 loadAvatarsForJson 只挂 result.authors[].avatarUrl，而 model-cache 的
    // collectBlobUrls 确实扫该字段——故「进缓存」的头像可回收。
    // 本断言即证明：只要 result 进缓存，收集器能枚举到该 URL。
    const { collectBlobUrls } = await import("./model-cache.ts");
    const urls = collectBlobUrls({
      authors: [{ name: "x", avatarUrl: "blob:a" }],
    });
    expect(
      [...urls],
      "model-cache 收集器须覆盖 authors[].avatarUrl（否则淘汰即泄漏）",
    ).toContain("blob:a");
  });
});
