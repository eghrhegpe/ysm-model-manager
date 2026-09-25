// ===== 创意工坊 — 批量下载队列 · UI 控制器（ADR-014 P3 features）=====
// 拆分说明（ADR-040 ≤400 行红线）：原 download-queue.ts 829 行拆为三文件——
// · download-queue-store.ts：模块级状态/Go 调用/4 组后端事件注册（含 ADR-039 §2.2 豁免声明）
// · download-queue-progress.ts：99% 卡进度防骗状态机（陷阱 #6 锁定/菊花/completeTimer 收口互斥）
// · 本文件：createDownloadQueue UI 控制器 + 对外 re-export（测试 / events.ts / download-tasks.ts
//   均从本文件取符号，契约零改动）

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { communityGetApp } from "./community-deps.ts";
import { createProgressGuard, type ProgressGuard } from "./download-queue-progress.ts";
import {
  cancelDownloads,
  type DownloadState,
  type DownloadTask,
  enqueueDownloads,
  getStateSnapshot,
  isActiveStatus,
  type QueueError,
  resume,
  rollbackToIdle,
  subscribe,
} from "./download-queue-store.ts";

export type { DownloadState, DownloadTask, QueueError } from "./download-queue-store.ts";
// ── 对外 re-export（保持消费者从本文件导入的既有契约）──
export {
  cancelDownloads,
  enqueueDownloads,
  getState, // @deprecated — 内部委托给 getStateSnapshot
  getStateSnapshot,
  resume,
  subscribe,
} from "./download-queue-store.ts";

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
  onFileSuccess?: ((name: string) => void) | undefined;
  onAllDone?: ((result: { cancelled: boolean; errorList: QueueError[] }) => void) | undefined;
  progressGuard: ProgressGuard;
  prev: CmDqPrev;
}

function cmDqQsEl(ctx: CmDqCtx): HTMLElement | null {
  return ctx.sr.querySelector("#gh-queue-status");
}

function cmDqDlBtn(ctx: CmDqCtx): HTMLButtonElement | null {
  return ctx.sr.querySelector(".gh-dl-selected");
}

/** 设置队列状态行（⬇️ 图标 + 文案）——preparing / downloading-remain 两处共用，DOM API 构建 */
function cmDqSetStatusLine(qs: HTMLElement, text: string): void {
  const icon = document.createElement("span");
  icon.className = "gh-queue-icon";
  icon.innerHTML = UI_ICONS.download;
  qs.replaceChildren(icon, document.createTextNode(` ${text}`));
}

