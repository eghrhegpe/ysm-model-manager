// ===== i18n 安全取值（缺失键兜底）=====
// 与 preview-menu/core.ts 内嵌 tr() 同形（2026-XX P2-1 抽取）：
//   const tr = (key, fallback) => { const v = t(key); return v === key ? fallback : v; }
// 收敛为共享助手，菜单声明（menu-defs.ts 等）改用 tr() 兜底，
// 杜绝发版前漏译让菜单退化显示裸 key 字面量（如 "menu.openFolder"）。
//
// 判定语义：t() 缺失键返回 key 本身（t.ts:21）——「v === key」即命中兜底。
// 该判定是单一事实来源，与 t() 缺失键行为强耦合，t() 行为变化需同步 tr()。
import { t } from "./t.ts";

/**
 * i18n 安全取值：键缺失时回退到 fallback，杜绝显示裸 key 字面量。
 * @param key - 翻译键（如 "menu.openFolder"）
 * @param fallback - 键缺失时的兜底字符串（建议用英文/原 key 之外的稳定文案）
 * @param params - 插值参数，透传 t(key, params)（同 t 的 {n} 语法）
 * @returns 翻译结果；缺失则返回 fallback
 */
export function tr(
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  const v = t(key, params);
  return v === key ? fallback : v;
}