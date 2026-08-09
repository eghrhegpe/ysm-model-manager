// ===== 下载队列状态机测试（ADR-021 扩展）=====
// 模块级 STATE：getState/subscribe/enqueue/cancel/resume + 后端事件处理。
// 每个用例通过 vi.resetModules() + 动态 import 获得全新模块实例，
// 彻底隔离模块级 STATE（含 errorList），避免跨用例状态泄漏。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type Bus, type ToastPayload } from "../../bus.ts";
import {
  type DownloadState,
  type DownloadTask,
  type QueueController,
  type QueueControllerOptions,
} from "./download-queue.ts";

// 捕获模块顶层 Events.On 注册的 handler（import 时即执行）
const { onMock, eventHandlers } = vi.hoisted(() => {
  const handlers = {} as Record<string, (data: unknown) => void>;
  return {
    onMock: vi.fn((name: string, fn: (data: unknown) => void) => {
      handlers[name] = fn;
    }),
    eventHandlers: handlers,
  };
});
const {
  enqueueMock,
  statusMock,
  cancelMock,
  cachedAvatarMock,
  extractAvatarMock,
  loadConfigMock,
  repoRootMock,
} = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  statusMock: vi.fn(),
  cancelMock: vi.fn(),
  cachedAvatarMock: vi.fn(),
  extractAvatarMock: vi.fn(),
  loadConfigMock: vi.fn(),
  repoRootMock: vi.fn(),
}));

vi.mock("@wailsio/runtime", () => ({ Events: { On: onMock } }));
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  EnqueueDownloads: enqueueMock,
  QueueStatus: statusMock,
  CancelQueue: cancelMock,
  CachedCreatorAvatar: cachedAvatarMock,
  DebugExtractCreatorAvatar: extractAvatarMock,
  LoadAppConfig: loadConfigMock,
  GetRepoRoot: repoRootMock,
}));

let bus!: Bus;
let getState!: () => DownloadState;
let subscribe!: (fn: (s: DownloadState) => void) => () => void;
let enqueueDownloads!: (tasks: DownloadTask[]) => Promise<void>;
let cancelDownloads!: () => Promise<void>;
let resume!: () => Promise<void>;
let createDownloadQueue!: (options: QueueControllerOptions) => QueueController;

// 每个用例重置模块注册表并重新 import，拿到干净的模块级 STATE
beforeEach(async () => {
  vi.resetModules();
  enqueueMock.mockClear();
  statusMock.mockClear();
  cancelMock.mockClear();
  cachedAvatarMock.mockReset();
  extractAvatarMock.mockReset();
  loadConfigMock.mockReset();
  repoRootMock.mockReset();
  const mod = await import("./download-queue.ts");
  getState = mod.getState;
  subscribe = mod.subscribe;
  enqueueDownloads = mod.enqueueDownloads;
  cancelDownloads = mod.cancelDownloads;
  resume = mod.resume;
  createDownloadQueue = mod.createDownloadQueue;
  // 与重新 import 的 download-queue 共用同一 bus 实例
  bus = (await import("../../bus.ts")).bus;
});

/** 触发后端事件（payload 为 { data: [...] } 格式） */
function emit(name: string, data: unknown) {
  const handler = eventHandlers[name];
  expect(handler, `未注册事件: ${name}`).toBeTruthy();
  handler!({ data });
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
  it("subscribe 订阅后收到状态变更通知", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    emit("queue:status", ["done", 0, undefined]); // 触发 notify
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    emit("queue:status", ["done", 0, undefined]);
    expect(fn).toHaveBeenCalledTimes(1); // 取消订阅后不再通知
  });
});

