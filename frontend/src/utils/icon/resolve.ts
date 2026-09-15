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

/**
 * 把菜单项 icon 字段落到元素上——**迁移期统一入口**（3D 菜单表迁移 2026-09 新增）。
 *
 * 两种形态并存是有意为之：图标迁移是**分域推进**的（工具栏下拉 ADR-239、右键菜单 ADR-245
 * 已迁完，3D 菜单表在迁），所以渲染层必须同时接受两种值：
 *   - 命中语义名（`isIconName`）→ 把 `resolveIcon()` 的产物经 `innerHTML` 落位，渲染为 SVG；
 *   - 未命中 → 按旧路径当**字形文本**写入（`textContent`），未迁的表零改动继续可用。
 *
 * 为什么必须有兜底分支：`resolveIcon()` 对未知名返回 `""`（其注释明确「emoji/任意字符串
 * 由调用方按兜底路径自行处理」）。若渲染层无脑把产物塞给 `innerHTML` 而不判命中，
 * 未迁移的 emoji 图标会**整片消失**——那比继续显示 emoji 更糟。
 *
 * ⚠️ 走 `innerHTML` 的分支只喂 `resolveIcon()` 的产物（ICON_KIT 渲染串 / UI_ICONS 常量），
 * **永不是用户数据**——这也是 check-redlines R8 豁免它的结构性理由（RHS 为单一变量）。
 * 待全部菜单表迁完，可删兜底分支，改由契约测试统一守护。
 *
 * 注：本段注释刻意不写「innerHTML 空格等号空格 函数调用」的字面形态——R8 扫描器**不剥注释**，
 * 写了会把说明文字当违规行拦下（实测被拦 2 处），故改用「经 … 落位」的描述式措辞。
 */
export function applyIcon(el: HTMLElement, icon: string | undefined): void {
  const rendered = icon ? resolveIcon(icon) : "";
  if (rendered) {
    el.innerHTML = rendered;
  } else {
    el.textContent = icon ?? "";
  }
}
