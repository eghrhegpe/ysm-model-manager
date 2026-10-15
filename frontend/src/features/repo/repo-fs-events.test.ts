// @vitest-environment node
// ===== repo-fs-events.ts 回归锁（止血 2026-10-15 A3）=====
// 覆盖：EventsOn 幂等注册 / Wails 事件 → 二级 800ms 防抖 → bus.emit("repo:fs-changed")
// / 防抖窗口内多触发合并为一次 / cleanup 清在途防抖 + 复位注册位。
// ⚠️ 同文件共享模块实例（registered 位跨用例存活）：cleanup 统一登记到
// pendingCleanup，afterEach 复位——用例中途失败也复位，防状态串扰到下一例。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";

const { mocks } = vi.hoisted(() => {
  const on = vi.fn(() => () => {});
  const mocks = { on };
  return { mocks };
});

vi.mock("@/backend/runtime.ts", () => ({
  Events: { On: mocks.on },
}));

vi.mock("@/utils/debug/debug.ts", () => ({ dbg: () => {} }));

import { registerRepoFsEvents } from "./repo-fs-events.ts";

function lastOnCb(): ((...a: unknown[]) => void) | undefined {
  // vi.fn 泛型推导出零参 calls 表（[]），经 unknown 桥接取真实调用记录
  const calls = (mocks.on as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[calls.length - 1]?.[1] as ((...a: unknown[]) => void) | undefined;
}

describe("registerRepoFsEvents（repo:fs-changed 事件桥）", () => {
  let pendingCleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.on.mockClear();
    mocks.on.mockImplementation(() => () => {});
  });
  afterEach(() => {
    pendingCleanup?.();
    pendingCleanup = null;
    vi.useRealTimers();
  });

  it("注册一次 → EventsOn 恰 1 次；幂等再调不重复注册；cleanup 复位注册位", () => {
    const c1 = registerRepoFsEvents();
    pendingCleanup = c1;
    registerRepoFsEvents(); // 幂等分支：不二次 EventsOn（仅首个调用方持有效 cleanup）
    expect(mocks.on).toHaveBeenCalledTimes(1);
    expect(mocks.on).toHaveBeenCalledWith("repo:fs-changed", expect.any(Function));
    c1(); // 解绑 + 复位注册位
    const c2 = registerRepoFsEvents(); // 复位后可再注册
    expect(mocks.on).toHaveBeenCalledTimes(2);
    c2();
    pendingCleanup = null; // 两次注册均已各自复位
  });

  it("Wails 事件 → 800ms 防抖后才 bus.emit（窗口内多触发合并为一次）", async () => {
    const cleanup = registerRepoFsEvents();
    pendingCleanup = cleanup;
    const onCb = lastOnCb();
    expect(onCb, "EventsOn 回调须已注册").toBeDefined();

    const emitSpy = vi.spyOn(bus, "emit");
    onCb!();
    onCb!(); // 防抖窗口内第二次触发
    vi.advanceTimersByTime(799);
    expect(emitSpy).not.toHaveBeenCalledWith("repo:fs-changed");
    vi.advanceTimersByTime(1);
    expect(emitSpy).toHaveBeenCalledWith("repo:fs-changed");
    expect(emitSpy.mock.calls.filter((c) => c[0] === "repo:fs-changed")).toHaveLength(1);
    emitSpy.mockRestore();
  });

  it("cleanup 清除在途防抖（卸载后到期的事件不再 emit）", async () => {
    const cleanup = registerRepoFsEvents();
    pendingCleanup = cleanup;
    const onCb = lastOnCb();
    const emitSpy = vi.spyOn(bus, "emit");
    onCb!();
    cleanup();
    pendingCleanup = null; // 已主动复位
    vi.advanceTimersByTime(900);
    expect(emitSpy).not.toHaveBeenCalledWith("repo:fs-changed");
    emitSpy.mockRestore();
  });
});
