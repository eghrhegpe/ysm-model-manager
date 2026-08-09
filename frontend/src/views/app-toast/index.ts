// ===== <app-toast> — Toast 通知系统（类型化版 — ADR-014 P3 components）=====
// 用法：bus.emit('toast:show', { msg, undo?, duration?, type? })
import { bus } from "../../bus.ts";
import { esc } from "../../utils/dom/html.ts";

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
        .toast.warn { border-left: 3px solid #f38ba8; }
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
    t.dataset.testid = "toast"; // G-1 稳定钩子（Design.md §19.1）
    if (clickCallback) t.style.cursor = "pointer";
    t.innerHTML = `<span class="msg">${this._esc(msg)}</span>${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ""}<button class="close-btn">✕</button>`;
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
            msg: "❌ 操作失败",
            duration: 3000,
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
            msg: "✅ 已撤销",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          // P2 修复：undo 抛错不得跳过反馈——原 try/finally 无 catch，
          // 异常传播跳过「已撤销」确认且冒泡控制台无用户反馈
          console.error("[toast] 撤销回调失败:", e);
          bus.emit("toast:show", {
            msg: "❌ 撤销失败",
            duration: 3000,
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
    setTimeout(() => t.remove(), 200);
  }

  _esc(s: string): string {
    return esc(s);
  }
}
customElements.define("app-toast", AppToast);
