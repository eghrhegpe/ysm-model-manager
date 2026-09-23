// ===== 下拉选择弹窗 modalSelect（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）select 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const choice = await modalSelect({ title, titleIcon, items })

import { t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { createDialog, type ModalLabels } from "./modal-core.ts";

/** modalSelect 选项 */
export interface ModalSelectOptions {
  title: string;
  titleIcon?: UiIconName;
  items: string[];
  placeholder?: string;
  okText?: string;
  /** 文案覆盖（优先级：okText > labels > i18n 默认） */
  labels?: ModalLabels;
}

function selectBoxBuilder(
  items: string[],
  okText: string | undefined,
  labels: ModalLabels | undefined,
): (box: HTMLElement) => void {
  const ok = okText || labels?.ok || t("dialog.ok");
  const cancel = labels?.cancel || t("dialog.cancelEsc");
  return (box): void => {
    // 标题行由 createDialog 统一渲染（ADR-190 D3）；本 builder 顺带统一为模板串风格
    box.innerHTML = `
      <select id="ms-select" data-testid="dlg-select" class="dlg-field">
        ${(items || []).map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join("")}
      </select>
      <div class="dlg-footer dlg-footer-flush">
        <button id="ms-cancel" data-testid="dlg-cancel" class="dlg-btn">${esc(cancel)}</button>
        <button id="ms-ok" data-testid="dlg-ok" class="dlg-btn dlg-btn-primary">${esc(ok)} (Enter)</button>
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
    const { title, titleIcon, items, okText, labels } = opts;
    const { box, close } = createDialog<string | null>({
      title,
      titleIcon,
      width: "var(--dlg-width-sm)" /* 审计 P1-1：宽收口 --dlg-width-sm（420px） */,
      tabIndex: -1,
      cancelValue: null,
      resolve,
      buildBox: selectBoxBuilder(items, okText, labels),
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
