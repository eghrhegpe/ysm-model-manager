#!/usr/bin/env node
/**
 * stale-baseline.mjs — baseline 文件超期告警共享层。
 *
 * 设计意图：baseline 文件（deadcode / jscpd-go / redlines）的门槛值长期不刷新
 * 会悄然失效——门禁放行越来越多本应阻断的问题，形同虚设。本模块统一检测
 * `generated` 字段距今是否超过 STALE_DAYS，输出标准化 WARN 字符串供调用方插入日志。
 *
 * 用法：
 *   import { checkStale } from './stale-baseline.mjs';
 *   const warn = checkStale(base.generated, 'deadcode');
 *   if (warn) console.warn(warn);
 *
 * 依赖：零依赖（仅 Date 内置 API）
 */

/** 基线超期天数阈值：超过此天数未刷新即发出警告。 */
export const STALE_DAYS = 30;

/**
 * 检查基线是否超期。
 * @param {string|undefined} generatedISO  - ISO 8601 时间戳（JSON 中的 generated 字段）
 * @param {string} label                   - 基线名称（用于文案，如 'deadcode' / 'jscpd-go' / 'redlines'）
 * @returns {string|null} 超期时返回警告字符串，否则返回 null
 */
export function checkStale(generatedISO, label) {
  if (!generatedISO) return null;
  const ts = new Date(generatedISO).getTime();
  if (isNaN(ts)) return null;
  const days = (Date.now() - ts) / 86_400_000;
  if (days > STALE_DAYS) {
    return `⚠️  ${label} baseline 已 ${Math.round(days)} 天未刷新（阈值 ${STALE_DAYS} 天），门禁容忍度可能过时。运行 --update-baseline 更新。`;
  }
  return null;
}
