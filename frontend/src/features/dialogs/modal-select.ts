// ===== 下拉选择弹窗 modalSelect（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）select 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const choice = await modalSelect({ title, icon, items })

import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { createDialog } from "./modal-core.ts";

/** modalSelect 选项 */
export interface ModalSelectOptions {
  title: string;
  icon?: string;
  items: string[];
  placeholder?: string;
  okText?: string;
}

function selectBoxBuilder(items: string[], okText: string | undefined): (box: HTMLElement) => void {
  return (box): void => {
    // 标题行由 createDialog 统一渲染（ADR-190 D3）；本 builder 顺带统一为模板串风格
    box.innerHTML = `
      <select id="ms-select" data-testid="dlg-select" class="dlg-field">
        ${(items || []).map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join("")}
      </select>
      <div class="dlg-footer dlg-footer-flush">
        <button id="ms-cancel" data-testid="dlg-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="ms-ok" data-testid="dlg-ok" class="dlg-btn dlg-btn-primary">${esc(okText || t("dialog.ok"))} (Enter)</button>
      </div>`;
  };
}

/**
 * 弹出下拉选择框
 * @param opts 选项
 * @returns 选择的项，取消返回 null
 */
export function modalSelect(opts: ModalSelectOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, icon, items, okText } = opts;
    const { box, close } = createDialog<string | null>({
      title,
      icon,
      width: "400px",
      tabIndex: -1,
      cancelValue: null,
      resolve,
      buildBox: selectBoxBuilder(items, okText),
    });
    const select = box.querySelector("#ms-select") as HTMLSelectElement;
    select.focus();
    (box.querySelector("#ms-cancel") as HTMLElement).onclick = (): void => close(null);
    (box.querySelector("#ms-ok") as HTMLElement).onclick = (): void => close(select.value);
    select.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") close(select.value);
      if (e.key === "Escape") close(null);
    });
  });
}
