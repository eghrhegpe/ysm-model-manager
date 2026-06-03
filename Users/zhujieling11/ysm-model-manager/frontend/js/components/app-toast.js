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
        .toast .msg { flex: 1; }
        .toast .undo-btn {
          padding: 4px 10px; border-radius: 5px; border: none;
          background: #7c83ff33; color: #7c83ff; cursor: pointer;
          font-size: 11px; font-family: inherit; transition: background .12s;
        }
        .toast .undo-btn:hover { background: #7c83ff55; }
        .toast .close-btn {
          background: none; border: none; color: #6c7086;
          cursor: pointer; font-size: 14px; padding: 0 2px;
        }
        .toast .close-btn:hover { color: #cdd6f4; }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(20px); opacity: 0; }
        }
      </style>
      <div id="c" style="display:flex;flex-direction:column;gap:8px"></div>
    \`;
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
    t.innerHTML = \`<span class="msg">\${this._esc(msg)}</span>\${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ''}<button class="close-btn">✕</button>\`;
    c.appendChild(t);
    if (undoCallback) {
      t.querySelector('.undo-btn').onclick = () => {
        undoCallback();
        this._remove(t);
        this.show('✅ 已撤销', null, 2000, 'success');
      };
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

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
}
customElements.define('app-toast', AppToast);// ===== <app-toast> — Toast 通知系统 =====
// 用法：bus.emit('toast:show', { msg, undo?, duration?, type? })

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
        .toast .msg { flex: 1; }
        .toast .undo-btn {
          padding: 4px 10px; border-radius: 5px; border: none;
          background: #7c83ff33; color: #7c83ff; cursor: pointer;
          font-size: 11px; font-family: inherit; transition: background .12s;
        }
        .toast .undo-btn:hover { background: #7c83ff55; }
        .toast .close-btn {
          background: none; border: none; color: #6c7086;
          cursor: pointer; font-size: 14px; padding: 0 2px;
        }
        .toast .close-btn:hover { color: #cdd6f4; }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(20px); opacity: 0; }
        }
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
    t.innerHTML = `
      <span class="msg">${this._esc(msg)}</span>
      ${undoCallback ? '<button class="undo-btn">↩ 撤销</button>' : ''}
      <button class="close-btn">✕</button>
    `;
    c.appendChild(t);

    if (undoCallback) {
      t.querySelector('.undo-btn').onclick = () => {
        undoCallback();
        this._remove(t);
        this.show('✅ 已撤销', null, 2000, 'success');
      };
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

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
}
customElements.define('app-toast', AppToast);
