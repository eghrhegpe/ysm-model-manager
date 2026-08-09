// ===== i18n 翻译函数（ADR-045）=====
// 纯查表函数，语言包缓存由 locale.ts 管理（避免循环依赖）。

import { getBundle, _warned } from "./locale.ts";

/**
 * 翻译函数。
 * @param key - 扁平化 key，如 "nav.repository"
 * @param params - 插值参数，如 { n: 3 } 替换 "{n}"
 * @returns 翻译后的字符串，缺失时返回 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const bundle = getBundle();

  let text = bundle[key];
  if (text === undefined) {
    if (!_warned.has(key)) {
      _warned.add(key);
      console.warn(`[i18n] 缺失 key: ${key}`);
    }
    return key;
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/** 可用语言列表（由构建脚本确保与 locales/ 目录对齐） */
export const AVAILABLE_LANGS = ["zh-CN", "en"] as const;
