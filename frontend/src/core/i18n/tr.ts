// ===== i18n 安全取值（缺失键兜底，ADR-207 D3 双入口）=====
// tr（严格字面量 key，LocaleKey 编译期检查）/ trDynamic（数据驱动 key，string）；
// 二者共享 tOf（缺失键返回 key 本身——「v === key」判定单一事实源），无 cast 洗白。
// 杜绝发版前漏译让菜单/控件退化显示裸 key 字面量（如 "menu.openFolder"）。
import { interpolate, type LocaleKey, type LocaleParams, tOf } from "./t.ts";

/**
 * i18n 安全取值（严格字面量 key）：键缺失时回退到 fallback（经同参插值），杜绝裸 key 上屏。
 * @param key - 翻译键字面量（拼错编译期报错；数据驱动 string key 用 trDynamic）
 * @param fallback - 键缺失时的兜底字符串（建议用英文/原 key 之外的稳定文案）
 * @param params - 插值参数，透传 t(key, params)（同 t 的 {n} 语法）
 * @returns 翻译结果；缺失则返回 interpolate(fallback, params)
 */
export function tr(key: LocaleKey, fallback: string, params?: LocaleParams): string {
  const v = tOf(key, params);
  // 缺失键语义：tOf 返回 key 本身 → fallback 须做与 t 相同的 {name} 插值，否则显示裸占位符
  return v === key ? interpolate(fallback, params, key) : v;
}

/**
 * i18n 安全取值（动态 key）：数据驱动键（控件定义 labelKey/group 等运行时 string 数据字段，
 * 如 3D 菜单 CapControlView.labelKey、右键菜单 BATCH_TPL 模板表）——key 有意为 string，
 * 无编译期收窄；字面量 key 请优先 tr（拼错编译期报红）。
 */
export function trDynamic(key: string, fallback: string, params?: LocaleParams): string {
  const v = tOf(key, params);
  return v === key ? interpolate(fallback, params, key) : v;
}
