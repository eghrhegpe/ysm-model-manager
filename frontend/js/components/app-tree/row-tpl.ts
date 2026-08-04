// ===== 树节点行 HTML 模板 =====
import { renderDisplayName } from "../../utils/display.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { esc } from "../../utils/dom.ts";
import { fmt, sizeColor } from "../../utils/fmt.ts";
import type { TreeEntry } from "./loader.ts";

/** 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） */
export function fileRowHTML(
  e: TreeEntry,
  nmHtml: string,
  icon: string,
  dateStr: string,
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
  const tagMark = e.HasTags ? '<span class="tag-dot" title="有标签">🏷️</span>' : "";
  return `<div class="fl${ban}${rowCls}" data-path="${p}" data-fullpath="${fp}"${pad}>
<span class="ck${checked}" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${typeIcon}</span>
<span class="nm${nmCls}">${tagMark}${nmHtml}</span>
<span class="hover-actions">
  <span class="ha-btn ha-preview" data-path="${fp}" title="B站搜索作者">🔍</span>
  <span class="ha-btn ha-copy" data-path="${fp}" title="复制文件名">📋</span>
</span>
<span class="sz ${sizeColor(e.size)}">${fmt(e.size)}</span>${dateStr ? `<span class="dt">${dateStr}</span>` : ""}</div>`;
}

/** 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） */
export function folderRowHTML(
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
  return `<div class="fh${lk}" data-dir="${esc(full)}"${pad}>
<span class="ck${ckCls}" data-dir="${esc(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
}
