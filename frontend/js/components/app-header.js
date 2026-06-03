// ===== <app-header> — 顶部导航栏 =====
// 事件：theme:toggle, settings:open
// 监听：theme:changed（更新按钮文本）

class AppHeader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._theme = 'dark';
  }

  connectedCallback() {
    this._unsubs = [];
    this._unsubs.push(bus.on('theme:changed', ({ theme }) => {
      this._theme = theme;
      const btn = this.shadowRoot.getElementById('btn-theme');
      if (btn) btn.textContent = theme === 'dark' ? '🌙 暗色' : '☀️ 亮色';
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
          display: block;
          background: #181825;
          border-bottom: 1px solid rgba(255,255,255,.06);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          padding: 8px 16px;
          gap: 10px;
          height: 40px;
        }
        .logo {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .logo-icon { font-size: 18px; }
        .status {
          font-size: 11px;
          color: #6c7086;
          flex: 1;
        }
        .btn {
          padding: 4px 10px;
          border-radius: 5px;
          border: 1px solid rgba(255,255,255,.08);
          background: transparent;
          color: #cdd6f4;
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          transition: background .12s, color .12s;
        }
        .btn:hover { background: #2a2a42; }
        .btn-accent {
          background: #7c83ff33;
          color: #7c83ff;
          border-color: #7c83ff55;
        }
        .btn-accent:hover { background: #7c83ff55; }
      </style>
      <div class="header">
        <div class="logo">
          <span class="logo-icon">🧱</span>
          <span>YSM 模型管理器</span>
        </div>
        <span class="status" id="st">就绪</span>
        <div style="flex:1"></div>
        <button class="btn" id="btn-theme">${this._theme === 'dark' ? '🌙 暗色' : '☀️ 亮色'}</button>
        <button class="btn btn-accent" id="btn-settings">⚙️ 设置</button>
      </div>
    `;

    this.shadowRoot.getElementById('btn-theme').onclick = () => {
      bus.emit('theme:toggle');
    };
    this.shadowRoot.getElementById('btn-settings').onclick = () => {
      bus.emit('settings:open');
    };
  }
}
customElements.define('app-header', AppHeader);
