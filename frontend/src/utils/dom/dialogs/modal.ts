// ===== 统一模态弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 风格参照 rename.js 的卡片式弹窗，复用 CSS 变量
// 用法: const name = await modalPrompt({ title, icon, value, placeholder })

import { esc } from "../../../utils/dom/html.ts";

export { esc };

declare global {
  interface HTMLElement {
    /** 关闭动画中标记（closeDlg 防重复触发） */
    _closing?: boolean;
  }
}

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
  if (!overlay || overlay._closing) return;
  overlay._closing = true;
  overlay.classList.add("dlg-closing");
  setTimeout(() => {
    overlay.remove();
    if (_activeOverlay === overlay) {
      _activeOverlay = null;
      _closeActive = null;
    }
    resolve(value);
  }, delay);
}

/** 活动弹窗单例槽位：新开弹窗前先按取消值结算旧弹窗，防连点叠加/双执行 */
let _activeOverlay: HTMLElement | null = null;
let _closeActive: (() => void) | null = null;

/** 弹窗 append 到 body 后调用，登记为当前活动弹窗 */
export function registerDlg(overlay: HTMLElement, cancelClose: () => void): void {
  if (_activeOverlay && _closeActive) _closeActive();
  _activeOverlay = overlay;
  _closeActive = cancelClose;
}

/** modalPrompt 选项 */
export interface ModalPromptOptions {
  title: string;
  icon?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
}

/**
 * 弹出带输入框的模态框，类似 styled prompt()
 * @param opts 选项
 * @returns 用户输入的值，取消返回 null
 */
export function modalPrompt(opts: ModalPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, icon, value, placeholder, okText } = opts;
    const overlay = document.createElement("div");
    overlay.tabIndex = 0; // ADR-039 P3：补 overlay Esc（对齐 modalConfirm/select）
    overlay.className = "dlg-overlay";
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) closeDlg(overlay, resolve, null);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDlg(overlay, resolve, null);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">${esc(icon || "")} ${esc(title)}</div>
      <input id="mp-input" maxlength="255" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}" style="width:100%;padding:6px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:12px;box-sizing:border-box">
      <div id="mp-err" class="dlg-err"></div>
      <div class="dlg-footer" style="padding:0">
        <button id="mp-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="mp-ok" class="dlg-btn dlg-btn-primary">${esc(okText || "确定")} (Enter)</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));

    const input = box.querySelector("#mp-input") as HTMLInputElement;
    input.focus();
    input.select();
    trapFocus(overlay);

    const close = (result: string | null): void =>
      closeDlg(overlay, resolve, result);

    const errEl = box.querySelector("#mp-err") as HTMLElement | null;

    (box.querySelector("#mp-cancel") as HTMLElement).onclick = (): void =>
      close(null);
    (box.querySelector("#mp-ok") as HTMLElement).onclick = (): void => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        if (errEl) errEl.textContent = "⚠️ 此项不能为空";
        return;
      }
      close(v);
    };
    input.addEventListener("input", (): void => {
      if (errEl) errEl.textContent = "";
    });
    input.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (!v) {
          if (errEl) errEl.textContent = "⚠️ 此项不能为空";
          return;
        }
        close(v);
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

/**
 * 弹出下拉选择框
 * @param opts 选项
 * @returns 选择的项，取消返回 null
 */
export function modalSelect(opts: ModalSelectOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, icon, items, placeholder, okText } = opts;
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.tabIndex = -1;
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) closeDlg(overlay, resolve, null);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDlg(overlay, resolve, null);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";
    box.style.width = "400px";

    box.innerHTML =
      '<div class="dlg-title" style="margin:0">' +
      esc(icon || "") +
      " " +
      esc(title) +
      "</div>" +
      '<select id="ms-select" style="width:100%;padding:6px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:12px">' +
      (items || [])
        .map(
          (item) =>
            '<option value="' + esc(item) + '">' + esc(item) + "</option>",
        )
        .join("") +
      "</select>" +
      '<div class="dlg-footer" style="padding:0">' +
      '<button id="ms-cancel" class="dlg-btn">取消 (Esc)</button>' +
      '<button id="ms-ok" class="dlg-btn dlg-btn-primary">' +
      esc(okText || "确定") +
      " (Enter)</button>" +
      "</div>";
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));
    overlay.focus();

    const select = box.querySelector("#ms-select") as HTMLSelectElement;
    select.focus();
    trapFocus(overlay);
    void placeholder;

    const close = (result: string | null): void =>
      closeDlg(overlay, resolve, result);

    (box.querySelector("#ms-cancel") as HTMLElement).onclick = (): void =>
      close(null);
    (box.querySelector("#ms-ok") as HTMLElement).onclick = (): void =>
      close(select.value);
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

