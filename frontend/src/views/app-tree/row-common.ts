// ===== 树行公共子结构（D-2 去重，2026-08-05）=====
// grid（row-tpl.ts）与 list（row-tpl-list.ts）两套模板共享的计算与骨架。
// 抽自 jscpd 报的 36 行跨文件重复：p/fp/checked/ban/typeIcon/pad 计算一字不差，
// 文件夹行 8 个局部变量（fi/nc/lk/ar/ac/ckCls/dispName/pad）完全一致。
import { renderDisplayName } from "../../utils/dom/display.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { esc } from "../../utils/dom/html.ts";
import type { TreeEntry } from "./loader.ts";

/** 文件行公共计算：path 转义、开关状态、禁用 class、类型图标、缩进 */
export function fileRowCommon(
  e: TreeEntry,
  icon: string,
  indent: number | null | undefined,
): {
  p: string;
  fp: string;
  checked: string;
  ban: string;
  typeIcon: string;
  pad: string;
} {
  const p = esc(e.path);
  const fp = esc(e.fullPath || e.path);
  const checked = e.banned ? "" : " on";
  const ban = e.banned ? " ban" : "";
  const typeIcon =
    e.type === RESOURCE_TYPES.PACK ? "🎨" : e.type === RESOURCE_TYPES.YSM ? "💎" : icon;
  const pad = indent != null ? ' style="padding-left:' + indent + 'px"' : "";
  return { p, fp, checked, ban, typeIcon, pad };
}

/** 文件夹行公共计算：图标、颜色、箭头、开关 class、显示名、缩进 */
export function folderRowCommon(
  k: string,
  _full: string,
  isOpen: boolean,
  isLocked: boolean,
  hasEnabled: boolean,
  hasDisabled: boolean,
  indent: number | null | undefined,
): {
  fi: string;
  nc: string;
  lk: string;
  ar: string;
  ac: string;
  ckCls: string;
  dispName: string;
  pad: string;
} {
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
  return { fi, nc, lk, ar, ac, ckCls, dispName, pad };
}
