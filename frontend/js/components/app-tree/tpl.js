// ===== HTML 模板（页面布局级，不含节点行） =====

export function headerHTML() {
  return `<div class="hdr">
<div class="hdr-row">
<span class="hdr-label">📦 仓库</span>
<div class="batch-dropdown" id="batch-dropdown">
  <button class="hdr-btn" id="btn-batch-trigger">⚡ 批量管理 ▾</button>
  <div class="batch-menu" id="batch-menu" style="display:none">
    <button class="hdr-btn batch-item" id="btn-ea">✅ 全部启用</button>
    <button class="hdr-btn batch-item" id="btn-da">⛔ 全部禁用</button>
  </div>
</div>
</div>
<div class="srch-row">
<input class="srch-inp" id="srch" type="text" placeholder="🔍 搜索模型名称" autocomplete="off">
<select class="sort-sel" id="sort">
<option value="name">名称</option>
<option value="size">大小</option>
<option value="date">日期</option>
</select>
</div>
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
