/**
 * supersede-regex.mjs — ADR 取代关系判别的核心正则（YSM 版）。
 *
 * 适配 YSM ADR 首部格式：`- **状态**：xxx`（无序列表 + 中文冒号）。
 * 供 gen-adr-supersede.mjs 与 new-adr.mjs 共用。
 *
 * 分层语义（与 gen-adr-supersede.mjs 的五层判别对应）：
 *   ① RE_SUPERSEDED_BY   状态行声明「被 ADR-NNN 取代/推翻」(已登记)
 *   ② RE_CLAIM_A/B       正文「取代/废弃了 ADR-NNN」紧邻宣称(漏标告警)
 *   ③ RE_SELF_DEPRECATED 状态行自身废弃(⚠️/🗑️ 强调或开头即废弃词)
 *   ④ RE_DEPRECATED_WORD 可疑信号强词(推翻/已过时);RE_NEGATED 否定过滤
 *   ⑤ RE_TABLE_*         表格弱宣称(行首 ADR 编号 + 「本 ADR…替代」跨列)
 *
 * 零依赖（仅 node:fs / node:path）。
 */

// ① 状态行/正文中「被 ADR-NNN 取代」类声明（支持 [ADR-NNN](xxx) 链接写法）——已登记
//    编号与动词之间只允许「markdown 链接目标」这一种有界插入，不再用无界 [^)\]]* 贪婪吞句子。
export const RE_SUPERSEDED_BY = /被\s*\[?ADR-(\d+)\]?(?:\s*\([^)]{0,80}\))?\s*(?:取代|替代|推翻|退役)/;

// ② 正文「取代/废弃了 ADR-NNN」类宣称，紧邻式（间隔 ≤8 个非字母数字字符），避免宽词误报：
//   A. 宣称方在前：「取代 ADR-019」「替代了 ADR-123」
//   B. 被废弃方在前：「ADR-144 已废弃」「ADR-019(已废弃)」
// 刻意不带 g：全局正则的 lastIndex 有状态，共享单例被 .test() 调用后会让下一次匹配从半截开始跳行。
export const RE_CLAIM_A = /(?:取代|替代|推翻|废弃|废除)\s*了?\s*\[?ADR-(\d+)\]?/;
export const RE_CLAIM_B = /ADR-(\d+)\s*[）)]?\s*(?:已\s*(?:废弃|过时|放弃|搁置|退役)|被\s*(?:取代|推翻|替代))/;

/** 由无状态正则派生一个带 g 的副本，供 String.prototype.matchAll 使用（matchAll 强制要求 g）。 */
export function globalOf(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

// ③ 状态行自身废弃：带 ⚠️/🗑️ 强调标记，或以废弃类词开头（不指明取代者）
export const RE_SELF_DEPRECATED = /(?:⚠️|🗑️)\s*\**(?:已废弃|已过时|已放弃|已搁置|已退役)|^(?:已废弃|已过时|已放弃|已搁置|已退役|搁置|废弃)/;

// ④ 可疑信号强词：仅「推翻」与「过时」值得人工确认（决策冲突/文档漂移）
export const RE_DEPRECATED_WORD = /(推翻|已过时)/;
// ④ 否定语境过滤：「非推翻/不推翻/未推翻」等明确否认，不算冲突信号
export const RE_NEGATED = /(非|不|未|无|没有)\s*推翻/;

// ⑤ 表格弱宣称：行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」（跨列自指）
export const RE_TABLE_FIRST_COL = /^\|\s*ADR-(\d+(?:\.\d+)?)/;
export const RE_TABLE_VERB = /本\s*ADR[^|]{0,30}(?:完全)?(?:替代|取代|推翻)/;
// ⑤ 否定语境过滤：「不替代/不取代」等明确否认
export const RE_TABLE_NEGATED = /(非|不|未|无|没有)\s*(?:替代|取代|推翻)/;
