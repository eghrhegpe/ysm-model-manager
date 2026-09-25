// ===== 创意工坊 — 下载队列 · 进度条守卫（99% 卡进度防骗状态机）=====
// 从 download-queue.ts 拆分（ADR-040 ≤400 行红线）：陷阱 #6 卡进度锁定逻辑内聚于此，
// 自 download-queue.ts 拆分（ADR-040 ≤400 行红线）：陷阱 #6 卡进度锁定逻辑内聚于此。
// 职责：进度条渲染 + 小文件 300ms 强制 100% / 大文件 2s 转菊花 / file-done 强制复位 /
// 3s completeTimer 收口互斥（与队列结束双路收口防重复）。
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { type DownloadState, isActiveStatus, resetProgress } from "./download-queue-store.ts";

// ===== 进度条守卫时序常量 =====
/** 小文件阈值（≤此值走快速 300ms 强制 100% 路径） */
const TINY_FILE_BYTES = 100 * 1024;
/** 大文件阈值（>此值走 2s 转菊花路径） */
const LARGE_FILE_BYTES = 1024 * 1024;
/** 小文件卡 99% 后强制 100% 的延迟 */
const STUCK_TINY_MS = 300;
/** 大文件卡 99% 后转菊花的延迟 */
const STUCK_LARGE_MS = 2000;
/** 菊花点动画间隔 */
const DOT_INTERVAL_MS = 400;
/** 进度 100% 后收口 completeTimer 的延迟 */
const COMPLETE_DELAY_MS = 3000;
/** 进度锁定触发的起始阈值（_lastPct < 此值才触发） */
const STUCK_PCT_THRESHOLD = 10;

/** createProgressGuard 依赖注入（controller 提供查找与收口回调） */
export interface ProgressGuardHooks {
  /** 查找进度条容器（controller 注入其作用域根） */
  qsEl: () => HTMLElement | null;
  /** completeTimer 3s 到期且守卫全部通过时收口（controller：cleanupProgressUI + onAllDone）；summary 为 DOM 节点 */
  onTimedCompletion: (summary?: HTMLElement | null) => void;
}

/** 进度条守卫控制器 */
export interface ProgressGuard {
  /** 渲染进度（含 99% 卡进度锁定状态机） */
  render(s: DownloadState): void;
  /** file-done 到达：ok 强制 100% / fail 显示 ❌，并复位锁定与定时器 */
  forceFileDone(done: { status: string; errMsg: string }): void;
  /** 清空进度并取 pct/fill 元素（ok/fail 分支共用，防重复代码红线） */
  resetProgressUI(): { pctEl: HTMLElement | null; fillEl: HTMLElement | null };
  /** 集中清 _stuckTimer/_dotTimer/completeTimer（destroy 与 cleanup 共用） */
  stuckGuardReset(): void;
  clearCompleteTimer(): void;
  /** 队列结束收口互斥：返回是否首次收口（false = 已收口过，调用方直接 return） */
  beginQueueEnded(): boolean;
  /** 复位收口互斥标志（新批次入队 / 状态变 downloading 时调用） */
  resetCompletionMutex(): void;
}

/** 类型提级：CmPgCtx 收纳全部可变状态与 hooks 引用（community/progress-guard 域） */
interface CmPgCtx {
  qsEl: () => HTMLElement | null;
  onTimedCompletion: (summary?: HTMLElement | null) => void;
  _lastPct: number;
  _stuckLocked: boolean;
  _stuckTimer: ReturnType<typeof setTimeout> | null;
  completeTimer: ReturnType<typeof setTimeout> | null;
  _doneNotified: boolean;
  /** 菊花点动画：timer 与帧数收进守卫闭包（曾挂 pctEl 自定义属性 _dots/_dotTimer——
   * 状态藏 DOM 节点的恶习：重渲染换节点即丢帧、detached 节点吊住 timer，2026-09 锐评整改） */
  _dotTimer: ReturnType<typeof setInterval> | null;
  _dots: number;
}

function cmPgClearCompleteTimer(ctx: CmPgCtx): void {
  if (ctx.completeTimer) {
    clearTimeout(ctx.completeTimer);
    ctx.completeTimer = null;
  }
}

function cmPgStuckGuardReset(ctx: CmPgCtx): void {
  ctx._lastPct = -1;
  ctx._stuckLocked = false;
  cmPgClearCompleteTimer(ctx);
  if (ctx._stuckTimer) {
    clearTimeout(ctx._stuckTimer);
    ctx._stuckTimer = null;
  }
  if (ctx._dotTimer) {
    clearInterval(ctx._dotTimer);
    ctx._dotTimer = null;
  }
}

