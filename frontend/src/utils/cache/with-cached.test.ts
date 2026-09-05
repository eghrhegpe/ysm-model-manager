// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCached, invalidateCache, clearAllCache, getCacheTtlMs } from "./with-cached.ts";

beforeEach(() => {
  // 清除缓存状态
  clearAllCache();
});

describe("withCached", () => {
  it("首次调用执行 fn 并缓存结果", async () => {
    const fn = vi.fn(async () => 42);
    const result = await withCached("test-key", 60000, fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("同一 key 在 ttl 内命中缓存，不重新调用 fn", async () => {
    const fn = vi.fn(async () => 42);
    await withCached("test-key", 60000, fn);
    const result = await withCached("test-key", 60000, fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ttl=0 → 永不过期（文档契约）：多次调用命中缓存，fn 只执行一次", async () => {
    const fn = vi.fn(async () => "v1");
    await withCached("zero-ttl-key", 0, fn);
    // 契约「0 = 永不过期」→ 第二次调用应命中缓存（若实现为「0=不缓存」则 fn 二次执行）
    const result = await withCached("zero-ttl-key", 0, fn);
    expect(result).toBe("v1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("STALE 后台刷新用 ttl=0 写回 → 刷新后仍永不过期（refreshInBackground 路径）", async () => {
    const fn = vi.fn(async () => "v1");
    // 先以短 ttl 种入缓存并等待过期——否则 ttl=0 条目 expiryMs=MAX_SAFE_INTEGER
    // 永不「过期」，STALE 调用只会走缓存命中分支，refreshInBackground 永不触发
    //（空断言陷阱：原测试在同一 ttl=0 key 上调 STALE，断言恒真但路径不可达）
    await withCached("stale-refresh-zero-key", 10, fn);
    await new Promise((r) => setTimeout(r, 20)); // 等待过期
    // STALE：命中已过期条目 → 立即返回旧值并后台刷新（写回用 ttl=0 → 永不过期）
    const stale = await withCached("stale-refresh-zero-key", 0, fn, "STALE");
    expect(stale).toBe("v1"); // 返回旧值，不阻塞
    // 后台刷新是异步 fire-and-forget：等一拍后 fn 应被二次调用且缓存已用 ttl=0 写回
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(2); // seed 1 次 + 后台刷新 1 次
    // 刷新写回后仍永不过期：再过 ttl 时长仍命中（若 refresh 误用 ttl=0=不缓存则 fn 三调）
    await new Promise((r) => setTimeout(r, 30));
    const again = await withCached("stale-refresh-zero-key", 0, fn);
    expect(again).toBe("v1");
    expect(fn).toHaveBeenCalledTimes(2); // 命中，不再调 fn
  });

  it("ttl 过期后重新调用 fn", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    await withCached("ttl-key", 10, () => fn(1), "NORMAL");
    // 等待过期
    await new Promise((r) => setTimeout(r, 20));
    await withCached("ttl-key", 10, () => fn(100), "NORMAL");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("STALE 策略：过期时返回旧值并后台刷新", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      return callCount * 10;
    });
    await withCached("stale-key", 10, fn, "NORMAL");
    await new Promise((r) => setTimeout(r, 20));
    // STALE 调用：应返回旧值 10，fn 不应被同步阻塞
    const result = await withCached("stale-key", 10, fn, "STALE");
    expect(result).toBe(10);
    // fn 已在后台触发（异步），等待一下确认
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("FORCE 策略：忽略缓存强制重新计算", async () => {
    const fn = vi.fn(async () => 99);
    await withCached("force-key", 60000, fn);
    await withCached("force-key", 60000, fn, "FORCE");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("getCacheTtlMs 返回正确剩余时间", async () => {
    await withCached("ttl-measure", 5000, async () => "ok");
    const ttl = getCacheTtlMs("ttl-measure");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5000);
  });

  it("getCacheTtlMs 未命中返回 -1", () => {
    expect(getCacheTtlMs("nonexistent")).toBe(-1);
  });

  it("invalidateCache 清除指定 key", async () => {
    const fn = vi.fn(async () => 1);
    await withCached("inv-key", 60000, fn);
    invalidateCache("inv-key");
    await withCached("inv-key", 60000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });


  it("并发 miss 只执行一次 fn（stampede guard）", async () => {
    const fn = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 10));
      return "computed";
    });
    // 两个并发调用同一个 key
    const [r1, r2] = await Promise.all([
      withCached("stampede-key", 60000, fn),
      withCached("stampede-key", 60000, fn),
    ]);
    expect(r1).toBe("computed");
    expect(r2).toBe("computed");
    expect(fn).toHaveBeenCalledTimes(1); // 只执行一次
  });

  it("fn 抛错时不写入缓存，下次调用仍重试", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(withCached("fail-key", 60000, fn)).rejects.toThrow("boom");
    // 缓存应为空，下次调用重新执行 fn
    const result = await withCached("fail-key", 60000, fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
