// @vitest-environment node
// ===== 忙锁原语测试（lock.ts）=====
import { describe, it, expect, vi } from "vitest";
import { createBusyLock, withLock } from "./lock.ts";

describe("createBusyLock — 抢锁/释放", () => {
  it("初始空闲：首次 tryStart 返回 true", () => {
    const lock = createBusyLock();
    expect(lock.tryStart()).toBe(true);
  });

  it("占用期间 tryStart 返回 false（连点互斥）", () => {
    const lock = createBusyLock();
    expect(lock.tryStart()).toBe(true);
    expect(lock.tryStart()).toBe(false);
    expect(lock.tryStart()).toBe(false);
  });

  it("finish 后可再次抢锁", () => {
    const lock = createBusyLock();
    expect(lock.tryStart()).toBe(true);
    lock.finish();
    expect(lock.tryStart()).toBe(true);
  });

  it("多实例互不耦合（各持各的 flag）", () => {
    const a = createBusyLock();
    const b = createBusyLock();
    expect(a.tryStart()).toBe(true);
    expect(b.tryStart()).toBe(true); // b 不受 a 占用影响
    expect(a.tryStart()).toBe(false);
  });
});

describe("withLock — 组合子自动释放", () => {
  it("成功路径：执行 fn 并自动释放锁", async () => {
    const lock = createBusyLock();
    const fn = vi.fn(async () => 42);
    const out = await withLock(lock, fn);
    expect(out).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.tryStart()).toBe(true); // 已释放
  });

  it("fn 抛错路径：finally 仍释放锁", async () => {
    const lock = createBusyLock();
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withLock(lock, fn)).rejects.toThrow("boom");
    expect(lock.tryStart()).toBe(true); // 异常后锁已释放，可再次抢
  });

  it("锁被占用：不执行 fn，返回 null（调用方据 null 走「被跳过」分支）", async () => {
    const lock = createBusyLock();
    const fn = vi.fn(async () => 1);
    expect(lock.tryStart()).toBe(true); // 外部先占用
    const out = await withLock(lock, fn);
    expect(out).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("占用期间的并发调用：仅首个执行，其余返回 null", async () => {
    const lock = createBusyLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fn = vi.fn(async () => {
      await gate; // 首个调用挂起期间
      return "done";
    });
    const p1 = withLock(lock, fn);
    const p2 = withLock(lock, fn);
    const p3 = withLock(lock, fn);
    release();
    expect(await p1).toBe("done");
    expect(await p2).toBeNull();
    expect(await p3).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.tryStart()).toBe(true); // 全部结束后已释放
  });
});
