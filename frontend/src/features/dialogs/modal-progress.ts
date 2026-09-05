// ===== 进度弹窗 modalProgress（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）progress 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const handle = modalProgress({ title, icon, closable }); handle.update(done, total)
// 注意: fmtMB 不再经本文件 re-export——消费方直连 utils/format/fmt-mb.ts（原「逐步移除」兑现）。

import { t } from "../../core/i18n/t.ts";
import { fmtMB } from "../../utils/format/fmt-mb.ts";
import { createDialog } from "./modal-core.ts";

export interface ModalProgressOptions {
  title: string;
  icon?: string;
  width?: string;
  /** 是否允许 Esc/点遮罩关闭（默认 true；下载等不可中断任务传 false 防误关丢进度） */
  closable?: boolean;
}

export interface ModalProgressHandle {
  /** 更新进度（done/total 字节；total<=0 表示大小未知，显示已下载字节） */
  update(done: number, total: number): void;
  close(): void;
}

function buildProgressDoms(): {
  pctEl: HTMLDivElement;
  track: HTMLDivElement;
  fill: HTMLDivElement;
} {
  const pctEl = document.createElement("div");
  pctEl.className = "dlg-prog-pct";
  const track = document.createElement("div");
  track.className = "dlg-prog-track";
  const fill = document.createElement("div");
  fill.className = "dlg-prog-fill";
  track.appendChild(fill);
  return { pctEl, track, fill };
}

function progressBoxBuilder(
  track: HTMLDivElement,
  pctEl: HTMLDivElement,
): (box: HTMLElement) => void {
  return (box): void => {
    // 标题行由 createDialog 统一渲染（ADR-190 D3），本 builder 只管进度条
    box.appendChild(track);
    box.appendChild(pctEl);
  };
}

function guardProgressClose(
  closed: { value: boolean },
  settleClose: (value: undefined) => void,
): () => void {
  return (): void => {
    if (closed.value) return;
    closed.value = true;
    settleClose(undefined);
  };
}

function updateProgressFinite(
  done: number,
  total: number,
  fill: HTMLDivElement,
  pctEl: HTMLDivElement,
): void {
  const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
  fill.style.width = pct + "%";
  pctEl.textContent = `${pct}%（${fmtMB(done)} / ${fmtMB(total)}）`;
}

function updateProgressUnknown(done: number, fill: HTMLDivElement, pctEl: HTMLDivElement): void {
  fill.style.width = "60%";
  pctEl.textContent = `${t("dialog.downloaded")} ${fmtMB(done)}`;
}

function updateProgressHandler(
  closed: { value: boolean },
  fill: HTMLDivElement,
  pctEl: HTMLDivElement,
): (done: number, total: number) => void {
  return (done, total): void => {
    if (closed.value) return;
    if (!Number.isFinite(done) || !Number.isFinite(total)) return;
    if (total > 0) {
      updateProgressFinite(done, total, fill, pctEl);
    } else {
      updateProgressUnknown(done, fill, pctEl);
    }
  };
}

/**
 * 只读进度弹窗（无确认/取消按钮，Esc 或点遮罩关闭）。
 * 返回句柄：update() 驱动进度条，close() 关闭。
 * 用于版本更新等长任务的前端进度反馈（配合 update:progress 事件）。
 */
export function modalProgress(opts: ModalProgressOptions): ModalProgressHandle {
  const { title, icon, width, closable = true } = opts;
  const { pctEl, track, fill } = buildProgressDoms();
  const { close: settleClose } = createDialog<undefined>({
    title,
    icon,
    width,
    tabIndex: 0,
    cancelValue: undefined,
    closable,
    resolve: () => {},
    buildBox: progressBoxBuilder(track, pctEl),
  });
  const closed = { value: false };
  const close = guardProgressClose(closed, settleClose);
  return {
    update: updateProgressHandler(closed, fill, pctEl),
    close,
  };
}
