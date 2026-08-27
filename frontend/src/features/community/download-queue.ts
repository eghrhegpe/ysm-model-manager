// ===== 创意工坊 — 批量下载队列 · UI 控制器（ADR-014 P3 features）=====
// 拆分说明（ADR-040 ≤400 行红线）：原 download-queue.ts 829 行拆为三文件——
// · download-queue-store.ts：模块级状态/Go 调用/4 组后端事件注册（含 ADR-039 §2.2 豁免声明）
// · download-queue-progress.ts：99% 卡进度防骗状态机（陷阱 #6 锁定/菊花/completeTimer 收口互斥）
// · 本文件：createDownloadQueue UI 控制器 + 对外 re-export（测试 / events.ts / download-tasks.ts
//   均从本文件取符号，契约零改动）
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { currentRepoType } from "../repo-rtype.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../backend/app.ts";
import { swallowError } from "../../utils/core/async.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import {
  STATE,
  notify,
  subscribe,
  resume,
  isActiveStatus,
  enqueueDownloads,
  cancelDownloads,
  type DownloadState,
  type DownloadTask,
  type QueueError,
} from "./download-queue-store.ts";
import { createProgressGuard, type ProgressGuard } from "./download-queue-progress.ts";

// ── 对外 re-export（保持消费者从本文件导入的既有契约）──
export {
  subscribe,
  getStateSnapshot,
  getState, // @deprecated — 内部委托给 getStateSnapshot
  resume,
  enqueueDownloads,
  cancelDownloads,
} from "./download-queue-store.ts";
export type { DownloadTask, DownloadState, QueueError } from "./download-queue-store.ts";

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

/** 旧契约别名（events.ts / download-tasks.ts 仍使用 DownloadQueue 命名） */
export type DownloadQueue = QueueController;

interface CmDqPrev {
  status: string;
  file: string;
  lastDoneSeq: number;
}

interface CmDqCtx {
  sr: HTMLElement;
  esc: (s: string) => string;
  getLocalMap: () => Map<string, string>;
  onFileSuccess?: (name: string) => void;
  onAllDone?: (result: { cancelled: boolean; errorList: QueueError[] }) => void;
  progressGuard: ProgressGuard;
  prev: CmDqPrev;
}

function cmDqQsEl(ctx: CmDqCtx): HTMLElement | null {
  return ctx.sr.querySelector("#gh-queue-status");
}

function cmDqDlBtn(ctx: CmDqCtx): HTMLButtonElement | null {
  return ctx.sr.querySelector(".gh-dl-selected");
}

