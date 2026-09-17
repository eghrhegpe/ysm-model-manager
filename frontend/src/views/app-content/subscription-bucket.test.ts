// ===== SubscriptionBucket 契约测试（ADR-261）=====
// 本文件锁定 addPageOnce / addGlobalOnce 的**生命周期契约**——它们取代了
// 「各页在 AppContentState 上开布尔标志 + 由 index.ts 在 lang:changed 手工复位」的旧模式，
// 故必须证明两点同时成立：
//   ① 同一代内重复注册 → 幂等（不重复挂监听）；
//   ② 世代重置（cleanupPage / cleanupAll）后 → **可再次注册**。
// ② 是旧模式的真正难点：旧标志的复位时机必须与面板世代同步，散落在页与协调器两处；
// 一旦漏复位，页面会在语言热切换后永久失去监听（僵尸页的孪生缺陷：DOM 在、事件不在）。
import { describe, it, expect, vi } from "vitest";
import { SubscriptionBucket } from "./subscription-bucket.ts";

describe("SubscriptionBucket — addPageOnce / addGlobalOnce 幂等契约", () => {
  it("addPageOnce：同 key 二次注册 → 只挂一次", () => {
    const subs = new SubscriptionBucket();
    const fn = vi.fn();
    subs.addPageOnce("instances:package-selected", fn);
    subs.addPageOnce("instances:package-selected", fn);
    expect(subs.pageUnsubs).toHaveLength(1);
  });

  it("addPageOnce：不同 key → 各自注册（key 是身份，不是去重池）", () => {
    const subs = new SubscriptionBucket();
    subs.addPageOnce("a", vi.fn());
    subs.addPageOnce("b", vi.fn());
    expect(subs.pageUnsubs).toHaveLength(2);
  });

  it("addPageOnce：cleanupPage 后可再次注册（lang:changed 重建的关键契约）", () => {
    const subs = new SubscriptionBucket();
    subs.addPageOnce("instances:package-selected", vi.fn());
    expect(subs.pageUnsubs).toHaveLength(1);

    subs.cleanupPage(); // ← lang:changed 全量重建
    expect(subs.pageUnsubs).toHaveLength(0);

    // 关键：若 drainPage 未清 pageKeys，这里会被静默吞掉 → 页面永久失去监听
    subs.addPageOnce("instances:package-selected", vi.fn());
    expect(subs.pageUnsubs, "世代重建后必须允许重新注册").toHaveLength(1);
  });

  it("addGlobalOnce：同 key 幂等；cleanupAll 后可再注册", () => {
    const subs = new SubscriptionBucket();
    subs.addGlobalOnce("workshop:avatar-refresh", vi.fn());
    subs.addGlobalOnce("workshop:avatar-refresh", vi.fn());
    expect(subs.globalUnsubs).toHaveLength(1);

    subs.cleanupAll();
    expect(subs.globalUnsubs).toHaveLength(0);

    subs.addGlobalOnce("workshop:avatar-refresh", vi.fn());
    expect(subs.globalUnsubs, "组件重建后必须允许重新注册").toHaveLength(1);
  });

  it("addPageOnce 注册的清理项随 cleanupPage 一并执行（同步 + 异步）", async () => {
    const subs = new SubscriptionBucket();
    const sync = vi.fn();
    const asyncFn = vi.fn(async () => {});
    subs.addPageOnce("k1", sync);
    subs.addPageOnce("k2", asyncFn);

    subs.cleanupPage();
    await Promise.resolve();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it("单项失败不中断拆除：同步抛错 + 异步 reject 都不逸出，后续项照常执行", async () => {
    const subs = new SubscriptionBucket();
    const later = vi.fn();
    subs.addPage(
      vi.fn(() => {
        throw new Error("sync boom");
      }),
    );
    subs.addPage(async () => {
      throw new Error("async boom");
    });
    subs.addPage(later);

    expect(() => subs.cleanupPage()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(later, "前项失败不得中断后续清理").toHaveBeenCalledTimes(1);
  });
});
