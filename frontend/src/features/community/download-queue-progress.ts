// ===== 创意工坊 — 下载队列 · 进度条守卫（99% 卡进度防骗状态机）=====
// 从 download-queue.ts 拆分（ADR-040 ≤400 行红线）：陷阱 #6 卡进度锁定逻辑内聚于此，
// 逻辑零改动纯搬移——回归护栏见 download-queue.test.ts「99% 锁定状态机」describe。
// 职责：进度条渲染 + 小文件 300ms 强制 100% / 大文件 2s 转菊花 / file-done 强制复位 /
// 3s completeTimer 收口互斥（与队列结束双路收口防重复）。
import { t } from "../../core/i18n/t.ts";
import { type DownloadState, isActiveStatus, STATE } from "./download-queue-store.ts";

/** 进度条元素的自定义属性（点动画） */
type PctEl = HTMLElement & {
  _dotTimer?: ReturnType<typeof setInterval> | null;
  _dots?: number;
};

/** createProgressGuard 依赖注入（controller 提供查找与收口回调） */
export interface ProgressGuardHooks {
  /** 查找进度条容器（controller 注入其作用域根） */
  qsEl: () => HTMLElement | null;
  /** completeTimer 3s 到期且守卫全部通过时收口（controller：cleanupProgressUI + onAllDone） */
  onTimedCompletion: (summary?: string) => void;
}

/** 进度条守卫控制器 */
export interface ProgressGuard {
  /** 渲染进度（含 99% 卡进度锁定状态机） */
  render(s: DownloadState): void;
  /** file-done 到达：ok 强制 100% / fail 显示 ❌，并复位锁定与定时器 */
  forceFileDone(done: { status: string; errMsg: string }): void;
  /** 清空进度并取 pct/fill 元素（ok/fail 分支共用，防重复代码红线） */
  resetProgressUI(): { pctEl: PctEl | null; fillEl: HTMLElement | null };
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
  onTimedCompletion: (summary?: string) => void;
  _lastPct: number;
  _stuckLocked: boolean;
  _stuckTimer: ReturnType<typeof setTimeout> | null;
  completeTimer: ReturnType<typeof setTimeout> | null;
  _doneNotified: boolean;
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
  const pctEl = ctx.qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
  if (pctEl?._dotTimer) {
    clearInterval(pctEl._dotTimer);
    pctEl._dotTimer = null;
  }
}

function cmPgResetProgressUI(ctx: CmPgCtx): { pctEl: PctEl | null; fillEl: HTMLElement | null } {
  STATE.progress = { dl: 0, total: 0 };
  const pctEl = ctx.qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
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
    label = mb + "MB";
    pct = 0;
  } else {
    pct = Math.min(Math.round((dl / total) * 100), 100);
    label = pct + "%";
  }
  const isTiny = total > 0 && total <= 100 * 1024;
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

  if (isTiny && ctx._lastPct < 10 && pct >= 99 && !ctx.completeTimer) {
    outLabel = "99%";
    outPct = 99;
    ctx._stuckLocked = true;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    ctx._stuckTimer = setTimeout(() => {
      const pctEl2 = qs?.querySelector(".gh-progress-pct") as PctEl | null;
      const fillEl2 = qs?.querySelector(".gh-progress-fill") as HTMLElement | null;
      if (pctEl2) pctEl2.textContent = "100%";
      if (fillEl2) {
        fillEl2.style.transition = "width .3s";
        fillEl2.style.width = "100%";
      }
      ctx._stuckTimer = null;
      ctx._stuckLocked = false;
    }, 300);
  }

  const hasCL = total > 0 && pct > 0;
  if (hasCL && !isTiny && ctx._lastPct < 10 && pct >= 99 && total > 1024 * 1024) {
    outLabel = "99%";
    outPct = 99;
    ctx._stuckLocked = true;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    const lockPctEl = qs.querySelector(".gh-progress-pct") as PctEl | null;
    if (lockPctEl) lockPctEl.textContent = outLabel;
    ctx._stuckTimer = setTimeout(() => {
      const pctEl = qs?.querySelector(".gh-progress-pct") as PctEl | null;
      const fillEl = qs?.querySelector(".gh-progress-fill") as HTMLElement | null;
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

  const pctEl = qs.querySelector(".gh-progress-pct") as PctEl | null;
  const fillEl = qs.querySelector(".gh-progress-fill") as HTMLElement | null;
  if (pctEl && !ctx._stuckLocked) pctEl.textContent = label;
  if (fillEl) {
    fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
    fillEl.style.width = pct + "%";
  }

  if (pct >= 100 && !ctx._stuckLocked) {
    cmPgClearCompleteTimer(ctx);
    ctx.completeTimer = setTimeout(() => {
      if (!isActiveStatus(STATE)) return;
      if (STATE.remaining > 0) return;
      if (STATE._lastDoneSeq > 0 && STATE.status !== "downloading") return;
      if (ctx._doneNotified) return;
      ctx._doneNotified = true;
      let summary: string | undefined;
      if (STATE.errorList.length > 0) {
        summary =
          '<div class="gh-queue-error">⚠️ ' +
          t("downloadQueue.failedCount", { n: STATE.errorList.length }) +
          "</div>";
      }
      ctx.onTimedCompletion(summary);
    }, 3000);
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
      if (pctEl._dotTimer) {
        clearInterval(pctEl._dotTimer);
        pctEl._dotTimer = null;
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
      pctEl.textContent = "❌";
      pctEl.classList.add("gh-progress-error");
      pctEl.title = done.errMsg || "下载失败";
    }
    ctx._stuckLocked = false;
    if (ctx._stuckTimer) {
      clearTimeout(ctx._stuckTimer);
      ctx._stuckTimer = null;
    }
    if (pctEl?._dotTimer) {
      clearInterval(pctEl._dotTimer);
      pctEl._dotTimer = null;
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
  };

  const render = (s: DownloadState): void => cmPgRender(ctx, s);
  const forceFileDone = (done: { status: string; errMsg: string }): void =>
    cmPgForceFileDone(ctx, done);
  const resetProgressUI = (): { pctEl: PctEl | null; fillEl: HTMLElement | null } =>
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
