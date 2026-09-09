// ===== 创意工坊 — 批量下载队列 · 状态层（模块级 Store）=====
// v2: 模块级持久层 — EventsOn 在脚本加载时注册一次，页面切换不丢失事件
//
// ⚠️ ADR-039 §2.2 Events.On 豁免声明：
// 本模块顶层注册 4 组 Wails Events.On（queue:status / queue:file-start / queue:file-done /
// download:progress），无对应 Events.Off 退出路径。认定为 app 级单例豁免——
// download-queue 是社区页常驻单例（_registered 布尔守卫防重复注册），
// 生命周期等于应用生命周期，与 registerErrorDiary / matchMedia 监听同类。
// 禁止非 app 级模块复制此模式；若未来社区页支持卸载/热重载，再补 Events.Off。
//
// 拆分说明（ADR-040 ≤400 行红线）：自 download-queue.ts（829 行）拆出，
// 类型/STATE/Go 调用/后端事件注册全部内聚于此；
// download-queue-progress.ts 承接 99% 卡进度守卫状态机；
// download-queue-web.ts 承接网页版 fetch→IDB/直链兜底入队分支（ADR-208 D2 二次拆分）；
// download-queue.ts 保留 createDownloadQueue UI 控制器并对外 re-export（消费者零改动）。

import { isWebPlatform } from "@/backend/platform-web.ts";
import { Events } from "@/backend/runtime.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { communityGetApp } from "./community-deps.ts";
import { runWebEnqueue } from "./download-queue-web.ts";
import type {
  DownloadProgressPayload,
  QueueFileDonePayload,
  QueueFileStartPayload,
  QueueStatusPayload,
} from "./event-types.ts";
import { parseEventPayload } from "./event-types.ts";

// ============================================================
//  模块顶层 — 持久状态与事件注册（脚本加载时执行一次）
// ============================================================

/** 下载任务 */
export interface DownloadTask {
  url: string;
  saveDir: string;
  name: string;
  size: number;
}

/** 队列错误项 */
export interface QueueError {
  name: string;
  err: string;
}

/** 队列状态快照 */
export interface DownloadState {
  status: string; // "idle" | "downloading" | "done" | "cancelled"
  total: number;
  remaining: number;
  currentFile: string;
  progress: { dl: number; total: number };
  errorList: QueueError[];
  _lastDone: { name: string; status: string; errMsg: string } | null;
  _lastDoneSeq: number;
}

/**
 * 模块级共享状态（progress guard / UI 控制器 import 协作，不对外 re-export）
 *
 * ⚠️ ADR-187 D3 决策固化：本单例是**有意设计**（下载队列 app 级全局唯一，
 * 生命周期与 Events.On 常驻注册绑定，见文件头 ADR-039 豁免声明），
 * 订阅经自建 subscribe/notify（listeners Set），不引入额外页面状态适配层——
 * 双状态哲学并存（两套订阅机制）比单例更伤。
 *
 * ⚠️ 单一写入纪律：所有 STATE 字段修改必须经本模块导出的写入函数，
 * 禁止模块外直接写 STATE.xxx（会绕过 notify 导致订阅者看到陈旧状态）。
 */
const STATE: DownloadState = {
  status: "idle",
  total: 0,
  remaining: 0,
  currentFile: "",
  progress: { dl: 0, total: 0 },
  errorList: [],
  _lastDone: null,
  _lastDoneSeq: 0,
};

/** 外部写入入口：入队失败时回滚 idle（download-queue.ts catch 分支调用） */
export function rollbackToIdle(): void {
  STATE.status = "idle";
  STATE.currentFile = "";
  notify();
}

/** 外部写入入口：进度守卫重置进度为 0（不调 notify，避免在 notify 回调链内触发递归） */
export function resetProgress(): void {
  STATE.progress = { dl: 0, total: 0 };
}

/** 外部写入入口（web 分支经 ctx 注入）：设当前下载文件并 notify */
export function markCurrentFile(name: string): void {
  STATE.currentFile = name;
  notify();
}

