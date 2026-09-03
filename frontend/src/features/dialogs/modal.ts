// ===== 统一模态弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 风格参照 rename.js 的卡片式弹窗，复用 CSS 变量
// 用法: const name = await modalPrompt({ title, icon, value, placeholder })

import { esc } from "../../utils/dom/html.ts";
import { t } from "../../core/i18n/t.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  'dlg-overlay',
  'dlg-input',
  'dlg-select',
  'dlg-cancel',
  'dlg-ok',
];



/** 关闭动画中标记（closeDlg 防重复触发）；WeakSet 随元素 GC 回收，不污染 HTMLElement 全局类型 */
const _closingOverlays = new WeakSet<HTMLElement>();

/** 可聚焦元素选择器 */
const FOCUSABLE_SEL =
  "button,input,select,textarea,tabindex,[tabindex]:not([tabindex=\"-1\"]),a[href],summary";

/**
 * 焦点陷阱：Tab 键在弹窗内可聚焦元素间循环，防止焦点逃逸到背后页面
 * @param overlay 弹窗 overlay 元素
 * @returns cleanup 函数（移除 keydown 监听器）
 */
export function trapFocus(overlay: HTMLElement): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const focusable = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SEL);
    if (!focusable.length) return;
    const arr = Array.from(focusable);
    const first = arr[0];
    const last = arr[arr.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === overlay)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || active === overlay)) {
      e.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener("keydown", handler);
  return () => overlay.removeEventListener("keydown", handler);
}

/**
 * 带退场动画关闭对话框
 * @param overlay 对话框 overlay 元素
 * @param resolve Promise resolve 函数
 * @param value 要 resolve 的值
 * @param delay 退场动画时长 (ms)
 */
export function closeDlg<T>(
  overlay: HTMLElement,
  resolve: (value: T) => void,
  value: T,
  delay = 120,
): void {
  if (!overlay || _closingOverlays.has(overlay)) return;
  _closingOverlays.add(overlay);
  overlay.classList.add("dlg-closing");
  setTimeout(() => {
    overlay.remove();
    if (_activeOverlay === overlay) {
      _activeOverlay = null;
      _closeActive = null;
      _activeClosable = true;
    }
    resolve(value);
  }, delay);
}

/** 活动弹窗单例槽位：新开弹窗前先按取消值结算旧弹窗，防连点叠加/双执行 */
let _activeOverlay: HTMLElement | null = null;
let _closeActive: (() => void) | null = null;
/** 当前活动弹窗是否允许被外部关闭（进度弹窗 closable=false 时 back 不强关） */
let _activeClosable = true;

/** 测试钩子：重置活动弹窗单例槽位（isolate:false 共享模块图下，兄弟文件残留的
 *  _activeOverlay 会让「无活动弹窗」断言失真；web-store.__resetWebLogStateForTest 同款） */
export function __resetModalStateForTest(): void {
  _activeOverlay = null;
  _closeActive = null;
  _activeClosable = true;
}

/** 弹窗 append 到 body 后调用，登记为当前活动弹窗 */
export function registerDlg(
  overlay: HTMLElement,
  cancelClose: () => void,
  closable = true,
): void {
  if (_activeOverlay && _closeActive) _closeActive();
  _activeOverlay = overlay;
  _closeActive = cancelClose;
  _activeClosable = closable;
}

/**
 * 关闭当前活动弹窗（按取消值结算）。返回是否关闭了弹窗。
 * ADR-047：android:back 先关弹窗再退出——弹窗只听 Esc，触屏无 Esc 键，
 * 由 back 事件桥接；进度弹窗（closable=false）不强关。
 */
export function closeActiveDialog(): boolean {
  if (!_activeOverlay || !_closeActive || !_activeClosable) return false;
  const close = _closeActive;
  _closeActive = null;
  _activeOverlay = null;
  _activeClosable = true;
  close();
  return true;
}

function buildOverlay<T>(
  tabIndex: number,
  closable: boolean,
  cancelValue: T,
  resolve: (value: T) => void,
): { overlay: HTMLElement; close: (value: T) => void } {
  const overlay = document.createElement("div");
  overlay.tabIndex = tabIndex;
  overlay.className = "dlg-overlay";
  overlay.dataset.testid = "dlg-overlay";
  const close = (value: T): void => closeDlg(overlay, resolve, value);
  overlay.onclick = (e: MouseEvent): void => {
    if (e.target === overlay && closable) close(cancelValue);
  };
  overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape" && closable) close(cancelValue);
  });
  return { overlay, close };
}

function appendDialogBox(
  overlay: HTMLElement,
  width: string | undefined,
  buildBox: (box: HTMLElement) => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "dlg-box dlg-pad dlg-gap-lg";
  if (width) box.style.width = width;
  buildBox(box);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return box;
}

function registerDialogLife<T>(
  overlay: HTMLElement,
  closable: boolean,
  cancelValue: T,
  close: (value: T) => void,
): void {
  registerDlg(overlay, () => close(cancelValue), closable);
  overlay.focus();
  trapFocus(overlay);
}

