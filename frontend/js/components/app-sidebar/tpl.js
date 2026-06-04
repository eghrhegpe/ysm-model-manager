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
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-ins">📂 整合包: -</span>
  <span class="stat-item" id="stat-pending">🔄 待处理: -</span>
</div>
<button class="footer-btn" id="btn-mc">🎮 指定游戏路径</button>
</div>`;
}

export function listContainerHTML() {
  return `<div class="list" id="vg"></div>`;
}

/** 单个整合包卡片头部。
 *  最后一个参数 idx 用于绑定安装缺失按钮的 data-idx */
export function vcHeaderHTML(
  name,
  synced,
  missing,
  extra,
  status,
  isOpen = false,
  idx = -1,
) {
  const parts = [];
  if (synced > 0) parts.push(`<span class="tag green">✅ ${synced}</span>`);
  const arrowClass = isOpen ? "arrow open" : "arrow";
  const installBtn =
    missing > 0
      ? `<button class="tag red btn-install-missing" data-idx="${idx}" style="cursor:pointer;border:none">⬇️ 安装缺失 (${missing})</button>`
      : "";
  const extraTag =
    extra > 0 ? `<span class="tag orange">📤 ${extra}</span>` : "";
  return `<div class="vc-header">
<span class="${arrowClass}">▶</span>
<span class="name">📦 ${esc(name)}</span>
${parts.join("")}
${extraTag}
${installBtn}
</div>`;
}

/** 区块标题（如"✅ 已同步 (3)"） */
export function sectionTitleHTML(text, count) {
  return `<div class="sec-title">${text} (${count})</div>`;
}

/** 单行模型条目 — dotColor: 状态圆点色, name: 文件名, size: 大小, linkType: 链接图标, extraCls: 额外 class, path: 完整路径（可选，存 data-path）, btnHtml: 操作按钮HTML, rowCls: 额外CSS类 */
export function rowHTML(
  dotColor,
  name,
  size,
  linkType,
  extraCls = "",
  path,
  btnHtml = "",
  rowCls = "",
) {
  const linkIcon = linkType ? `<span class="link-icon">${linkType}</span>` : "";
  const pathAttr = path ? ` data-path="${esc(path)}"` : "";
  return `<div class="row ${extraCls}${rowCls}" data-name="${esc(name)}"${pathAttr}><span class="dot" style="background:${dotColor}"></span><span class="rn">${esc(name)}</span>${linkIcon}<span class="sz">${size}</span>${btnHtml}</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
