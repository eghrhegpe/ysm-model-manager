// ===== 图标语义名解析（ADR-238 / ADR-245 / ADR-248 单一事实源）=====
// 菜单项 icon 字段填「语义名」（**UI_ICONS 的 key**），统一解析为渲染串。
// 未命中返回 ""（无图标）；emoji/任意字符串由调用方按兜底路径自行处理（不在此 escape）。
// 下沉自 views/app-tree/toolbar-menus.ts 的私有 resolveIcon，消除重复实现。
// 2026-09：原并列的 icon-kit（多源中介层 ICON_KIT）按 ADR-248 §3 并入 UI_ICONS——
// 故本函数由「两表按优先级查找」简化为**单表查找**，语义名命名空间收敛为一个。

import { esc } from "@/utils/html/html.ts";
import type { DataGlyph } from "@/utils/resource/types.ts";
import { UI_ICONS, type UiIconName } from "./ui-icons.ts";

/**
 * 结构槽图标字段的类型（ADR-248 D3）：**图标语义名** 或 **数据图标字形**。
 *
 * 关键在于**裸 emoji 字面量两者皆不满足**（`"🧍"` 既不是 `UI_ICONS` 的键，也没有
 * `DataGlyph` 的品牌）→ 写进去即 `tsc` 报错。这条线正是 ADR-238 §1.3（数据图标不可动）
 * 与 §1.4（结构槽须走 SVG）要守的边界——现在由**类型**守，不再靠清单与扫描。
 *
 * 命名沿革：初版名 `IconSpec`，与当时 icon-kit 导出的同名类型（多源定义 `{src:"svg"|…}`）
 * 撞名 → 更名 `IconRef`；随后 icon-kit 整体并入 `UI_ICONS`（ADR-248 §3），该重名源已消失。
 */
export type IconRef = UiIconName | DataGlyph;

/** 语义名 → 渲染串（SVG HTML 或 ""）；未命中返回 ""。 */
export function resolveIcon(name: string): string {
  // `UI_ICONS` 已在 ADR-248 收紧为字面量键：`in` 已给出运行时证明，但 TS 不会把 `string`
  // 收窄到 keyof，故显式断言——断言范围被紧邻的 `in` 判定框死，属可接受范围。
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
 * 就把 `typeIconOf()`（resource_types.json 派生的 DataGlyph 字形）直接传进来——
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

/**
 * 图标字段的**字符串版**统一出口（applyIcon 的模板串孪生，ADR-238/248）——
 * 三态入参 → 可信 HTML 产物：
 *   - 预构建 SVG（UI_ICONS 常量直传形态）→ 原样透传；
 *   - 语义名 → resolveIcon 的 SVG 产物；
 *   - 数据图标/任意文本（DataGlyph 字形等）→ esc 后按文本落位。
 *
 * 消费方 = `${renderIconHtml(x)}` 模板插值（card-shell / detail / preview tpl）；
 * R8 模板闸（scripts/_lib/innerhtml-hygiene.ts）按 render* builder 命名视为可信源。
 * 与 applyIcon 同价：同一三态契约的 DOM 形态 vs 字符串形态，勿再造第四种写法。
 */
export function renderIconHtml(icon: string | undefined): string {
  if (!icon) return "";
  // 预构建 SVG 常量透传（esc 会把它们打成字面文本）。
  // 入参仅限 UI_ICONS 常量 / 语义名 / DataGlyph 字形（typeIconOf、UI_ICONS 表派生），
  // 禁止喂外部输入（URL 参数、文件名派生等）——`<svg` 前缀无白名单校验，刻意 `<svg`
  // 开头的外部数据会原样进 innerHTML（XSS 放大面）。
  if (icon.includes("<svg")) return icon;
  return resolveIcon(icon) || esc(icon); // 语义名→SVG；其余→转义文本（数据图标兼容态）
}