function cmDqCleanupProgressUI(ctx: CmDqCtx, errorSummary?: HTMLElement | null): void {
  ctx.progressGuard.clearCompleteTimer();
  ctx.progressGuard.stuckGuardReset();
  const qs = cmDqQsEl(ctx);
  if (qs) {
    if (errorSummary) {
      qs.replaceChildren(errorSummary);
    } else {
      qs.classList.remove("show");
    }
  }
  const btn = cmDqDlBtn(ctx);
  if (btn) btn.disabled = false;
  try {
    swallowError(
      communityGetApp().then((App) => {
        if (App.ClearScanCache) App.ClearScanCache();
        // 解除 features → views 反向依赖：经 bus 事件解耦，订阅在 views 层注册（ADR-039 范式）
        bus.emit("community:clear-cache");
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
    // DOM API 构建进度行（对齐 render.ts「非字符串拼接」范式）；name span 保留
    // innerHTML——renderDisplayName 返回带 tag-author/tag-work 高亮 span 的受信任
    // HTML（内部已 esc 原文，与 render.ts buildModelRow 同款模式）
    const row = document.createElement("div");
    row.className = "gh-progress-row";
    const icon = document.createElement("span");
    icon.className = "gh-queue-icon";
    icon.innerHTML = UI_ICONS.download;
    const name = document.createElement("span");
    name.className = "gh-progress-name";
    name.innerHTML = renderDisplayName(s.currentFile);
    const pct = document.createElement("span");
    pct.className = "gh-progress-pct";
    pct.innerHTML = UI_ICONS.refresh;
    row.append(icon, name, pct);
    if (remain > 1) {
      const remainEl = document.createElement("span");
      remainEl.className = "gh-progress-remain";
      remainEl.textContent = t("community.downloadQueue.remain", { n: remain });
      row.appendChild(remainEl);
    }
    const cancel = document.createElement("button");
    cancel.className = "btn-base sm gh-cancel-queue";
    cancel.title = t("common.cancel");
    cancel.innerHTML = UI_ICONS.close; // ADR-238 §1.4：结构槽图标位走 SVG（原字面 glyph "✕"）
    cancel.addEventListener("click", async () => {
      if (cancelling) return;
      cancelling = true;
      try {
        await cancelDownloads();
      } finally {
        cancelling = false;
      }
    });
    row.appendChild(cancel);
    const barWrap = document.createElement("div");
    barWrap.className = "gh-progress-bar-wrap";
    const fill = document.createElement("div");
    fill.className = "gh-progress-fill";
    barWrap.appendChild(fill);
    qs.replaceChildren(row, barWrap);
  }
}

function cmDqHandleFileDone(
  ctx: CmDqCtx,
  done: {
    name: string;
    status: string;
    errMsg: string;
  },
): void {
  ctx.progressGuard.forceFileDone(done);
  if (done.status === "ok") {
    if (done.name) ctx.getLocalMap().set(done.name, "");
    cmDqUncheckByName(ctx, done.name);
  } else if (done.status === "fail") {
    cmDqUncheckByName(ctx, done.name);
  }
}

function cmDqUncheckByName(ctx: CmDqCtx, name: string): void {
  const cb = ctx.sr.querySelector(`.gh-sel[data-name="${escapeAttrValue(name)}"]`);
  if (cb) (cb as HTMLInputElement).checked = false;
  if (ctx.onFileSuccess) ctx.onFileSuccess(name);
}

function cmDqHandleQueueEnded(ctx: CmDqCtx, s: DownloadState): void {
  if (!ctx.progressGuard.beginQueueEnded()) return;
  const cancelled = s.status === "cancelled";
  let summary: HTMLElement | null = null;
  if (s.errorList.length > 0) {
    const wrap = document.createElement("div");
    // 摘要容器 class 钩子（A-3：DOM 化后原 flat 拼接失去天然层级，显式命名供
    // 未来样式/测试定位；CSS 视觉等价——content-diag 无组合器规则）
    wrap.className = "gh-queue-error-wrap";
    const title = document.createElement("div");
    title.className = "gh-queue-error";
    title.innerHTML = `${UI_ICONS.error} ${t("downloadQueue.failedListTitle", { n: s.errorList.length })}`;
    wrap.appendChild(title);
    for (const e of s.errorList.slice(0, 5)) {
      const item = document.createElement("div");
      item.className = "gh-queue-err-item";
      // renderDisplayName 为受信任格式化（内部已 esc 原文），ctx.esc(err) 转义用户
      // 数据——拼接无注入面（与 render.ts buildModelRow 的 nameSpan 同款模式）
      item.innerHTML = `${UI_ICONS.error} ${renderDisplayName(e.name)}: ${ctx.esc(e.err)}`;
      wrap.appendChild(item);
    }
    if (s.errorList.length > 5) {
      const more = document.createElement("div");
      more.className = "gh-queue-ellipsis";
      more.textContent = t("downloadQueue.moreCount", { n: s.errorList.length - 5 });
      wrap.appendChild(more);
    }
    summary = wrap;
  }
  if (cancelled) {
    const cancelSpan = document.createElement("span");
    cancelSpan.className = "gh-queue-cancel";
    cancelSpan.innerHTML = `${UI_ICONS.close} ${t("downloadQueue.cancelled")}`;
    cmDqCleanupProgressUI(ctx, summary || cancelSpan);
  } else {
    cmDqCleanupProgressUI(ctx, summary || undefined);
  }
  // 传快照拷贝而非活体引用（2026-09 锐评修复）：s 来自 notify 推送的 STATE 活体，
  // 消费者改写会静默污染活状态——与 onTimedCompletion 路径的 getStateSnapshot 防御级对齐
  if (ctx.onAllDone) ctx.onAllDone({ cancelled, errorList: getStateSnapshot().errorList });
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
      cmDqSetStatusLine(qs, t("downloadQueue.downloadingRemain", { n: s.remaining || "?" }));
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
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
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
    } else if (isActiveStatus(s)) {
      // 认 downloading 与 enqueued 双态（2026-09 锐评修复）：Go 入队后只发 "enqueued"，
      // 原只认 "downloading" 依赖「前端直设态恰好先于事件」的脆弱时序——事件序
      // idle→enqueued 曾跳过 run 分支导致按钮不 disable、进度行不初始化
      cmDqHandleRun(ctx, s);
    } else if (
      s.status === "idle" &&
      (ctx.prev.status === "downloading" || ctx.prev.status === "enqueued")
    ) {
      cmDqHandleEnded(ctx);
    }
  }

  ctx.prev.file = s.status === "done" || s.status === "cancelled" ? "" : s.currentFile;
  ctx.prev.status = s.status;
}

async function cmDqEnqueue(ctx: CmDqCtx, tasks: DownloadTask[]): Promise<void> {
  if (isActiveStatus(getStateSnapshot())) return;
  if (!tasks.length) return;

  try {
    const { GetRepoRoot } = await communityGetApp();
    const filesRoot = await GetRepoRoot(currentRepoType());
    if (!filesRoot) {
      bus.emit("toast:show", {
        msg: t("workshop.configureRepo"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
    tasks.forEach((t) => (t.saveDir = filesRoot));

    const btn = cmDqDlBtn(ctx);
    if (btn) btn.disabled = true;

    const qs = cmDqQsEl(ctx);
    if (qs) {
      qs.classList.add("show");
      cmDqSetStatusLine(qs, t("downloadQueue.preparingTotal", { n: tasks.length }));
    }

    ctx.prev.lastDoneSeq = 0;
    ctx.progressGuard.resetCompletionMutex();
    await enqueueDownloads(tasks);
  } catch (e) {
    rollbackToIdle();
    bus.emit("toast:show", {
      msg: `${t("workshop.enqueueFailed")}: ${safeErrorMessage(e)}`,
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
        if (onAllDone) onAllDone({ cancelled: false, errorList: getStateSnapshot().errorList });
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
    isDownloading: () => isActiveStatus(getStateSnapshot()),
    destroy: () => {
      ctx.progressGuard.stuckGuardReset();
      unsub();
    },
  };
}
