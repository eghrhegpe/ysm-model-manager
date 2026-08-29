// @vitest-environment node
// ===== mc-tints.ts 契约测试 =====
// 覆盖：loadMcTints 的缓存 / inflight 去重 / 失败语义，getTintColorSync 的
// dead_bush 固定色、表驱动非零色、零色哨兵降级 DEFAULT_TINTS、未知类别回退 grass。
//
// 模块级 cache/inflight 有状态，用例按依赖顺序排布：
//   ① 未加载（cache=null）→ ② 失败语义（resetModules 隔离实例，不污染静态实例）
//   → ③ 成功加载建缓存 → ④ 表驱动查询。
import { describe, it, expect, vi } from "vitest";
import { loadMcTints, getTintColorSync } from "./mc-tints.ts";

/** DEFAULT_TINTS 权威值（与源码常量一致，防漂移） */
const DEFAULTS = {
  grass: 0x91bd59,
  foliage: 0x77ab2f,
  water: 0x3f76e4,
  dead_bush: 0x7c4e08,
};

/** vendored tints 表 fixture：非零 = 真实固定色；0 = 哨兵（需 colormap 采样） */
const TINTS_TABLE = {
  grass: {
    data: [
      { keys: ["extreme_hills", "mountains"], color: 0x8ab689 },
      { keys: ["plains"], color: 0 }, // 默认 biome 哨兵
    ],
  },
  water: {
    data: [
      { keys: ["frozen"], color: 0x3938c9 },
      { keys: ["warm"], color: 0 },
    ],
  },
};

describe("getTintColorSync（未加载 vendored 表，cache=null）", () => {
  it("grass / foliage / water 走 DEFAULT_TINTS（plains 权威色）", () => {
    expect(getTintColorSync("grass")).toBe(DEFAULTS.grass);
    expect(getTintColorSync("foliage")).toBe(DEFAULTS.foliage);
    expect(getTintColorSync("water")).toBe(DEFAULTS.water);
  });

  it("dead_bush 固定色，与 biome 无关", () => {
    expect(getTintColorSync("dead_bush")).toBe(DEFAULTS.dead_bush);
    expect(getTintColorSync("dead_bush", "desert")).toBe(DEFAULTS.dead_bush);
  });

  it("未知类别 → 回退 grass 默认色", () => {
    expect(getTintColorSync("vine")).toBe(DEFAULTS.grass);
  });
});

describe("loadMcTints", () => {
  it("HTTP 失败：抛 HTTP <status>；失败清空 inflight → 重试重新 fetch（不复用 rejected promise）", async () => {
    // resetModules + 动态导入：隔离实例，不污染本文件静态实例的 cache
    vi.resetModules();
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const mod = await import("./mc-tints.ts");
      await expect(mod.loadMcTints("1.20")).rejects.toThrow("HTTP 404");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("mc-tints/1.20.json");

      // 失败后 inflight 已清空 → 再次调用重新发 fetch（而非复用 rejected promise）
      fetchMock.mockClear();
      await expect(mod.loadMcTints("1.21.4")).rejects.toThrow("HTTP 404");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("mc-tints/1.21.4.json");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("成功加载：fetch 一次、并发共享 inflight、结果写入缓存", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => TINTS_TABLE }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      const [a, b] = await Promise.all([loadMcTints(), loadMcTints()]);
      expect(fetchMock).toHaveBeenCalledTimes(1); // inflight 去重
      expect(String(fetchMock.mock.calls[0][0])).toContain("mc-tints/1.21.4.json");
      expect(a).toEqual(TINTS_TABLE);
      expect(b).toBe(a);

      // 缓存命中：不再发 fetch
      const c = await loadMcTints();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(c).toBe(a);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("getTintColorSync（缓存已加载，表驱动）", () => {
  it("例外 biome 非零固定色 → 直接采用表值", () => {
    expect(getTintColorSync("grass", "extreme_hills")).toBe(0x8ab689);
    expect(getTintColorSync("grass", "mountains")).toBe(0x8ab689);
    expect(getTintColorSync("water", "frozen")).toBe(0x3938c9);
  });

  it("表色为 0（哨兵）→ 降级 DEFAULT_TINTS", () => {
    expect(getTintColorSync("grass", "plains")).toBe(DEFAULTS.grass);
    expect(getTintColorSync("water", "warm")).toBe(DEFAULTS.water);
  });

  it("biome 不在表 keys 中 → 降级 DEFAULT_TINTS", () => {
    expect(getTintColorSync("grass", "desert")).toBe(DEFAULTS.grass);
    expect(getTintColorSync("water", "lukewarm")).toBe(DEFAULTS.water);
  });

  it("dead_bush 短路优先于表查询（固定色）", () => {
    expect(getTintColorSync("dead_bush", "extreme_hills")).toBe(DEFAULTS.dead_bush);
  });

  it("表里没有的类别 → 回退 grass 默认色", () => {
    expect(getTintColorSync("vine", "extreme_hills")).toBe(DEFAULTS.grass);
  });
});
