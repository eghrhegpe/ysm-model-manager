// ===== <context-menu> — 右键菜单 =====
// 事件：menu:show, menu:hide
// 监听：menu:show({ x, y, items: [{label, icon?, onClick}] })
import { bus } from "../bus.js";

class ContextMenu extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._unsub = bus.on('menu:show', ({ x, y, items }) => {
      this.show(x, y, items);
    });
    document.addEventListener('click', () => this.hide());
    document.addEventListener('contextmenu', () => this.hide());
    this.render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: 99999;
          display: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .menu {
          background: #2a2a42;
          border: 1px solid rgba(255,255,255,.08);
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
          font-size: 11px;
          color: #cdd6f4;
          cursor: pointer;
          transition: background .1s;
        }
        .item:hover { background: #7c83ff33; color: #7c83ff; }
        .item.danger:hover { background: #f38ba833; color: #f38ba8; }
        .item .icon { font-size: 12px; width: 16px; text-align: center; }
        .divider {
          border: none;
          border-top: 1px solid rgba(255,255,255,.06);
          margin: 3px 8px;
        }
        @keyframes fadeIn { from { opacity: .5; transform: scale(.95); } to { opacity: 1; transform: scale(1); } }
      </style>
      <div class="menu" id="menu"></div>
    `;
  }

  show(x, y, items) {
    const menu = this.shadowRoot.getElementById('menu');
    menu.innerHTML = items.map((item, i) => {
      if (item.divider) return '<hr class="divider">';
      return `
        <div class="item ${item.danger ? 'danger' : ''}" data-idx="${i}">
          ${item.icon ? `<span class="icon">${item.icon}</span>` : ''}
          <span>${item.label}</span>
        </div>
      `;
    }).join('');

    // 绑定点击
    menu.querySelectorAll('.item').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        if (items[idx] && items[idx].onClick) items[idx].onClick();
        this.hide();
      };
    });

    this.style.display = 'block';
    this.style.left = x + 'px';
    this.style.top = y + 'px';
  }

  hide() {
    this.style.display = 'none';
  }
}
customElements.define('context-menu', ContextMenu);
