// ===== network.ts 单测（performSingleOp 契约）=====
// 锐评 P2 补强：per-path 并发守卫 / 代际+连接守卫 / finally busy 派生 / 错误出口。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/views/backend-deps.ts", () => ({ backendGetApp: vi.fn() }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn() } }));

import { bus } from "@/bus";
import { backendGetApp } from "@/views/backend-deps.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { performSingleOp } from "./network.ts";
import type { SyncManagerSelf } from "./self-type.ts";

const busEmit = vi.mocked(bus.emit);
const getAppMock = vi.mocked(backendGetApp);

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
});
