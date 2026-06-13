// ===== <app-toast> — Toast 通知系统 =====
// 用法：bus.emit('toast:show', { msg, undo?, duration?, type? })
//       type: 'success' | 'error' | 'info'
import { bus } from "../bus.js";

class AppToast extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .toast {
          display: flex; align-items: center; gap: 10px; padding: 10px 16px;
          border-radius: 8px; background: var(--card); color: var(--txt); font-size: var(--fs-base);
          box-shadow: 0 6px 20px rgba(0,0,0,.4); animation: slideUp .25s ease;
          border: 1px solid var(--bd); pointer-events: auto;
          font-family: var(--font-ui);
        }
        .toast.error { border-left: 3px solid var(--paid); }
        .toast.success { border-left: 3px solid var(--free); }
        .toast.info { border-left: 3px solid var(--accent); }
        .toast .msg { flex: 1; white-space: pre-line; }
        .toast .undo-btn { padding: 4px 10px; border-radius: 5px; border: none; background: var(--hover); color: var(--accent); cursor: pointer; font-size: var(--fs-sm); font-family: inherit; transition: background .12s; }
        .toast .undo-btn:hover { background: var(--act); }
        .toast .close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: var(--fs-md); padding: 0 2px; }
        .toast .close-btn:hover { color: var(--txt); }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
      </style>
      <div id="c" class="toast-container"></div>
    `;
  }

  connectedCallback() {
    this._unsub = bus.on(
      "toast:show",
      ({ msg, undo, duration, type, click }) => {
        this.show(msg, undo, duration, type, click);
      },
    );
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  show(msg, undoCallback, duration = 4000, type = "", clickCallback) {
    const c = this.shadowRoot.getElementById("c");
    const t = document.createElement("div");
    t.className = "toast" + (type ? " " + type : "");
    if (clickCallback) t.style.cursor = "pointer";
    t.innerHTML = `<span class="msg">${this._esc(msg)}</span>${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ""}<button class="close-btn">✕</button>`;
    c.appendChild(t);
    if (clickCallback) {
      t.querySelector(".msg").onclick = (e) => {
        e.stopPropagation();
        clickCallback();
        this._remove(t);
      };
    }
    if (undoCallback) {
      t.querySelector(".undo-btn").onclick = () => {
        undoCallback();
        this._remove(t);
        this.show("✅ 已撤销", null, 2000, "success");
      };
    }
    t.querySelector(".close-btn").onclick = (e) => {
      e.stopPropagation();
      this._remove(t);
    };
    t._timer = setTimeout(() => this._remove(t), duration);
  }

  _remove(t) {
    if (t._timer) clearTimeout(t._timer);
    if (!t.parentNode) return;
    t.style.animation = "slideOut .2s ease forwards";
    setTimeout(() => t.remove(), 200);
  }

  _esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
}
customElements.define("app-toast", AppToast);
