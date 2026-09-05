// ===== 下载队列 UI 层测试 — createDownloadQueue 控制器（ADR-187 D5 修订拆分）=====
// 状态层（download-queue.test.ts）之外的 UI 域：控制器四件套 / 进度行渲染 / 取消按钮 /
// 完成清理 / 99% 锁定状态机（陷阱 #6，fake timers 精确控制）。
//
// ⚠️ ADR-187 D5 修订（2026-09-05）：vitest isolate:true 下拆分可行——本文件自持
// mock 矩阵 + beforeEach 动态 import（与状态层复制式同构，见 download-queue.test.ts 头）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type Bus, type ToastPayload } from "../../bus.ts";
import { type QueueController, type QueueControllerOptions } from "./download-queue.ts";

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
  isWebPlatformMock,
  importWebFilesMock,
  fetchMock,
} = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  statusMock: vi.fn(),
  cancelMock: vi.fn(),
  cachedAvatarMock: vi.fn(),
  extractAvatarMock: vi.fn(),
  loadConfigMock: vi.fn(),
  repoRootMock: vi.fn(),
  isWebPlatformMock: vi.fn().mockReturnValue(false), // 默认桌面
  // ADR-123 P1：web 分支下载改走 browser-adapter.importWebFiles 入库（对齐导入链路）
  importWebFilesMock: vi.fn().mockResolvedValue({ imported: 0, failed: 0 }),
  // web 分支小文件会真 fetch——默认回微 blob，防测试环境触网
  fetchMock: vi.fn().mockResolvedValue(new Response(new Blob(["x"]))),
}));

vi.mock("../../backend/platform-web.ts", () => ({
  isWebPlatform: isWebPlatformMock,
}));
// store web 分支动态 import browser-adapter 拿 importWebFiles；其余导出保持原实现，
// 防 graph 内其他消费方拿到 undefined 导出炸整条 import 链
vi.mock("../../backend/browser-adapter.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  importWebFiles: importWebFilesMock,
}));
vi.mock("@wailsio/runtime", () => ({ Events: { On: onMock }, Window: { Show: vi.fn(), Hide: vi.fn(), SetTitle: vi.fn(), OpenDevTools: vi.fn(), Reload: vi.fn() } }));
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
let createDownloadQueue!: (options: QueueControllerOptions) => QueueController;

