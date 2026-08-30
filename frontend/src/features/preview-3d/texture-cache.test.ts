// ===== TextureCache 险恶测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Texture } from "three";
import { TextureCacheImpl } from "./texture-cache.ts";

describe("TextureCache 险恶测试", () => {
  let cache: TextureCacheImpl;

  beforeEach(() => {
    cache = new TextureCacheImpl();
  });

  const makeFakeTex = (): Texture =>
    ({ dispose: vi.fn() }) as unknown as Texture;

  it("acquire 同 url 两次 → 返回同一实例", () => {
    const fakeTex = makeFakeTex();
    const make = vi.fn(() => fakeTex);
    const t1 = cache.acquire("a.png", make);
    const t2 = cache.acquire("a.png", make);
    expect(t1).toBe(t2);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("acquire 不同 url → 返回不同实例", () => {
    const make = vi.fn((u: string) => ({ id: u, dispose: vi.fn() }) as unknown as Texture);
    const t1 = cache.acquire("a.png", make);
    const t2 = cache.acquire("b.png", make);
    expect(t1).not.toBe(t2);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("release 后 acquire 同 url → 返回缓存实例（归零保留）", () => {
    const fakeTex = makeFakeTex();
    const make = vi.fn(() => fakeTex);
    cache.acquire("a.png", make);
    cache.release("a.png");
    const t2 = cache.acquire("a.png", make);
    expect(t2).toBe(fakeTex);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("release 未 acquire 的 url → 不抛", () => {
    expect(() => cache.release("ghost.png")).not.toThrow();
  });

  it("invalidate 释放坏纹理并允许同 URL 重新创建", () => {
    const broken = makeFakeTex();
    cache.acquire("broken.png", () => broken);
    cache.invalidate("broken.png");
    const replacement = makeFakeTex();
    const got = cache.acquire("broken.png", () => replacement);

    expect(broken.dispose).toHaveBeenCalledTimes(1);
    expect(got).toBe(replacement);
    expect(cache.size).toBe(1);
  });

  it("disposeAll 释放所有缓存纹理", () => {
    const t1 = makeFakeTex();
    const t2 = makeFakeTex();
    cache.acquire("a.png", () => t1);
    cache.acquire("b.png", () => t2);
    cache.disposeAll();
    expect(t1.dispose).toHaveBeenCalledTimes(1);
    expect(t2.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });

  it("disposeAll 后 acquire → 重新创建", () => {
    const t1 = makeFakeTex();
    const make = vi.fn(() => t1);
    cache.acquire("a.png", make);
    cache.disposeAll();
    const t2 = makeFakeTex();
    cache.acquire("a.png", () => t2);
    expect(cache.size).toBe(1);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("多次 release 同 url → refs 不会变负", () => {
    const fakeTex = makeFakeTex();
    cache.acquire("a.png", () => fakeTex);
    cache.release("a.png");
    cache.release("a.png");
    cache.release("a.png");
    const t2 = cache.acquire("a.png", vi.fn(() => makeFakeTex()));
    expect(t2).toBe(fakeTex);
  });

  it("size 正确反映缓存数量", () => {
    expect(cache.size).toBe(0);
    cache.acquire("a.png", () => makeFakeTex());
    expect(cache.size).toBe(1);
    cache.acquire("b.png", () => makeFakeTex());
    expect(cache.size).toBe(2);
    cache.disposeAll();
    expect(cache.size).toBe(0);
  });
});

describe("TextureCache 容量上限（审核 P3-3）", () => {
  /** 记录各 url 纹理 dispose 情况的工厂 */
  function makeTrackingFactory(disposed: string[]) {
    return vi.fn((u: string) =>
      ({ id: u, dispose: () => disposed.push(u) }) as unknown as Texture,
    );
  }

  it("超出上限时淘汰 refs==0 的最久未用条目并 dispose", () => {
    const c = new TextureCacheImpl(2);
    const disposed: string[] = [];
    const mk = makeTrackingFactory(disposed);
    c.acquire("a.png", mk);
    c.acquire("b.png", mk);
    c.release("a.png"); // a 归零 → 可淘汰
    c.acquire("c.png", mk);
    expect(c.size).toBe(2); // a 被淘汰，b/c 保留
    expect(disposed).toEqual(["a.png"]);
    // a 再次 acquire → 重新创建（未被缓存复用）
    const callsBefore = mk.mock.calls.length;
    c.acquire("a.png", mk);
    expect(mk.mock.calls.length).toBe(callsBefore + 1);
  });

  it("全部 refs>0 时超限不淘汰（保留跨模型复用语义）", () => {
    const c = new TextureCacheImpl(2);
    const disposed: string[] = [];
    const mk = makeTrackingFactory(disposed);
    c.acquire("a.png", mk);
    c.acquire("b.png", mk);
    c.acquire("c.png", mk); // 无归零条目可淘汰
    expect(c.size).toBe(3);
    expect(disposed).toEqual([]);
    c.disposeAll();
    expect(c.size).toBe(0);
  });

  it("acquire 命中刷新访问序：最久未用先淘汰（LRU）", () => {
    const c = new TextureCacheImpl(2);
    const disposed: string[] = [];
    const mk = makeTrackingFactory(disposed);
    c.acquire("a.png", mk);
    c.acquire("b.png", mk);
    c.release("a.png");
    c.release("b.png");
    c.acquire("a.png", mk); // a 刷新为最近使用
    c.acquire("c.png", mk); // 淘汰 b（最久未用）
    expect(disposed).toEqual(["b.png"]);
    expect(c.size).toBe(2);
  });

  it("默认构造（单例口径）不受上限影响，行为与旧版一致", () => {
    const c = new TextureCacheImpl();
    const fakeTex = { dispose: vi.fn() } as unknown as Texture;
    c.acquire("a.png", () => fakeTex);
    c.release("a.png");
    const again = c.acquire("a.png", () => ({ dispose: vi.fn() }) as unknown as Texture);
    expect(again).toBe(fakeTex); // 归零保留复用
  });
});
