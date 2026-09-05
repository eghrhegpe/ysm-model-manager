// ===== 输入框弹窗 modalPrompt（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）prompt 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const name = await modalPrompt({ title, icon, value, placeholder })

import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { createDialog } from "./modal-core.ts";

/** modalPrompt 选项 */
export interface ModalPromptOptions {
  title: string;
  icon?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
}

function promptBoxBuilder(
  title: string,
  icon: string | undefined,
  value: string | undefined,
  placeholder: string | undefined,
  okText: string | undefined,
): (box: HTMLElement) => void {
  return (box): void => {
    box.innerHTML = `
      <div class="dlg-title dlg-title-flush">${esc(icon || "")} ${esc(title)}</div>
      <input id="mp-input" data-testid="dlg-input" class="dlg-field" maxlength="255" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}">
      <div id="mp-err" class="dlg-err"></div>
      <div class="dlg-footer dlg-footer-flush">
        <button id="mp-cancel" data-testid="dlg-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="mp-ok" data-testid="dlg-ok" class="dlg-btn dlg-btn-primary">${esc(okText || t("dialog.ok"))} (Enter)</button>
      </div>
    `;
  };
}

/**
 * 弹出带输入框的模态框，类似 styled prompt()
 * @param opts 选项
 * @returns 用户输入的值，取消返回 null
 */
export function modalPrompt(opts: ModalPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, icon, value, placeholder, okText } = opts;
    const { box, close } = createDialog<string | null>({
      title,
      icon,
      tabIndex: 0,
      cancelValue: null,
      resolve,
      buildBox: promptBoxBuilder(title, icon, value, placeholder, okText),
    });
    const input = box.querySelector("#mp-input") as HTMLInputElement;
    input.focus();
    input.select();
    const errEl = box.querySelector("#mp-err") as HTMLElement | null;
    // 空值校验（OK 点击与 Enter 共用）；有值返回并 close，空值标错返回 null
    const requireValue = (refocus: boolean): string | null => {
      const v = input.value.trim();
      if (!v) {
        if (refocus) input.focus();
        if (errEl) errEl.textContent = "⚠️ " + t("dialog.fieldRequired");
        return null;
      }
      return v;
    };
    (box.querySelector("#mp-cancel") as HTMLElement).onclick = (): void => close(null);
    (box.querySelector("#mp-ok") as HTMLElement).onclick = (): void => {
      const v = requireValue(true);
      if (v !== null) close(v);
    };
    input.addEventListener("input", (): void => {
      if (errEl) errEl.textContent = "";
    });
    input.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        const v = requireValue(false);
        if (v !== null) close(v);
      }
      if (e.key === "Escape") close(null);
    });
  });
}
