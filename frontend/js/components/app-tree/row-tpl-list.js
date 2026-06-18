// ===== 紧凑列表行 HTML 模板（24px 高度）=====
import { renderDisplayName } from "../../utils/display.js";

/** 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） */
export function listFileRowHTML(e, nmHtml, icon, nmCls = "", indent, rowCls = "") {
  const p = attr(e.path);
  const fp = attr(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const ban = e.banned ? " ban" : "";
  const typeIcon =
    e.type === "resourcepack" ? "🎨" : e.type === "ysm" ? "💎" : icon;
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return `<div class="fl-list${ban}${rowCls}" data-path="${p}" data-fullpath="${fp}"${pad}>
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${typeIcon}</span>
<span class="nm${nmCls}">${nmHtml}</span>
<span class="sz ${sc(e.size)}">${size(e.size)}</span></div>`;
}

/** 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） */
export function listFolderRowHTML(
  k,
  full,
  isOpen,
  isLocked,
  hasEnabled,
  hasDisabled,
  indent,
) {
  const fi = isLocked ? "🔒" : "📁";
  const nc = isLocked ? "var(--muted)" : "var(--txt)";
  const lk = isLocked ? " locked" : "";
  const ar = isOpen ? "▾" : "▸";
  const ac = isOpen ? " open" : "";
  // 文件夹开关：部分选中用半开
  let ckCls = "";
  if (hasEnabled && hasDisabled) {
    ckCls = " on partial";
  } else if (hasEnabled && !hasDisabled) {
    ckCls = " on";
  }
  const dispName = renderDisplayName(k);
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return `<div class="fh-list${lk}" data-dir="${attr(full)}"${pad}>
<span class="ck${ckCls}" data-dir="${attr(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
}

function attr(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function size(b) {
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
function sc(b) {
  if (b == null) return "";
  if (b < 1048576) return "sz-green";
  if (b < 3145728) return "";
  return "sz-red";
}