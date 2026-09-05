// ===== 下载队列状态机测试（ADR-021 扩展）— 状态层段（ADR-187 D5 修订拆分）=====
// 模块级 STATE：getState/subscribe/enqueue/cancel/resume + 后端事件处理。
// 每个用例通过 vi.resetModules() + 动态 import 获得全新模块实例，
// 彻底隔离模块级 STATE（含 errorList），避免跨用例状态泄漏。
//
// ⚠️ ADR-187 D5 修订（2026-09-05）：vitest isolate:true（vitest.config.ts L26，
// 2026-08-22 迁移）下每文件独立 worker + 模块图——原例外条款依据的
// 「isolate:false 共享 mock 引用」在配置层已失效。952 行拆 2 文件（复制式，本文件
// 为状态层；UI 层见 download-queue-ui.test.ts）；beforeEach 动态 import 绑定文件级
// let 与 mock 矩阵强耦合，抽共享 setup 需双 let 绑定复杂度不值，故每文件自持矩阵。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Bus } from "../../bus.ts";
import { type DownloadState, type DownloadTask } from "./download-queue.ts";

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
let getState!: () => DownloadState;
let subscribe!: (fn: (s: DownloadState) => void) => () => void;
let enqueueDownloads!: (tasks: DownloadTask[]) => Promise<void>;
let cancelDownloads!: () => Promise<void>;
let resume!: () => Promise<void>;

