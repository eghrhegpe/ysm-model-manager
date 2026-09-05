// ===== 确认弹窗 modalConfirm（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）confirm 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const ok = await modalConfirm({ title, icon, message, danger })

import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { createDialog } from "./modal-core.ts";

/** modalConfirm 选项 */
export interface ModalConfirmOptions {
  title: string;
  icon?: string;
  message: string;
  okText?: string;
  danger?: boolean;
  width?: string;
  /**
   * 自定义 HTML 内容区（传入后替代 message 文本区，用于复杂布局弹窗）。
   * ⚠️ XSS 契约：本通道**不再转义**，调用方必须传入已完成 esc() 的内容——
   * 任何用户可控数据（版本号/路径/文件名等）进 bodyHTML 前必须过 esc()。
   * 存量调用方（version-updater.ts）已自律转义；新增调用方照此契约。
   */
  bodyHTML?: string;
}

function confirmBoxBuilder(
  title: string,
  icon: string | undefined,
  message: string,
  okText: string | undefined,
  danger: boolean | undefined,
  bodyHTML: string | undefined,
): (box: HTMLElement) => void {
  return (box): void => {
    box.innerHTML = `
      <div class="dlg-title dlg-title-flush">${esc(icon || "")} ${esc(title)}</div>
      ${bodyHTML ?? `<div class="dlg-msg">${esc(message)}</div>`}
      <div class="dlg-footer dlg-footer-flush">
        <button id="mc-cancel" data-testid="dlg-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="mc-ok" data-testid="dlg-ok" class="dlg-btn ${danger ? "dlg-btn-danger" : "dlg-btn-primary"}">${esc(okText || t("dialog.ok"))} (Enter)</button>
      </div>
    `;
  };
}

/**
 * 弹出确认对话框
 * @param opts 选项
 * @returns 用户是否确认
 */
export function modalConfirm(opts: ModalConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const { title, icon, message, okText, danger, width, bodyHTML } = opts;
    const { box, close } = createDialog<boolean>({
      title,
      icon,
      width,
      tabIndex: 0,
      cancelValue: false,
      resolve,
      buildBox: confirmBoxBuilder(title, icon, message, okText, danger, bodyHTML),
    });
    (box.querySelector("#mc-cancel") as HTMLElement).onclick = (): void => close(false);
    (box.querySelector("#mc-ok") as HTMLElement).onclick = (): void => close(true);
    box.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        if (e.isComposing) return;
        if (e.target instanceof HTMLButtonElement) return;
        close(true);
      }
      if (e.key === "Escape") close(false);
    });
  });
}
