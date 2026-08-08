// ===== 预览缓存测试（cache.ts，模块级状态用 vi.resetModules 隔离）=====
// 覆盖：cacheGet/cacheSet、同 key 覆盖不误 evict、FIFO 淘汰、evict 回调
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type CacheModule = typeof import("./cache.ts");

async function freshModule(): Promise<CacheModule> {
  vi.resetModules();
  return import("./cache.ts");
}

describe("cacheGet / cacheSet", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("未命中返回 null；set 后可读回", async () => {
    const m = await freshModule();
    expect(m.cacheGet("/a.ysm")).toBeNull();

    const data = { texture: "data:image/png;base64,x", geometry: { textures: [] } };
    m.cacheSet("/a.ysm", data);
    expect(m.cacheGet("/a.ysm")).toBe(data);
  });

  it("同 key 覆盖新值，不触发 evict（新值保留旧 blob URL）", async () => {
    const m = await freshModule();
    const onEvict = vi.fn();
    m.cacheSetEvictHandler(onEvict);

    const blob = "blob:abc";
    m.cacheSet("/a.ysm", { texture: blob });
    m.cacheSet("/a.ysm", { texture: blob }); // 同引用 → 不 evict
    expect(onEvict).not.toHaveBeenCalled();
    expect(m.cacheGet("/a.ysm")).toEqual({ texture: blob });
  });

  it("同 key 覆盖且新值丢弃旧 blob URL → 触发 evict", async () => {
    const m = await freshModule();
    const onEvict = vi.fn();
    m.cacheSetEvictHandler(onEvict);

    m.cacheSet("/a.ysm", { texture: "blob:old" });
    m.cacheSet("/a.ysm", { texture: "data:new" });
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("/a.ysm", expect.objectContaining({ texture: "blob:old" }));
  });

  it("超出上限 FIFO 淘汰最早条目", async () => {
    const m = await freshModule();
    const onEvict = vi.fn();
    m.cacheSetEvictHandler(onEvict);

    for (let i = 0; i < 52; i++) m.cacheSet(`/p${i}.ysm`, { texture: `blob:${i}` });

    // 最早两条被淘汰
    expect(m.cacheGet("/p0.ysm")).toBeNull();
    expect(m.cacheGet("/p1.ysm")).toBeNull();
    expect(m.cacheGet("/p51.ysm")).not.toBeNull();
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict.mock.calls[0][0]).toBe("/p0.ysm");
  });
});