// 每个用例重置模块注册表并重新 import，拿到干净的模块级 STATE
beforeEach(async () => {
  vi.resetModules();
  onMock.mockClear();
  enqueueMock.mockReset();
  statusMock.mockClear();
  cancelMock.mockClear();
  cachedAvatarMock.mockReset();
  extractAvatarMock.mockReset();
  loadConfigMock.mockReset();
  repoRootMock.mockReset();
  isWebPlatformMock.mockReturnValue(false); // 默认桌面
  importWebFilesMock.mockReset().mockResolvedValue({ imported: 0, failed: 0 });
  fetchMock.mockReset().mockResolvedValue(new Response(new Blob(["x"])));
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("./download-queue.ts");
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
    // 精确断言（原 4 连 toBeTruthy 只验存在）：名称文本 + 进度 + 取消按钮可用
    expect(qs.querySelector(".gh-progress-name")?.textContent).toContain("[作者] 角色");
    const remain = qs.querySelector(".gh-progress-remain");
    expect(remain?.textContent).toMatch(/\d/); // remain=3-1=2
    const cancel = qs.querySelector(".gh-cancel-queue") as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    expect(cancel?.disabled).toBe(false);
    expect(qs.querySelector(".gh-progress-row")).not.toBeNull();
    ctrl.destroy();
  });

  it("done 后同文件名二次下载仍触发 handleFileStart（_prevFile 防御清零回归护栏）", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const qs = sr.querySelector("#gh-queue-status")!;
    // 第一次下载：渲染进度行（remain=2 → 显示「剩余2」）
    emit("queue:file-start", ["[作者] 角色.ysm", 3, 2]);
    expect(qs.querySelector(".gh-progress-remain")?.textContent).toContain("2");
    // 队列结束（done）→ 状态清空
    emit("queue:status", ["done", 3, undefined]);
    // 同文件名二次下载（remaining=4）→ 进度行必须重新渲染：remain 变为 4。
    // 若 _prevFile 残留旧名导致 handleFileStart 不触发，则仍显示第一次的「剩余2」
    emit("queue:file-start", ["[作者] 角色.ysm", 5, 4]);
    expect(qs.querySelector(".gh-progress-remain")?.textContent).toContain("4");
    expect(qs.querySelector(".gh-progress-name")?.textContent).toContain("[作者] 角色");
    ctrl.destroy();
  });

  it("取消按钮 click → cancelDownloads（接线）", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:status", ["enqueued", 2, 1]); // 置 active
    emit("queue:file-start", ["[作者] 角色.ysm", 3, 2]); // 渲染进度行 + 取消按钮
    cancelMock.mockClear();
    (sr.querySelector(".gh-cancel-queue") as HTMLElement).click();
    await vi.waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    ctrl.destroy();
  });

  it("ctrl.cancel() 公共方法 → cancelDownloads", async () => {
    const { ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:status", ["enqueued", 2, 1]); // 置 active
    cancelMock.mockClear();
    await ctrl.cancel();
    expect(cancelMock).toHaveBeenCalledTimes(1);
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

  it("enqueue 入队失败 → 状态回 idle + error toast + 按钮恢复（陷阱 #3 失败回滚）", async () => {
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockResolvedValue("/repo");
    enqueueMock.mockRejectedValue(new Error("disk full"));
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const toasts: ToastPayload[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    // enqueue 内部 try/catch 吞掉 Go reject（转 toast + 恢复 UI），不会向外 rethrow
    await ctrl.enqueue([{ url: "u", saveDir: "", name: "a.ysm", size: 1 }]);
    expect(ctrl.isDownloading()).toBe(false);
    expect((sr.querySelector(".gh-dl-selected") as HTMLButtonElement).disabled).toBe(false);
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("disk full"))).toBe(true);
    off();
    ctrl.destroy();
  });

  it("GetRepoRoot reject → 按钮恢复 + error toast（陷阱 #3 getApp/GetRepoRoot reject 变体）", async () => {
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockRejectedValue(new Error("fs down"));
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const toasts: ToastPayload[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    await ctrl.enqueue([{ url: "u", saveDir: "", name: "a.ysm", size: 1 }]);
    expect(ctrl.isDownloading()).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect((sr.querySelector(".gh-dl-selected") as HTMLButtonElement).disabled).toBe(false);
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("fs down"))).toBe(true);
    off();
    ctrl.destroy();
  });

  it("快速连点 3 次 enqueue 只入队一次（并发重入：store 守卫兜底）", async () => {
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockResolvedValue("/repo");
    const { ctrl } = createCtrl();
    await Promise.resolve();
    const tasks = [{ url: "u", saveDir: "", name: "a.ysm", size: 1 }];
    await Promise.all([ctrl.enqueue(tasks), ctrl.enqueue(tasks), ctrl.enqueue(tasks)]);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    ctrl.destroy();
  });

  it("网页版直链下载完成后按钮复位 + 状态隐藏（陷阱 #3 web 变体：无 done 事件流不卡死）", async () => {
    isWebPlatformMock.mockReturnValue(true);
    loadConfigMock.mockResolvedValue({});
    repoRootMock.mockResolvedValue("/repo");
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement;
    const qs = sr.querySelector("#gh-queue-status")!;
    const tasks = [{ url: "https://x/a.ysm", saveDir: "", name: "a.ysm", size: 1 }];
    await ctrl.enqueue(tasks);
    // store web 分支置 idle 无 done 事件——控制器必须自行复位，否则按钮永久卡禁用
    expect(btn.disabled).toBe(false);
    expect(qs.classList.contains("show")).toBe(false);
    expect(ctrl.isDownloading()).toBe(false);
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

  it("total 恰为 100KB 边界（≤100KB 含边界）→ 仍按小文件锁定", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, 100 * 1024]);
    emit("download:progress", [99 * 1024, 100 * 1024]); // pct=99 → 小文件锁定
    const { pctEl, fillEl } = progressEls(sr);
    expect(fillEl!.style.width).toBe("99%");
    vi.advanceTimersByTime(300);
    expect(pctEl!.textContent).toBe("100%");
    ctrl.destroy();
  });

  it("中尺寸文件（100KB–1MB 空档）99% 不锁定、直显 100%，file-done ok 兜底复位", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    const total = 500 * 1024;
    emit("download:progress", [0, total]);
    emit("download:progress", [total - 1024, total]); // pct≈100 → 非锁定分支直显 100%
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("100%");
    expect(fillEl!.style.width).toBe("100%");
    emit("queue:file-done", ["f.ysm", "ok", ""]); // file-done 仍强制 100%（不留残余）
    expect(pctEl!.textContent).toBe("100%");
    ctrl.destroy();
  });

  it("progress 达 100% → 3s completeTimer 后清理 UI + onAllDone + 按钮恢复（完成路径）", async () => {
    const { sr, onAllDone, ctrl } = createCtrl();
    await Promise.resolve();
    const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement;
    btn.disabled = true; // 模拟下载中按钮禁用
    emit("queue:status", ["enqueued", 1, undefined]); // 置 active，completeTimer 回调才生效
    emit("queue:file-start", ["f.ysm", 1, 0]); // 单文件：Go 端剩余文件数 left=0（app_download.go:178）
    emit("download:progress", [50, 100]); // _lastPct=50
    emit("download:progress", [100, 100]); // pct=100（_lastPct≥10 不触发锁定）→ 3s completeTimer
    expect(onAllDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onAllDone).toHaveBeenCalledWith({ cancelled: false, errorList: [] });
    expect(sr.querySelector("#gh-queue-status")!.classList.contains("show")).toBe(false);
    expect(btn.disabled).toBe(false);
    ctrl.destroy();
  });

  it("锁定期间到达 progress 不清 _stuckTimer（大文件 2s 后仍转菊花）", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const total = 2 * 1024 * 1024;
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, total]);
    emit("download:progress", [total - 1024, total]); // pct≈100 → 大文件锁定 99%
    emit("download:progress", [total - 512, total]); // 锁定态下第三条 progress
    const { pctEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("99%");
    vi.advanceTimersByTime(2000);
    expect(pctEl!.textContent).toBe("⏳"); // timer 未被锁定态 progress 清除
    ctrl.destroy();
  });

  it("file-done fail 复位锁定并清 _stuckTimer（2s 补写不再覆盖 ❌）", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    const total = 2 * 1024 * 1024;
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, total]);
    emit("download:progress", [total - 1024, total]); // pct≈100 → 大文件锁定 99%
    const { pctEl, fillEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("99%");
    emit("queue:file-done", ["f.ysm", "fail", "磁盘已满"]); // 锁定 2s 窗口内 fail
    expect(pctEl!.textContent).toBe("❌");
    expect(fillEl!.classList.contains("gh-progress-fill-error")).toBe(true);
    vi.advanceTimersByTime(2000); // _stuckTimer 已清，补写逻辑不再把 ❌ 改成 ⏳
    expect(pctEl!.textContent).toBe("❌");
    ctrl.destroy();
  });

  it("锁定态收到 dl==total 的 progress 不 arm completeTimer（file-done 前不提前完成）", async () => {
    const { sr, onAllDone, ctrl } = createCtrl();
    await Promise.resolve();
    const total = 2 * 1024 * 1024;
    emit("queue:status", ["enqueued", 1, undefined]); // 置 active
    emit("queue:file-start", ["f.ysm", 1, 0]); // 单文件 remaining=0
    emit("download:progress", [0, total]);
    emit("download:progress", [total - 1024, total]); // pct≈100 → 大文件锁定 99%
    emit("download:progress", [total, total]); // 锁定态下 dl==total（pct=100）
    const { pctEl } = progressEls(sr);
    expect(pctEl!.textContent).toBe("99%");
    vi.advanceTimersByTime(3000); // 若无盲区修复，completeTimer 会提前 onAllDone
    expect(onAllDone).not.toHaveBeenCalled();
    ctrl.destroy();
  });

  it("destroy 清理 stuck timer（小文件锁定后 destroy → 300ms 后不再强制 100%）", async () => {
    const { sr, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [0, 50000]);
    emit("download:progress", [49500, 50000]); // 小文件锁定 99%
    const { pctEl } = progressEls(sr);
    expect(pctEl!.textContent).not.toBe("100%");
    ctrl.destroy(); // P2 修复：stuckGuardReset 清 _stuckTimer
    vi.advanceTimersByTime(300);
    expect(pctEl!.textContent).not.toBe("100%"); // timer 已清，不再强制 100%
  });

  it("destroy 清理 completeTimer（达 100% 后 destroy → 3s 后不触发 onAllDone）", async () => {
    const { onAllDone, ctrl } = createCtrl();
    await Promise.resolve();
    emit("queue:status", ["enqueued", 1, undefined]); // 置 active
    emit("queue:file-start", ["f.ysm", 1, 1]);
    emit("download:progress", [50, 100]); // _lastPct=50
    emit("download:progress", [100, 100]); // pct=100 → 3s completeTimer
    ctrl.destroy();
    vi.advanceTimersByTime(3000);
    expect(onAllDone).not.toHaveBeenCalled(); // completeTimer 已清，死视图无副作用
  });
});
