// ===== i18n 插值占位符提取（core 内核纯函数，ADR-189）=====
// 单一事实源：{ident} 占位符的识别正则与提取函数。
// 在 core 上从 utils/base/pure/i18n-placeholder 迁移而来（2026-09）：
// 该纯函数仅被 core/i18n 消费，迁入 core 消除 utils ↔ core 循环依赖回边。
// 占位符约定 = JS 标识符（字母/_/$ 开头，后接字母/数字/_/$）；与 interpolate 的 split/join 键空间一致。
// 消费方：t.ts 残留守卫 + locales-consistency.test.ts 一致性校验。

/** i18n 插值占位符正则（匹配 {name} / {n} 等 JS 标识符形态） */
export const PLACEHOLDER_RE = /\{([a-zA-Z_$][\w$]*)\}/g;

/** 提取文本中全部占位符名（去重、稳定排序） */
export function extractPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    names.add(m[1]);
  }
  return [...names].sort();
}
