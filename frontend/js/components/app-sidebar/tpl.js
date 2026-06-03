// ===== sidebar HTML 模板 =====

export function headerHTML() {
  return `<div class="header">
<div class="header-row">
<span class="header-label">📂 版本列表</span>
<span class="header-stat" id="ver-stat">4个整合包</span>
</div>
<input class="search-input" id="ver-search" type="text" placeholder="🔍 搜索整合包" autocomplete="off" autocapitalize="off">
</div>`;
}

export function footerHTML() {
  return `<div class="footer">
<button class="footer-btn" id="btn-mc">🎮 指定游戏路径</button>
</div>`;
}

export function listContainerHTML() {
  return `<div class="list" id="vg"></div>`;
}

/** 单个整合包卡片头部 */
export function vcHeaderHTML(name, synced, missing) {
  const parts = [];
  if (synced > 0) parts.push(`<span class="tag green">✅ ${synced}</span>`);
  if (missing > 0) parts.push(`<span class="tag red">⬇️ ${missing}</span>`);
  return `<div class="vc-header">
<span class="arrow">▶</span>
<span class="name">📦 ${esc(name)}</span>
${parts.join("")}
</div>`;
}

/** 区块标题（如"✅ 已同步 (3)"） */
export function sectionTitleHTML(text, count) {
  return `<div class="sec-title">${text} (${count})</div>`;
}

/** 单行模型条目 */
export function rowHTML(dotColor, name, size) {
  return `<div class="row"><span class="dot" style="background:${dotColor}"></span><span class="rn">${esc(name)}</span><span class="sz">${size}</span></div>`;
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
