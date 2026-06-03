// ===== HTML 模板（页面布局级，不含节点行） =====

export function headerHTML() {
  return `<div class="hdr">
<div class="hdr-row">
<span class="hdr-label">📦 仓库</span>
<button class="hdr-btn" id="btn-ea">✅ 全部启用 <span class="tag">预告</span></button>
<button class="hdr-btn" id="btn-da">⛔ 全部禁用 <span class="tag">预告</span></button>
<button class="hdr-btn accent" id="btn-st">▶️ 同步状态 <span class="tag">预告</span></button>
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
<button class="hdr-btn" id="btn-repo">📁 选择仓库目录</button>
<button class="hdr-btn" id="btn-dedup">🔗 去重 <span class="tag">预告</span></button>
<button class="hdr-btn" id="btn-trash">🗑️ 回收站</button>
<div style="flex:1"></div>
<button class="hdr-btn" id="btn-pv">◀ 预览</button>
</div>`;
}

export function emptyHTML(icon, msg) {
  return `<div class="empty"><div class="big">${icon}</div>${msg}</div>`;
}
