// ===== network.ts 单测（performSingleOp 契约）=====
// 锐评 P2 补强：per-path 并发守卫 / 代际+连接守卫 / finally busy 派生 / 错误出口。
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1-3（2026-10-16 锐评）：mock 目标统一到 seam 唯一出口 @/backend/app.ts，
// 与同目录 index/events/renderer 测试同口径；弃用 @/views/backend-deps.ts 旁路
// （ADR-224：vi.mock 路径失效会静默无告警，而 backend-deps.ts 是纯转发 seam，
// 一旦加入 deps? 注入签名，这条 mock 会静默失效）。
vi.mock("@/backend/app.ts", () => ({ getApp: vi.fn() }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn() } }));
// 批D：超时用例需把同步兜底超时打桩（否则要真等 120s）；其余用例透传真实实现，
// TimeoutError 保持真实类（断言分支用 instanceof 判定）。
vi.mock("@/utils/async/sync-op-timeout.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/async/sync-op-timeout.ts")>();
  return { ...actual, withSyncOpTimeout: vi.fn(actual.withSyncOpTimeout) };
});

import { bus } from "@/bus";
import { getApp } from "@/backend/app.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { withSyncOpTimeout } from "@/utils/async/sync-op-timeout.ts";
import { TimeoutError } from "@/utils/base/primitives/async.ts";
import { performSingleOp } from "./network.ts";
import type { SyncManagerSelf } from "./self-type.ts";

const busEmit = vi.mocked(bus.emit);
const getAppMock = vi.mocked(getApp);

function makeSelf(over: Partial<SyncManagerSelf> = {}): SyncManagerSelf {
  return {
    _guard: createLoadGuard(),
    _instance: "inst1",
    _subtype: "",
    _selectedType: "ysm",
    _singleBusy: new Set<string>(),
    isConnected: true,
    querySelectorAll: () => [],
    ...over,
  } as unknown as SyncManagerSelf;
}

const noopCb = { doLoadData: vi.fn().mockResolvedValue(undefined), doRender: vi.fn(), doEmitStats: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("network.performSingleOp", () => {
  it("push 成功 → PushSingleResourceToInstance(rtype, instance, path) + 成功 toast + 三回调", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    getAppMock.mockResolvedValue({ PushSingleResourceToInstance: push } as never);
    const cb = { ...noopCb };
    await performSingleOp(makeSelf(), "push", "a.zip", cb);
    expect(push).toHaveBeenCalledWith("ysm", "inst1", "a.zip");
    expect(busEmit).toHaveBeenCalledTimes(1);
    expect(busEmit.mock.calls[0][0]).toBe("toast:show");
    expect(cb.doLoadData).toHaveBeenCalledTimes(1);
    expect(cb.doRender).toHaveBeenCalledTimes(1);
    expect(cb.doEmitStats).toHaveBeenCalledTimes(1);
  });

  it("pull 成功 → PullSingleResourceFromInstance(rtype, path, instance)", async () => {
    const pull = vi.fn().mockResolvedValue(undefined);
    getAppMock.mockResolvedValue({ PullSingleResourceFromInstance: pull } as never);
    await performSingleOp(makeSelf(), "pull", "a.zip", { ...noopCb });
    expect(pull).toHaveBeenCalledWith("ysm", "a.zip", "inst1");
  });

  it("同一 path 在途重入被守卫吞；不同 path 可并发", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    getAppMock.mockReturnValue(gate.then(() => ({ PushSingleResourceToInstance: vi.fn() })) as never);
    const self = makeSelf();
    const first = performSingleOp(self, "push", "a.zip", noopCb);
    const dupe = performSingleOp(self, "push", "a.zip", noopCb);
    const other = performSingleOp(self, "push", "b.zip", noopCb);
    expect(self._singleBusy.has("a.zip")).toBe(true);
    expect(self._singleBusy.has("b.zip")).toBe(true);
    release();
    await Promise.all([first, dupe, other]);
    expect(self._singleBusy.size).toBe(0);
  });

  it("失败 → error toast；finally busy 视觉按在途数派生复位", async () => {
    getAppMock.mockRejectedValue(new Error("boom"));
    const self = makeSelf();
    await performSingleOp(self, "push", "a.zip", noopCb);
    expect(busEmit).toHaveBeenCalledTimes(1);
    const payload = busEmit.mock.calls[0][1] as { type?: string };
    expect(payload.type).toBe("error");
    expect(self._singleBusy.size).toBe(0);
  });

  it("操作期间 disconnect → 不 toast 不渲染", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    getAppMock.mockResolvedValue({ PushSingleResourceToInstance: push } as never);
    const cb = { ...noopCb };
    const self = makeSelf({ isConnected: false });
    await performSingleOp(self, "push", "a.zip", cb);
    expect(busEmit).not.toHaveBeenCalled();
    expect(cb.doRender).not.toHaveBeenCalled();
  });

  // 批D：binding 挂起（Go 侧锁/慢盘不收口）原会永久占住该行——必须超时收口 + 解锁 + 专属文案。
  it("binding 挂起 → 超时收口 + 该行解锁 + 专属超时文案", async () => {
    const push = vi.fn(() => new Promise(() => {})); // 永不 settle
    getAppMock.mockResolvedValue({ PushSingleResourceToInstance: push } as never);
    vi.mocked(withSyncOpTimeout).mockRejectedValueOnce(new TimeoutError("推送 a.zip", 120_000));

    const self = makeSelf();
    const cb = { ...noopCb };
    await performSingleOp(self, "push", "a.zip", cb);

    // 收口：忽略悬空 binding 的结果，不进成功路径
    expect(cb.doRender).not.toHaveBeenCalled();
    expect(self._singleBusy.size).toBe(0); // 该行已解锁（原实现永不删除 → 永久禁用）
    const payload = busEmit.mock.calls[0][1] as { type?: string; msg?: string };
    expect(payload.type).toBe("error");
    expect(payload.msg).toContain("操作超时");
  });

  it("push 走同步兜底超时收口（label 含动作与路径，便于定位）", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    getAppMock.mockResolvedValue({ PushSingleResourceToInstance: push } as never);
    const timeoutMock = vi.mocked(withSyncOpTimeout);
    timeoutMock.mockClear();

    await performSingleOp(makeSelf(), "push", "a.zip", { ...noopCb });

    expect(timeoutMock).toHaveBeenCalledTimes(1);
    expect(timeoutMock.mock.calls[0][1]).toBe("推送 a.zip");
  });
});
