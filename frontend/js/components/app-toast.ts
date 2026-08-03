// ===== <app-toast> — Toast 通知系统（类型化版 — ADR-014 P3 components）=====
// 用法：bus.emit('toast:show', { msg, undo?, duration?, type? })
import { bus } from "../bus.ts";

/** toast 元素（含关闭定时器） */
type ToastEl = HTMLElement & {
  _timer?: ReturnType<typeof setTimeout>;
};

class AppToast extends HTMLElement {
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
        .toast.info { border-left: 3px solid var(--accent); }
        .toast .msg { flex: 1; white-space: pre-line; }
        .toast .undo-btn { padding: 4px 10px; border-radius: 5px; border: none; background: var(--hover); color: var(--accent); cursor: pointer; font-size: var(--fs-sm); font-family: inherit; transition: background var(--tr-fast); }
        .toast .undo-btn:hover { background: var(--act); }
        .toast .close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: var(--fs-md); padding: 0 2px; }
        .toast .close-btn:hover { color: var(--txt); }
        @keyframes toastIn { 0% { transform: translateY(20px) scale(.95); opacity: 0; } 60% { transform: translateY(-4px) scale(1.02); opacity: 1; } 100% { transform: translateY(0) scale(1); } }
        @keyframes slideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
      </style>
      <div id="c" class="toast-container"></div>
    `;
  }

  connectedCallback(): void {
    this._unsub = bus.on("toast:show", ({ msg, undo, duration, type, click }) => {
      this.show(msg, undo || null, duration, type, click);
    });
  }

  disconnectedCallback(): void {
    if (this._unsub) this._unsub();
  }

  show(
    msg: string,
    undoCallback: (() => void) | null,
    duration = 4000,
    type = "",
    clickCallback?: () => void,
  ): void {
    const c = this.shadowRoot!.getElementById("c") as HTMLElement;
    // 限制最多 5 个同时显示，超出直接同步移除最早的（_remove 含动画异步，会死循环）
    while (c.children.length >= 5) {
      const oldest = c.children[0] as ToastEl;
      if (oldest) {
        if (oldest._timer) clearTimeout(oldest._timer);
        oldest.remove();
      }
    }
    const t = document.createElement("div") as ToastEl;
    t.className = "toast" + (type ? " " + type : "");
    if (clickCallback) t.style.cursor = "pointer";
    t.innerHTML = `<span class="msg">${this._esc(msg)}</span>${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ""}<button class="close-btn">✕</button>`;
    c.appendChild(t);
    if (clickCallback) {
      (t.querySelector(".msg") as HTMLElement).onclick = (e: MouseEvent) => {
        e.stopPropagation();
        clickCallback();
        this._remove(t);
      };
    }
    if (undoCallback) {
      (t.querySelector(".undo-btn") as HTMLElement).onclick = () => {
        undoCallback();
        this._remove(t);
        this.show("✅ 已撤销", null, 2000, "success");
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
    setTimeout(() => t.remove(), 200);
  }

  _esc(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
}
customElements.define("app-toast", AppToast);
