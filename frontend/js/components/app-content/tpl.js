// ===== app-content 页面模板 =====

export function repositoryHTML() {
  return (
    '<div class="repo-wrap">' +
    // 第一栏：操作
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="tree">📁 文件树</button>' +
    '<button class="repo-tab" data-tab="import">📥 导入</button>' +
    '<button class="repo-tab" data-tab="recycle">♻️ 回收站</button>' +
    '<button class="repo-tab" data-tab="dedup">🔗 去重</button>' +
    '<button class="repo-tab" data-tab="oldest">👴 仓库元老</button>' +
    "</div>" +
    // 第二栏：资源类型（仅在文件树 tab 可见）
    '<div class="repo-subtabs" id="repo-subtabs" style="display:flex;gap:2px;padding:2px 8px;border-bottom:1px solid var(--bd);flex-shrink:0">' +
    '<button class="repo-subtab active" data-rtab="ysm">💎 YSM</button>' +
    '<button class="repo-subtab" data-rtab="mmd-skin">🎭 MMD</button>' +
    '<button class="repo-subtab" data-rtab="vrchat-avatar">🥽 VRC</button>' +
    '<span style="padding:3px 4px;color:var(--muted)">│</span>' +
    '<button class="repo-subtab" data-rtab="resourcepack">🎨 材质包</button>' +
    '<button class="repo-subtab" data-rtab="shaderpack">☀️ 光影包</button>' +
    '<button class="repo-subtab" data-rtab="create-blueprint">⚙️ 蓝图</button>' +
    "</div>" +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;border-right:1px solid var(--bd)">' +
    '<div class="repo-tab-body" id="repo-tab-tree" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    // 默认 YSM 文件树 + 预览
    '<div style="flex:1;display:flex;overflow:hidden">' +
    '<app-tree root="ysm" style="flex:1;min-width:0"></app-tree>' +
    '<app-preview mode="model" style="width:220px;flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
    "</div>" +
    "</div>" +
    '<div class="repo-tab-body" id="repo-tab-import" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-recycle" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-dedup" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>' +
    '<div class="repo-tab-body" id="repo-tab-oldest" style="display:none;flex:1;overflow-y:auto;overflow-x:hidden"></div>' +
    "</div>" +
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
    '<div class="ins-content" id="ins-content" style="display:flex;flex-direction:column;overflow:hidden">' +
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

export function resourceLibraryHTML() {
  return (
    '<div class="repo-wrap" style="display:flex;flex-direction:column">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-rtab="ysm">💎 YSM</button>' +
    '<button class="repo-tab" data-rtab="mmd-skin">🎭 MMD</button>' +
    '<button class="repo-tab" data-rtab="vrchat-avatar">🥽 VRC</button>' +
    '<span style="padding:4px 8px;color:var(--muted);font-size:var(--fs-xs);align-self:center">│</span>' +
    '<button class="repo-tab" data-rtab="resourcepack">🎨 材质包</button>' +
    '<button class="repo-tab" data-rtab="shaderpack">☀️ 光影包</button>' +
    '<button class="repo-tab" data-rtab="create-blueprint">⚙️ 蓝图</button>' +
    "</div>" +
    '<div id="res-panel" style="flex:1;display:flex;overflow:hidden"></div>' +
    "</div>"
  );
}

export function settingsHTML() {
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="repo-tab active" data-tab="basic">⚙️ 基础设置</button>
<button class="repo-tab" data-tab="ui">⚙️ 界面与体验</button>
<button class="repo-tab" data-tab="about">ℹ️ 关于</button>
</div>
<div class="repo-tab-body" id="stg-tab-basic">
<div class="stg-page">

<div class="section-title stg-title">⚙️ 仓库路径配置</div>

<div class="stg-grid">
    <!-- Row 1 -->
    <div class="stg-card">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">🎮 游戏根目录<button class="btn" id="set-mc-detect" style="font-size:var(--fs-btn-tool);padding:var(--pad-btn-tool) 8px">🔍 自动搜索</button></div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-mc-path">加载中...</div>
        <div class="stg-card-desc">自动扫描 PCL2、%AppData% 等常见位置</div>
      </div>
    </div>
    <div class="stg-card">
      <div class="stg-card-hdr">🎨 材质包路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-rp-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\resourcepacks\\</div>
      </div>
    </div>
    <div class="stg-card">
      <div class="stg-card-hdr">☀️ 光影包路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-sp-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\shaderpacks\\</div>
      </div>
    </div>
    <!-- Row 2 -->
    <div class="stg-card">
      <div class="stg-card-hdr">💎 YSM 模型路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-repo-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\config\\yes_steve_model\\custom</div>
      </div>
    </div>
    <div class="stg-card">
      <div class="stg-card-hdr">🎭 MMD 模型路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-mmd-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\3d-skin\\EntityPlayer\\</div>
      </div>
    </div>
    <div class="stg-card">
      <div class="stg-card-hdr">🥽 VRChat 模型路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-vrc-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\vrchat-avatars\\</div>
      </div>
    </div>
    <!-- Row 3: 居中 -->
    <div class="stg-card" style="grid-column:2">
      <div class="stg-card-hdr">⚙️ 蓝图路径</div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-schem-path">加载中...</div>
        <div class="stg-card-hint">默认: {mc}\\schematics\\</div>
      </div>
    </div>
  </div>

<div class="section-title stg-title stg-sub-title">🔗 存储策略 & 🌐 网络</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0;display:flex;align-items:center;justify-content:space-between">
      <span class="label" style="font-size:13px;font-weight:600">🔗 链接模式</span>
      <button id="set-relink" class="btn" style="font-size:var(--fs-btn-tool);padding:var(--pad-btn-tool) 8px">🔄 重新应用链接</button>
    </div>
    <select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="copy">📋 复制</option>
      <option value="hardlink" selected>🔗 硬链接 ✅</option>
      <option value="symlink">🔗 符号链接</option>
    </select>
    <div id="lm-hint-copy" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">每个整合包独立占用磁盘空间，最兼容</div>
    <div id="lm-hint-hardlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">✅ 推荐：省磁盘空间，支持实时开关模型<br>📌 需与游戏同分区</div>
    <div id="lm-hint-symlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0"><span style="color:#e5534b">❌ 不推荐：权限不足时文件被挂起</span></div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">🌐 下载镜像源</span>
    </div>
    <select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="">🌍 直连（raw.githubusercontent.com）</option>
      <option value="jsdelivr">⚡ jsDelivr CDN（国内加速）</option>
      <option value="githubapi">🐙 GitHub API</option>
    </select>
    <div id="mirror-hint-direct" style="font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">直接从 GitHub 原始服务器下载，确保获取最新版本的文件。<br>⚠️ 国内网络环境下可能速度较慢或连接失败</div>
    <div id="mirror-hint-jsdelivr" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">通过 jsDelivr 全球加速网络分发，国内下载速度显著提升。<br>📌 缓存 TTL 约 12 小时，新发布的内容可能稍有延迟</div>
    <div id="mirror-hint-githubapi" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">通过 GitHub REST API 获取下载地址。<br>📌 未认证请求限制 60 次/小时，适合偶尔手动下载</div>
  </div>
</div>

</div>
</div>

<div class="repo-tab-body" id="stg-tab-ui" style="display:none">
<div class="stg-page">

<div class="section-title stg-title">🌙 主题与外观</div>

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

<div class="section-title stg-title stg-sub-title">📐 字体与布局</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">📏 基准字号</span>
    </div>
    <select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="small">🔹 小（−1px）</option>
      <option value="normal" selected>🔸 标准</option>
      <option value="large">🔺 大（+2px）</option>
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">
      <span>正文 <b id="sz-base" style="color:var(--txt)">12px</b></span>
      <span>按钮间距 <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>按钮高 <b id="sz-btn-h" style="color:var(--txt)">23px</b></span>
    </div>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">调整整体界面文字大小，选择后立即生效</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">🃏 创作者字体</span>
    </div>
    <select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>🖌️ 楷体（更文艺）</option>
      <option value="system">📝 系统字体（更简洁）</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">创作者卡片名字使用的艺术字体</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">💳 卡片密度</span>
    </div>
    <select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>📦 紧凑（信息密集）</option>
      <option value="normal">📦 标准（间距舒适）</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">卡片内边距和间距调整</div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">⚡ 行为与动画</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">✨ 动画效果</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-animations" checked> 启用过渡动画
    </label>
  </div>
  <div class="stg-hint">关闭后仅保留布局过渡，移除 hover 和淡入淡出动画，适合低配设备。</div>
</div>

<div class="settings-group" style="margin-bottom:12px">
  <div class="setting-row">
    <span class="label">🏠 启动默认页面</span>
    <select id="set-default-page" class="stg-select">
      <option value="instances">🎮 整合包管理</option>
      <option value="workshop">🎨 创作者频道</option>
      <option value="repository">📦 模型仓库</option>
    </select>
  </div>
  <div class="stg-hint">启动程序时自动打开的页面。</div>
</div>

</div>
</div>

<div class="repo-tab-body" id="stg-tab-about" style="display:none">
<div class="stg-page">

<div class="section-title stg-title">📦 关于 YSM 模型管理器</div>

<div class="settings-group" style="margin-bottom:12px;padding:0 16px">
  <div class="setting-row">
    <span class="label">📦 当前版本</span>
    <span id="set-version" style="font-size:var(--fs-sm);color:var(--muted)">加载中...</span>
    <button class="btn stg-btn" id="set-check-update">🔄 检查更新</button>
    <button class="btn" id="set-releases" style="margin-left:4px" title="打开 GitHub Releases">📋 发布页</button>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:2;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">🛠️ 这是什么？</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <b>YSM 模型管理器</b> 是一款面向 Minecraft YSM 模组的模型管理工具，帮你像 Steam 创意工坊一样管理你的模型收藏。
      <br><br>
      ✅ 拖拽导入 .ysm / .zip / .7z 模型文件<br>
      ✅ 按作者、角色、作品智能归类<br>
      ✅ 2D/3D 模型预览，不必进游戏确认<br>
      ✅ 按 SHA256 去重，节省磁盘空间<br>
      ✅ 硬链接安装，不复制冗余文件<br>
      ✅ 整合包同步、回收站、批量操作
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💎 技术栈</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>🔹 Go + Wails v2（后端）</div>
      <div>🔹 原生 HTML/CSS/JS（前端）</div>
      <div>🔹 Web Components + Shadow DOM</div>
      <div>🔹 Three.js（3D 预览）</div>
      <div>🔹 YSMParser WASM（解码）</div>
      <div>🔹 Vite（构建）</div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">📦 资源链接</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.8">
      <div>🐙 GitHub：<a href="https://github.com/eghrhegpe/ysm-model-manager" target="_blank" style="color:var(--accent)">eghrhegpe/ysm-model-manager</a></div>
      <div>📋 发布页：<a href="https://github.com/eghrhegpe/ysm-model-manager/releases" target="_blank" style="color:var(--accent)">查看所有版本</a></div>
      <div>📖 文档：<a href="https://github.com/eghrhegpe/ysm-model-manager/tree/main/docs" target="_blank" style="color:var(--accent)">docs/ 目录</a></div>
      <div>📄 配置：exe 同目录 <code>ysm_config.json</code></div>
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💡 快速上手</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>1. 设置游戏目录和仓库路径</div>
      <div>2. 将模型文件拖入「导入」页</div>
      <div>3. 模型自动归档到仓库</div>
      <div>4. 在「整合包管理」中安装到整合包</div>
      <div>5. 在游戏中加载 YSM 资源包即可看到模型</div>
    </div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">🎯 灵感来源</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">⬇️ 下载与更新</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/LaoYutang/lytvpk" target="_blank" style="color:var(--accent)">LaoYutang/lytvpk</a><br>
      L4D2 MOD 管理器，启发了下载队列和更新检测的设计
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🎨 3D 渲染</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/DrAbcOfficial/YSMViewer" target="_blank" style="color:var(--accent)">DrAbcOfficial/YSMViewer</a><br>
      参考了骨骼层级、UV 映射和 BufferGeometry 构建方式
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🔐 YSM 解析</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      YSMParser.Core<br>
      跨平台 YSM 二进制格式解码能力（WASM 内嵌）
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">📦 仓库管理</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      Mod Organizer 2<br>
      硬链接安装、回收站、按实例管理的设计理念来源
    </div>
  </div>
</div>

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
  <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;background:var(--surf);overflow:hidden">
    <span style="color:var(--muted);font-size:9px;white-space:nowrap">最终命名</span>
    <span id="dl-preview" style="font-weight:600;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-</span>
    <span id="dl-conflict" style="display:none;font-size:9px;color:#f9a826;white-space:nowrap">⚠️</span>
    <button class="btn accent" id="dl-import" style="padding:3px 10px;white-space:nowrap">📥 导入</button>
    <span style="font-size:9px;color:var(--muted);white-space:nowrap">队列 <span id="dl-queue-count">0</span></span>
    <button class="btn" id="dl-cancel" style="padding:2px 6px;white-space:nowrap">✕</button>
  </div>
</div>
<div style="margin:0 12px 4px;border-top:1px solid var(--bd);padding-top:4px">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--txt);padding:2px 0">
    <span style="font-size:var(--fs-md)">📋 已导入</span>
    <span id="dl-count" style="font-size:10px;color:var(--muted);font-weight:400">0 个文件</span>
    <button class="btn" id="dl-clear-list" style="padding:2px 8px;margin-left:auto">🗑️ 清空</button>
  </div>
  <div id="dl-imported-list" style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto"></div>
</div>
<div id="dl-drop" style="flex:1;margin:4px 12px;border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;transition:all .2s;cursor:pointer;min-height:80px">
  <div style="font-size:28px;opacity:.35">📥</div>
  <div style="font-size:11px;color:var(--muted)">拖拽模型文件 <b>.ysm .zip .7z .json .pmx .pmd .vrca .vrm .nbt .schematic</b> 或文件夹到此处，或点击选择文件</div>
  <div style="display:flex;gap:8px;align-items:center">
    <span style="font-size:9px;color:var(--muted)">📁 拖入整个文件夹即可批量导入</span>
  </div>
  <div style="font-size:10px;color:#bd93f9;margin-top:2px">💡 MMD/基岩版模型建议打包为 .zip 文件管理</div>
  <input type="file" id="dl-file-input" accept=".ysm,.zip,.7z,.json,.pmx,.pmd,.vrca,.vrm,.nbt,.schematic" style="display:none">
  <input type="file" id="dl-folder-input" webkitdirectory style="display:none">
</div>
</div>
</div>`;
}

export function diagnosticsHTML() {
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="repo-tab active" data-tab="diagnostics">🛠️ 诊断与冲突</button>
</div>
<div class="repo-tab-body">
<div class="diag-wrapper">
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
<div class="diag-log-filter" style="display:flex;gap:4px;padding:3px 12px;overflow:hidden">
<button class="diag-log-fbtn active" data-status="all">全部</button>
<button class="diag-log-fbtn" data-status="success">✅ 成功</button>
<button class="diag-log-fbtn" data-status="failed">❌ 失败</button>
<button class="diag-log-fbtn" data-status="skipped">⏭️ 跳过</button>
<input id="diag-log-search" placeholder="🔍 搜索模型名..." style="width:130px;font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);margin-left:auto">
</div>
<div id="diag-log-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">暂无日志</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div id="diag-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">点击「开始扫描」检测整合包冲突
<button class="hdr-btn accent" id="diag-scan-conflict" style="margin-top:4px">⚡ 开始扫描</button>
</div></div></div>
<div class="diag-panel" id="diag-oldest" style="display:none">
<div class="diag-panel-header">
<span>👴 仓库元老</span>
<button class="hdr-btn" id="diag-oldest-refresh">🔄</button>
</div>
<div id="diag-oldest-list"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">点击「🔄」刷新</div></div>
</div>
</div>
</div>
</div>
</div>`;
}

export function recycleHTML() {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span id="recy-count" style="font-size:11px;color:#6c7086">加载中...</span>
<button class="btn" id="recy-refresh" style="margin-left:auto">🔄 刷新</button>
<button class="btn danger" id="recy-empty">♻️ 清空回收站</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
</div>`;
}

/* ===== GitHub 仓库页面 ===== */

export function githubHTML() {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="github">🐙 GitHub仓库</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="gh-tab-repos">' +
    '<div class="gh-page" id="gh-page">' +
    '<div class="gh-left" id="gh-left">' +
    '<div style="padding:4px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
    '<span style="font-size:11px;font-weight:600;color:var(--muted)">仓库</span>' +
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
    "</div></div></div></div></div>" +
    "</div>" +
    "</div>"
  );
}

export function workshopHTML() {
  // 站点 Tab 由 _initWorkshop 动态生成，此处只放容器
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs" id="ws-tabs">' +
    '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">⏳ 加载中...</span>' +
    "</div>" +
    '<div class="repo-tab-body" id="cr-tab-creators">' +
    '<div class="cr-page" id="ws-page">' +
    '<div class="cr-right" style="width:100%;flex:1;display:flex;flex-direction:column;overflow:hidden" id="ws-right">' +
    '<div class="cr-right-inner" id="ws-right-inner">' +
    '<div id="ws-search-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    '<div id="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">' +
    '<div style="color:var(--muted);font-size:10px;padding:12px 0;text-align:center">加载中...</div>' +
    "</div>" +
    "</div>" +
    '<div id="ws-creator-view" style="display:none;flex:1;display:none;flex-direction:column;overflow:hidden">' +
    '<div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<span style="font-size:12px;font-weight:600;color:var(--txt)" id="ws-cr-title">🎨 活跃创作者</span>' +
    '<span style="font-size:9px;color:var(--muted);margin-left:auto">creators/</span>' +
    "</div>" +
    '<div class="ws-creators-list" id="ws-cr-list"></div>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="ws-browser" style="display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg)">' +
    '<div class="ws-browser-bar">' +
    '<button class="ws-back" id="ws-back">← 返回</button>' +
    '<span class="ws-url" id="ws-url"></span>' +
    '<button class="ws-open-btn" id="ws-open">↗ 浏览器打开</button>' +
    "</div>" +
    '<iframe id="ws-iframe" style="flex:1;border:none;background:#fff" sandbox="allow-scripts allow-forms allow-popups"></iframe>' +
    '<div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">' +
    '<div style="font-size:32px">🚫</div>' +
    "<div>此站点不允许内嵌浏览</div>" +
    '<button class="btn accent" id="ws-open-fallback">↗ 在系统浏览器中打开</button>' +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}
