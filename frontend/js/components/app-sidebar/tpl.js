// ===== sidebar HTML 模板 =====

export function headerHTML() {
  return (
    '<div style="padding:4px 8px;border-bottom:1px solid var(--bd)">' +
    '<button class="sidebar-import-all" style="width:100%;padding:5px 8px;border-radius:6px;border:1px solid var(--accent);background:#7c83ff22;color:var(--accent);cursor:pointer;font-size:10px;font-family:inherit;text-align:center">⬇️ 一键安装模型</button>' +
    "</div>"
  );
}

export function footerHTML() {
  return `<div class="footer">
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-ins">📂 整合包: -</span>
  <span class="stat-item" id="stat-pending">🔄 待处理: -</span>
  <button class="footer-btn btn-mc-dir" id="btn-mc" title="点击选择游戏目录">🎮 未设置</button>
</div>
</div>`;
}

export function listContainerHTML() {
  return `<div class="list" id="vg">${skeletonHTML()}</div>`;
}

/** 加载骨架屏 */
export function skeletonHTML() {
  let h = "";
  for (let i = 0; i < 4; i++) {
    h += `<div class="sk-item">
<div class="sk-line sk-w80"></div>
<div class="sk-line sk-w40"></div>
</div>`;
  }
  return h;
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
  hasYSM = true,
) {
  const parts = [];
  const installBtn =
    missing > 0 && hasYSM
      ? `<button class="tag red btn-install-missing btn-install" data-idx="${idx}">⬇️ 安装缺失 (${missing})</button>`
      : "";
  const noYsmTag = !hasYSM
    ? `<span class="tag gray tag-no-ysm">🚫 无YSM</span>`
    : "";
  const extraTag =
    extra > 0 ? `<span class="tag orange">📤 ${extra}</span>` : "";
  return `<div class="vc-header">
<div class="vc-hdr-row1"><span class="name">📦 ${esc(name)}</span></div>
<div class="vc-hdr-row2">${synced > 0 ? `<span class="tag green">✅ ${synced}</span> ` : ""}${extraTag}${noYsmTag}${installBtn}</div>
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
  return `<div class="row ${extraCls}${rowCls}" data-name="${esc(name)}"${pathAttr}><span class="dot" style="background:${dotColor}"></span><span class="rn">${name}</span>${linkIcon}<span class="sz">${size}</span>${btnHtml}</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
