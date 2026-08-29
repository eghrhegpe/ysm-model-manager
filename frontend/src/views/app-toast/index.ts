// ===== <app-toast> — Toast 通知系统（类型化版 — ADR-014 P3 components）=====
// 用法：bus.emit('toast:show', { msg, undo?, duration?, type? })
import { bus } from "../../bus.ts";
import { esc } from "../../utils/dom/html.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
// 别名导入：show() 内局部变量 `t` 是 toast 元素，直接用 `t` 会被遮蔽
import { t as tr } from "../../core/i18n/t.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";

/** toast 元素（含关闭定时器） */
type ToastEl = HTMLElement & {
  _timer?: ReturnType<typeof setTimeout>;
};

// ── 魔法数值收敛 ──────────────────────────────────
const MAX_TOASTS = 5;        // 同时显示上限，超出同步移除最早的
const DEFAULT_DURATION = TOAST_MS.verbose; // 默认展示时长 ms
const SLIDE_OUT_MS = 200;    // 退出动画时长 ms（与 CSS slideOut 同步）
const OK_TOAST_MS = TOAST_MS.success;    // 成功反馈 toast 展示时长 ms
const ERR_TOAST_MS = TOAST_MS.normal;   // 失败反馈 toast 展示时长 ms

class AppToast extends WebComponentBase {
  _unsub: (() => void) | undefined;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          z-index: var(--z-toast); display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .toast {
          display: flex; align-items: center; gap: 10px; padding: 10px 16px;
          border-radius: 8px; background: var(--card); color: var(--txt); font-size: var(--fs-base);
          box-shadow: 0 6px 20px rgba(0,0,0,.4); animation: toastIn .3s cubic-bezier(.34,1.56,.64,1);
          border: 1px solid var(--bd); pointer-events: auto;
          font-family: var(--font-ui);
        }
        .toast.error { border-left: 3px solid var(--paid); }
        .toast.success { border-left: 3px solid var(--free); }
        .toast.warn { border-left: 3px solid var(--status-error); }
        .toast.info { border-left: 3px solid var(--accent); }
        .toast .msg { flex: 1; white-space: pre-line; }
        .toast .undo-btn { padding: 4px 10px; border-radius: 5px; border: none; background: var(--hover); color: var(--accent); cursor: pointer; font-size: var(--fs-sm); font-family: inherit; transition: background var(--tr-fast); }
        .toast .undo-btn:hover { background: var(--act); }
        .toast .close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: var(--fs-md); padding: 0 2px; }
        .toast .close-btn:hover { color: var(--txt); }
        @keyframes toastIn { 0% { transform: translateY(20px) scale(.95); opacity: 0; } 60% { transform: translateY(-4px) scale(1.02); opacity: 1; } 100% { transform: translateY(0) scale(1); } }
        @keyframes slideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
      </style>
      <div id="c" class="toast-container" role="status" aria-live="polite"></div>
    `;
  }

  connectedCallback(): void {
    this._unsub = bus.on("toast:show", ({ msg, undo, duration, type, click }) => {
      this.show(msg, undo || null, duration, type, click);
    });
  }

  disconnectedCallback(): void {
    if (this._unsub) this._unsub();
    // P3 修复（子代理审计）：清理容器内所有挂起 timer + 移除 toast 元素——
    // 原实现仅退订 bus，已 show 的 toast 各自 _timer 在 disconnected 后仍会在
    // 脱离 DOM 的容器上触发 _remove（无害但泄漏；重连后旧 timer 还可能与新 toast 竞争）
    // P3 修复（code review）：只清 timer 不删元素 → disconnect→reconnect 循环后
    // 陈旧 toast 复活且无 timer 永不自动消失，占用 show() 的 MAX_TOASTS 槽位挤掉新 toast；
    // clearTimeout 后必须 t.remove()（slide-out 移除 timer 存于 _remove 闭包无法
    // 追踪，直接同步移除最稳妥）
    const c = this.shadowRoot?.getElementById("c") as HTMLElement | null;
    if (c) {
      c.querySelectorAll(".toast").forEach((el) => {
        const t = el as ToastEl;
        if (t._timer) clearTimeout(t._timer);
        t.remove();
      });
    }
  }

  show(
    msg: string,
    undoCallback: (() => void) | null,
    duration: number = DEFAULT_DURATION,
    type = "",
    clickCallback?: () => void,
  ): void {
    const c = this.shadowRoot!.getElementById("c") as HTMLElement;
    // 限制最多 MAX_TOASTS 个同时显示，超出直接同步移除最早的（_remove 含动画异步，会死循环）
    while (c.children.length >= MAX_TOASTS) {
      const oldest = c.children[0] as ToastEl;
      if (oldest) {
        if (oldest._timer) clearTimeout(oldest._timer);
        oldest.remove();
      }
    }
    const t = document.createElement("div") as ToastEl;
    t.className = "toast" + (type ? " " + type : "");
    t.dataset.testid = "toast"; // G-1 稳定钩子（Design.md §19.1）
    if (clickCallback) t.style.cursor = "pointer";
    t.innerHTML = `<span class="msg">${this._esc(msg)}</span>${undoCallback ? `<button class="undo-btn">↩ ${tr("toast.undo")}</button>` : ""}<button class="close-btn">✕</button>`;
    c.appendChild(t);
    if (clickCallback) {
      (t.querySelector(".msg") as HTMLElement).onclick = (e: MouseEvent) => {
        e.stopPropagation();
        // P2 修复：JS 层防重入——pointer-events:none 只拦真实鼠标事件，
        // 拦不住编程式 click()/键盘激活；handler 首行检查标记双保险
        if (t.style.pointerEvents === "none") return;
        t.style.pointerEvents = "none";
        try {
          clickCallback();
        } catch (e) {
          // P2 修复（审核发现）：click 回调无 catch 出口——抛错逃逸 onclick 成
          // uncaught 且无反馈，与 undo 路径（L92-103 有 catch）错误边界不对称；
          // 对齐 undo：记录并反馈，不静默
          console.error("[toast] 点击回调失败:", e);
          bus.emit("toast:show", {
            msg: "❌ " + tr("error.fallback"),
            duration: ERR_TOAST_MS,
            type: "error",
          });
        } finally {
          this._remove(t);
        }
      };
    }
    if (undoCallback) {
      (t.querySelector(".undo-btn") as HTMLElement).onclick = () => {
        // P2 修复：JS 层防重入（同 click）——防撤销连点重复执行 undoCallback
        if (t.style.pointerEvents === "none") return;
        t.style.pointerEvents = "none";
        try {
          undoCallback();
          // P3 修复（审核发现）：内部反馈统一走 bus——原 this.show 绕过 bus，
          // error-diary 的 toast:show 监听收不到（用户可见错误漏出日记链）
          bus.emit("toast:show", {
            msg: "✅ " + tr("toast.undone"),
            duration: OK_TOAST_MS,
            type: "success",
          });
        } catch (e) {
          // P2 修复：undo 抛错不得跳过反馈——原 try/finally 无 catch，
          // 异常传播跳过「已撤销」确认且冒泡控制台无用户反馈
          console.error("[toast] 撤销回调失败:", e);
          bus.emit("toast:show", {
            msg: "❌ " + tr("toast.undoFailed"),
            duration: ERR_TOAST_MS,
            type: "error",
          });
        } finally {
          this._remove(t);
        }
      };
    }
    (t.querySelector(".close-btn") as HTMLElement).onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this._remove(t);
    };
    t._timer = setTimeout(() => this._remove(t), duration);
  }

  _remove(t: ToastEl): void {
    if (t._timer) clearTimeout(t._timer);
    if (!t.parentNode) return;
    t.style.animation = "slideOut .2s ease forwards";
    setTimeout(() => t.remove(), SLIDE_OUT_MS);
  }

  _esc(s: string): string {
    return esc(s);
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-toast")) {
  customElements.define("app-toast", AppToast);
}
