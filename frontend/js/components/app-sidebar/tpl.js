// ===== sidebar HTML 模板 =====

export function headerHTML() {
  return (
    '<div style="padding:4px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px;color:var(--muted);flex:1">' +
    '<input type="checkbox" id="sb-select-all" style="cursor:pointer"> 全选</label>' +
    '<div class="dd-wrap" style="position:relative;display:inline-block">' +
    '<button class="sidebar-sync-selected" style="padding:3px 8px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:9px;font-family:inherit">⬇️ 同步所选 ▾</button>' +
    '<div class="dd-menu" id="sidebar-sync-menu" style="display:none;position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-size:10px;white-space:nowrap">' +
    '<div class="dd-item" data-sync-type="all" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">📦 全部类型</div>' +
    '<div class="dd-item" data-sync-type="ysm" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">💎 YSM</div>' +
    '<div class="dd-item" data-sync-type="mmd-skin" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🎭 MMD</div>' +
    '<div class="dd-item" data-sync-type="vrchat-avatar" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🥽 VRC</div>' +
    '<div class="dd-item" data-sync-type="resourcepack" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🎨 材质包</div>' +
    '<div class="dd-item" data-sync-type="shaderpack" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">☀️ 光影包</div>' +
    '<div class="dd-item" data-sync-type="create-blueprint" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">⚙️ 蓝图</div>' +
    "</div></div>" +
    "</div>"
  );
}

export function footerHTML() {
  return `<div class="footer">
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-sync">完全同步 -/-</span>
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
  hasMod = true,
  rtype = "ysm",
) {
  const chips =
    (synced > 0 ? `<span class="tag green">${synced}</span> ` : "") +
    (missing > 0 && hasMod ? `<span class="tag red">${missing}</span> ` : "") +
    (extra > 0 ? `<span class="tag orange">${extra}</span>` : "") +
    (!hasMod
      ? `<span class="tag gray">🚫 无${{ ysm: "YSM", "mmd-skin": "MMD", "vrchat-avatar": "VRC" }[rtype] || rtype}</span>`
      : "");
  return `<div class="vc-header">
<div class="vc-hdr-row1"><span class="name">${esc(name)}</span></div>
<div class="vc-hdr-row2"><input type="checkbox" class="chk" data-idx="${idx}">📦${chips}</div>
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
