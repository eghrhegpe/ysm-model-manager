// ===== <context-menu> — 右键菜单 =====
// 事件：menu:show, menu:hide
// 监听：menu:show({ x, y, items: [{label, icon?, onClick}] })
import { bus } from "../bus.js";

class ContextMenu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._docClick = () => this.hide();
    this._docCtx = () => this.hide();
  }

  connectedCallback() {
    this._unsub = bus.on("menu:show", ({ x, y, items }) => {
      this.show(x, y, items);
    });
    document.addEventListener("click", this._docClick);
    document.addEventListener("contextmenu", this._docCtx);
    this.render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
    document.removeEventListener("click", this._docClick);
    document.removeEventListener("contextmenu", this._docCtx);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: var(--z-popover);
          display: none;
          font-family: var(--font-ui);
          font-size: var(--fs-base);
        }
        .menu {
          background: var(--card);
          border: 1px solid var(--bd);
          border-radius: 8px;
          padding: 4px;
          min-width: 160px;
          box-shadow: 0 8px 24px rgba(0,0,0,.5);
          animation: fadeIn .1s ease;
        }
        .item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 5px;
          font-size: var(--fs-btn-secondary);
          color: var(--txt);
          cursor: pointer;
          transition: background .1s;
        }
        .item:hover { background: #7c83ff33; color: var(--accent); }
        .item.danger:hover { background: var(--paid); color: #fff; }
        .item .icon { font-size: var(--fs-base); width: 16px; text-align: center; }
        .divider {
          border: none;
          border-top: 1px solid var(--bd);
          margin: 3px 8px;
        }
        @keyframes fadeIn { from { opacity: .5; transform: scale(.95); } to { opacity: 1; transform: scale(1); } }
      </style>
      <div class="menu" id="menu"></div>
    `;
  }

  _esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  show(x, y, items) {
    const menu = this.shadowRoot.getElementById("menu");
    menu.innerHTML = items
      .map((item, i) => {
        if (item.divider) return '<hr class="divider">';
        const label = this._esc(item.label);
        const icon = item.icon ? this._esc(item.icon) : "";
        const danger = item.danger ? "danger" : "";
        return `
        <div class="item ${danger}" data-idx="${i}">
          ${icon ? `<span class="icon">${icon}</span>` : ""}
          <span>${label}</span>
        </div>
      `;
      })
      .join("");

    // 绑定点击
    menu.querySelectorAll(".item").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        if (items[idx] && items[idx].onClick) items[idx].onClick();
        this.hide();
      };
    });

    // 边界检测：先测量菜单尺寸再设置位置，避免 RAF 跳变
    this.style.display = "block";
    this.style.left = "-9999px";
    this.style.top = "-9999px";
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      const mw = rect.width;
      const mh = rect.height;
      let l = x;
      let t = y;
      if (x + mw > iw) l = Math.max(0, iw - mw);
      if (y + mh > ih) t = Math.max(0, ih - mh);
      this.style.left = l + "px";
      this.style.top = t + "px";
    });
  }

  hide() {
    this.style.display = "none";
  }
}
customElements.define("context-menu", ContextMenu);
