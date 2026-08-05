// ===== 创意工坊 — 批量下载队列（类型化版 — ADR-014 P3 features）=====
// v2: 模块级持久层 — EventsOn 在脚本加载时注册一次，页面切换不丢失事件
//
// ⚠️ ADR-039 §2.2 Events.On 豁免声明：
// 本模块顶层注册 4 组 Wails Events.On（queue:status / queue:file-start / queue:file-done /
// download:progress），无对应 Events.Off 退出路径。认定为 app 级单例豁免——
// download-queue 是社区页常驻单例（_registered 布尔守卫防重复注册），
// 生命周期等于应用生命周期，与 registerErrorDiary / matchMedia 监听同类。
// 禁止非 app 级模块复制此模式；若未来社区页支持卸载/热重载，再补 Events.Off。
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../wails/app.ts";
import { Events } from "@wailsio/runtime";

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

/** 进度条元素的自定义属性（点动画） */
type PctEl = HTMLElement & {
  _dotTimer?: ReturnType<typeof setInterval> | null;
  _dots?: number;
};

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

const listeners = new Set<(s: DownloadState) => void>();
let _registered = false;

/**
 * 订阅 STATE 变更。返回取消订阅函数。
 */
export function subscribe(fn: (s: DownloadState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  listeners.forEach((fn) => fn(STATE));
}

/** 当前状态的只读快照 */
export function getState(): DownloadState {
  return STATE;
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
  } catch (_) {
    /* QueueStatus 调用失败，安全忽略 */
  }
}

/**
 * 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。
 * UI 层应在此之前完成配置检查和 DOM 初始化。
 */
export async function enqueueDownloads(tasks: DownloadTask[]): Promise<void> {
  dbg("enqueue:start", tasks.length);
  if (STATE.status === "downloading") return;
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
  const { EnqueueDownloads } = await getApp();
  await EnqueueDownloads(tasks);
  dbg("enqueue:done", STATE.status);
}

/**
 * 模块级取消 — 纯粹的 Go 调用。
 */
export async function cancelDownloads(): Promise<void> {
  if (STATE.status !== "downloading") return;
  try {
    const { CancelQueue } = await getApp();
    await CancelQueue();
  } catch (_) {
    /* 取消失败不影响状态 */
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
      STATE.errorList.push({ name, err: errMsg || "未知错误" });
    }
    STATE._lastDone = { name, status, errMsg: errMsg || "" };
    STATE._lastDoneSeq++;
    notify();

    // 增量提取创作者头像（仅 .ysm 文件成功时）
    if (status === "ok" && /\.ysm$/i.test(name)) {
      const authorMatch = name.match(/^\[(.+?)\]/);
      if (authorMatch) {
        const author = authorMatch[1];
        (async () => {
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
          }
        })();
      }
    }
  });

  Events.On("download:progress", (e: { data: unknown[] }) => {
    const [dl, total] = e.data as [number, number];
    dbg("event:download:progress", dl, total, typeof dl, typeof total);
    STATE.progress = { dl, total };
    notify();
  });
}

// ============================================================
//  createDownloadQueue — UI 层（订阅 STATE → 渲染 DOM）
// ============================================================

/** createDownloadQueue 选项 */
export interface QueueControllerOptions {
  sr: HTMLElement;
  esc: (s: string) => string;
  getLocalMap: () => Map<string, string>;
  onFileSuccess?: (name: string) => void;
  onAllDone?: (result: { cancelled: boolean; errorList: QueueError[] }) => void;
}

/** 队列控制器 */
export interface QueueController {
  enqueue: (tasks: DownloadTask[]) => Promise<void>;
  cancel: () => Promise<void>;
  isDownloading: () => boolean;
  destroy: () => void;
}

/**
 * 创建一个下载队列 UI 控制器。
 * 所有 Go 事件已在模块顶层注册，本函数只负责：
 *   1. 订阅 STATE 变更 → 渲染进度 DOM
 *   2. 暴露 enqueue() / cancel() 供事件绑定使用
 */
