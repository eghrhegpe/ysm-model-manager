// ===== HTML 模板（页面布局级，不含节点行） =====

export function headerHTML() {
  return `<div class="hdr">
<div class="hdr-row">
  <input class="srch-inp" id="srch" type="text" placeholder="🔍 搜索模型名称..." autocomplete="off">
  <button class="btn-base sm" id="btn-adv-filter" title="高级筛选（骨骼/立方体/纹理）">⚙️ 筛选</button>
  <div class="dd-wrap" id="dd-authors"><button class="btn-base sm" id="btn-authors">🎨 作者 ▾</button><div class="dd-menu" id="menu-authors"></div></div>
  <div class="dd-wrap" id="dd-batch"><button class="btn-base sm" id="btn-batch">⚡ 批量 ▾</button><div class="dd-menu" id="menu-batch"><button class="dd-item" data-batch="enable-all">✅ 全部启用</button><button class="dd-item" data-batch="disable-all">⛔ 全部禁用</button></div></div>
  <div class="dd-wrap" id="dd-more"><button class="btn-base sm" id="btn-more">⋮ 更多 ▾</button><div class="dd-menu" id="menu-more"><button class="dd-item" data-more="import-file">📥 导入文件</button><button class="dd-item" data-more="import-dir">📁 导入文件夹</button><button class="dd-item" data-more="sel-all" id="sel-all">☑️ 全选</button><button class="dd-item" data-more="repo-export" id="repo-export">📋 骨骼结构</button><div style="border-top:1px solid var(--bd);margin:2px 0"></div><button class="dd-item" data-more="open-folder">📂 打开文件夹</button><button class="dd-item" data-more="refresh">🔄 刷新</button><button class="dd-item" data-more="genindex">📇 生成索引</button></div></div>
  <select class="sort-sel" id="sort"><option value="name">名称</option><option value="size">大小</option><option value="date">日期</option></select>
</div>
<div class="adv-filter" id="adv-filter" style="display:none">
  <div class="adv-filter-row">
    <label>骨骼数</label><input type="number" id="af-minBones" placeholder="最小" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxBones" placeholder="最大" class="af-inp" min="0">
    <label>立方体</label><input type="number" id="af-minCubes" placeholder="最小" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxCubes" placeholder="最大" class="af-inp" min="0">
    <label>纹理尺寸</label><input type="number" id="af-minTex" placeholder="最小" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxTex" placeholder="最大" class="af-inp" min="0">
    <button class="btn-base sm accent" id="af-apply">🔍 应用</button>
    <button class="btn-base sm" id="af-clear">清除</button>
  </div>
</div>
</div>`;
}

export function footerHTML() {
  return `<div class="ftr">
<span class="stat" id="ftr-stat">共 0 项</span>
<div style="flex:1"></div>
<button class="btn-base sm" id="btn-repo" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="点击选择仓库目录">📁 未设置</button>
</div>`;
}

export function emptyHTML(icon, msg) {
  return `<div class="empty"><div class="big">${icon}</div>${msg}</div>`;
}

export function spinnerHTML() {
  return `<div class="empty"><div class="big">⏳</div><div>扫描中...</div></div>`;
}
