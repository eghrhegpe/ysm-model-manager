// ===== DnD 锁 + 待导入队列测试（dnd-state.ts）=====
// 覆盖：DnDLock acquire/release、PendingImport setQueue/clear、bus 事件发射
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { DnDLock, PendingImport } from "./dnd-state.ts";

// 统一清理：每个用例前重置模块状态，避免跨用例污染
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  // 通过 bus 内部 listeners 直接清空，避免 off() 需要 handler 引用
  (bus as any).listeners = {};
});

describe("DnDLock — 锁状态", () => {
  it("初始状态为未锁定", () => {
    expect(DnDLock.locked).toBe(false);
  });

  it("acquire 成功返回 true 并锁定", () => {
    const acquired = DnDLock.acquire();
    expect(acquired).toBe(true);
    expect(DnDLock.locked).toBe(true);
    DnDLock.release();
  });

  it("已锁定时 acquire 返回 false", () => {
    DnDLock.acquire();
    const second = DnDLock.acquire();
    expect(second).toBe(false);
    expect(DnDLock.locked).toBe(true);
    DnDLock.release();
  });

  it("release 后状态恢复为未锁定", () => {
    DnDLock.acquire();
    DnDLock.release();
    expect(DnDLock.locked).toBe(false);
  });

  it("未锁定时 release 不抛错", () => {
    expect(() => DnDLock.release()).not.toThrow();
  });
});

describe("DnDLock — bus 事件", () => {
  it("acquire 时发射 dnd:lock-changed (locked: true)", () => {
    const handler = vi.fn();
    bus.on("dnd:lock-changed", handler);
    DnDLock.acquire();
    expect(handler).toHaveBeenCalledWith({ locked: true });
    DnDLock.release();
  });

  it("release 时发射 dnd:lock-changed (locked: false)", () => {
    const handler = vi.fn();
    bus.on("dnd:lock-changed", handler);
    DnDLock.acquire();
    handler.mockClear();
    DnDLock.release();
    expect(handler).toHaveBeenCalledWith({ locked: false });
  });
});

describe("PendingImport — 队列操作", () => {
  it("初始队列为空", () => {
    expect(PendingImport.queue).toEqual([]);
  });

  it("setQueue 设置队列并发射事件", () => {
    const handler = vi.fn();
    bus.on("import:pending-changed", handler);
    const files = [{ name: "a.ysm" }, { name: "b.ysm" }];
    PendingImport.setQueue(files);
    expect(PendingImport.queue).toEqual(files);
    expect(handler).toHaveBeenCalledWith({ count: 2 });
  });

  it("setQueue 传入 null 时队列为空数组", () => {
    const handler = vi.fn();
    bus.on("import:pending-changed", handler);
    PendingImport.setQueue(null as unknown as unknown[]);
    expect(PendingImport.queue).toEqual([]);
    expect(handler).toHaveBeenCalledWith({ count: 0 });
  });

  it("clear 清空队列并发射 count: 0", () => {
    const handler = vi.fn();
    bus.on("import:pending-changed", handler);
    PendingImport.setQueue([{ name: "a.ysm" }]);
    handler.mockClear();
    PendingImport.clear();
    expect(PendingImport.queue).toEqual([]);
    expect(handler).toHaveBeenCalledWith({ count: 0 });
  });
});
