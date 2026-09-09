// ===== i18n 翻译函数（ADR-045）=====
// 纯查表 + 插值，语言包缓存与缺失告警状态由 locale.ts 管理（避免循环依赖）。
// 类型化（ADR-189 锐评整改）：t 收窄 key 为 LocaleKey（zh-CN 基准包 key 联合），
// 拼错 key 编译期报错——三语言包 key 集严格一致（locales-consistency 测试保证），
// zh-CN 作单一类型源。
// 双入口（ADR-207 D3）：t（严格字面量 key）/ tOf（string 版，动态 key）——
// 缺失键语义一致（返回 key 本身 + warnMissingKey 单次告警），tr/trDynamic 共用 tOf。

import type { zhCN } from "@/locales/zh-CN.ts";
import { getBundle, warnMissingKey } from "./locale.ts";

/** 全部合法 i18n key（扁平化命名空间 key，如 "nav.repository"） */
export type LocaleKey = keyof typeof zhCN;

/** 插值参数：{key} 占位符的值（字符串/数字） */
export type LocaleParams = Record<string, string | number>;

// 残留占位符告警（每签名一次）：模板含 {ident} 而参数未传/未覆盖 → 裸占位符上屏是
// 静默 UI bug 类，守卫兜底（ADR-207 D3）
const warnedResiduals = new Set<string>();
const RESIDUAL_RE = /\{[a-zA-Z_$][\w$]*\}/g;

/**
 * 将 params 中的 {key} 占位符替换为对应值。
 * split/join 字面量替换：无正则编译、无缓存表；对 $&/$1 等特殊序列天然免疫。
 * 残留占位符守卫：替换后仍含 {ident} → 按残留签名 console.warn 一次（context 供诊断）。
 */
export function interpolate(text: string, params?: LocaleParams, context?: string): string {
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  const residual = text.match(RESIDUAL_RE);
  if (residual) {
    const names = [...new Set(residual)].sort();
    const sig = `${names.join("|")}${context ? `@${context}` : ""}`;
    if (!warnedResiduals.has(sig)) {
      warnedResiduals.add(sig);
      console.warn(
        `[i18n] 残留插值占位符 ${names.join(" ")}${context ? `（key: ${context}）` : ""}`,
      );
    }
  }
  return text;
}

/**
 * 翻译函数（严格字面量 key 入口）。
 * @param key - 扁平化 key，如 "nav.repository"（keyof 校验：字面量拼错编译期报错）
 * @param params - 插值参数，如 { n: 3 } 替换 "{n}"
 * @returns 翻译后的字符串，缺失时返回 key 本身（warnMissingKey 单次告警）
 *
 * 数据驱动 key（labelKey/group 数据字段等运行时 string）→ trDynamic（tr.ts），勿在此收窄。
 */
export function t(key: LocaleKey, params?: LocaleParams): string {
  return tOf(key, params);
}

/**
 * string 版 t（动态 key 入口）：缺失键语义与 t 同构（返回 key 本身 + 单次告警）——
 * 「v === key 即缺失」判定单一事实源，tr / trDynamic 共用（ADR-207 D3）。
 */
export function tOf(key: string, params?: LocaleParams): string {
  const bundle = getBundle();
  const text = bundle[key];
  if (text === undefined) {
    warnMissingKey(key);
    return key;
  }
  // 一律经 interpolate：残留占位符守卫须覆盖「模板有 {n} 而 params 缺省」这一最需告警的场景
  return interpolate(text, params, key);
}
