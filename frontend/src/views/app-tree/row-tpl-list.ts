// ===== 紧凑列表行 HTML 模板（24px 高度）=====
import { esc } from "../../utils/dom/html.ts";
import { fmt, sizeColor } from "../../utils/dom/format.ts";
import type { TreeEntry } from "./loader.ts";
import { fileRowCommon, folderRowCommon } from "./row-common.ts";

/** 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） */
export function listFileRowHTML(
  e: TreeEntry,
  nmHtml: string,
  icon: string,
  nmCls = "",
  indent: number | null | undefined = null,
  rowCls = "",
): string {
  const { p, fp, checked, ban, typeIcon, pad } = fileRowCommon(e, icon, indent);
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
  const { fi, nc, lk, ar, ac, ckCls, dispName, pad } = folderRowCommon(
    k, full, isOpen, isLocked, hasEnabled, hasDisabled, indent,
  );
  return `<div class="fh-list${lk}" data-dir="${esc(full)}"${pad}>
<span class="ck${ckCls}" data-dir="${esc(full)}"></span>
<span class="ar${ac}">${ar}</span>
<span class="nm" style="color:${nc}">${fi} ${dispName}</span></div>`;
}
