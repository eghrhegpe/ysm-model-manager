// ===== 树节点行 HTML 模板 =====
import { renderDisplayName } from "../../utils/display.js";

/** 文件行 HTML */
export function fileRowHTML(e, nmHtml, icon, dateStr, extraCls = "") {
  const p = attr(e.path);
  const fp = attr(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const ban = e.banned ? " ban" : "";
  return `<div class="fl${ban}" data-path="${p}" data-fullpath="${fp}">
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${icon}</span>
<span class="nm${extraCls}">${nmHtml}</span>
<span class="sz ${sc(e.size)}">${size(e.size)}</span>${dateStr ? `<span class="dt">${dateStr}</span>` : ""}</div>`;
}

/** 文件夹行 HTML（含 .ch 容器开头） */
export function folderRowHTML(
  k,
  full,
  isOpen,
  isLocked,
  hasEnabled,
  hasDisabled,
) {
  const fi = isLocked ? "🔒" : "📁";
  const nc = isLocked ? "var(--muted)" : "var(--txt)";
  const lk = isLocked ? " locked" : "";
  const ar = isOpen ? "▾" : "▸";
  const ac = isOpen ? " open" : "";
  // 文件夹开关：部分选中用半开，全选中/全禁用跟随状态
  let ckCls = "";
  if (hasEnabled && hasDisabled) {
    ckCls = " on partial";
  } else if (hasEnabled && !hasDisabled) {
    ckCls = " on";
  }
  const dispName = k.startsWith("[") ? renderDisplayName(k) : attr(k);
  return `<div class="fh${lk}" data-dir="${attr(full)}">
<span class="ck${ckCls}" data-dir="${attr(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>
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
function sc(b) {
  if (!b && b !== 0) return "";
  if (b < 1048576) return "sz-green";
  if (b < 3145728) return "";
  return "sz-red";
}
