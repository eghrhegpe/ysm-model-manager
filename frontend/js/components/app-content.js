// ===== <app-content> — 多页面内容容器 =====
// 监听：nav:change — 切换到对应页面

class AppContent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._current = "dashboard";
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this.render();
    });
    this.render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  render() {
    let innerHTML = "";
    switch (this._current) {
      case "dashboard":
        innerHTML = this._renderDashboard();
        break;
      case "repository":
        innerHTML = this._renderRepository();
        break;
      case "instances":
        innerHTML = this._renderInstances();
        break;
      case "downloads":
        innerHTML = this._renderPlaceholder("⬇️", "下载与更新");
        break;
      case "diagnostics":
        innerHTML = this._renderPlaceholder("🛠️", "诊断与冲突检测");
        break;
      case "settings":
        innerHTML = this._renderSettings();
        break;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; background:#1e1e2e; }
        .page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
        .section-title { font-size:14px; font-weight:600; color:#fff; padding:16px 16px 8px; }
        .card-row { display:flex; gap:12px; padding:0 16px; }
        .stat-card { flex:1; background:#181825; border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; }
        .stat-card .num { font-size:24px; font-weight:700; color:#7c83ff; }
        .stat-card .label { font-size:11px; color:#6c7086; margin-top:2px; }
        .stat-card .sub { font-size:10px; color:#a6adc8; margin-top:6px; }
        .placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#6c7086; font-size:12px; gap:8px; }
        .placeholder-box .big { font-size:48px; }
        .ptag { font-size:9px; background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
        .repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
        .repo-layout app-sidebar { width:280px; flex-shrink:0; }
        .settings-group { padding:0 16px; }
        .setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#181825; border-radius:6px; margin-bottom:4px; font-size:12px; }
        .setting-row .label { color:#cdd6f4; }
        .setting-row .value { color:#6c7086; }
      </style>
      <div class="page">${innerHTML}</div>
    `;
  }

  _renderDashboard() {
    return `<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
      <div class="section-title">🏠 仪表盘</div>
      <div class="card-row">
        <div class="stat-card"><div class="num">6</div><div class="label">仓库模型</div><div class="sub">已启用: 5</div></div>
        <div class="stat-card"><div class="num">4</div><div class="label">整合包</div><div class="sub">完全同步: 2</div></div>
        <div class="stat-card"><div class="num">2</div><div class="label">待处理</div><div class="sub">待上传: 2</div></div>
        <div class="stat-card"><div class="num">—</div><div class="label">月同步</div><div class="sub"><span class="ptag">预告</span></div></div>
      </div>
      <div style="padding:16px">
        <div style="font-size:11px;color:#6c7086;margin-bottom:8px">最近使用的整合包</div>
        <div style="display:flex;gap:8px">
          <div style="background:#181825;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px;font-size:11px;flex:1"><b>📦 我的整合包</b><br><span style="color:#6c7086">✅ 已同步 3/4</span></div>
          <div style="background:#181825;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px;font-size:11px;flex:1"><b>📦 光影测试包</b><br><span style="color:#f38ba8">⬇️ 缺失 2/3</span></div>
        </div>
      </div>
    </div>`;
  }

  _renderRepository() {
    return '<div class="repo-layout"><app-tree></app-tree></div>';
  }

  _renderPlaceholder(icon, label) {
    return (
      '<div class="placeholder-box"><div class="big">' +
      icon +
      "</div><div>" +
      label +
      '</div><span class="ptag">预告</span></div>'
    );
  }

  _renderInstances() {
    return '<div class="repo-layout"><app-sidebar></app-sidebar><app-preview></app-preview></div>';
  }

  _renderSettings() {
    return '<div style="flex:1;overflow-y:auto"><div class="section-title">⚙️ 设置</div><div class="settings-group"><div class="setting-row"><span class="label">🎮 游戏路径</span><span class="value">未设置 <span class="ptag" style="margin-left:4px">预告</span></span></div><div class="setting-row"><span class="label">📁 仓库路径</span><span class="value">未设置 <span class="ptag" style="margin-left:4px">预告</span></span></div><div class="setting-row"><span class="label">🌙 主题</span><span class="value">暗色</span></div><div class="setting-row"><span class="label">🔗 链接模式</span><span class="value">硬链接 <span class="ptag" style="margin-left:4px">预告</span></span></div></div></div>';
  }
}
customElements.define("app-content", AppContent);