function cmPgResetProgressUI(ctx: CmPgCtx): {
  pctEl: HTMLElement | null;
  fillEl: HTMLElement | null;
} {
  resetProgress();
  const pctEl = ctx.qsEl()?.querySelector(".gh-progress-pct") as HTMLElement | null;
  const fillEl = ctx.qsEl()?.querySelector(".gh-progress-fill") as HTMLElement | null;
  return { pctEl, fillEl };
}

interface CmPgCalcPctResult {
  pct: number;
  label: string;
  isTiny: boolean;
  total: number;
}

function cmPgCalcPct(s: DownloadState): CmPgCalcPctResult {
  const { dl, total } = s.progress;
  let pct: number;
  let label: string;
  if (!total || total <= 0) {
    const mb = (dl / 1024 / 1024).toFixed(1);
    label = `${mb}MB`;
    pct = 0;
  } else {
    pct = Math.min(Math.round((dl / total) * 100), 100);
    label = `${pct}%`;
  }
  const isTiny = total > 0 && total <= TINY_FILE_BYTES;
  return { pct, label, isTiny, total };
}

function cmPgApplyLock(
  ctx: CmPgCtx,
  qs: HTMLElement,
  pct: number,
  label: string,
  isTiny: boolean,
  total: number,
): { pct: number; label: string } {
  let outPct = pct;
  let outLabel = label;

  if (isTiny && ctx._lastPct < STUCK_PCT_THRESHOLD && pct >= 99 && !ctx.completeTimer) {
    outLabel = "99%";
    outPct = 99;
    ctx._stuckLocked = true;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    ctx._stuckTimer = setTimeout(() => {
      const pctEl2 = qs?.querySelector(".gh-progress-pct") as HTMLElement | null;
      const fillEl2 = qs?.querySelector(".gh-progress-fill") as HTMLElement | null;
      if (pctEl2) pctEl2.textContent = "100%";
      if (fillEl2) {
        fillEl2.style.transition = "width .3s";
        fillEl2.style.width = "100%";
      }
      ctx._stuckTimer = null;
      ctx._stuckLocked = false;
    }, STUCK_TINY_MS);
  }

  const hasCL = total > 0 && pct > 0;
  if (
    hasCL &&
    !isTiny &&
    ctx._lastPct < STUCK_PCT_THRESHOLD &&
    pct >= 99 &&
    total > LARGE_FILE_BYTES
  ) {
    outLabel = "99%";
    outPct = 99;
    ctx._stuckLocked = true;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    const lockPctEl = qs.querySelector(".gh-progress-pct") as HTMLElement | null;
    if (lockPctEl) lockPctEl.textContent = outLabel;
    ctx._stuckTimer = setTimeout(() => {
      const pctEl = qs?.querySelector(".gh-progress-pct") as HTMLElement | null;
      const fillEl = qs?.querySelector(".gh-progress-fill") as HTMLElement | null;
      if (pctEl && pctEl.textContent !== "100%") {
        pctEl.innerHTML = UI_ICONS.refresh;
        pctEl.style.fontSize = "var(--fs-micro)";
        if (ctx._dotTimer) clearInterval(ctx._dotTimer); // 双次进锁不留孤儿动画
        ctx._dots = 0;
        ctx._dotTimer = setInterval(() => {
          // isConnected 守卫：pctEl 被重渲染/移除后文本永远停在 ⏳，原判据（textContent
          // 变 100%）不再触发 → 脱文档即自清（帧数/timer 已在闭包，自清不依赖节点属性）。
          if (!pctEl.isConnected || pctEl.textContent === "100%") {
            if (ctx._dotTimer) {
              clearInterval(ctx._dotTimer);
              ctx._dotTimer = null;
            }
            return;
          }
          ctx._dots = (ctx._dots + 1) % 4;
          pctEl.innerHTML = `${UI_ICONS.refresh}${".".repeat(ctx._dots)}`;
        }, DOT_INTERVAL_MS);
      }
      if (fillEl) fillEl.style.width = "99%";
    }, STUCK_LARGE_MS);
  } else if (!ctx._stuckLocked) {
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
  }
  ctx._lastPct = outPct;

  return { pct: outPct, label: outLabel };
}