export function createDownloadQueue({
  sr,
  esc,
  getLocalMap,
  onFileSuccess,
  onAllDone,
}: QueueControllerOptions): QueueController {
  let _prevStatus = "idle";
  let _prevFile = "";
  let _prevLastDoneSeq = 0;
  let _lastPct = -1;
  let _stuckTimer: ReturnType<typeof setTimeout> | null = null;
  let completeTimer: ReturnType<typeof setTimeout> | null = null;

  const qsEl = (): HTMLElement | null => sr.querySelector("#gh-queue-status");
  const dlBtn = (): HTMLButtonElement | null =>
    sr.querySelector(".gh-dl-selected");

  // ── 工具函数 ──

  const clearCompleteTimer = (): void => {
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = null;
    }
  };

  const stuckGuardReset = (): void => {
    _lastPct = -1;
    clearCompleteTimer();
    if (_stuckTimer) {
      clearTimeout(_stuckTimer);
      _stuckTimer = null;
    }
    const pctEl = qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
    if (pctEl?._dotTimer) {
      clearInterval(pctEl._dotTimer);
      pctEl._dotTimer = null;
    }
  };

  const cleanupProgressUI = (errorSummary?: string): void => {
    clearCompleteTimer();
    stuckGuardReset();
    const qs = qsEl();
    if (qs) {
      if (errorSummary) {
        qs.innerHTML = errorSummary;
      } else {
        qs.classList.remove("show");
      }
    }
    // 统一恢复下载按钮（成功/取消/失败路径都经此清理，防按钮卡死）
    const btn = dlBtn();
    if (btn) btn.disabled = false;
    try {
      getApp()
        .then((App) => {
          if (App.ClearScanCache) App.ClearScanCache();
        })
        .catch(() => {});
    } catch (_) {
      /* 清除缓存失败不影响清理 */
    }
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
  };

  // ── 事件 → UI 映射 ──

  /** 新文件开始下载 → 渲染进度行 + 取消按钮 */
  function handleFileStart(s: DownloadState): void {
    stuckGuardReset();
    const done = s.total - s.remaining;
    const qs = qsEl();
    if (qs) {
      const remain = s.total - done;
      qs.innerHTML =
        '<div class="gh-progress-row">' +
        '<span class="gh-queue-icon">⬇️</span>' +
        '<span class="gh-progress-name">' +
        renderDisplayName(s.currentFile) +
        "</span>" +
        '<span class="gh-progress-pct">⏳</span>' +
        (remain > 1 ? '<span class="gh-progress-remain">剩余' + remain + "</span>" : "") +
        '<button class="btn-base sm gh-cancel-queue" title="取消">✕</button>' +
        "</div>" +
        '<div class="gh-progress-bar-wrap"><div class="gh-progress-fill"></div></div>';
      qs.querySelector(".gh-cancel-queue")?.addEventListener("click", async () => {
        await cancelDownloads();
      });
    }
  }

  /** 下载进度更新 → 更新进度条和百分比 */
  function handleProgress(s: DownloadState): void {
    const qs = qsEl();
    if (!qs) return;
    const { dl, total } = s.progress;

    let pct: number;
    let label: string;
    if (!total || total <= 0) {
      const mb = (dl / 1024 / 1024).toFixed(1);
      label = mb + "MB";
      // Content-Length=-1 时不得误报 100%（陷阱 #6）：完成判定只信任 file-done / queue:status done
      pct = 0;
    } else {
      pct = Math.min(Math.round((dl / total) * 100), 100);
      label = pct + "%";
    }

    const isTiny = total > 0 && total <= 100 * 1024;

    // 小文件卡进度防骗
    if (isTiny && _lastPct < 10 && pct >= 99 && !completeTimer) {
      label = "99%";
      pct = 99;
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      _stuckTimer = setTimeout(() => {
        const pctEl2 = qs?.querySelector(".gh-progress-pct") as PctEl | null;
        const fillEl2 = qs?.querySelector(
          ".gh-progress-fill",
        ) as HTMLElement | null;
        if (pctEl2) pctEl2.textContent = "100%";
        if (fillEl2) {
          fillEl2.style.transition = "width .3s";
          fillEl2.style.width = "100%";
        }
        _stuckTimer = null;
      }, 300);
    }

    // 大文件卡进度防骗（CLIP / VAE / UNET 结尾）
    const hasCL = total > 0 && pct > 0;
    if (hasCL && !isTiny && _lastPct < 10 && pct >= 99 && total > 1024 * 1024) {
      label = "99%";
      pct = 99;
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      (qs.querySelector(".gh-progress-pct") as PctEl).textContent = label;
      _stuckTimer = setTimeout(() => {
        const pctEl = qs?.querySelector(".gh-progress-pct") as PctEl | null;
        const fillEl = qs?.querySelector(
          ".gh-progress-fill",
        ) as HTMLElement | null;
        if (pctEl && pctEl.textContent !== "100%") {
          pctEl.textContent = "⏳";
          pctEl.style.fontSize = "9px";
          pctEl._dots = 0;
          pctEl._dotTimer = setInterval(() => {
            if (!pctEl || pctEl.textContent === "100%") {
              if (pctEl?._dotTimer) clearInterval(pctEl._dotTimer);
              return;
            }
            pctEl._dots = ((pctEl._dots || 0) + 1) % 4;
            pctEl.textContent = "⏳" + ".".repeat(pctEl._dots);
          }, 400);
        }
        if (fillEl) fillEl.style.width = "99%";
      }, 2000);
    } else {
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
    }
    _lastPct = pct;

    const pctEl = qs.querySelector(".gh-progress-pct") as PctEl | null;
    const fillEl = qs.querySelector(
      ".gh-progress-fill",
    ) as HTMLElement | null;
    if (pctEl && !_stuckTimer) pctEl.textContent = label;
    if (fillEl) {
      fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
      fillEl.style.width = pct + "%";
    }

    if (pct >= 100) {
      clearCompleteTimer();
      completeTimer = setTimeout(() => {
        if (STATE.status !== "downloading") return;
        let summary: string | undefined;
        if (STATE.errorList.length > 0) {
          summary =
            '<div class="gh-queue-error">⚠️ ' +
            STATE.errorList.length +
            " 个文件下载失败</div>";
        }
        cleanupProgressUI(summary);
        if (onAllDone)
          onAllDone({ cancelled: false, errorList: STATE.errorList });
      }, 3000);
    } else {
      clearCompleteTimer();
    }
  }

  /** 文件下载完成 → 更新本地缓存 / 清勾选 / 显示错误 */
  function handleFileDone(done: {
    name: string;
    status: string;
    errMsg: string;
  }): void {
    if (done.status === "ok") {
      // file-done 到达时强制覆盖卡在 99% 的进度条
      const pctEl = qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
      const fillEl = qsEl()?.querySelector(
        ".gh-progress-fill",
      ) as HTMLElement | null;
      if (pctEl && pctEl.textContent === "99%") {
        pctEl.textContent = "100%";
        if (pctEl._dotTimer) {
          clearInterval(pctEl._dotTimer);
          pctEl._dotTimer = null;
        }
        if (fillEl) fillEl.style.width = "100%";
      }
      if (done.name) getLocalMap().set(done.name, "");
      const cb = sr.querySelector('.gh-sel[data-name="' + esc(done.name) + '"]');
      if (cb) (cb as HTMLInputElement).checked = false;
      if (onFileSuccess) onFileSuccess(done.name);
    } else if (done.status === "fail") {
      const pctEl = qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
      const fillEl = qsEl()?.querySelector(
        ".gh-progress-fill",
      ) as HTMLElement | null;
      if (pctEl) {
        pctEl.textContent = "❌";
        pctEl.classList.add("gh-progress-error");
        pctEl.title = done.errMsg || "下载失败";
        if (pctEl._dotTimer) {
          clearInterval(pctEl._dotTimer);
          pctEl._dotTimer = null;
        }
      }
      if (fillEl) fillEl.classList.add("gh-progress-fill-error");
      const cb = sr.querySelector('.gh-sel[data-name="' + esc(done.name) + '"]');
      if (cb) (cb as HTMLInputElement).checked = false;
      if (onFileSuccess) onFileSuccess(done.name);
    }
  }

  /** 队列结束 → 显示错误摘要 / 清理 UI / 通知外部 */
  function handleQueueEnded(s: DownloadState): void {
    const cancelled = s.status === "cancelled";
    let summary = "";
    if (s.errorList.length > 0) {
      summary =
        '<div class="gh-queue-error">⚠️ ' +
        s.errorList.length +
        " 个文件下载失败：</div>" +
        s.errorList
          .slice(0, 5)
          .map(
            (e) =>
              '<div class="gh-queue-err-item">❌ ' +
              renderDisplayName(e.name) +
              ": " +
              esc(e.err) +
              "</div>",
          )
          .join("") +
        (s.errorList.length > 5
          ? '<div class="gh-queue-ellipsis">…还有 ' +
            (s.errorList.length - 5) +
            " 个</div>"
          : "");
    }
    if (cancelled) {
      cleanupProgressUI(summary || '<span class="gh-queue-cancel">⏹ 已取消</span>');
    } else {
      cleanupProgressUI(summary || undefined);
    }
    if (onAllDone) onAllDone({ cancelled, errorList: s.errorList });
  }

  // ── 核心：订阅 STATE → 渲染 DOM ──

  function handleStateChange(s: DownloadState): void {
    // 文件完成事件（可能夹在 file-start 和 progress 之间到达）
    if (s._lastDoneSeq > _prevLastDoneSeq) {
      handleFileDone(s._lastDone!);
      _prevLastDoneSeq = s._lastDoneSeq;
    }

    // 新文件开始
    if (s.currentFile && s.currentFile !== _prevFile) {
      handleFileStart(s);
    }

    // 下载进度更新
    if (s.progress && (s.progress.dl > 0 || s.progress.total > 0)) {
      handleProgress(s);
    }

    // 队列状态变化
    if (s.status !== _prevStatus) {
      if (s.status === "done" || s.status === "cancelled") {
        clearCompleteTimer(); // 强制清掉进度条 3s timer，防止 "100% → done" 间隙
        handleQueueEnded(s);
      } else if (s.status === "downloading") {
        // 队列启动或 resume 恢复 — 确保 UI 就绪
        const qs = qsEl();
        const btn = dlBtn();
        if (btn) btn.disabled = true;
        if (qs && !qs.classList.contains("show")) {
          // resume 路径：UI 未初始化，补上进度条
          qs.classList.add("show");
          if (s.currentFile) {
            handleFileStart(s);
          } else {
            qs.innerHTML =
              '<span class="gh-queue-icon">⬇️</span> 下载中… 剩余 ' +
              (s.remaining || "?") +
              " 个";
          }
        }
      }
    }

    _prevFile = s.currentFile;
    _prevStatus = s.status;
  }

  const unsub = subscribe(handleStateChange);

  // 页面进入时恢复下载状态（防止切页期间进度丢失）
  void resume();

  // ── 公开 API ──

  async function enqueue(tasks: DownloadTask[]): Promise<void> {
    if (STATE.status === "downloading") return;
    if (!tasks.length) return;

    const { GetRepoRoot } = await getApp();
    const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    if (!repoRoot) {
      bus.emit("toast:show", {
        msg: "请先配置仓库目录",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    tasks.forEach((t) => (t.saveDir = repoRoot));

    const btn = dlBtn();
    if (btn) btn.disabled = true;

    const qs = qsEl();
    if (qs) {
      qs.classList.add("show");
      qs.innerHTML =
        '<span class="gh-queue-icon">⬇️</span> 准备下载… 共 ' +
        tasks.length +
        " 个";
    }

    try {
      await enqueueDownloads(tasks);
    } catch (e) {
      // Go 入队失败：恢复状态与 UI，防止按钮/进度条卡死（陷阱 #3）
      STATE.status = "idle";
      notify();
      bus.emit("toast:show", {
        msg: "❌ 入队失败: " + (e instanceof Error ? e.message : String(e)),
        duration: 4000,
        type: "error",
      });
      cleanupProgressUI();
    }
  }

  async function cancel(): Promise<void> {
    await cancelDownloads();
  }

  return {
    enqueue,
    cancel,
    isDownloading: () => STATE.status === "downloading",
    /** 组件销毁时取消订阅，防止僵尸回调累积 */
    destroy: unsub,
  };
}
