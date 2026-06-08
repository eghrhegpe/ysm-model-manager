// ===== HTML 模板（页面布局级，不含节点行） =====

export function headerHTML() {
  return `<div class="hdr">
<div class="hdr-row">
  <span class="hdr-label">📦 模型仓库</span>
  <span class="hdr-spacer"></span>
  <button class="repo-bar-btn" id="repo-genindex">📇 索引</button>
  <button class="repo-bar-btn" id="repo-export-bones">📋 骨骼</button>
</div>
<div class="hdr-row">
  <input class="srch-inp" id="srch" type="text" placeholder="🔍 搜索模型名称..." autocomplete="off">
  <div class="dd-wrap" id="dd-authors"><button class="hdr-btn" id="btn-authors">🎨 作者 ▾</button><div class="dd-menu" id="menu-authors"></div></div>
  <div class="dd-wrap" id="dd-tex"><button class="hdr-btn" id="btn-tex">📐 纹理 ▾</button><div class="dd-menu" id="menu-tex"></div></div>
  <button class="hdr-btn" id="btn-batch">⚡ 批量</button>
  <button class="hdr-btn" id="btn-filter-toggle">🔍 筛选</button>
  <select class="sort-sel" id="sort"><option value="name">名称</option><option value="size">大小</option><option value="date">日期</option></select>
</div>
<div id="hdr-container"></div>
</div>`;
}

export function footerHTML() {
  return `<div class="ftr">
<span class="stat" id="ftr-stat">共 0 项</span>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-repo" style="font-size:10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="点击选择仓库目录">📁 未设置</button>
</div>`;
}

export function emptyHTML(icon, msg) {
  return `<div class="empty"><div class="big">${icon}</div>${msg}</div>`;
}
