// ===== <app-toast> — Toast 通知系统 =====
class AppToast extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .toast {
          display: flex; align-items: center; gap: 10px; padding: 10px 16px;
          border-radius: 8px; background: #2a2a42; color: #cdd6f4; font-size: 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.4); animation: slideUp .25s ease;
          border: 1px solid rgba(255,255,255,.06); pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .toast.error { border-left: 3px solid #f38ba8; }
        .toast.success { border-left: 3px solid #a6e3a1; }
        .toast.info { border-left: 3px solid #89b4fa; }
        .toast .msg { flex: 1; }
        .toast .undo-btn { padding: 4px 10px; border-radius: 5px; border: none; background: #7c83ff33; color: #7c83ff; cursor: pointer; font-size: 11px; font-family: inherit; transition: background .12s; }
        .toast .undo-btn:hover { background: #7c83ff55; }
        .toast .close-btn { background: none; border: none; color: #6c7086; cursor: pointer; font-size: 14px; padding: 0 2px; }
        .toast .close-btn:hover { color: #cdd6f4; }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
      </style>
      <div id="c" style="display:flex;flex-direction:column;gap:8px"></div>
    `;
  }
  connectedCallback() {
    this._unsub = bus.on('toast:show', ({ msg, undo, duration, type }) => {
      this.show(msg, undo, duration, type);
    });
  }
  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }
  show(msg, undoCallback, duration = 4000, type = '') {
    const c = this.shadowRoot.getElementById('c');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.innerHTML = `<span class="msg">${this._esc(msg)}</span>${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ''}<button class="close-btn">✕</button>`;
    c.appendChild(t);
    if (undoCallback) {
      t.querySelector('.undo-btn').onclick = () => { undoCallback(); this._remove(t); this.show('✅ 已撤销', null, 2000, 'success'); };
    }
    t.querySelector('.close-btn').onclick = () => this._remove(t);
    t._timer = setTimeout(() => this._remove(t), duration);
  }
  _remove(t) {
    if (t._timer) clearTimeout(t._timer);
    if (!t.parentNode) return;
    t.style.animation = 'slideOut .2s ease forwards';
    setTimeout(() => t.remove(), 200);
  }
  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}
customElements.define('app-toast', AppToast);
// ===== <app-sidebar> — 左侧栏（整合包列表） =====
// 事件：ver:search, ysm:filter
// 监听：versions:updated, version:select

class AppSidebar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._unsubs = [];
    this._unsubs.push(bus.on('versions:updated', ({ instances, stats }) => {
      // 更新统计
      const statEl = this.shadowRoot.getElementById('ver-stat');
      if (statEl) statEl.textContent = `${instances.length}个整合包`;
    }));
    this.render();
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn());
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: #11111b;
          border-right: 1px solid rgba(255,255,255,.06);
          width: 280px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .header {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        }
        .header-label {
          font-size: 12px;
          font-weight: 600;
          color: #a6adc8;
          text-transform: uppercase;
          letter-spacing: .5px;
          flex: 1;
        }
        .header-stat {
          font-size: 10px;
          color: #6c7086;
        }
        .search-input {
          width: 100%;
          padding: 5px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,.08);
          background: #181825;
          color: #cdd6f4;
          font-size: 11px;
          outline: none;
          font-family: inherit;
        }
        .search-input::placeholder { color: #6c7086; }
        .list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        .list::-webkit-scrollbar { width: 4px; }
        .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
        .footer {
          padding: 8px 12px;
          border-top: 1px solid rgba(255,255,255,.06);
        }
        .footer-btn {
          width: 100%;
          padding: 6px 0;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,.08);
          background: transparent;
          color: #cdd6f4;
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          transition: background .12s;
        }
        .footer-btn:hover { background: #2a2a42; }
        .empty {
          text-align: center;
          padding: 30px 12px;
          font-size: 12px;
          color: #6c7086;
        }
      </style>
      <div class="header">
        <div class="header-row">
          <span class="header-label">📂 版本列表</span>
          <span class="header-stat" id="ver-stat">加载中...</span>
        </div>
        <input class="search-input" id="ver-search" type="text" placeholder="🔍 搜索整合包" autocomplete="off" autocapitalize="off">
      </div>
      <div class="list" id="vg">
        <div class="empty">请指定 .minecraft 目录</div>
      </div>
      <div class="footer">
        <button class="footer-btn" id="btn-mc">🎮 指定游戏路径</button>
      </div>
    `;

    this.shadowRoot.getElementById('ver-search').oninput = (e) => {
      bus.emit('ver:search', { keyword: e.target.value });
    };
    this.shadowRoot.getElementById('btn-mc').onclick = () => {
      bus.emit('dir:select-mc');
    };
  }
}
customElements.define('app-sidebar', AppSidebar);