// 每个用例重置模块注册表并重新 import，拿到干净的模块级 STATE
beforeEach(async () => {
  vi.resetModules();
  onMock.mockClear(); // 清掉上一用例注册记录，防「累积调用下恒真」弱断言
  enqueueMock.mockReset(); // mockReset 清实现：防「入队失败」用例的 mockRejectedValue 跨用例残留
  statusMock.mockClear();
  cancelMock.mockClear();
  cachedAvatarMock.mockReset();
  extractAvatarMock.mockReset();
  loadConfigMock.mockReset();
  repoRootMock.mockReset();
  isWebPlatformMock.mockReturnValue(false); // 默认桌面
  importWebFilesMock.mockReset().mockResolvedValue({ imported: 0, failed: 0 });
  fetchMock.mockReset().mockResolvedValue(new Response(new Blob(["x"])));
  // web 分支可能触发真实 fetch——全局兜底防测试触网（桌面用例不受影响）
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("./download-queue.ts");
  getState = mod.getState;
  subscribe = mod.subscribe;
  enqueueDownloads = mod.enqueueDownloads;
  cancelDownloads = mod.cancelDownloads;
  resume = mod.resume;
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

  it("模块顶层只注册一组后端事件（陷阱 #7：onMock 覆盖写入，需断言防重复注册回归）", () => {
    // 陷阱 #7：单文件/多选/全选三入口只注册一组 EventsOn——若回归把注册移进
    // createDownloadQueue（每控制器一组），onMock 会累积多次同名注册（覆盖写入掩盖），
    // 此处断言 4 组事件各被注册过
    for (const name of ["queue:status", "queue:file-start", "queue:file-done", "download:progress"]) {
      expect(onMock).toHaveBeenCalledWith(name, expect.any(Function));
    }
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

  it("并发 3 次 enqueueDownloads 只入队一次（重入守卫：状态置位先于首个 await）", async () => {
    const tasks = [{ url: "u", saveDir: "", name: "a", size: 1 }];
    await Promise.all([enqueueDownloads(tasks), enqueueDownloads(tasks), enqueueDownloads(tasks)]);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(getState().total).toBe(1); // 首次调用设置的批次参数不被后续忽略调用覆盖
  });

  it("enqueued 状态同样防重入（P1：Go 入队后只发 enqueued 不发 downloading）", async () => {
    emit("queue:status", ["enqueued", 2, 1]);
    expect(getState().status).toBe("enqueued");
    enqueueMock.mockClear();
    await enqueueDownloads([{ url: "u2", saveDir: "", name: "b", size: 1 }]);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("网页版小文件：fetch → importWebFiles 入库（对齐导入链路），成功路径无直链、不调 Go、回 idle", async () => {
    isWebPlatformMock.mockReturnValue(true);
    importWebFilesMock.mockResolvedValue({ imported: 1, failed: 0 });
    const origCreate = document.createElement.bind(document);
    const created: HTMLAnchorElement[] = [];
    const createElSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === "a") created.push(el as HTMLAnchorElement);
        return el;
      });
    try {
      await enqueueDownloads([
        { url: "https://x/a.ysm", saveDir: "/web/ysm", name: "[作者]模型.ysm", size: 10 },
      ]);
    } finally {
      createElSpy.mockRestore();
    }
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://x/a.ysm", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // rtype 从 saveDir=/web/<type> 反解（web 模式 GetRepoRoot 恒返回 /web/<type>）
    expect(importWebFilesMock).toHaveBeenCalledTimes(1);
    const [files, webType] = importWebFilesMock.mock.calls[0];
    expect(files[0].name).toBe("[作者]模型.ysm");
    expect(webType).toBe("ysm");
    expect(created.length).toBe(0); // 成功入库不再创建 <a> 直链
    expect(getState().status).toBe("idle");
    expect(getState().errorList).toEqual([]);
  });

  it("网页版 saveDir 边界：webType 反解空串/多级路径/不足三段回退", async () => {
    isWebPlatformMock.mockReturnValue(true);
    importWebFilesMock.mockResolvedValue({ imported: 1, failed: 0 });
    fetchMock.mockResolvedValue(new Response("ok"));
    // 多级路径仍取 [2] 段（GetRepoRoot 恒 /web/<type>，防御性验证）
    await enqueueDownloads([{ url: "https://x/m.ysm", saveDir: "/web/ysm/sub/dir", name: "m.ysm", size: 10 }]);
    expect(importWebFilesMock).toHaveBeenCalledTimes(1);
    expect(importWebFilesMock.mock.calls[0][1]).toBe("ysm");
    importWebFilesMock.mockClear();
    fetchMock.mockResolvedValue(new Response("ok"));
    // 空 saveDir → webType 空串（importWebFiles 走默认类型分支）
    await enqueueDownloads([{ url: "https://x/e.ysm", saveDir: "", name: "e.ysm", size: 10 }]);
    expect(importWebFilesMock).toHaveBeenCalledTimes(1);
    expect(importWebFilesMock.mock.calls[0][1]).toBe("");
    importWebFilesMock.mockClear();
    fetchMock.mockResolvedValue(new Response("ok"));
    // 不足三段 → split("/")[2] 越界，回退空串（importWebFiles 走默认类型分支）
    await enqueueDownloads([{ url: "https://x/o.ysm", saveDir: "/odd", name: "o.ysm", size: 10 }]);
    expect(importWebFilesMock).toHaveBeenCalledTimes(1);
    expect(importWebFilesMock.mock.calls[0][1]).toBe("");
  });

  it("网页版 fetch 挂起超时 → 回退直链且回 idle（P2：防永久卡 downloading）", async () => {
    vi.useFakeTimers();
    try {
      isWebPlatformMock.mockReturnValue(true);
      importWebFilesMock.mockResolvedValue({ imported: 1, failed: 0 });
      // 永不 settle 的 fetch：仅响应 abort 信号（模拟挂起服务器，无超时即永久卡住）
      fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
      );
      const p = enqueueDownloads([{ url: "https://x/slow.ysm", saveDir: "/web/ysm", name: "slow.ysm", size: 10 }]);
      await vi.advanceTimersByTimeAsync(15_000); // 前进超时窗口（=WEB_DOWNLOAD_FETCH_TIMEOUT_MS）触发 abort
      await p;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(importWebFilesMock).not.toHaveBeenCalled(); // 超时 → 直链兜底不入库
      expect(getState().status).toBe("idle"); // 队列未被永久卡在 downloading
    } finally {
      vi.useRealTimers();
    }
  });

  it("网页版大文件（>50MB）：不 fetch，回退浏览器直链（ADR-123 P1 回退分支）", async () => {
    isWebPlatformMock.mockReturnValue(true);
    await enqueueDownloads([
      { url: "https://x/big.ysm", saveDir: "/web/ysm", name: "big.ysm", size: 50 * 1024 * 1024 + 1 },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(importWebFilesMock).not.toHaveBeenCalled();
    expect(getState().status).toBe("idle");
  });

  it("网页版 fetch 失败（HTTP 非 ok）：回退浏览器直链，不入 errorList（用户仍拿到文件）", async () => {
    isWebPlatformMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
    await enqueueDownloads([
      { url: "https://x/a.ysm", saveDir: "/web/ysm", name: "a.ysm", size: 10 },
    ]);
    expect(fetchMock).toHaveBeenCalled();
    expect(importWebFilesMock).not.toHaveBeenCalled();
    expect(getState().errorList).toEqual([]); // 直链兜底成功 → 非错误
    expect(getState().status).toBe("idle");
  });

  it("网页版非 http(s) URL：直接回退直链，不 fetch（协议白名单守卫）", async () => {
    isWebPlatformMock.mockReturnValue(true);
    await enqueueDownloads([
      { url: "file:///etc/passwd", saveDir: "/web/ysm", name: "x.ysm", size: 10 },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(importWebFilesMock).not.toHaveBeenCalled();
    expect(getState().status).toBe("idle");
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

  it("enqueued 状态调用 CancelQueue（P1：取消守卫认 enqueued）", async () => {
    emit("queue:status", ["enqueued", 2, 1]);
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

  it("download:progress 收到非法数值归一为 0（NaN/负数/Content-Length=-1 哨兵不污染进度）", () => {
    emit("download:progress", [Number.NaN, 100]);
    expect(getState().progress.dl).toBe(0);
    emit("download:progress", [50, -1]); // Content-Length=-1 哨兵 → 与 total=0 等价
    expect(getState().progress.total).toBe(0);
    emit("download:progress", [Infinity, 1]);
    expect(getState().progress.dl).toBe(0);
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

describe("后端事件 payload 守卫（eventArr 畸形数据）", () => {
  it("非数组 payload（null/对象/字符串）不崩且 STATE 关键字段不变", () => {
    const before = getState().status;
    expect(() => emit("queue:status", null)).not.toThrow();
    expect(() => emit("queue:status", { notArray: true })).not.toThrow();
    expect(() => emit("queue:status", "bad")).not.toThrow();
    expect(getState().status).toBe(before);
  });

  it("空数组 payload 被守卫拦截，不污染 STATE", () => {
    emit("queue:file-start", ["f.ysm", 3, 2]);
    const s1 = getState();
    expect(s1.currentFile).toBe("f.ysm");
    expect(() => emit("queue:file-start", [])).not.toThrow();
    const s2 = getState();
    expect(s2.currentFile).toBe("f.ysm"); // 未被空数组污染
    expect(s2.total).toBe(3);
    expect(s2.remaining).toBe(2);
  });

  it("download:progress 畸形 payload（非数组/空）不污染进度", () => {
    emit("download:progress", [50, 100]);
    expect(getState().progress).toEqual({ dl: 50, total: 100 });
    expect(() => emit("download:progress", null)).not.toThrow();
    expect(() => emit("download:progress", [])).not.toThrow();
    expect(getState().progress).toEqual({ dl: 50, total: 100 }); // 不变
  });

  it("queue:file-done 畸形 payload（非数组/空）不污染 errorList/_lastDone", () => {
    const seq0 = getState()._lastDoneSeq;
    expect(() => emit("queue:file-done", null)).not.toThrow();
    expect(() => emit("queue:file-done", [])).not.toThrow();
    expect(getState()._lastDoneSeq).toBe(seq0); // 未新增
    expect(getState().errorList).toEqual([]);
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

  it("QueueStatus 返回数组格式 [remaining, running]", async () => {
    statusMock.mockResolvedValue([3, true]);
    await resume();
    expect(getState().status).toBe("downloading");
    expect(getState().remaining).toBe(3);
  });

  it("QueueStatus 返回小写对象格式 {remaining, running}", async () => {
    statusMock.mockResolvedValue({ remaining: 4, running: true });
    await resume();
    expect(getState().status).toBe("downloading");
    expect(getState().remaining).toBe(4);
  });

  it("QueueStatus 返回 null/无法解析值 → 安全忽略保持 idle", async () => {
    statusMock.mockResolvedValue(null);
    await resume();
    expect(getState().status).toBe("idle");
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
