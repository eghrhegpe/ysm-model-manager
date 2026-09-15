/**
 * icons.ts — 多源图标定义集（icon-kit）。
 *
 * 是什么：把「图标语义」与「图标源（SVG / emoji / 图标字体）」解耦的图标注册表。
 * 调用方只认**语义名**，`renderIcon(spec)` 决定最终渲染成 `<svg>` / `<span class="eicon">`
 * / `<span class="ficon ...">` 中的哪一种。
 *
 * 为什么存在（承接 ADR-238 的 SVG 单一体系，破掉「只支持 SVG」的限制）：
 *   ADR-238 已把 UI chrome 图标收敛到 `UI_ICONS`（纯 SVG），但**源被锁死**——emoji
 *   只能出现在文案正文、图标字体无入口。icon-kit 在不推翻 `.ws-icon` 约定（SVG 仍是
 *   首选源，随主题/字号走）的前提下，补上「一个语义名可以声明多种源」的弹性：
 *   - 想要 SVG 精确可控 → `{ src: 'svg', svg }`（默认，SVG 优先策略）；
 *   - 想要 emoji（如世界表情、特殊字形）→ `{ src: 'emoji', char }`；
 *   - 想用图标字体 → `{ src: 'font', className }`（预留，.ws-icon 外新渲染形态）。
 *
 * 与 `UI_ICONS` 的关系（ADR-238 语义名规范继续有效）：
 *   `UI_ICONS` 仍是通用 SVG chrome 图标集的统一出处；icon-kit 是**在其之上**的多源
 *   中介层，不为 SVG 重造轮子 —— 需要 SVG 时可直接 `spec = { src:'svg', svg: UI_ICONS.x }`
 *   或由 render 内部解析复用 `UI_ICONS` 的 `.ws-icon` 外壳。
 *
 * 命名沿用 ADR-238 D2：语义名（enableAll），非外观名/字形名。
 */

import type { IconSpec } from "./types.ts";

/** 语义名 → 多源图标定义。新增图标在此外挂，消费方只 import 语义名。 */
export const ICON_KIT = {
  // ── 批量操作 ──
  // 「全部启用」= 正向肯定动作，视觉用打勾（SVG 首选，随主题/字号）。
  enableAll: {
    src: "svg",
    svg: '<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>',
  },
  // 「全部禁用」= 打叉语义，同样用 SVG，与 enableAll 保持成对一致的视觉权重。
  // 多源能力保留：若日后想用 emoji/图标字体，把 src 换成对应形态即可，调用方零改动。
  disableAll: {
    src: "svg",
    svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>',
  },
} satisfies Record<string, IconSpec>;

/**
 * icon-kit 语义名（字面量联合）。收紧前是 `Record<string, IconSpec>` → `keyof` 退化为 `string`，
 * 于是任何字段都"接受"icon-kit 名字，类型形同虚设（ADR-248 D1 同款处理，此处对齐）。
 */
export type IconKitName = keyof typeof ICON_KIT;

/** 全部语义名（供测试/文档消费）。 */
export function iconKitNames(): string[] {
  return Object.keys(ICON_KIT).sort();
}