/** 外部写入入口（web 分支经 ctx 注入）：剩余计数 -1 并 notify */
export function decrementRemaining(): void {
  STATE.remaining = Math.max(0, STATE.remaining - 1);
  notify();
}

/** 外部写入入口（web 分支经 ctx 注入）：累积队列错误（notify 延迟到下一次 decrementRemaining） */
export function addQueueError(name: string, err: string): void {
  STATE.errorList.push({ name, err });
}

/** 监听器集合（ADR-216 提级共享原语，替代原手搓 Set） */
const listenerSet = createListenerSet<DownloadState>();
let _registered = false;
// P3 修复（审核）：头像提取串行化——每成功一个 .ysm 就调 DebugExtractCreatorAvatar
// （内部跑 Node+WASM 解码，60s 超时）。批量下载 N 个不同作者文件会并发 N 个子进程，
// CPU/内存峰值。用 Promise 链限并发 1，排队执行不丢（作者去重防重复排队）。
let _avatarChain: Promise<void> = Promise.resolve();
const _avatarInFlight = new Set<string>();

/**
 * 订阅 STATE 变更。返回取消订阅函数。
 * 底层经共享原语 createListenerSet（ADR-216）；单一写入纪律不变——
 * 状态修改仍只经本模块导出的写函数，notify 传通知时刻的 STATE 引用。
 */
export function subscribe(fn: (s: DownloadState) => void): () => void {
  return listenerSet.subscribe(fn);
}

/** 广播 STATE 变更（UI 控制器 enqueue 失败回滚等场景也经此通知） */
function notify(): void {
  listenerSet.notify(STATE);
}

/**
 * 当前状态的只读快照（深拷贝，不返回模块级 STATE 的原始引用）。
 *
 * 调用方应只读快照、不可修改——修改会绕过通知链路，导致订阅者看到陈旧状态。
 * 如需修改，请通过本模块提供的 enqueue/cancel/resume 等入口。
 *
 * 与 notify() 的区别：
 * - notify() 推送模型，回调期内的 s 引用为活体，适合立即读取
 * - getStateSnapshot() 拉取模型，返回值独立于 STATE，适合一次性渲染快照
 *
 * 深拷贝范围：progress / errorList / _lastDone 均为嵌套可变结构，浅拷贝会让
 * 快照与 STATE 共享引用——「只读快照」从君子协定变真保证（快照独立性测试见
 * download-queue.test.ts「getStateSnapshot 快照独立性」describe）。
 */
export function getStateSnapshot(): Readonly<DownloadState> {
  return {
    ...STATE,
    progress: { ...STATE.progress },
    // QueueError 元素也需逐个浅拷贝：[...arr] 只拷数组壳，元素对象仍与
    // STATE 共享——快照持有者改 errorList[0].err 会静默污染活状态
    // （code_review 5f7027748 P3）
    errorList: STATE.errorList.map((e) => ({ ...e })),
    _lastDone: STATE._lastDone ? { ...STATE._lastDone } : null,
  };
}

/** @deprecated 请使用 getStateSnapshot()；当前等价于 getStateSnapshot()，保留为兼容 */
export function getState(): DownloadState {
  return getStateSnapshot() as DownloadState;
}

/**
 * 页面切回时调用，从 Go 端恢复当前队列状态。
 * 如果下载仍在运行，STATE.status 会更新为 "downloading"，
 * 已订阅的 UI 层会根据 STATE 渲染进度条。
 */
