// ===== 图标语义名解析（ADR-238 / ADR-245 单一事实源）=====
// 菜单项 icon 字段填「语义名」（UI_ICONS / ICON_KIT 的 key），统一解析为渲染串：
//   - ICON_KIT（多源，如 enableAll）优先
//   - UI_ICONS（SVG，如 folderOpen/file）兜底
// 未命中返回 ""（无图标）；emoji/任意字符串由调用方按兜底路径自行处理（不在此 escape）。
// 下沉自 views/app-tree/toolbar-menus.ts 的私有 resolveIcon，消除重复实现。

import type { DataGlyph } from "@/utils/resource/types.ts";
import { ICON_KIT, type IconKitName, renderIcon } from "./icon-kit/index.ts";
import { UI_ICONS, type UiIconName } from "./ui-icons.ts";

/**
 * 已知图标语义名 = **两个命名空间的并**：`UI_ICONS`（SVG chrome 图标集）∪ `ICON_KIT`
 * （多源中介层，当前仅 `enableAll` / `disableAll`）。二者由 `resolveIcon()` 定优先级。
 *
 * 注：两条来源是否收敛成一个命名空间是**待决事项**（见 ADR-248 §3「已知遗留」）——
 * 在收敛前，类型层如实表达「当前有两个来源」，而不是假装只有一个。
 */
export type IconName = UiIconName | IconKitName;

/**
 * 结构槽图标字段的类型（ADR-248 D3）：**图标语义名** 或 **数据图标字形**。
 *
 * 关键在于**裸 emoji 字面量两者皆不满足**（`"🧍"` 既不是任一注册表的键，也没有
 * `DataGlyph` 的品牌）→ 写进去即 `tsc` 报错。这条线正是 ADR-238 §1.3（数据图标不可动）
 * 与 §1.4（结构槽须走 SVG）要守的边界——现在由**类型**守，不再靠清单与扫描。
 *
 * 命名：初版叫 `IconSpec`，与 `icon-kit/types.ts` 的同名导出（多源定义 `{src:"svg"|…}`）
 * **同名不同义**，2026-09 更名 `IconRef` 消除重名（同一棵 `utils/icon/` 树下两个 `IconSpec`
 * 是明确的阅读陷阱）。`IconSpec` 一名归 icon-kit 所有。
 */
export type IconRef = IconName | DataGlyph;

/** 语义名 → 渲染串（SVG HTML 或 ""）；未命中返回 ""。 */
export function resolveIcon(name: string): string {
  // 两个注册表都在 ADR-248 里收紧成了字面量键：`in` 已给出运行时证明，但 TS 不会把 `string`
  // 收窄到 keyof，故两处都显式断言——断言范围被紧邻的 `in` 判定框死，属可接受范围。
  if (name in ICON_KIT) return renderIcon(ICON_KIT[name as IconKitName]);
  if (name in UI_ICONS) return UI_ICONS[name as UiIconName];
  return "";
}

/**
 * 把菜单项 icon 字段落到元素上——**统一入口**（3D 菜单表迁移 2026-09 新增）。
 *
 * 两种形态并存是**长期**设计，不是迁移期的临时妥协：图标有两个合法来源，
 * 渲染层必须同时接受——
 *   - **UI 图标**：语义名（ADR-238 §1，如 `folderOpen`/`camera`）→ `resolveIcon()` 有产物，
 *     把其经 `innerHTML` 落位，渲染为 SVG；
 *   - **数据图标**：`resource_types.json` 的 `icon`/`groupIcon`（ADR-238 §1.3 🚨不可动，
 *     由 Go + 该 JSON 判定归属）→ `resolveIcon()` 返回 `""`（它不是注册表里的名字），
 *     按旧路径当**字形文本**写入。
 *
 * 运行时判别 = `resolveIcon()` 是否返回空串（不再需要 `isIconName()` 这类二次查表函数：
 * 名字合法性已由字段类型 `IconRef` 在编译期保证，见 resolve.ts 顶部类型注释）。
 *
 * 为什么兜底分支不可删：`resolveIcon()` 对未知名返回 `""`（其注释明确「emoji/任意字符串
 * 由调用方按兜底路径自行处理」）。`views/app-preview/preview-router.ts|routeTypeMeta`
 * 就把 `typeCache`（资源类型注册表）的图标直接传进来，并带 `|| "📦"` 兜底——
 * 删掉本分支 = 数据图标**整片消失**，比显示 emoji 更糟。
 *
 * ⚠️ 走 `innerHTML` 的分支只喂 `resolveIcon()` 的产物（ICON_KIT 渲染串 / UI_ICONS 常量），
 * **永不是用户数据**——这也是 check-redlines R8 豁免它的结构性理由（RHS 为单一变量）。
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
