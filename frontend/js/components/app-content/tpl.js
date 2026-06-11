// ===== app-content 页面模板 =====

export function repositoryHTML() {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="tree">📁 文件树</button>' +
    '<button class="repo-tab" data-tab="import">📥 导入</button>' +
    '<button class="repo-tab" data-tab="recycle">🗑️ 回收站</button>' +
    '<button class="repo-tab" data-tab="dedup">🔗 去重</button>' +
    '<button class="repo-tab" data-tab="oldest">👴 仓库元老</button>' +
    "</div>" +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;border-right:1px solid var(--bd)">' +
    '<div class="repo-tab-body" id="repo-tab-tree" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    "<app-tree></app-tree>" +
    "</div>" +
    '<div class="repo-tab-body" id="repo-tab-import" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-recycle" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-dedup" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>' +
    '<div class="repo-tab-body" id="repo-tab-oldest" style="display:none;flex:1;overflow-y:auto;overflow-x:hidden"></div>' +
    "</div>" +
    '<app-preview mode="model" style="width:220px;flex-shrink:0;min-width:0"></app-preview>' +
    "</div>" +
    "</div>"
  );
}

export function instancesHTML() {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="versions">🎮 版本列表</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="ins-tab-versions">' +
    '<div class="repo-layout">' +
    '<app-sidebar class="ins-sidebar"></app-sidebar>' +
    '<div class="ins-content" id="ins-content">' +
    '<div class="dp-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px">' +
    '<div style="font-size:24px">👈</div>' +
    "<div>点击左侧整合包查看模型</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

export function settingsHTML() {
  return `<div class="stg-page">

<div class="section-title stg-title">⚙️ 核心路径配置</div>

<div class="settings-group stg-group">
  <div class="setting-row">
    <span class="label">🎮 游戏根目录</span>
    <span class="value stg-val" id="set-mc-path">加载中...</span>
    <button class="btn stg-btn stg-ml-auto" id="set-mc-browse">📂 选择目录</button>
    <button class="btn stg-btn" id="set-mc-detect">🔍 自动搜索</button>
  </div>
  <div class="stg-hint">自动扫描 PCL2、%AppData% 等常见位置。选择目录后自动检测 versions/ 等特征，选错父目录自动补 .minecraft 子目录</div>
  <div class="stg-hint" id="set-mc-empty-hint" style="display:none;color:var(--accent)">💡 请点击「选择目录」或「自动搜索」设置 .minecraft 路径</div>
</div>

<div class="settings-group stg-group">
  <div class="setting-row">
    <span class="label">📁 模型仓库路径</span>
    <span class="value stg-val" id="set-repo-path">加载中...</span>
    <button class="btn stg-btn stg-ml-auto" id="set-repo-browse">📂 选择目录</button>
  </div>
  <div class="stg-hint">存放所有下载的 .ysm / .zip / .7z 模型文件</div>
  <div class="stg-hint" id="set-repo-empty-hint" style="display:none;color:var(--accent)">💡 请点击「选择目录」设置模型仓库路径，否则下载的模型将无法归类</div>
</div>

<div class="section-title stg-title stg-sub-title">⚙️ 存储策略</div>

<div class="settings-group stg-group">
  <div class="setting-row">
    <span class="label">🔗 链接模式</span>
  </div>
  <div class="stg-radio-row">
    <label class="stg-label">
      <input type="radio" name="link-mode" value="copy" id="lm-copy"> 📋 复制
    </label>
    <label class="stg-label">
      <input type="radio" name="link-mode" value="hardlink" id="lm-hardlink"> 🔗 硬链接 ✅
    </label>
    <label class="stg-label">
      <input type="radio" name="link-mode" value="symlink" id="lm-symlink"> 🔗 符号链接
    </label>
  </div>
  <div id="lm-hint-copy" class="stg-hint-hidden">每个整合包独立占用磁盘空间，最兼容</div>
  <div id="lm-hint-hardlink" class="stg-hint-hidden" style="color:var(--muted,#6c7086)">✅ 推荐：省磁盘空间，支持实时开关模型，YSM 兼容性好<br>📌 需要将模型仓库放在与游戏相同的分区（如 C: 游戏 / C: 模型仓库）</div>
  <div id="lm-hint-symlink" class="stg-hint-hidden"><span class="stg-hint-warn">❌ 不推荐：YSM 加载符号链接文件时可能因启动器权限不足（PCL/HMCL 无管理员权限）导致文件被挂起无法禁用，需退出游戏后手动删除</span></div>
</div>

<div class="section-title stg-title stg-sub-title">⚙️ 网络与下载</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🌐 下载镜像源</span>
    <select id="set-mirror" class="stg-select">
      <option value="">🌍 直连（raw.githubusercontent.com）</option>
      <option value="jsdelivr">⚡ jsDelivr CDN（国内加速）</option>
      <option value="githubapi">🐙 GitHub API</option>
    </select>
  </div>
  <div class="stg-hint">选择优先使用的下载源，失败自动回退到其他源</div>
</div>

<div class="section-title stg-title stg-sub-title">⚙️ 界面与体验</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🌙 主题模式</span>
    <select id="set-theme" class="stg-select">
      <option value="system">💻 跟随系统</option>
      <option value="cyber">🌙 赛博霓虹</option>
      <option value="warm">☀️ 温暖木纹</option>
      <option value="pro">⚪ 极简深邃</option>
    </select>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">ℹ️ 关于</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">📦 当前版本</span>
    <span id="set-version" style="font-size:11px;color:var(--muted)">加载中...</span>
    <button class="btn stg-btn" id="set-check-update">🔄 检查更新</button>
    <button class="btn" id="set-releases" style="font-size:10px;margin-left:4px" title="打开 GitHub Releases">📋 发布页</button>
  </div>
  <div style="font-size:9px;color:var(--muted);padding:4px 12px 0;line-height:1.6">
    <div>🛠️ <b>YSM 模型管理器</b> — 类似 Mod Organizer 2 的 Minecraft YSM 模型管理工具</div>
    <div>🧱 <b>技术栈</b>: Go (Wails v2) + 原生 HTML/CSS/JS (Web Components + Shadow DOM)</div>
    <div>📦 <b>GitHub</b>: <a href="https://github.com/eghrhegpe/ysm-model-manager" target="_blank" style="color:var(--accent)">eghrhegpe/ysm-model-manager</a></div>
    <div>📋 <b>发布</b>: <a href="https://github.com/eghrhegpe/ysm-model-manager/releases" target="_blank" style="color:var(--accent)">查看所有版本</a></div>
    <div>📖 <b>文档</b>: <a href="https://github.com/eghrhegpe/ysm-model-manager/tree/main/docs" target="_blank" style="color:var(--accent)">docs/</a></div>
    <div style="margin-top:6px;border-top:1px solid var(--bd);padding-top:4px">
      <div style="font-size:9px;color:var(--muted)">🎯 <b>灵感来源</b></div>
      <div style="font-size:9px;color:var(--muted);line-height:1.7">
        <div>⬇️ 下载与更新：<a href="https://github.com/LaoYutang/lytvpk" target="_blank" style="color:var(--accent)">LaoYutang/lytvpk</a> L4D2 MOD 管理器</div>
        <div>🎨 3D 渲染：<a href="https://github.com/DrAbcOfficial/YSMViewer" target="_blank" style="color:var(--accent)">DrAbcOfficial/YSMViewer</a> YSM 模型查看器</div>
        <div>🔐 解析器：YSMParser.Core</div>
        <div>📦 仓库、硬链接：Mod Organizer 2</div>
      </div>
    </div>
    <div style="margin-top:4px;font-size:8px;color:var(--muted)">📄 配置文件：exe 同目录下的 ysm_config.json，可直接编辑</div>
  </div>
</div>

</div>`;
}

export function placeholderHTML(icon, label) {
  return `<div class="placeholder-box"><div class="big">${icon}</div><div>${label}</div><span class="ptag">预告</span></div>`;
}

export function downloadsHTML() {
  return `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
<div id="dl-form" style="margin:4px 12px;display:none;flex-direction:column;gap:4px">
  <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;flex-wrap:wrap">
    <span>导入仓库前，先重命名一下吧：</span>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-from-header"> 读取作者
    </label>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-date-auto" checked> 当天
    </label>
  </div>
  <div style="display:flex;gap:4px">
    <input id="dl-author" placeholder="作者" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-work" placeholder="作品品牌" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-chara" placeholder="角色名" style="width:80px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-variant" placeholder="变体" style="width:60px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-date" placeholder="年月" style="width:64px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
  </div>
  <div id="dl-tips" style="display:none;font-size:10px;color:var(--muted);padding:4px 8px;margin:2px 0;border-radius:4px;border-left:3px solid var(--accent);background:var(--surf);line-height:1.5;max-height:60px;overflow-y:auto"></div>
  <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;background:var(--surf)">
    <span style="color:var(--muted);font-size:9px;white-space:nowrap">最终命名</span>
    <span id="dl-preview" style="font-weight:600;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-</span>
    <span id="dl-conflict" style="display:none;font-size:9px;color:#f9a826;white-space:nowrap">⚠️</span>
    <button class="btn accent" id="dl-import" style="padding:3px 10px;font-size:10px;white-space:nowrap">📥 导入</button>
    <span style="font-size:9px;color:var(--muted);white-space:nowrap">队列 <span id="dl-queue-count">0</span></span>
    <button class="btn" id="dl-cancel" style="padding:2px 6px;font-size:9px;white-space:nowrap">✕</button>
  </div>
</div>
<div style="margin:0 12px 4px;border-top:1px solid var(--bd);padding-top:4px">
  <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--txt);padding:2px 0">
    <span>📋 已导入</span>
    <span id="dl-count" style="font-size:10px;color:var(--muted);font-weight:400">0 个文件</span>
    <button class="btn" id="dl-clear-list" style="font-size:9px;padding:1px 6px;margin-left:auto">🗑️ 清空</button>
  </div>
  <div id="dl-imported-list" style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto"></div>
</div>
<div id="dl-drop" style="flex:1;margin:4px 12px;border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;transition:all .2s;cursor:pointer;min-height:80px">
  <div style="font-size:28px;opacity:.35">📥</div>
  <div style="font-size:11px;color:var(--muted)">拖拽模型文件 <b>.ysm .zip .7z</b> 或文件夹到此处，或点击选择文件</div>
  <div style="display:flex;gap:8px;align-items:center">
    <span style="font-size:9px;color:var(--muted)">📁 拖入整个文件夹即可批量导入</span>
  </div>
  <input type="file" id="dl-file-input" accept=".ysm,.zip,.7z" style="display:none">
  <input type="file" id="dl-folder-input" webkitdirectory style="display:none">
</div>
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
<div class="diag-log-filter" style="display:flex;gap:4px;padding:3px 0">
<button class="diag-log-fbtn active" data-status="all" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">全部</button>
<button class="diag-log-fbtn" data-status="success" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">✅ 成功</button>
<button class="diag-log-fbtn" data-status="failed" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">❌ 失败</button>
<button class="diag-log-fbtn" data-status="skipped" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">⏭️ 跳过</button>
<input id="diag-log-search" placeholder="🔍 搜索模型名..." style="flex:1;font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);min-width:0;margin-left:4px">
</div>
<div id="diag-log-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">暂无日志</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div class="diag-panel-header">
<span>⚡ 冲突检测</span>
<button class="hdr-btn accent" id="diag-scan-conflict">⚡ 开始扫描</button>
</div>
<div id="diag-conflict-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">点击「开始扫描」检测整合包冲突</div></div>
</div>
<div class="diag-panel" id="diag-oldest" style="display:none">
<div class="diag-panel-header">
<span>👴 仓库元老</span>
<button class="hdr-btn" id="diag-oldest-refresh">🔄</button>
</div>
<div id="diag-oldest-list"><div class="stat-row" style="padding:12px;color:#6c7086;font-size:11px">点击「🔄」刷新</div></div>
</div>
</div>
</div>`;
}

export function recycleHTML() {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span id="recy-count" style="font-size:11px;color:#6c7086">加载中...</span>
<button class="btn" id="recy-refresh" style="margin-left:auto;font-size:10px">🔄 刷新</button>
<button class="btn danger" id="recy-empty" style="font-size:10px">🗑️ 清空回收站</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
</div>`;
}

/* ===== GitHub 仓库页面 ===== */

export function githubHTML() {
  return (
    '<div class="gh-page" id="gh-page">' +
    '<div class="gh-left" id="gh-left">' +
    '<div style="padding:10px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
    '<span style="font-size:13px;font-weight:600">🧩 创意工坊</span>' +
    '<span style="flex:1"></span>' +
    "</div>" +
    '<div class="gh-grid" id="gh-grid">' +
    '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>' +
    "</div>" +
    '<div style="padding:4px 12px 8px;font-size:8px;color:var(--muted)">' +
    '仓库：<span id="gh-source-info">-</span>' +
    "</div>" +
    "</div>" +
    '<div class="gh-right" id="gh-right">' +
    '<div class="gh-right-inner" id="gh-right-inner">' +
    '<div id="gh-results" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    '<div id="gh-results-body" style="flex:1;overflow-y:auto;padding:0 12px 8px">' +
    '<div style="color:var(--muted);font-size:10px;padding:12px 0;text-align:center">点击左侧仓库查看模型</div>' +
    "</div></div></div></div></div>"
  );
}

export function workshopHTML() {
  return `<div class="cr-page" id="ws-page">
  <!-- 左栏：站点列表 -->
  <div class="cr-left" id="ws-left">
    <div style="padding:10px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:600">🎨 创作者频道</span>
      <button id="cr-mode-toggle" class="cr-toggle" style="margin-left:auto" title="切换点击站点后的打开方式">↗ 外链</button>
    </div>
    <div class="cr-grid" id="ws-grid">
      <div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>
    </div>
    <div style="padding:4px 12px 8px;font-size:8px;color:var(--muted)">
      站点：<span id="ws-source-info">-</span>
      <span style="display:block">📄 站点配置：exe 同目录下的 workshop_sites.json，可直接编辑</span>
    </div>
  </div>
  <!-- 右栏：搜索 + 创作者 -->
  <div class="cr-right" id="ws-right">
    <div class="cr-right-inner" id="ws-right-inner">
      <!-- 默认视图：作者搜索 -->
      <div id="ws-search-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div id="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">
          <div style="color:var(--muted);font-size:10px;padding:12px 0;text-align:center">点击左侧站点查看详情</div>
        </div>
      </div>
      <!-- 创作者视图：选中站点时显示 -->
      <div id="ws-creator-view" style="display:none;flex:1;display:none;flex-direction:column;overflow:hidden">
        <div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">
          <span style="font-size:12px;font-weight:600;color:var(--txt)" id="ws-cr-title">🎨 活跃创作者</span>
          <span style="font-size:9px;color:var(--muted);margin-left:auto">creators/</span>
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
    <iframe id="ws-iframe" style="flex:1;border:none;background:#fff" sandbox="allow-scripts allow-forms allow-popups"></iframe>
    <div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">
      <div style="font-size:32px">🚫</div>
      <div>此站点不允许内嵌浏览</div>
      <button class="btn accent" id="ws-open-fallback" style="font-size:11px">↗ 在系统浏览器中打开</button>
    </div>
  </div>
`;
}