export async function resume(): Promise<void> {
  try {
    dbg("resume:start");
    const { QueueStatus } = await communityGetApp();
    const result = await QueueStatus();
    dbg("resume:result", result);
    // Wails v2 多返回值映射：数组/对象/单值 三种格式都要兜底
    let remaining: number;
    let running: boolean;
    if (Array.isArray(result)) {
      remaining = result[0] ?? 0;
      running = Boolean(result[1]);
    } else if (result && typeof result === "object") {
      // Wails 某些版本返回 {Remaining, Running} 大写字段
      const r = result as {
        Remaining?: number;
        remaining?: number;
        Running?: boolean;
        running?: boolean;
      };
      remaining = r.Remaining ?? r.remaining ?? 0;
      running = r.Running ?? r.running ?? false;
    } else if (typeof result === "number") {
      remaining = result;
      running = remaining > 0;
    } else {
      return; // 无法解析，安全忽略
    }
    if (running) {
      STATE.status = "downloading";
      STATE.remaining = remaining;
      notify();
    }
  } catch (e) {
    // P3（审核发现）：不静默吞错——QueueStatus 失败会导致恢复/防重入逻辑失明
    dbg("queue:status 解析失败:", e);
  }
}

/**
 * 队列是否处于活跃下载中（downloading 或 enqueued）。
 * Go 端入队后只发 queue:status "enqueued"（从不发 "downloading"），
 * 因此所有「是否在下载」守卫必须同时认两个状态，否则取消/防重入会静默失效（P1 修复）。
 */
export function isActiveStatus(s: DownloadState): boolean {
  return s.status === "downloading" || s.status === "enqueued";
}

/**
 * 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。
 * UI 层应在此之前完成配置检查和 DOM 初始化。
 * 网页版下载入库分支（fetch→IDB / 直链兜底）已拆至 ./download-queue-web.ts（ADR-208 D2），
 * 经 ctx 注入本模块写函数保持单一写入纪律 + 零运行时环。
 */
export async function enqueueDownloads(tasks: DownloadTask[]): Promise<void> {
  dbg("enqueue:start", tasks.length);
  if (isActiveStatus(STATE)) return;
  if (!tasks?.length) return;

  STATE.status = "downloading";
  STATE.total = tasks.length;
  STATE.remaining = tasks.length;
  STATE.currentFile = "";
  STATE.progress = { dl: 0, total: 0 };
  STATE.errorList = [];
  STATE._lastDone = null;
  STATE._lastDoneSeq = 0;
  notify();

  // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
  tasks.forEach((t) => (t.saveDir = t.saveDir || ""));
  // 网页版（ADR-123 P1）：下载与导入统一走 IndexedDB 入库（fetch→IDB / 直链兜底），
  // 实现已拆至 ./download-queue-web.ts（ADR-208 D2）；STATE 写入经下方 ctx 注入的
  // 本模块写函数（单一写入纪律）。完成后置 idle 避免队列 UI 卡「下载中」。
  if (isWebPlatform()) {
    await runWebEnqueue(tasks, {
      markCurrentFile,
      decrementRemaining,
      addQueueError,
      rollbackToIdle,
    });
    return;
  }
  try {
    const { EnqueueDownloads } = await communityGetApp();
    await EnqueueDownloads(tasks);
    dbg("enqueue:done", STATE.status);
  } catch (e) {
    // P3 修复：模块级函数失败也回滚 idle，否则状态永久卡 downloading，
    // 后续所有入队被守卫静默拦截（UI 层 enqueue 另有 toast/按钮恢复兜底）
    STATE.status = "idle";
    notify();
    throw e;
  }
}

/**
 * 模块级取消 — 纯粹的 Go 调用。
 */
export async function cancelDownloads(): Promise<void> {
  if (!isActiveStatus(STATE)) return;
  try {
    const { CancelQueue } = await communityGetApp();
    await CancelQueue();
  } catch (e) {
    // P3（审核发现）：不静默吞错——取消失败时 UI 仍显示下载中，记录原因便于排查
    dbg("cancelDownloads 失败:", e);
  }
}

// ── 一次性注册全部后端事件 ──
// Wails 脚本加载时执行一次，页面切换不受影响
// v3: 事件 payload 为单对象，多参经 Go Emit 打包为数组，此处按 e.data 解构

