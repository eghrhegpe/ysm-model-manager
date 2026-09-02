// ===== i18n 翻译函数（ADR-045）=====
// 纯查表函数，语言包缓存由 locale.ts 管理（避免循环依赖）。
// 类型化（锐评整改）：key 参数收窄为 LocaleKey（zh-CN 基准包 key 联合），
// 拼错 key 编译期报错——三语言包 key 集严格一致（locales-consistency 测试保证），
// zh-CN 作单一类型源；运行时缺失仍返回 key + warn（JSON 语言包可能滞后，优雅降级不崩）。

import { getBundle, warnedKeys } from "./locale.ts";
import type { zhCN } from "./locales/zh-CN.ts";

/** 全部合法 i18n key（扁平化命名空间 key，如 "nav.repository"） */
export type LocaleKey = keyof typeof zhCN;

/** 插值参数：{key} 占位符的值（字符串/数字） */
export type LocaleParams = Record<string, string | number>;

/**
 * 翻译函数。
 * @param key - 扁平化 key，如 "nav.repository"（keyof 校验：字面量拼错编译期报错）
 * @param params - 插值参数，如 { n: 3 } 替换 "{n}"
 * @returns 翻译后的字符串，缺失时返回 key 本身
 *
 * 数据驱动 key（MenuControlDef.labelKey / tr() / opts.t 等运行时 string）
 * 需显式收窄为 LocaleKey（调用处 as LocaleKey 或字段类型改 LocaleKey）——
 * 语言包 key 即契约，新 UI 文案先入语言包再引用。
 */
export function t(key: LocaleKey, params?: LocaleParams): string {
  const bundle = getBundle();

  let text = bundle[key];
  if (text === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] 缺失 key: ${key}`);
    }
    return key;
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // P1/P2 修复（子代理审计）：① 替换值用函数型替换——字符串替换会把 `$&`/`$1`/
      // `$<name>` 当特殊序列解析（参数值含 "$1" 会被替换成空串或捕获组内容，产生错译文）；
      // ② 参数名先正则转义——`{a.b}`/`{[` 等含正则元字符的 key 会构造非法正则（RangeError）
      // 或误匹配。函数型替换 + 转义双保险
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\{${escaped}\\}`, "g"), () => String(v));
    }
  }
  return text;
}