function cmPgRender(ctx: CmPgCtx, s: DownloadState): void {
  const qs = ctx.qsEl();
  if (!qs) return;

  const { pct: rawPct, label: rawLabel, isTiny, total } = cmPgCalcPct(s);
  const { pct, label } = cmPgApplyLock(ctx, qs, rawPct, rawLabel, isTiny, total);

  const pctEl = qs.querySelector(".gh-progress-pct") as HTMLElement | null;
  const fillEl = qs.querySelector(".gh-progress-fill") as HTMLElement | null;
  if (pctEl && !ctx._stuckLocked) pctEl.textContent = label;
  if (fillEl) {
    fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
    fillEl.style.width = `${pct}%`;
  }

  if (pct >= 100 && !ctx._stuckLocked) {
    cmPgClearCompleteTimer(ctx);
    ctx.completeTimer = setTimeout(() => {
      if (!isActiveStatus(s)) return;
      if (s.remaining > 0) return;
      if (s._lastDoneSeq > 0 && s.status !== "downloading") return;
      if (ctx._doneNotified) return;
      ctx._doneNotified = true;
      // 错误摘要以 DOM 节点传递（对齐 controller 侧 cmDqCleanupProgressUI 的
      // replaceChildren 收口，消除跨文件 HTML 字符串契约）
      let summary: HTMLElement | null = null;
      if (s.errorList.length > 0) {
        summary = document.createElement("div");
        summary.className = "gh-queue-error";
        summary.innerHTML = `${UI_ICONS.error} ${t("downloadQueue.failedCount", { n: s.errorList.length })}`;
      }
      ctx.onTimedCompletion(summary);
    }, COMPLETE_DELAY_MS);
  } else {
    cmPgClearCompleteTimer(ctx);
  }
}

function cmPgForceFileDone(ctx: CmPgCtx, done: { status: string; errMsg: string }): void {
  if (done.status === "ok") {
    const { pctEl, fillEl } = cmPgResetProgressUI(ctx);
    if (pctEl && (ctx._stuckLocked || pctEl.textContent === "99%")) {
      pctEl.textContent = "100%";
      ctx._stuckLocked = false;
      if (ctx._dotTimer) {
        clearInterval(ctx._dotTimer);
        ctx._dotTimer = null;
      }
      if (fillEl) fillEl.style.width = "100%";
    }
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
  } else if (done.status === "fail") {
    const { pctEl, fillEl } = cmPgResetProgressUI(ctx);
    if (pctEl) {
      pctEl.innerHTML = UI_ICONS.error;
      pctEl.classList.add("gh-progress-error");
      pctEl.title = done.errMsg || t("downloadQueue.hint.failed");
    }
    ctx._stuckLocked = false;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    if (ctx._dotTimer) {
      clearInterval(ctx._dotTimer);
      ctx._dotTimer = null;
    }
    if (fillEl) fillEl.classList.add("gh-progress-fill-error");
  }
}

function cmPgBeginQueueEnded(ctx: CmPgCtx): boolean {
  if (ctx._doneNotified) return false;
  ctx._doneNotified = true;
  return true;
}

function cmPgResetCompletionMutex(ctx: CmPgCtx): void {
  ctx._doneNotified = false;
}

export function createProgressGuard(hooks: ProgressGuardHooks): ProgressGuard {
  const { qsEl, onTimedCompletion } = hooks;
  const ctx: CmPgCtx = {
    qsEl,
    onTimedCompletion,
    _lastPct: -1,
    _stuckLocked: false,
    _stuckTimer: null,
    completeTimer: null,
    _doneNotified: false,
    _dotTimer: null,
    _dots: 0,
  };

  const render = (s: DownloadState): void => cmPgRender(ctx, s);
  const forceFileDone = (done: { status: string; errMsg: string }): void =>
    cmPgForceFileDone(ctx, done);
  const resetProgressUI = (): { pctEl: HTMLElement | null; fillEl: HTMLElement | null } =>
    cmPgResetProgressUI(ctx);
  const stuckGuardReset = (): void => cmPgStuckGuardReset(ctx);
  const clearCompleteTimer = (): void => cmPgClearCompleteTimer(ctx);
  const beginQueueEnded = (): boolean => cmPgBeginQueueEnded(ctx);
  const resetCompletionMutex = (): void => cmPgResetCompletionMutex(ctx);

  return {
    render,
    forceFileDone,
    resetProgressUI,
    stuckGuardReset,
    clearCompleteTimer,
    beginQueueEnded,
    resetCompletionMutex,
  };
}