describe("enqueueDownloads", () => {
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
  it("QueueStatus 返回数字且 >0 → downloading", async () => {
    statusMock.mockResolvedValue(5);
    await resume();
    expect(getState().status).toBe("downloading");
    expect(getState().remaining).toBe(5);
  });

  it("QueueStatus 返回 0 → 保持原状态", async () => {
    statusMock.mockResolvedValue(0);
    await resume();
    expect(getState().status).toBe("idle");
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

describe("queue:status 分支补充", () => {
  it("enqueued 不改 currentFile，重置进度", () => {
    emit("queue:file-start", ["f.ysm", 3, 2]);
    emit("queue:status", ["enqueued", 5, undefined]);
    const s = getState();
    expect(s.status).toBe("enqueued");
    expect(s.currentFile).toBe("f.ysm"); // ★ 不覆盖 file-start 文件名
    expect(s.progress).toEqual({ dl: 0, total: 0 });
  });

  it("未知状态走 else 分支仅更新 status", () => {
    emit("queue:status", ["downloading", 2, undefined]);
    expect(getState().status).toBe("downloading");
  });
});

describe("queue:file-done 头像增量提取", () => {
  it(".ysm 成功且带 [作者] → 命中缓存发 avatar:refresh", async () => {
    cachedAvatarMock.mockResolvedValue("data:avatar");
    const events: Array<{ author: string; dataUri: string }> = [];
    const off = bus.on("avatar:refresh", (p) => events.push(p));
    emit("queue:file-done", ["[作者A] 角色.ysm", "ok", ""]);
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(events[0]).toEqual({ author: "作者A", dataUri: "data:avatar" });
    expect(cachedAvatarMock).toHaveBeenCalledWith("作者A");
    expect(extractAvatarMock).not.toHaveBeenCalled();
    off();
  });

  it("缓存未命中 → 先 DebugExtract 再取缓存", async () => {
    cachedAvatarMock.mockResolvedValueOnce("").mockResolvedValue("data:late");
    const events: Array<{ author: string; dataUri: string }> = [];
    const off = bus.on("avatar:refresh", (p) => events.push(p));
    emit("queue:file-done", ["[作者B] 角色.ysm", "ok", ""]);
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(extractAvatarMock).toHaveBeenCalledWith("作者B");
    expect(events[0]).toEqual({ author: "作者B", dataUri: "data:late" });
    off();
  });

  it("非 .ysm 文件不触发提取", async () => {
    cachedAvatarMock.mockResolvedValue("data:x");
    emit("queue:file-done", ["[作者C] 角色.zip", "ok", ""]);
    await Promise.resolve();
    await Promise.resolve();
    expect(cachedAvatarMock).not.toHaveBeenCalled();
  });

  it("无 [作者] 前缀不触发提取", async () => {
    cachedAvatarMock.mockResolvedValue("data:x");
    emit("queue:file-done", ["普通文件.ysm", "ok", ""]);
    await Promise.resolve();
    await Promise.resolve();
    expect(cachedAvatarMock).not.toHaveBeenCalled();
  });

  it("提取抛错安全吞掉", async () => {
    cachedAvatarMock.mockRejectedValue(new Error("boom"));
    emit("queue:file-done", ["[作者D] 角色.ysm", "ok", ""]);
    await vi.waitFor(() => expect(cachedAvatarMock).toHaveBeenCalled());
  });
});

describe("createDownloadQueue UI 层", () => {
  function createCtrl(overrides: Partial<QueueControllerOptions> = {}) {
    const sr = document.createElement("div");
    sr.innerHTML =
      '<div id="gh-queue-status"></div><button class="gh-dl-selected">下载</button>';
    document.body.appendChild(sr);
    const localMap = new Map();
    const onFileSuccess = vi.fn();
    const onAllDone = vi.fn();
    statusMock.mockResolvedValue(0); // resume 保持 idle
    const ctrl = createDownloadQueue({
      sr,
      esc: (s: string) => String(s),
      getLocalMap: () => localMap,
      onFileSuccess,
      onAllDone,
      ...overrides,
    });
    return { sr, localMap, onFileSuccess, onAllDone, ctrl };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("返回控制器四件套且初始非下载中", () => {
    const { ctrl } = createCtrl();
    expect(typeof ctrl.enqueue).toBe("function");
    expect(typeof ctrl.cancel).toBe("function");
    expect(typeof ctrl.destroy).toBe("function");
    expect(ctrl.isDownloading()).toBe(false);
    ctrl.destroy();
  });

  it("file-start 渲染进度行与取消按钮", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["[作者] 角色.ysm", 3, 2]);
    const qs = sr.querySelector("#gh-queue-status")!;
    expect(qs.querySelector(".gh-progress-row")).toBeTruthy();
    expect(qs.querySelector(".gh-progress-name")).toBeTruthy();
    expect(qs.querySelector(".gh-cancel-queue")).toBeTruthy();
    expect(qs.querySelector(".gh-progress-remain")).toBeTruthy(); // remain=3-1=2>1
    ctrl.destroy();
  });

  it("download:progress 更新进度条宽度与百分比", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [50, 100]);
    expect((sr.querySelector(".gh-progress-fill") as HTMLElement).style.width).toBe("50%");
    expect(sr.querySelector(".gh-progress-pct")!.textContent).toBe("50%");
    ctrl.destroy();
  });

  it("queue:status done → 清理 UI + tree:reload + onAllDone", async () => {
    const { sr, onAllDone, ctrl } = createCtrl();
    await Promise.resolve();
    const reloads: number[] = [];
    const off = bus.on("tree:reload", () => reloads.push(1));
    sr.querySelector("#gh-queue-status")!.classList.add("show");
    emit("queue:status", ["done", 1, undefined]);
    const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(sr.querySelector("#gh-queue-status")!.classList.contains("show")).toBe(false);
    expect(onAllDone).toHaveBeenCalledWith({ cancelled: false, errorList: [] });
    await vi.waitFor(() => expect(reloads.length).toBe(1));
    off();
    ctrl.destroy();
  });

  it("queue:status cancelled → 显示已取消摘要", async () => {
    const { sr, onAllDone, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:status", ["cancelled", 0, undefined]);
    expect(sr.querySelector("#gh-queue-status")!.innerHTML).toContain("已取消");
    expect(onAllDone).toHaveBeenCalledWith({ cancelled: true, errorList: [] });
    ctrl.destroy();
  });

  it("file-done ok → 写入本地缓存 + 回调 onFileSuccess", async () => {
    const { localMap, onFileSuccess, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("queue:file-done", ["f.ysm", "ok", ""]);
    expect(localMap.get("f.ysm")).toBe("");
    expect(onFileSuccess).toHaveBeenCalledWith("f.ysm");
    ctrl.destroy();
  });

  it("enqueue 有仓库根 → 设置 saveDir 并入队", async () => {
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockResolvedValue("/repo");
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const tasks = [{ url: "u", saveDir: "", name: "a.ysm", size: 1 }];
    await ctrl.enqueue(tasks);
    expect(repoRootMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0][0][0].saveDir).toBe("/repo");
    expect((sr.querySelector(".gh-dl-selected") as HTMLButtonElement).disabled).toBe(true);
    expect(sr.querySelector("#gh-queue-status")!.innerHTML).toContain("准备下载");
    expect(ctrl.isDownloading()).toBe(true);
    ctrl.destroy();
  });

  it("enqueue 无仓库根 → warn toast 且不入队", async () => {
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockResolvedValue("");
    const { ctrl } = createCtrl();
    await Promise.resolve();
    const toasts: ToastPayload[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    await ctrl.enqueue([{ url: "u", saveDir: "", name: "a.ysm", size: 1 }]);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(toasts.some((t) => t.type === "warn")).toBe(true);
    off();
    ctrl.destroy();
  });

  it("destroy 后不再响应状态变更", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    ctrl.destroy();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    expect(sr.querySelector("#gh-queue-status")!.innerHTML).toBe("");
  });
});

// ── 陷阱 #6：Content-Length=-1 / 99% 卡进度锁定状态机 ──
// handleProgress 的小文件 300ms 强制 100%、大文件 2s 转菊花、file-done 复位，
// 全部依赖 _stuckLocked / _stuckTimer / _lastPct 闭包状态——用 fake timers 精确控制。
describe("createDownloadQueue 99% 锁定状态机（陷阱 #6）", () => {
  function createCtrl(overrides: Partial<QueueControllerOptions> = {}) {
    const sr = document.createElement("div");
    sr.innerHTML =
      '<div id="gh-queue-status"></div><button class="gh-dl-selected">下载</button>';
    document.body.appendChild(sr);
    const localMap = new Map();
    const onFileSuccess = vi.fn();
    const onAllDone = vi.fn();
    statusMock.mockResolvedValue(0); // resume 保持 idle
    const ctrl = createDownloadQueue({
      sr,
      esc: (s: string) => String(s),
      getLocalMap: () => localMap,
      onFileSuccess,
      onAllDone,
      ...overrides,
    });
    return { sr, localMap, onFileSuccess, onAllDone, ctrl };
  }

  function progressEls(sr: HTMLElement) {
    return {
      pctEl: sr.querySelector(".gh-progress-pct") as HTMLElement | null,
      fillEl: sr.querySelector(".gh-progress-fill") as HTMLElement | null,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("小文件（≤100KB）99% → 锁定 300ms 后强制 100%", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, 50000]); // pct=0，_lastPct=0
    emit("download:progress", [49500, 50000]); // pct=99 → 小文件锁定
    const { pctEl, fillEl } = progressEls(sr);
    // 锁定中：进度条 99%，百分比停留在上一轮值（不显示假 100%）
    expect(fillEl!.style.width).toBe("99%");
    expect(pctEl!.textContent).not.toBe("100%");
    vi.advanceTimersByTime(300);
    expect(pctEl!.textContent).toBe("100%");
    ctrl.destroy();
  });

  it("大文件（>1MB）99% → 2s 后转菊花 ⏳", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    const total = 2 * 1024 * 1024;
    emit("download:progress", [0, total]); // pct=0
    emit("download:progress", [total - 1024, total]); // pct≈100 → 大文件锁定 99%
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("99%");
    expect(fillEl!.style.width).toBe("99%");
    vi.advanceTimersByTime(2000);
    expect(pctEl!.textContent).toBe("⏳");
    ctrl.destroy();
  });

  it("file-done ok 到达时强制 100% 并复位锁定", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, 50000]);
    emit("download:progress", [49500, 50000]); // 锁定 99%
    emit("queue:file-done", ["f.ysm", "ok", ""]);
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("100%");
    expect(fillEl!.style.width).toBe("100%");
    ctrl.destroy();
  });

  it("Content-Length=-1（total=0）不误报百分比，显示 MB", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [2 * 1024 * 1024, 0]); // total=0 → pct=0
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("2.0MB");
    expect(fillEl!.style.width).toBe("0%");
    ctrl.destroy();
  });

  it("progress 全程 <99%（有 Content-Length）不触发锁定", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, 1000000]);
    emit("download:progress", [500000, 1000000]); // 50% 正常
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("50%");
    expect(fillEl!.style.width).toBe("50%");
    ctrl.destroy();
  });
});
