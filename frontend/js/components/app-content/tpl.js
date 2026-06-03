// ===== app-content 页面模板 =====

export function dashboardHTML() {
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

export function repositoryHTML() {
  return '<div class="repo-layout"><app-tree></app-tree><app-preview mode="model"></app-preview></div>';
}

export function instancesHTML() {
  return '<div class="repo-layout"><app-sidebar></app-sidebar><app-preview mode="stat"></app-preview></div>';
}

export function settingsHTML() {
  return `<div style="flex:1;overflow-y:auto">
<div class="section-title">⚙️ 设置</div>
<div class="settings-group">
<div class="setting-row"><span class="label">🎮 游戏路径</span><span class="value">未设置 <span class="ptag" style="margin-left:4px">预告</span></span></div>
<div class="setting-row"><span class="label">📁 仓库路径</span><span class="value">未设置 <span class="ptag" style="margin-left:4px">预告</span></span></div>
<div class="setting-row"><span class="label">🌙 主题</span><span class="value">暗色</span></div>
<div class="setting-row"><span class="label">🔗 链接模式</span><span class="value">硬链接 <span class="ptag" style="margin-left:4px">预告</span></span></div>
</div>
</div>`;
}

export function placeholderHTML(icon, label) {
  return `<div class="placeholder-box"><div class="big">${icon}</div><div>${label}</div><span class="ptag">预告</span></div>`;
}

export function diagnosticsHTML() {
  return `<div class="diag-wrapper">
<div class="diag-left">
<button class="diag-btn active" data-diag="log">
<span class="diag-btn-icon">📋</span>
<span>操作日志</span>
</button>
<button class="diag-btn" data-diag="conflict">
<span class="diag-btn-icon">⚡</span>
<span>冲突检测</span>
</button>
<div class="diag-left-spacer"></div>
<button class="diag-btn diag-btn-action" id="diag-refresh">
<span>🔄</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-clear">
<span>🗑️</span>
</button>
</div>
<div class="diag-right">
<div class="diag-panel" id="diag-log">
<div class="diag-panel-header">
<span>📋 操作日志</span>
<button class="hdr-btn" id="diag-refresh2" style="display:none">🔄</button>
</div>
<div id="diag-log-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">暂无日志</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div class="diag-panel-header">
<span>⚡ 冲突检测</span>
<button class="hdr-btn accent" id="diag-scan-conflict">⚡ 开始扫描</button>
</div>
<div id="diag-conflict-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">点击「开始扫描」检测整合包冲突</div></div>
</div>
</div>
</div>`;
}
