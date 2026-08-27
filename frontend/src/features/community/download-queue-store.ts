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
// download-queue.ts 保留 createDownloadQueue UI 控制器并对外 re-export（消费者零改动）。
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../backend/app.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { Events } from "../../backend/runtime.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";

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

/** 模块级共享状态（progress guard / UI 控制器 import 协作，不对外 re-export） */
export const STATE: DownloadState = {
  status: "idle",
  total: 0,
  remaining: 0,
  currentFile: "",
  progress: { dl: 0, total: 0 },
  errorList: [],
  _lastDone: null,
  _lastDoneSeq: 0,
};

const listeners = new Set<(s: DownloadState) => void>();
let _registered = false;
// P3 修复（审核）：头像提取串行化——每成功一个 .ysm 就调 DebugExtractCreatorAvatar
// （内部跑 Node+WASM 解码，60s 超时）。批量下载 N 个不同作者文件会并发 N 个子进程，
// CPU/内存峰值。用 Promise 链限并发 1，排队执行不丢（作者去重防重复排队）。
let _avatarChain: Promise<void> = Promise.resolve();
const _avatarInFlight = new Set<string>();

/**
 * 订阅 STATE 变更。返回取消订阅函数。
 */
export function subscribe(fn: (s: DownloadState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 广播 STATE 变更（UI 控制器 enqueue 失败回滚等场景也经此通知） */
export function notify(): void {
  listeners.forEach((fn) => fn(STATE));
}

/**
 * 当前状态的只读快照（浅拷贝，不返回模块级 STATE 的原始引用）。
 *
 * 调用方应只读快照、不可修改——修改会绕过通知链路，导致订阅者看到陈旧状态。
 * 如需修改，请通过本模块提供的 enqueue/cancel/resume 等入口。
 *
 * 与 notify() 的区别：
 * - notify() 推送模型，回调期内的 s 引用为活体，适合立即读取
 * - getStateSnapshot() 拉取模型，返回值独立于 STATE，适合一次性渲染快照
 */
export function getStateSnapshot(): Readonly<DownloadState> {
  return { ...STATE };
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
    const { QueueStatus } = await getApp();
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
      const r = result as { Remaining?: number; remaining?: number; Running?: boolean; running?: boolean };
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

// ADR-123 P1：web 下载入库大小上限——超限回退浏览器直链（fetch 整文件进内存 +
// base64 转换对大文件内存压力大，web-common 的 DetectZipType 同款 50MB 量级守卫）
const WEB_DOWNLOAD_IDB_LIMIT = 50 * 1024 * 1024;
/** 网页版单文件 fetch 超时（code_review P2）：挂起服务器不永久卡队列，超时走直链兜底 */
const WEB_DOWNLOAD_FETCH_TIMEOUT_MS = 15_000;

/** 触发浏览器直链保存（web 下载回退分支：大文件 / 协议不符 / fetch 失败） */
function triggerAnchorDownload(url: string, name: string): void {
  if (!url) throw new Error("空下载地址");
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "";
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。
 * UI 层应在此之前完成配置检查和 DOM 初始化。
 */
export async function enqueueDownloads(tasks: DownloadTask[]): Promise<void> {
  dbg("enqueue:start", tasks.length);
  if (isActiveStatus(STATE)) return;
  if (!tasks || !tasks.length) return;

  STATE.status = "downloading";
  STATE.total = tasks.length;
  STATE.remaining = tasks.length;
  STATE.currentFile = "";
  STATE.progress = { dl: 0, total: 0 };
  STATE.errorList = [];
  STATE._lastDone = null;
  STATE._lastDoneSeq = 0;
  notify();

  tasks.forEach((t) => (t.saveDir = t.saveDir || ""));
  // 网页版（ADR-123 P1）：下载与导入统一走 IndexedDB 入库——逐个 fetch(url) 转 File
  // 复用 browser-adapter.importWebFiles 落库（与拖拽导入同一条 IDB/刷新/反馈链路）。
  // 回退分支：非 http(s) 协议、单文件超 50MB、fetch/HTTP 失败 → 浏览器直链 <a download>
  // （用户仍拿到文件但不入库）。完成后置 idle 避免队列 UI 卡「下载中」。
  if (resolveWebMode()) {
    let imported = 0;
    let failed = 0;
    let fallback = 0;
    // P2 修复（code_review）：fetch 无超时 → 挂起服务器可永久卡队列（downloading 态 +
    // 重入守卫丢弃后续入队 + web 模式无取消路径）。逐任务 AbortController 超时，
    // 超时走既有直链兜底；分支级 try/finally 保证任何意外异常都复位 idle。
    try {
      const { importWebFiles } = await import("../../backend/browser-adapter.ts");
      // 目标类型段：cmDqEnqueue 已把 GetRepoRoot 结果写入 saveDir，web 模式恒为
      // /web/<type>（web-fs.ts GetRepoRoot），从根反解即可，不改 enqueueDownloads 签名
      const webType = (tasks[0]?.saveDir || "").split("/")[2] || "";
      for (const task of tasks) {
        STATE.currentFile = task.name;
        notify();
        let handled = false;
        if (
          /^https?:\/\//i.test(task.url || "") &&
          (task.size || 0) <= WEB_DOWNLOAD_IDB_LIMIT
        ) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), WEB_DOWNLOAD_FETCH_TIMEOUT_MS);
          try {
            const resp = await fetch(task.url, { signal: ctrl.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const r = await importWebFiles([new File([blob], task.name || "model")], webType);
            imported += r.imported;
            failed += r.failed; // 导入层的扩展名/大小校验跳过属预期过滤，不回退直链
            handled = true;
          } catch (e) {
            dbg("enqueue:web-idb-fail", task.url, e); // 超时/CORS/网络失败 → 直链兜底
          } finally {
            clearTimeout(timer);
          }
        }
        if (!handled) {
          try {
            triggerAnchorDownload(task.url, task.name);
            fallback++;
          } catch (e) {
            failed++;
            STATE.errorList.push({ name: task.name, err: String((e as Error)?.message || e) });
          }
        }
        STATE.remaining = Math.max(0, STATE.remaining - 1);
        notify();
      }
      // 汇总反馈对齐导入链路语义（importWebFilesWithToast 同款 toast + 刷新广播）
      bus.emit("toast:show", {
        msg:
          failed > 0
            ? t("community.downloadQueue.webDlFailed", { imported, fallback, failed })
            : fallback > 0
              ? t("community.downloadQueue.webDlFallback", { imported, fallback })
              : t("community.downloadQueue.webDlOk", { imported }),
        duration: TOAST_MS.verbose,
        type: failed > 0 ? "warn" : "success",
      });
      bus.emit("tree:reload");
      bus.emit("stats:refresh");
    } catch (e) {
      dbg("enqueue:web-branch-fail", e); // 意外异常不留 downloading 残态
    } finally {
      STATE.status = "idle";
      STATE.currentFile = "";
      notify();
    }
    return;
  }
  try {
    const { EnqueueDownloads } = await getApp();
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
    const { CancelQueue } = await getApp();
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

  Events.On("queue:status", (e: { data: unknown[] }) => {
    const [status, total, extra] = e.data as [string, number, unknown];
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

  Events.On("queue:file-start", (e: { data: unknown[] }) => {
    const [name, total, remaining] = e.data as [string, number, number];
    dbg("event:queue:file-start", name, total, remaining);
    STATE.currentFile = name;
    STATE.total = total;
    STATE.remaining = remaining;
    STATE.progress = { dl: 0, total: 0 };
    notify();
  });

  Events.On("queue:file-done", (e: { data: unknown[] }) => {
    const [name, status, errMsg] = e.data as [string, string, string];
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
                const { CachedCreatorAvatar, DebugExtractCreatorAvatar } =
                  await getApp();
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

  Events.On("download:progress", (e: { data: unknown[] }) => {
    const [dl, total] = e.data as [number, number];
    dbg("event:download:progress", dl, total, typeof dl, typeof total);
    // P3 修复（审核）：进度回调边界守卫——非法数值（NaN/±Infinity/负数）归一为 0。
    // 否则 dl=NaN 会渲染成 "NaNMB"（幽灵数值），total 非法会让 pct 计算污染进度条。
    // Content-Length=-1 哨兵（负数）与 total=0 在 render 的 MB 分支语义等价，归一不改变行为。
    STATE.progress = {
      dl: typeof dl === "number" && Number.isFinite(dl) && dl >= 0 ? dl : 0,
      total:
        typeof total === "number" && Number.isFinite(total) && total >= 0
          ? total
          : 0,
    };
    notify();
  });
}