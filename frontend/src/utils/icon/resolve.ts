// ===== 图标语义名解析（ADR-238 / ADR-245 单一事实源）=====
// 菜单项 icon 字段填「语义名」（UI_ICONS / ICON_KIT 的 key），统一解析为渲染串：
//   - ICON_KIT（多源，如 enableAll）优先
//   - UI_ICONS（SVG，如 folderOpen/file）兜底
// 未命中返回 ""（无图标）；emoji/任意字符串由调用方按兜底路径自行处理（不在此 escape）。
// 下沉自 views/app-tree/toolbar-menus.ts 的私有 resolveIcon，消除重复实现。
import { ICON_KIT, renderIcon } from "./icon-kit/index.ts";
import { UI_ICONS } from "./ui-icons.ts";

/** 语义名 → 渲染串（SVG HTML 或 ""）；未命中返回 ""。 */
export function resolveIcon(name: string): string {
  if (name in ICON_KIT) return renderIcon(ICON_KIT[name]);
  if (name in UI_ICONS) return UI_ICONS[name];
  return "";
}

/** 是否命中已知图标语义名（供渲染层判断是否走 SVG 路径、调用方是否完成迁移）。 */
export function isIconName(name: string): boolean {
  return name in ICON_KIT || name in UI_ICONS;
}
