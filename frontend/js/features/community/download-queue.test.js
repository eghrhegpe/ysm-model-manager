// ===== 下载队列状态机测试（ADR-021 扩展）=====
// 模块级 STATE：getState/subscribe/enqueue/cancel/resume + 后端事件处理。
import { describe, it, expect, vi, beforeEach } from "vitest";

// 捕获模块顶层 Events.On 注册的 handler（import 时即执行）
const { onMock, eventHandlers } = vi.hoisted(() => {
  const handlers = {};
  return {
    onMock: vi.fn((name, fn) => {
      handlers[name] = fn;
    }),
    eventHandlers: handlers,
  };
});
const { enqueueMock, statusMock, cancelMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  statusMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock("@wailsio/runtime", () => ({ Events: { On: onMock } }));
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  EnqueueDownloads: enqueueMock,
  QueueStatus: statusMock,
  CancelQueue: cancelMock,
}));

import {
  getState,
  subscribe,
  enqueueDownloads,
  cancelDownloads,
  resume,
} from "./download-queue.ts";

/** 触发后端事件（payload 为 { data: [...] } 格式） */
function emit(name, data) {
  expect(eventHandlers[name], `未注册事件: ${name}`).toBeTruthy();
  eventHandlers[name]({ data });
}

/** 重置模块级状态：通过 queue:status done 事件 + enqueue 前的状态清空 */
function resetState() {
  emit("queue:status", ["done", 0, undefined]);
}

describe("下载队列初始状态", () => {
  it("模块加载初始为 idle", () => {
    const s = getState();
    expect(s.status).toBe("idle");
    expect(s.total).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.errorList).toEqual([]);
  });
});

describe("下载队列 STATE", () => {
  beforeEach(() => {
    resetState();
  });

  it("subscribe 订阅后收到状态变更通知", async () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    resetState(); // done 触发 notify
    expect(fn).toHaveBeenCalled();
    unsub();
    resetState();
    expect(fn).toHaveBeenCalledTimes(1); // 取消订阅后不再通知
  });
});

describe("enqueueDownloads", () => {
  beforeEach(() => {
    resetState();
    enqueueMock.mockClear();
  });

  it("入队设置 downloading 状态并调用 Go 绑定", async () => {
    await enqueueDownloads([{ url: "u", saveDir: "", name: "a", size: 1 }]);
    const s = getState();
    expect(s.status).toBe("downloading");
    expect(s.total).toBe(1);
    expect(s.remaining).toBe(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("空数组直接返回，不调用 Go 绑定", async () => {
    await enqueueDownloads([]);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("下载中重复入队被忽略", async () => {
    await enqueueDownloads([{ url: "u", saveDir: "", name: "a", size: 1 }]);
    enqueueMock.mockClear();
    await enqueueDownloads([{ url: "u2", saveDir: "", name: "b", size: 1 }]);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("cancelDownloads", () => {
  beforeEach(() => {
    resetState();
    cancelMock.mockClear();
  });

  it("非下载状态直接返回，不调用 Go", async () => {
    await cancelDownloads();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("下载中调用 CancelQueue", async () => {
    await enqueueDownloads([{ url: "u", saveDir: "", name: "a", size: 1 }]);
    await cancelDownloads();
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});

describe("后端事件处理", () => {
  beforeEach(resetState);

  it("queue:file-start 更新当前文件与进度", () => {
    emit("queue:file-start", ["f.ysm", 3, 2]);
    const s = getState();
    expect(s.currentFile).toBe("f.ysm");
    expect(s.total).toBe(3);
    expect(s.remaining).toBe(2);
  });

  it("queue:file-done fail 记录错误，成功不记录", () => {
    emit("queue:file-done", ["a.ysm", "fail", "磁盘已满"]);
    emit("queue:file-done", ["b.ysm", "ok", ""]);
    const s = getState();
    expect(s.errorList).toEqual([{ name: "a.ysm", err: "磁盘已满" }]);
    expect(s._lastDoneSeq).toBe(2);
  });

  it("download:progress 更新进度", () => {
    emit("download:progress", [50, 100]);
    expect(getState().progress).toEqual({ dl: 50, total: 100 });
  });

  it("queue:status done 清空当前文件与进度", () => {
    emit("queue:file-start", ["f.ysm", 3, 2]);
    emit("queue:status", ["done", 3, undefined]);
    const s = getState();
    expect(s.status).toBe("done");
    expect(s.currentFile).toBe("");
    expect(s.progress).toEqual({ dl: 0, total: 0 });
  });
});

describe("resume", () => {
  beforeEach(() => {
    resetState();
    statusMock.mockReset();
  });

  it("QueueStatus 返回数字且 >0 → downloading", async () => {
    statusMock.mockResolvedValue(5);
    await resume();
    expect(getState().status).toBe("downloading");
    expect(getState().remaining).toBe(5);
  });

  it("QueueStatus 返回 0 → 保持原状态", async () => {
    statusMock.mockResolvedValue(0);
    await resume();
    expect(getState().status).toBe("done");
  });

  it("QueueStatus 返回对象格式（大写字段）", async () => {
    statusMock.mockResolvedValue({ Remaining: 2, Running: true });
    await resume();
    expect(getState().status).toBe("downloading");
    expect(getState().remaining).toBe(2);
  });

  it("QueueStatus 抛错安全忽略", async () => {
    statusMock.mockRejectedValue(new Error("boom"));
    await expect(resume()).resolves.toBeUndefined();
  });
});