if (!_registered) {
  _registered = true;

  Events.On("queue:status", (e: { data: unknown }) => {
    const payload = parseEventPayload<QueueStatusPayload>(e, "queue:status");
    if (!payload) return;
    const [status, total, extra] = payload;
    dbg("event:queue:status", status, total, extra);
    STATE.total = total ?? STATE.total;
    if (status === "done" || status === "cancelled") {
      STATE.status = status;
      STATE.currentFile = "";
      STATE.progress = { dl: 0, total: 0 };
      notify();
    } else if (status === "enqueued") {
      STATE.status = "enqueued";
      // ★ 不改 STATE.currentFile，避免覆盖 file-start 已设的文件名
      STATE.progress = { dl: 0, total: 0 };
      notify();
    } else {
      STATE.status = status;
      notify();
    }
  });

  Events.On("queue:file-start", (e: { data: unknown }) => {
    const payload = parseEventPayload<QueueFileStartPayload>(e, "queue:file-start");
    if (!payload) return;
    const [name, total, remaining] = payload;
    dbg("event:queue:file-start", name, total, remaining);
    STATE.currentFile = name;
    STATE.total = total;
    STATE.remaining = remaining;
    STATE.progress = { dl: 0, total: 0 };
    notify();
  });

  Events.On("queue:file-done", (e: { data: unknown }) => {
    const payload = parseEventPayload<QueueFileDonePayload>(e, "queue:file-done");
    if (!payload) return;
    const [name, status, errMsg] = payload;
    dbg("event:queue:file-done", name, status, errMsg);
    if (status === "fail") {
      STATE.errorList.push({ name, err: errMsg || t("error.unknown") });
    }
    STATE._lastDone = { name, status, errMsg: errMsg || "" };
    STATE._lastDoneSeq++;
    notify();

    // 增量提取创作者头像（仅 .ysm 文件成功时）
    if (status === "ok" && /\.ysm$/i.test(name)) {
      const authorMatch = name.match(/^\[(.+?)\]/);
      if (authorMatch) {
        const author = authorMatch[1];
        // P3 修复（审核）：排队串行执行（见 _avatarChain 注释）；同一作者在途去重
        if (!_avatarInFlight.has(author)) {
          _avatarInFlight.add(author);
          _avatarChain = _avatarChain
            .then(async () => {
              try {
                const { CachedCreatorAvatar, DebugExtractCreatorAvatar } = await communityGetApp();
                let dataUri = await CachedCreatorAvatar(author);
                if (!dataUri) {
                  await DebugExtractCreatorAvatar(author);
                  dataUri = await CachedCreatorAvatar(author);
                }
                if (dataUri) {
                  bus.emit("avatar:refresh", { author, dataUri });
                }
              } catch (e) {
                dbg("avatar-refresh", "提取失败:", author, (e as Error)?.message);
              } finally {
                _avatarInFlight.delete(author);
              }
            })
            .catch((e) => {
              // 队列内异常兜底：不能让一个作者失败阻塞后续排队（链已自捕获，双保险）
              dbg("avatar-refresh", "队列异常:", e);
              _avatarInFlight.delete(author);
            });
        }
      }
    }
  });

  Events.On("download:progress", (e: { data: unknown }) => {
    const payload = parseEventPayload<DownloadProgressPayload>(e, "download:progress");
    if (!payload) return;
    const [dl, total] = payload;
    dbg("event:download:progress", dl, total, typeof dl, typeof total);
    // P3 修复（审核）：进度回调边界守卫——非法数值（NaN/±Infinity/负数）归一为 0。
    // 否则 dl=NaN 会渲染成 "NaNMB"（幽灵数值），total 非法会让 pct 计算污染进度条。
    // Content-Length=-1 哨兵（负数）与 total=0 在 render 的 MB 分支语义等价，归一不改变行为。
    STATE.progress = {
      dl: typeof dl === "number" && Number.isFinite(dl) && dl >= 0 ? dl : 0,
      total: typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : 0,
    };
    notify();
  });
}
