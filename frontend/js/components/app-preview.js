// ===== <app-preview> — 右侧统计面板 =====
// 监听：stats:updated
// 事件：stats:refresh, stats:upload, stats:logs

class AppPreview extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stats = { repo: 0, ver: 0, ok: 0, tot: 0, pending: 0 };
  }

  connectedCallback() {
    this._unsubs = [];
    this._unsubs.push(
      bus.on("stats:updated", (stats) => {
        if (stats) this._stats = { ...this._stats, ...stats };
        this._updateDisplay();
      }),
    );
    this.render();
    // ===== 模拟数据（预告阶段） =====
    this._stats = { repo: 6, ver: 4, ok: 2, tot: 4, pending: 2 };
    this._updateDisplay();
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: #11111b;
          border-left: 1px solid rgba(255,255,255,.06);
          width: 200px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .content { padding: 12px; }
        h3 {
          font-size: 12px;
          font-weight: 600;
          color: #a6adc8;
          text-transform: uppercase;
          letter-spacing: .5px;
          margin-bottom: 10px;
        }
        .stat-row {
          font-size: 11px;
          color: #cdd6f4;
          padding: 3px 0;
          display: flex;
          justify-content: space-between;
        }
        .stat-row .label { color: #6c7086; }
        .stat-row .value { color: #fff; font-weight: 500; }
        .stat-row .value.accent { color: #7c83ff; }
        .divider {
          border: none;
          border-top: 1px solid rgba(255,255,255,.06);
          margin: 8px 0;
        }
        .btn-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .btn {
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
        .btn:hover { background: #2a2a42; }
        .btn.accent { background: #7c83ff33; color: #7c83ff; border-color: #7c83ff55; }
        .btn.accent:hover { background: #7c83ff55; }
        .btn.warn { background: #f9a82622; color: #f9a826; border-color: #f9a82655; }
        .btn .tag { font-size: 7px; background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 4px; }
      </style>
      <div class="content">
        <h3>📊 统计</h3>
        <div class="stat-row"><span class="label">仓库模型</span><span class="value" id="s-repo">0</span></div>
        <div class="stat-row"><span class="label">整合包数</span><span class="value" id="s-ver">0</span></div>
        <div class="stat-row"><span class="label">完全同步</span><span class="value" id="s-ok">0</span><span class="value" id="s-tot" style="display:none"></span></div>
        <div class="stat-row"><span class="label">待上传</span><span class="value accent" id="s-pending">0</span></div>
        <hr class="divider">
        <div class="btn-group">
          <button class="btn" id="btn-refresh">🔄 刷新</button>
          <button class="btn warn" id="btn-upload">📤 上传待上传</button>
          <button class="btn" id="btn-logs">📋 日志</button>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById("btn-refresh").onclick = () =>
      bus.emit("stats:refresh");
    this.shadowRoot.getElementById("btn-upload").onclick = () =>
      bus.emit("stats:upload");
    this.shadowRoot.getElementById("btn-logs").onclick = () =>
      bus.emit("stats:logs");
  }

  _updateDisplay() {
    const get = (id) => this.shadowRoot.getElementById(id);
    if (get("s-repo")) get("s-repo").textContent = this._stats.repo;
    if (get("s-ver")) get("s-ver").textContent = this._stats.ver;
    if (get("s-ok")) get("s-ok").textContent = this._stats.ok;
    if (get("s-tot")) get("s-tot").textContent = this._stats.tot;
    if (get("s-pending")) get("s-pending").textContent = this._stats.pending;
  }
}
customElements.define("app-preview", AppPreview);