/**
 * 弹出确认对话框
 * @param opts 选项
 * @returns 用户是否确认
 */
export function modalConfirm(opts: ModalConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const { title, icon, message, okText, danger, width } = opts;
    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.className = "dlg-overlay";
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) closeDlg(overlay, resolve, false);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDlg(overlay, resolve, false);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";
    if (width) box.style.width = width;

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">${esc(icon || "")} ${esc(title)}</div>
      ${opts.bodyHTML ?? `<div style="font-size:11px;color:var(--txt);line-height:1.5;white-space:pre-wrap;max-height:55vh;overflow-y:auto">${esc(message)}</div>`}
      <div class="dlg-footer" style="padding:0">
        <button id="mc-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="mc-ok" class="dlg-btn ${danger ? "dlg-btn-danger" : "dlg-btn-primary"}">${esc(okText || "确定")} (Enter)</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, false));
    overlay.focus();
    trapFocus(overlay);

    const close = (result: boolean): void =>
      closeDlg(overlay, resolve, result);

    (box.querySelector("#mc-cancel") as HTMLElement).onclick = (): void =>
      close(false);
    (box.querySelector("#mc-ok") as HTMLElement).onclick = (): void =>
      close(true);
    // P3 修复（审核发现）：按钮文案声明「确定 (Enter)」但实现只有 Esc——prompt/select
    // 都有 Enter 处理器，confirm 唯独缺失，焦点在 overlay 时按 Enter 无反应
    box.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") close(true);
      if (e.key === "Escape") close(false);
    });
  });
}

export interface ModalProgressOptions {
  title: string;
  icon?: string;
  width?: string;
}

export interface ModalProgressHandle {
  /** 更新进度（done/total 字节；total<=0 表示大小未知，显示已下载字节） */
  update(done: number, total: number): void;
  close(): void;
}

/** 格式化字节为 MB（进度弹窗文案用） */
function fmtMB(n: number): string {
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

/**
 * 只读进度弹窗（无确认/取消按钮，Esc 或点遮罩关闭）。
 * 返回句柄：update() 驱动进度条，close() 关闭。
 * 用于版本更新等长任务的前端进度反馈（配合 update:progress 事件）。
 */
export function modalProgress(opts: ModalProgressOptions): ModalProgressHandle {
  const { title, icon, width } = opts;
  const overlay = document.createElement("div");
  overlay.tabIndex = 0;
  overlay.className = "dlg-overlay";
  overlay.onclick = (e: MouseEvent): void => {
    if (e.target === overlay) close();
  };
  overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  });

  const box = document.createElement("div");
  box.className = "dlg-box dlg-pad";
  box.style.gap = "10px";
  if (width) box.style.width = width;

  const pctEl = document.createElement("div");
  pctEl.style.cssText = "font-size:11px;color:var(--txt);text-align:right";
  const track = document.createElement("div");
  track.style.cssText =
    "height:8px;border-radius:4px;background:var(--bd);overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText =
    "height:100%;width:0%;background:var(--accent,#66d9ef);transition:width .2s";
  track.appendChild(fill);

  box.innerHTML = `<div class="dlg-title" style="margin:0">${esc(icon || "")} ${esc(title)}</div>`;
  box.appendChild(track);
  box.appendChild(pctEl);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  registerDlg(overlay, () => close());
  overlay.focus();
  trapFocus(overlay);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    closeDlg(overlay, () => {}, undefined);
  }

  return {
    update(done, total) {
      if (closed) return;
      if (total > 0) {
        // 钳制 [0,100]（ADR-044 ② 数值守卫：NaN/负值/超 100 不允许进入样式）
        const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
        fill.style.width = pct + "%";
        pctEl.textContent = `${pct}%（${fmtMB(done)} / ${fmtMB(total)}）`;
      } else {
        // 未知大小（分块传输）：显示已下载字节 + 不确定态条幅
        fill.style.width = "60%";
        pctEl.textContent = `已下载 ${fmtMB(done)}`;
      }
    },
    close,
  };
}