/**
 * 弹窗脚手架工厂：创建 overlay + box，绑定遮罩点击 / Esc 关闭（closable 门控）、
 * registerDlg 单例登记、焦点陷阱。收敛 modalPrompt / modalSelect / modalConfirm /
 * modalProgress 四份重复脚手架（索引 4.8）——各弹窗只提供 buildBox 内容与
 * cancelValue 结算值，关闭路径（closeDlg 退场动画）统一。
 * @returns { overlay, box, close } — close(value) 带退场动画结算（resolve）
 */
function createDialog<T>(opts: {
  title: string;
  icon?: string | undefined;
  width?: string | undefined;
  tabIndex?: number;
  cancelValue: T;
  resolve: (value: T) => void;
  closable?: boolean;
  buildBox: (box: HTMLElement) => void;
}): { overlay: HTMLElement; box: HTMLElement; close: (value: T) => void } {
  const { width, tabIndex = 0, cancelValue, resolve, closable = true, buildBox } = opts;
  const { overlay, close } = buildOverlay(tabIndex, closable, cancelValue, resolve);
  const box = appendDialogBox(overlay, width, buildBox);
  registerDialogLife(overlay, closable, cancelValue, close);
  return { overlay, box, close };
}

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
      title, icon, tabIndex: 0, cancelValue: null, resolve,
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

/** modalSelect 选项 */
export interface ModalSelectOptions {
  title: string;
  icon?: string;
  items: string[];
  placeholder?: string;
  okText?: string;
}

function selectBoxBuilder(
  title: string,
  icon: string | undefined,
  items: string[],
  okText: string | undefined,
): (box: HTMLElement) => void {
  return (box): void => {
    box.innerHTML =
      '<div class="dlg-title dlg-title-flush">' +
      esc(icon || "") +
      " " +
      esc(title) +
      "</div>" +
      '<select id="ms-select" data-testid="dlg-select" class="dlg-field">' +
      (items || [])
        .map(
          (item) =>
            '<option value="' + esc(item) + '">' + esc(item) + "</option>",
        )
        .join("") +
      "</select>" +
      '<div class="dlg-footer dlg-footer-flush">' +
      '<button id="ms-cancel" data-testid="dlg-cancel" class="dlg-btn">' +
      t("dialog.cancelEsc") +
      "</button>" +
      '<button id="ms-ok" data-testid="dlg-ok" class="dlg-btn dlg-btn-primary">' +
      esc(okText || t("dialog.ok")) +
      " (Enter)</button>" +
      "</div>";
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
      title, icon, width: "400px", tabIndex: -1, cancelValue: null, resolve,
      buildBox: selectBoxBuilder(title, icon, items, okText),
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

/** modalConfirm 选项 */
export interface ModalConfirmOptions {
  title: string;
  icon?: string;
  message: string;
  okText?: string;
  danger?: boolean;
  width?: string;
  /** 自定义 HTML 内容区（调用方负责转义；传入后替代 message 文本区，用于复杂布局弹窗） */
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
      title, icon, width, tabIndex: 0, cancelValue: false, resolve,
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

/** 格式化字节为 MB（实现下沉至 format/fmt-mb.ts；re-export 兼容既有消费方，可逐步移除） */
import { fmtMB } from "../../utils/format/fmt-mb.ts";
export { fmtMB };

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
  title: string,
  icon: string | undefined,
  track: HTMLDivElement,
  pctEl: HTMLDivElement,
): (box: HTMLElement) => void {
  return (box): void => {
    box.innerHTML = `<div class="dlg-title dlg-title-flush">${esc(icon || "")} ${esc(title)}</div>`;
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
    title, icon, width, tabIndex: 0, cancelValue: undefined, closable,
    resolve: () => {},
    buildBox: progressBoxBuilder(title, icon, track, pctEl),
  });
  const closed = { value: false };
  const close = guardProgressClose(closed, settleClose);
  return {
    update: updateProgressHandler(closed, fill, pctEl),
    close,
  };
}

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
  /** 列表下方自定义 HTML（调用方负责转义）；其中带 name 的表单控件值在关闭时聚合返回 */
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
function collectFooter(box: HTMLElement): { checked: Record<string, boolean>; values: Record<string, string> } {
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
  if (/^#[\da-fA-F]{3,8}$/.test(t)) return t;              // #hex（3/4/6/8 位）
  if (/^var\(\s*--[\w-]+\s*\)$/.test(t)) return t;         // var(--token)
  if (/^[a-zA-Z][a-zA-Z\s-]*$/.test(t)) return t;          // 命名色（无 CSS 注入字符）
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
      title, icon, width: width || "480px", tabIndex: 0, cancelValue: null, resolve,
      buildBox: pickerBoxBuilder(title, icon, subtitle, items, footerHTML, cancelText),
    });
    box.querySelectorAll<HTMLButtonElement>("[data-testid='pick-item']").forEach((row) => {
      row.addEventListener("click", () => {
        const footer = collectFooter(box);
        close({ index: Number(row.dataset.idx || "0"), footerChecked: footer.checked, footerValues: footer.values });
      });
    });
    (box.querySelector("#pk-cancel") as HTMLElement).onclick = (): void => close(null);
  });
}
