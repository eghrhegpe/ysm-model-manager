// ===== sync-flow 静默等待（waitBusQuiet）直测 =====
// 背景（2026-10 锐评修复）：原实现静默期只剩 30s 超时兜底——done 先于订阅发出
// 即错过，一条已死在途能把多包推送循环卡满半分钟。修复后双轨：非 skipped done
// 即 resolve；宽限期（2s）内零 done 判定通道空闲放行。
// 本文件用真实定时器验语义分支（断言窗口与 30s 旧超时量级可分，2s 宽限不拖慢套件）。
import { describe, it, expect, vi, afterEach } from "vitest";

// 隔离 backend 桥（launcher-detect.test.ts 同款）：sync-flow 模块图经
// directory-picker / backend-deps 触到 Wails 绑定，本文件只锁 bus 静默等待逻辑
vi.mock("@/backend/app.ts", () => ({ getApp: vi.fn() }));
vi.mock("@/backend/directory-picker.ts", () => ({ pickDirectory: vi.fn() }));

import { bus } from "@/bus";
import { nextPushToken, pruneCheckedSets, waitBusQuiet } from "./sync-flow.ts";
import type { SidebarInstance } from "./data.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitBusQuiet", () => {
  it("收到非 skipped done → 立即 resolve", async () => {
    const p = waitBusQuiet();
    bus.emit("sync:download:done", { token: "t1" });
    await expect(p).resolves.toBeUndefined();
  });

  it("skipped done 不解除等待，后续非 skipped done 才 resolve", async () => {
    const p = waitBusQuiet();
    bus.emit("sync:download:done", { token: "t2", skipped: true });
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // skipped 被忽略且宽限（2s）未到
    bus.emit("sync:download:done", { token: "t3" });
    await expect(p).resolves.toBeUndefined();
  });

  it("静默（done 竞态错过）→ 宽限期放行，不干等 30s 旧超时", async () => {
    const start = Date.now();
    await waitBusQuiet(); // 无任何 done 事件 → 只能走宽限期分支
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000); // 远小于旧 SYNC_TIMEOUT_MS=30s（2s 宽限 + 调度余量）
  });
});

// P1 修复回归锁（2026-10 锐评）：pushOne 的回执 token 原用 `${ins}:${rt}:${Date.now()}`
// ——同毫秒并发的两次推送 token 相同，bus 回执匹配错位致一个 promise 提前 resolve、
// 另一个干等 30s 超时。现改模块单调序号：格式仍带实例/类型前缀，序号永不碰撞。
describe("nextPushToken（序号防同毫秒串台）", () => {
  it("携带实例名与 rtype 前缀（回执可读、诊断可定位）", () => {
    expect(nextPushToken("insA", "ysm")).toMatch(/^insA:ysm:\d+$/);
  });

  it("同一实例同一类型连续调用 → token 互不相同（同毫秒也不碰撞）", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) tokens.add(nextPushToken("insA", "ysm"));
    expect(tokens.size).toBe(50);
  });

  // P2 加固（2026-10 复核）：上方用例在真时钟下若退化回 Date.now()，紧循环跨越毫秒
  // 边界仍常绿——概率性断言抓不住病。固定系统时间把同毫秒变成必然：50 连发唯一性
  // 只能由单调序号保证，Date.now() 实现此处必红。
  it("固定同一毫秒连续调用 → 仍互不相同（单调序号，非时间戳）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00Z"));
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) tokens.add(nextPushToken("insA", "ysm"));
    expect(tokens.size).toBe(50);
    vi.useRealTimers();
  });

  it("不同实例/类型的 token 也不同", () => {
    expect(nextPushToken("insA", "ysm")).not.toBe(nextPushToken("insB", "ysm"));
    expect(nextPushToken("insA", "ysm")).not.toBe(nextPushToken("insA", "vrm"));
  });
});

// P1 修复回归锁（2026-10 锐评）：勾选集合按 rtype 存实例名，实例被删除后名字
// 永远留在集合里（幽灵名）——重名实例再现时会被静默勾选，集合也只涨不消。
// pruneCheckedSets 在每次成功 reload 后把不在最新列表里的名字修剪掉。
describe("pruneCheckedSets（幽灵名修剪）", () => {
  function inst(name: string): SidebarInstance {
    return {
      name,
      dir: `/mc/instances/${name}`,
      exists: true,
      hasMod: true,
      status: "complete",
      synced: 1,
      missing: 0,
      extra: 0,
      disabled: 0,
      rtype: "ysm",
    };
  }

  function makeSets(entries: Array<[string, string[]]>): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const [rtype, names] of entries) m.set(rtype, new Set(names));
    return m;
  }

  it("已删除实例名被修剪，存活实例名保留", () => {
    const sets = makeSets([
      ["ysm", ["live", "ghost"]],
      ["vrm", ["other"]],
    ]);
    pruneCheckedSets("ysm", [inst("live")], () => sets);

    expect([...sets.get("ysm")!]).toEqual(["live"]);
    // 其他 rtype 的集合不受影响（按 rtype 隔离修剪）
    expect([...sets.get("vrm")!]).toEqual(["other"]);
  });

  it("空实例列表 → 不修剪（可能是加载失败/未配置 mcRoot 的空结果，保守保留）", () => {
    const sets = makeSets([["ysm", ["live"]]]);
    pruneCheckedSets("ysm", [], () => sets);
    expect([...sets.get("ysm")!]).toEqual(["live"]);
  });

  it("无该 rtype 的集合 / 空集合 → 无操作不建桶", () => {
    // 空集合场景：有桶但无名字 → 不建新桶、不报错
    const emptySets = new Map<string, Set<string>>([["ysm", new Set()]]);
    pruneCheckedSets("ysm", [inst("a")], () => emptySets);
    expect(emptySets.has("vrm")).toBe(false);

    // 完全不存在的 rtype：不得创建新桶
    const noBucket = makeSets([["ysm", ["a"]]]);
    pruneCheckedSets("vrm", [inst("a")], () => noBucket);
    expect(noBucket.has("vrm")).toBe(false);
  });
});
