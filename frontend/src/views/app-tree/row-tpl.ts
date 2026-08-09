// ===== 树节点行 HTML 模板（grid 模式）=====
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { formatBytes, sizeColor } from "../../utils/dom/format.ts";
import type { TreeEntry } from "./loader.ts";
import { fileRowCommon, folderRowCommon } from "./row-common.ts";

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
  const { p, fp, checked, ban, typeIcon, pad } = fileRowCommon(e, icon, indent);
  const tagMark = e.HasTags ? `<span class="tag-dot" title="${t("tree.hasTags")}">🏷️</span>` : "";
  return `<div class="fl${ban}${rowCls}" data-testid="tree-file" data-path="${p}" data-fullpath="${fp}"${pad}>
<span class="ck${checked}" data-testid="tree-toggle" data-path="${p}" data-fullpath="${fp}"></span>
<span class="ficon">${typeIcon}</span>
<span class="nm${nmCls}">${tagMark}${nmHtml}</span>
<span class="hover-actions">
  <span class="ha-btn ha-preview" data-path="${fp}" title="${t("tree.bilibiliSearch")}">🔍</span>
  <span class="ha-btn ha-copy" data-path="${fp}" title="${t("tree.copyFilename")}">📋</span>
</span>
<span class="sz ${sizeColor(e.size)}">${formatBytes(e.size)}</span>${dateStr ? `<span class="dt">${dateStr}</span>` : ""}</div>`;
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
  const { fi, nc, lk, ar, ac, ckCls, dispName, pad } = folderRowCommon(
    k, full, isOpen, isLocked, hasEnabled, hasDisabled, indent,
  );
  return `<div class="fh${lk}" data-testid="tree-dir" data-dir="${esc(full)}"${pad}>
<span class="ck${ckCls}" data-testid="tree-dir-toggle" data-dir="${esc(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
}
