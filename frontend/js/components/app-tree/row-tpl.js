// ===== 树节点行 HTML 模板 =====
import { renderDisplayName } from "../../utils/display.js";

/** 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） */
export function fileRowHTML(
  e,
  nmHtml,
  icon,
  dateStr,
  nmCls = "",
  indent,
  rowCls = "",
) {
  const p = attr(e.path);
  const fp = attr(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const ban = e.banned ? " ban" : "";
  const typeIcon =
    e.type === "resourcepack" ? "🎨" : e.type === "ysm" ? "💎" : icon;
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return `<div class="fl${ban}${rowCls}" data-path="${p}" data-fullpath="${fp}"${pad}>
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${typeIcon}</span>
<span class="nm${nmCls}">${nmHtml}</span>
<span class="hover-actions">
  <span class="ha-btn ha-preview" data-path="${fp}" title="B站搜索作者">🔍</span>
  <span class="ha-btn ha-copy" data-path="${fp}" title="复制文件名">📋</span>
</span>
<span class="sz ${sc(e.size)}">${size(e.size)}</span>${dateStr ? `<span class="dt">${dateStr}</span>` : ""}</div>`;
}

/** 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） */
export function folderRowHTML(
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
  const dispName = k.startsWith("[") ? renderDisplayName(k) : attr(k);
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return `<div class="fh${lk}" data-dir="${attr(full)}"${pad}>
<span class="ck${ckCls}" data-dir="${attr(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
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
function sc(b) {
  if (!b && b !== 0) return "";
  if (b < 1048576) return "sz-green";
  if (b < 3145728) return "";
  return "sz-red";
}