function cmDqCleanupProgressUI(ctx: CmDqCtx, errorSummary?: string): void {
  ctx.progressGuard.clearCompleteTimer();
  ctx.progressGuard.stuckGuardReset();
  const qs = cmDqQsEl(ctx);
  if (qs) {
    if (errorSummary) {
      qs.innerHTML = errorSummary;
    } else {
      qs.classList.remove("show");
    }
  }
  const btn = cmDqDlBtn(ctx);
  if (btn) btn.disabled = false;
  try {
    swallowError(
      getApp()
        .then((App) => {
          if (App.ClearScanCache) App.ClearScanCache();
          import("../../views/app-content/community-data.ts").then(m => m.clearAllCommunityCache()).catch((e) => console.warn("[download-queue] clearAllCommunityCache:", e));
        }),
    );
  } catch (_) {
    /* 清除缓存失败不影响清理 */
  }
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

function cmDqHandleFileStart(ctx: CmDqCtx, s: DownloadState): void {
  ctx.progressGuard.stuckGuardReset();
  let cancelling = false;
  const done = s.total - s.remaining;
  const qs = cmDqQsEl(ctx);
  if (qs) {
    const remain = s.total - done;
    qs.innerHTML =
      '<div class="gh-progress-row">' +
      '<span class="gh-queue-icon">⬇️</span>' +
      '<span class="gh-progress-name">' +
      renderDisplayName(s.currentFile) +
      "</span>" +
      '<span class="gh-progress-pct">⏳</span>' +
      (remain > 1
        ? '<span class="gh-progress-remain">' +
          t("community.downloadQueue.remain", { n: remain }) +
          "</span>"
        : "") +
      '<button class="btn-base sm gh-cancel-queue" title="' + t("common.cancel") + '">✕</button>' +
      "</div>" +
      '<div class="gh-progress-bar-wrap"><div class="gh-progress-fill"></div></div>';
    qs.querySelector(".gh-cancel-queue")?.addEventListener("click", async () => {
      if (cancelling) return;
      cancelling = true;
      try {
        await cancelDownloads();
      } finally {
        cancelling = false;
      }
    });
  }
}

function cmDqHandleFileDone(ctx: CmDqCtx, done: {
  name: string;
  status: string;
  errMsg: string;
}): void {
  ctx.progressGuard.forceFileDone(done);
  if (done.status === "ok") {
    if (done.name) ctx.getLocalMap().set(done.name, "");
    cmDqUncheckByName(ctx, done.name);
  } else if (done.status === "fail") {
    cmDqUncheckByName(ctx, done.name);
  }
}

function cmDqUncheckByName(ctx: CmDqCtx, name: string): void {
  const cb = ctx.sr.querySelector(
    '.gh-sel[data-name="' + escapeAttrValue(name) + '"]',
  );
  if (cb) (cb as HTMLInputElement).checked = false;
  if (ctx.onFileSuccess) ctx.onFileSuccess(name);
}

function cmDqHandleQueueEnded(ctx: CmDqCtx, s: DownloadState): void {
  if (!ctx.progressGuard.beginQueueEnded()) return;
  const cancelled = s.status === "cancelled";
  let summary = "";
  if (s.errorList.length > 0) {
    summary =
      '<div class="gh-queue-error">⚠️ ' +
      t("downloadQueue.failedListTitle", { n: s.errorList.length }) +
      "</div>" +
      s.errorList
        .slice(0, 5)
        .map(
          (e) =>
            '<div class="gh-queue-err-item">❌ ' +
            renderDisplayName(e.name) +
            ": " +
            ctx.esc(e.err) +
            "</div>",
        )
        .join("") +
      (s.errorList.length > 5
        ? '<div class="gh-queue-ellipsis">' +
          t("downloadQueue.moreCount", { n: s.errorList.length - 5 }) +
          "</div>"
        : "");
  }
  if (cancelled) {
    cmDqCleanupProgressUI(ctx, summary || '<span class="gh-queue-cancel">⏹ ' + t("downloadQueue.cancelled") + "</span>");
  } else {
    cmDqCleanupProgressUI(ctx, summary || undefined);
  }
  if (ctx.onAllDone) ctx.onAllDone({ cancelled, errorList: s.errorList });
}

function cmDqHandleCancel(ctx: CmDqCtx, s: DownloadState): void {
  ctx.progressGuard.clearCompleteTimer();
  cmDqHandleQueueEnded(ctx, s);
}

function cmDqHandleRun(ctx: CmDqCtx, s: DownloadState): void {
  ctx.progressGuard.resetCompletionMutex();
  const qs = cmDqQsEl(ctx);
  const btn = cmDqDlBtn(ctx);
  if (btn) btn.disabled = true;
  if (qs && !qs.classList.contains("show")) {
    qs.classList.add("show");
    if (s.currentFile) {
      cmDqHandleFileStart(ctx, s);
    } else {
      qs.innerHTML =
        '<span class="gh-queue-icon">⬇️</span> ' +
        t("downloadQueue.downloadingRemain", { n: s.remaining || "?" });
    }
  }
}

function cmDqHandleEnded(ctx: CmDqCtx): void {
  const btn = cmDqDlBtn(ctx);
  if (btn) btn.disabled = false;
  const qs = cmDqQsEl(ctx);
  if (qs) qs.classList.remove("show");
}

function cmDqHandleStateChange(ctx: CmDqCtx, s: DownloadState): void {
  if (s._lastDoneSeq > ctx.prev.lastDoneSeq) {
    cmDqHandleFileDone(ctx, s._lastDone!);
    ctx.prev.lastDoneSeq = s._lastDoneSeq;
  }

  if (s.currentFile && s.currentFile !== ctx.prev.file) {
    cmDqHandleFileStart(ctx, s);
  }

  if (s.progress && (s.progress.dl > 0 || s.progress.total > 0)) {
    ctx.progressGuard.render(s);
  }

  if (s.status !== ctx.prev.status) {
    if (s.status === "done" || s.status === "cancelled") {
      cmDqHandleCancel(ctx, s);
    } else if (s.status === "downloading") {
      cmDqHandleRun(ctx, s);
    } else if (s.status === "idle" && ctx.prev.status === "downloading") {
      cmDqHandleEnded(ctx);
    }
  }

  ctx.prev.file = s.status === "done" || s.status === "cancelled" ? "" : s.currentFile;
  ctx.prev.status = s.status;
}

async function cmDqEnqueue(ctx: CmDqCtx, tasks: DownloadTask[]): Promise<void> {
  if (isActiveStatus(STATE)) return;
  if (!tasks.length) return;

  try {
    const { GetRepoRoot } = await getApp();
    const filesRoot = await GetRepoRoot(currentRepoType());
    if (!filesRoot) {
      bus.emit("toast:show", {
        msg: t("workshop.configureRepo"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    tasks.forEach((t) => (t.saveDir = filesRoot));

    const btn = cmDqDlBtn(ctx);
    if (btn) btn.disabled = true;

    const qs = cmDqQsEl(ctx);
    if (qs) {
      qs.classList.add("show");
      qs.innerHTML =
        '<span class="gh-queue-icon">⬇️</span> ' +
        t("downloadQueue.preparingTotal", { n: tasks.length });
    }

    ctx.prev.lastDoneSeq = 0;
    ctx.progressGuard.resetCompletionMutex();
    await enqueueDownloads(tasks);
  } catch (e) {
    STATE.status = "idle";
    notify();
    bus.emit("toast:show", {
      msg: `❌ ${t("workshop.enqueueFailed")}: ` + (safeErrorMessage(e)),
      duration: TOAST_MS.verbose,
      type: "error",
    });
    cmDqCleanupProgressUI(ctx);
  }
}

async function cmDqCancel(): Promise<void> {
  await cancelDownloads();
}

/**
 * 属性选择器值转义。
 * 浏览器用标准 CSS.escape 正确处理 & < > 等字符（修复 &amp; 不还原问题，ADR-039 P3）；
 * 降级分支（CSS.escape 不可用时）做最小转义（" 与 \），覆盖非标准环境。
 */
function escapeAttrValue(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * 创建一个下载队列 UI 控制器。
 * 所有 Go 事件已在 download-queue-store.ts 模块顶层注册，本函数只负责：
 *   1. 订阅 STATE 变更 → 渲染进度 DOM（进度条细节委托 progressGuard）
 *   2. 暴露 enqueue() / cancel() 供事件绑定使用
 */
export function createDownloadQueue({
  sr,
  esc,
  getLocalMap,
  onFileSuccess,
  onAllDone,
}: QueueControllerOptions): QueueController {
  const ctx: CmDqCtx = {
    sr,
    esc,
    getLocalMap,
    onFileSuccess,
    onAllDone,
    progressGuard: createProgressGuard({
      qsEl: () => cmDqQsEl(ctx),
      onTimedCompletion: (summary) => {
        cmDqCleanupProgressUI(ctx, summary);
        if (onAllDone) onAllDone({ cancelled: false, errorList: STATE.errorList });
      },
    }),
    prev: {
      status: "idle",
      file: "",
      lastDoneSeq: 0,
    },
  };

  const unsub = subscribe((s) => cmDqHandleStateChange(ctx, s));

  void resume();

  return {
    enqueue: (tasks) => cmDqEnqueue(ctx, tasks),
    cancel: cmDqCancel,
    isDownloading: () => isActiveStatus(STATE),
    destroy: () => {
      ctx.progressGuard.stuckGuardReset();
      unsub();
    },
  };
}
