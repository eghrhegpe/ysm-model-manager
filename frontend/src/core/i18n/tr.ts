// ===== i18n 安全取值（已废弃，统一走 t()）=====
// tOf() 已内置多级回退（current → en → 裸 key），tr/trDynamic 不再需要。
// 保留本模块仅为兼容存量调用，新代码一律用 t()。
import { type LocaleKey, type LocaleParams, tOf } from "./t.ts";

/**
 * @deprecated 使用 t() 替代。tOf() 已内置 current → en → key 多级回退，无需手动提供 fallback。
 */
export function tr(key: LocaleKey, _fallback: string, params?: LocaleParams): string {
  return tOf(key, params);
}

/**
 * @deprecated 使用 t() 替代。tOf() 已内置 current → en → key 多级回退，无需手动提供 fallback。
 */
export function trDynamic(key: string, _fallback: string, params?: LocaleParams): string {
  return tOf(key, params);
}
