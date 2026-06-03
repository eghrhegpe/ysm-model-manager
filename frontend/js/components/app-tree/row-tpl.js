// ===== 树节点行 HTML 模板 =====

/** 文件行 HTML */
export function fileRowHTML(e, nmHtml, icon, dateStr) {
  const p = attr(e.path);
  const fp = attr(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const tick = e.banned ? "" : "✓";
  const ban = e.banned ? " ban" : "";
  return `<div class="fl${ban}" data-path="${p}" data-fullpath="${fp}">
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}">${tick}</span>
<span class="ficon">${icon}</span>
<span class="nm">${nmHtml}</span>
<span class="sz">${size(e.size)}</span>${dateStr ? `<span class="dt">${dateStr}</span>` : ""}</div>`;
}

/** 文件夹行 HTML（含 .ch 容器开头） */
export function folderRowHTML(k, full, isOpen, isLocked) {
  const fi = isLocked ? "🔒" : "📁";
  const nc = isLocked ? "#585b70" : "#a6adc8";
  const lk = isLocked ? " locked" : "";
  const ar = isOpen ? "▼" : "▶";
  const ac = isOpen ? " open" : "";
  return `<div class="fh${lk}" data-dir="${attr(full)}">
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${attr(k)}</span></div>
<div class="ch" style="display:${isOpen ? "block" : "none"}">`;
}

function attr(s) {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function size(b) {
  if (!b && b !== 0) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
