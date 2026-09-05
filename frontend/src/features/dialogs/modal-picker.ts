// ===== 富列表选择弹窗 modalPicker（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3）picker 段独立成文件；脚手架走 modal-core createDialog。
// 用法: const result = await modalPicker({ title, items, footerHTML })

import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { createDialog } from "./modal-core.ts";

/** modalPicker 行项（label/meta/sub/hint 由函数内部 esc 转义，调用方传原始文本） */
export interface ModalPickerItem {
  label: string;
  meta?: string;
  sub?: string;
  hint?: string;
  hintColor?: string;
}

/** modalPicker 选项 */
export interface ModalPickerOptions {
  title: string;
  icon?: string;
  width?: string;
  /** 标题下、列表上的说明文字 */
  subtitle?: string;
  items: ModalPickerItem[];
  /**
   * 列表下方自定义 HTML；其中带 name 的表单控件值在关闭时聚合返回。
   * ⚠️ XSS 契约：本通道**不再转义**，调用方必须传入已完成 esc() 的内容；
   * 存量调用方（launcher-detect.ts）已自律转义，新增调用方照此契约。
   */
  footerHTML?: string;
  cancelText?: string;
}

/** modalPicker 结果 */
export interface ModalPickerResult {
  /** 选中行下标（0-based） */
  index: number;
  /** footer 内 checkbox/radio 按 name 的选中态 */
  footerChecked: Record<string, boolean>;
  /** footer 内 input/select/textarea 按 name 的值 */
  footerValues: Record<string, string>;
}

/** 收集 footer 自定义区带 name 的表单控件值（关闭时结算，DOM 移除前读取） */
function collectFooter(box: HTMLElement): {
  checked: Record<string, boolean>;
  values: Record<string, string>;
} {
  const checked: Record<string, boolean> = {};
  const values: Record<string, string> = {};
  box.querySelectorAll<HTMLElement>("[name]").forEach((el) => {
    const name = el.getAttribute("name") || "";
    if (!name) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") checked[name] = el.checked;
      else values[name] = el.value;
    } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      values[name] = el.value;
    }
  });
  return { checked, values };
}

/** hintColor 白名单校验（review 14f3b7e4 P3）：modalPicker 是共享 API，hintColor 直插
 * style 属性——esc() 只转义 HTML 字符，`; : ( )` 未转义，恶意值可注入额外 CSS 属性
 * （UI redressing / 外链 beacon）。只放行 #hex / CSS 变量 var(--...) / 命名色（仅字母
 * 空格连字符，无 ;:() 注入面），不匹配回退默认。
 * @param c 调用方传入的 hintColor
 * @returns 安全颜色值（不匹配时回退 var(--muted,#888)）
 */
function safeHintColor(c?: string): string {
  if (!c) return "var(--muted,#888)";
  const t = c.trim();
  if (/^#[\da-fA-F]{3,8}$/.test(t)) return t; // #hex（3/4/6/8 位）
  if (/^var\(\s*--[\w-]+\s*\)$/.test(t)) return t; // var(--token)
  if (/^[a-zA-Z][a-zA-Z\s-]*$/.test(t)) return t; // 命名色（无 CSS 注入字符）
  return "var(--muted,#888)";
}

function pickerBoxBuilder(
  title: string,
  icon: string | undefined,
  subtitle: string | undefined,
  items: ModalPickerItem[],
  footerHTML: string | undefined,
  cancelText: string | undefined,
): (box: HTMLElement) => void {
  return (box): void => {
    const rows = items
      .map(
        (it, i) =>
          `<button data-idx="${i}" data-testid="pick-item" class="dlg-pick-row">
  <div class="dlg-pick-row-head"><span>${esc(it.label)}</span>${it.meta ? `<span class="dlg-pick-meta">${esc(it.meta)}</span>` : ""}</div>
  ${it.sub ? `<div class="dlg-pick-sub">${esc(it.sub)}</div>` : ""}
  ${it.hint ? `<div class="dlg-pick-hint" style="color:${safeHintColor(it.hintColor)}">${esc(it.hint)}</div>` : ""}
</button>`,
      )
      .join("");
    box.innerHTML =
      `<div class="dlg-title dlg-title-flush">${esc(icon || "")} ${esc(title)}</div>` +
      (subtitle ? `<div class="dlg-pick-subtitle">${esc(subtitle)}</div>` : "") +
      `<div data-testid="pick-list" class="dlg-pick-list">${rows}</div>` +
      (footerHTML || "") +
      `<div class="dlg-pick-cancel-wrap"><button id="pk-cancel" data-testid="dlg-cancel" class="dlg-btn">${esc(cancelText || t("dialog.cancelEsc"))}</button></div>`;
  };
}

/**
 * 富列表选择弹窗（行即选项）：复用统一弹窗脚手架（createDialog），
 * 单例登记 / 焦点陷阱 / 退场动画 / Esc / 遮罩关闭与 modalSelect 同款。
 * 区别于 modalSelect 的下拉形态：多行富内容展示（label/meta/sub/hint），
 * 底部可挂自定义表单（footerHTML，按 name 聚合返回选中态/值）。
 * @returns 选中行下标 + footer 表单值；取消返回 null
 */
export function modalPicker(opts: ModalPickerOptions): Promise<ModalPickerResult | null> {
  return new Promise((resolve) => {
    const { title, icon, width, subtitle, items, footerHTML, cancelText } = opts;
    const { box, close } = createDialog<ModalPickerResult | null>({
      title,
      icon,
      width: width || "480px",
      tabIndex: 0,
      cancelValue: null,
      resolve,
      buildBox: pickerBoxBuilder(title, icon, subtitle, items, footerHTML, cancelText),
    });
    box.querySelectorAll<HTMLButtonElement>("[data-testid='pick-item']").forEach((row) => {
      row.addEventListener("click", () => {
        const footer = collectFooter(box);
        close({
          index: Number(row.dataset.idx || "0"),
          footerChecked: footer.checked,
          footerValues: footer.values,
        });
      });
    });
    (box.querySelector("#pk-cancel") as HTMLElement).onclick = (): void => close(null);
  });
}
