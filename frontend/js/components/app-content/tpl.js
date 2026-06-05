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
      <option value="cyber">🌙 赛博霓虹</option>
      <option value="warm">☀️ 温暖木纹</option>
      <option value="pro">⚪ 极简深邃</option>
    </select>
  </div>
</div>

<div class="section-title" style="margin-bottom:8px;margin-top:16px">⚙️ 创意工坊</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🧩 站点与创作者配置</span>
    <button class="btn" id="set-ws-reset" style="font-size:10px">🗑️ 重置为默认</button>
  </div>
  <div style="font-size:9px;color:#6c7086;padding:2px 0 0 0">
    重置 workshop_sites.json 和 workshop_creators/ 文件夹为出厂默认值。<br>
    编辑文件位于程序同目录，修改后可在创意工坊页点「🔄」刷新。
  </div>
</div>

</div>`;
}

export function placeholderHTML(icon, label) {
  return `<div class="placeholder-box"><div class="big">${icon}</div><div>${label}</div><span class="ptag">预告</span></div>`;
}

export function downloadsHTML() {
  return `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
<div style="padding:12px 12px 4px;display:flex;gap:8px;align-items:center">
<span style="font-size:14px;font-weight:600">⬇️ 下载与导入</span>
<span style="font-size:10px;color:var(--muted)">拖入 .ysm / .zip / .7z 到下方区域</span>
</div>
<div id="dl-drop" style="flex:1;margin:4px 12px;border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;transition:all .2s;cursor:pointer;min-height:80px">
  <div style="font-size:28px;opacity:.35">📥</div>
  <div style="font-size:11px;color:var(--muted)">拖拽模型文件 <b>.ysm .zip .7z</b> 到此处</div>
  <div style="font-size:9px;color:var(--muted)">或点击选择文件</div>
  <input type="file" id="dl-file-input" accept=".ysm,.zip,.7z" style="display:none">
</div>
<div id="dl-form" style="margin:4px 12px;display:none;flex-direction:column;gap:4px">
  <div style="font-size:11px;display:flex;gap:8px">
    <span>文件：</span><span id="dl-fname" style="font-weight:500">-</span>
    <span style="color:var(--muted);font-size:10px" id="dl-fsize"></span>
  </div>
  <div style="font-size:11px;color:var(--muted)">导入仓库前，先重命名一下吧：</div>
  <div style="display:flex;gap:4px">
    <input id="dl-author" placeholder="作者" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-work" placeholder="作品品牌" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-chara" placeholder="角色名" style="width:80px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-variant" placeholder="变体" style="width:60px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-date" placeholder="年月" style="width:64px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-date-auto" checked> 当天
    </label>
  </div>
  <div style="font-size:11px;padding:4px 6px;border-radius:4px;background:var(--surf)">
    <span style="color:var(--muted)">最终命名：</span><span id="dl-preview" style="font-weight:500">-</span>
  </div>
  <button class="btn accent" id="dl-import" style="padding:6px;font-size:12px">📥 导入到仓库</button>
</div>
</div>`;
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

/* ===== 创意工坊页面 ===== */

export function workshopHTML() {
  return `<div class="ws-page" id="ws-page">
  <!-- 左栏：站点列表 -->
  <div class="ws-left" id="ws-left">
    <div style="padding:10px 12px 4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:600">🧩 创意工坊</span>
      <button class="btn" id="ws-refresh" style="font-size:9px;padding:2px 6px">🔄</button>
    </div>
    <div class="ws-grid" id="ws-grid">
      <div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>
    </div>
    <div style="padding:4px 12px 8px;font-size:8px;color:var(--muted)">
      站点：<span id="ws-source-info">-</span>
    </div>
  </div>
  <!-- 右栏：搜索 + 创作者 -->
  <div class="ws-right" id="ws-right">
    <div class="ws-right-inner" id="ws-right-inner">
      <!-- 默认视图：作者搜索 -->
      <div id="ws-search-view">
        <div style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--txt)">🔍 按作者搜索</div>
        <div style="padding:0 12px 8px;display:flex;gap:4px">
          <input id="ws-author-input" placeholder="输入作者名..." style="flex:1;padding:5px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
          <button class="btn accent" id="ws-search-btn" style="font-size:10px;padding:4px 10px">搜索</button>
        </div>
        <div id="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">
          <div style="color:var(--muted);font-size:10px;padding:4px 0">输入作者名，搜索仓库中的模型</div>
        </div>
      </div>
      <!-- 创作者视图：选中站点时显示 -->
      <div id="ws-creator-view" style="display:none;flex:1;display:none;flex-direction:column;overflow:hidden">
        <div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">
          <span style="font-size:12px;font-weight:600;color:var(--txt)" id="ws-cr-title">🎨 活跃创作者</span>
          <span style="font-size:9px;color:var(--muted);margin-left:auto">workshop_creators/</span>
        </div>
        <div class="ws-creators-list" id="ws-cr-list"></div>
      </div>
    </div>
  </div>
  <!-- 内嵌浏览（全屏覆盖） -->
  <div id="ws-browser" style="display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg)">
    <div class="ws-browser-bar">
      <button class="ws-back" id="ws-back">← 返回</button>
      <span class="ws-url" id="ws-url"></span>
      <button class="ws-open-btn" id="ws-open">↗ 浏览器打开</button>
    </div>
    <iframe id="ws-iframe" style="flex:1;border:none;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
    <div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">
      <div style="font-size:32px">🚫</div>
      <div>此站点不允许内嵌浏览</div>
      <button class="btn accent" id="ws-open-fallback" style="font-size:11px">↗ 在系统浏览器中打开</button>
    </div>
  </div>
  <!-- 二级菜单弹出层 -->
  <div id="ws-popup" class="ws-popup" style="display:none">
    <div class="ws-popup-item" data-action="browser">
      <span class="ws-popup-icon">↗</span>
      <div><div class="ws-popup-label">浏览器打开</div></div>
    </div>
    <div class="ws-popup-item" data-action="embed">
      <span class="ws-popup-icon">🔍</span>
      <div><div class="ws-popup-label">内嵌浏览</div></div>
    </div>
  </div>
</div>`;
}
