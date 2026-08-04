// ===== 紧凑列表行 HTML 模板（24px 高度）=====
import { renderDisplayName } from "../../utils/display.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { esc } from "../../utils/dom.ts";
import { fmt, sizeColor } from "../../utils/fmt.ts";
import type { TreeEntry } from "./loader.ts";

/** 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） */
export function listFileRowHTML(
  e: TreeEntry,
  nmHtml: string,
  icon: string,
  nmCls = "",
  indent: number | null | undefined,
  rowCls = "",
): string {
  const p = esc(e.path);
  const fp = esc(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const ban = e.banned ? " ban" : "";
  const typeIcon =
    e.type === RESOURCE_TYPES.PACK ? "🎨" : e.type === RESOURCE_TYPES.YSM ? "💎" : icon;
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return `<div class="fl-list${ban}${rowCls}" data-path="${p}" data-fullpath="${fp}"${pad}>
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${typeIcon}</span>
<span class="nm${nmCls}">${nmHtml}</span>
<span class="sz ${sizeColor(e.size)}">${fmt(e.size)}</span></div>`;
}

/** 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） */
export function listFolderRowHTML(
  k: string,
  full: string,
  isOpen: boolean,
  isLocked: boolean,
  hasEnabled: boolean,
  hasDisabled: boolean,
  indent: number | null | undefined,
): string {
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
  return `<div class="fh-list${lk}" data-dir="${esc(full)}"${pad}>
<span class="ck${ckCls}" data-dir="${esc(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
}
