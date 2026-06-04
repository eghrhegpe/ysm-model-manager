// ===== app-content 页面模板 =====

export function repositoryHTML() {
  return '<div class="repo-layout"><app-tree></app-tree><app-preview mode="model"></app-preview></div>';
}

export function instancesHTML() {
  return '<div class="repo-layout"><app-sidebar></app-sidebar><app-preview mode="stat"></app-preview></div>';
}

export function settingsHTML() {
  return `<div style="flex:1;overflow-y:auto;padding:12px">

<div class="section-title" style="margin-bottom:8px">⚙️ 核心路径配置</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🎮 游戏根目录</span>
    <span class="value" id="set-mc-path" style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px">加载中...</span>
    <button class="btn" id="set-mc-browse" style="font-size:10px;margin-left:auto">📂 选择目录</button>
    <button class="btn" id="set-mc-detect" style="font-size:10px">🔍 自动搜索</button>
  </div>
  <div style="font-size:9px;color:#6c7086;padding:2px 0 0 0">自动扫描常见路径如 %AppData%\\.minecraft</div>
</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">📁 模型仓库路径</span>
    <span class="value" id="set-repo-path" style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px">加载中...</span>
    <button class="btn" id="set-repo-browse" style="font-size:10px;margin-left:auto">📂 选择目录</button>
  </div>
  <div style="font-size:9px;color:#6c7086;padding:2px 0 0 0">存放所有下载的 .ysm / .zip / .7z 模型文件</div>
</div>

<div class="section-title" style="margin-bottom:8px;margin-top:16px">⚙️ 存储策略</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🔗 链接模式</span>
  </div>
  <div style="display:flex;gap:8px;padding:4px 0">
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer">
      <input type="radio" name="link-mode" value="copy" id="lm-copy"> 📋 复制
    </label>
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer">
      <input type="radio" name="link-mode" value="hardlink" id="lm-hardlink"> 🔗 硬链接
    </label>
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer">
      <input type="radio" name="link-mode" value="symlink" id="lm-symlink"> 🔗 符号链接
    </label>
  </div>
  <div style="font-size:9px;color:#6c7086;padding:2px 0 0 0">硬链接省磁盘空间，源文件删除后模型仍在整合包中生效</div>
</div>

<div class="section-title" style="margin-bottom:8px;margin-top:16px">⚙️ 界面与体验</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🌙 主题模式</span>
    <select id="set-theme" style="background:var(--bg,#1e1e2e);color:var(--txt,#cdd6f4);border:1px solid var(--bd,#444);border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer">
      <option value="system">💻 跟随系统</option>
      <option value="dark">🌙 暗黑模式</option>
      <option value="light">☀️ 明亮模式</option>
    </select>
  </div>
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
<button class="diag-btn" data-diag="dedup">
<span class="diag-btn-icon">🔗</span>
<span>模型去重</span>
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
<div class="diag-panel" id="diag-dedup" style="display:none">
<div class="diag-panel-header">
<span>🔗 模型去重</span>
<button class="hdr-btn accent" id="diag-start-dedup">🔗 开始去重</button>
</div>
<div id="diag-dedup-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">点击「开始去重」扫描仓库中 SHA256 重复的模型文件</div></div>
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

export function recycleHTML() {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span style="font-size:14px;font-weight:600">🗑️ 回收站</span>
<span id="recy-count" style="font-size:11px;color:#6c7086">加载中...</span>
<button class="btn" id="recy-refresh" style="margin-left:auto;font-size:10px">🔄 刷新</button>
<button class="btn danger" id="recy-empty" style="font-size:10px">🗑️ 清空回收站</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
<div id="recy-empty-hint" style="flex:1;display:none;align-items:center;justify-content:center;color:#6c7086;font-size:12px">🗑️ 回收站为空</div>
</div>`;
}
