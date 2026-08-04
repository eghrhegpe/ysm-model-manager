// ===== <context-menu> — 右键菜单（类型化版 — ADR-014 P3 components）=====
// 事件：menu:show, menu:hide
// 监听：menu:show({ x, y, items: [{label, icon?, onClick}] })
import { bus, type MenuItem } from "../bus.ts";
import { esc } from "../utils/dom.ts";

class ContextMenu extends HTMLElement {
  _unsub: (() => void) | undefined;
  _docClick: () => void;
  _docCtx: () => void;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._docClick = (): void => this.hide();
    this._docCtx = (): void => this.hide();
  }

  connectedCallback(): void {
    this._unsub = bus.on("menu:show", ({ x, y, items }) => {
      this.show(x, y, items);
    });
    document.addEventListener("click", this._docClick);
    document.addEventListener("contextmenu", this._docCtx);
    this.render();
  }

  disconnectedCallback(): void {
    if (this._unsub) this._unsub();
    document.removeEventListener("click", this._docClick);
    document.removeEventListener("contextmenu", this._docCtx);
  }

  render(): void {
    this.shadowRoot!.innerHTML = `
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
          animation: menuPop .2s cubic-bezier(.34,1.56,.64,1);
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
        @keyframes menuPop { 0% { opacity: 0; transform: scale(.85) translateY(-6px); } 60% { opacity: 1; transform: scale(1.02) translateY(0); } 100% { transform: scale(1); } }
        @keyframes itemSlideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
      </style>
      <div class="menu" id="menu"></div>
    `;
  }

  _esc(s: unknown): string {
    return esc(s == null ? "" : String(s));
  }

  show(x: number, y: number, items: MenuItem[]): void {
    const menu = this.shadowRoot!.getElementById("menu") as HTMLElement;
    menu.innerHTML = items
      .map((item, i) => {
        if (item.divider) return '<hr class="divider">';
        const label = this._esc(item.label || "");
        const icon = item.icon ? this._esc(item.icon) : "";
        const danger = item.danger ? "danger" : "";
        return `
        <div class="item ${danger}" data-idx="${i}" style="animation: itemSlideIn .15s ease ${i * 25}ms both;">
          ${icon ? `<span class="icon">${icon}</span>` : ""}
          <span>${label}</span>
        </div>
      `;
      })
      .join("");

    // 绑定点击
    menu.querySelectorAll(".item").forEach((el) => {
      (el as HTMLElement).onclick = (e: MouseEvent) => {
        e.stopPropagation();
        const idx = parseInt((el as HTMLElement).dataset.idx || "", 10);
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

  hide(): void {
    this.style.display = "none";
  }
}
customElements.define("context-menu", ContextMenu);
