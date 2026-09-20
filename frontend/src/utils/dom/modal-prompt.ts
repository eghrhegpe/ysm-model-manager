// ===== 输入框弹窗 modalPrompt（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）prompt 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const name = await modalPrompt({ title, titleIcon, value, placeholder })

import { t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { createDialog, type ModalLabels } from "./modal-core.ts";

/** modalPrompt 选项 */
export interface ModalPromptOptions {
  title: string;
  titleIcon?: UiIconName;
  value?: string;
  placeholder?: string;
  okText?: string;
  /** 文案覆盖（优先级：okText > labels > i18n 默认） */
  labels?: ModalLabels;
}

function promptBoxBuilder(
  value: string | undefined,
  placeholder: string | undefined,
  okText: string | undefined,
  labels: ModalLabels | undefined,
): (box: HTMLElement) => void {
  const ok = okText || labels?.ok || t("dialog.ok");
  const cancel = labels?.cancel || t("dialog.cancelEsc");
  return (box): void => {
    // 标题行由 createDialog 统一渲染（ADR-190 D3）
    box.innerHTML = `
      <input id="mp-input" data-testid="dlg-input" class="dlg-field" maxlength="255" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}">
      <div id="mp-err" class="dlg-err"></div>
      <div class="dlg-footer dlg-footer-flush">
        <button id="mp-cancel" data-testid="dlg-cancel" class="dlg-btn">${esc(cancel)}</button>
        <button id="mp-ok" data-testid="dlg-ok" class="dlg-btn dlg-btn-primary">${esc(ok)} (Enter)</button>
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
    const { title, titleIcon, value, placeholder, okText, labels } = opts;
    const { box, close } = createDialog<string | null>({
      title,
      titleIcon,
      tabIndex: 0,
      cancelValue: null,
      resolve,
      buildBox: promptBoxBuilder(value, placeholder, okText, labels),
    });
    const input = box.querySelector("#mp-input") as HTMLInputElement;
    input.focus();
    input.select();
    const errEl = box.querySelector("#mp-err") as HTMLElement | null;
    const fieldRequired = labels?.fieldRequired || t("dialog.fieldRequired");
    // 空值校验（OK 点击与 Enter 共用）；有值返回并 close，空值标错返回 null
    const requireValue = (refocus: boolean): string | null => {
      const v = input.value.trim();
      if (!v) {
        if (refocus) input.focus();
        if (errEl) errEl.textContent = `⚠️ ${fieldRequired}`;
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
