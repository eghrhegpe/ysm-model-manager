/**
 * supersede-regex.ts — ADR 取代关系判别的核心正则（YSM 完整版）。
 *
 * 从 MikuMikuAR 搬运（ADR-114 §被补充 元治理：基建补齐），
 * 原 YSM 版为不完整的半搬运（缺 RE_PARTIAL / RE_NEGATED_CLAIM，
 * RE_SUPERSEDED_BY 无 ** 粗体兼容，RE_NEGATED 仅覆盖推翻），已补全。
 *
 * 分层语义（与 gen-adr-supersede.mjs 的五层判别对应）：
 *   ① RE_SUPERSEDED_BY   状态行声明「被 ADR-NNN 取代/推翻」(已登记)
 *     RE_PARTIAL         局部限定词(部分/§N/条目 N)
 *   ② RE_CLAIM_A/B       正文「取代/废弃了 ADR-NNN」紧邻宣称(漏标告警)
 *     RE_NEGATED_CLAIM   目标级否定宣称（不取代/未替代 ADR-NNN）
 *   ③ RE_SELF_DEPRECATED 状态行自身废弃
 *   ④ RE_DEPRECATED_WORD 可疑信号强词(推翻/已过时)；RE_NEGATED 否定过滤
 *   ⑤ RE_TABLE_*         表格弱宣称
 *
 * 零依赖（仅 node:fs / node:path）。
 */

// ① 状态行「被 ADR-NNN 取代」类声明（已登记）。
// 兼容粗体包裹整个链接 + 全角括号注记（如 ADR-012 形态）：
//    「被 **[ADR-113](…)（体积云）** 取代」——** 在编号前后都有。
export const RE_SUPERSEDED_BY = /被\s*\*{0,2}\s*\[?ADR-(\d+)\]?(?:\s*\([^)]{0,80}\))?\s*(?:\*{0,2}\s*[（(][^）)]{0,40}[）)]\s*\*{0,2})?\s*(?:取代|替代|推翻|退役)/;

// ①→⑥ 局部限定词：命中则该「被取代」声明只覆盖部分章节/条目，不能整篇计入①
export const RE_PARTIAL = /(部分|局部|§\d|条目\s*\d)/;

// ② 正文「取代/废弃了 ADR-NNN」类宣称，紧邻式，避免宽词误报。
// 刻意不带 g：全局正则的 lastIndex 有状态。
export const RE_CLAIM_A = /(?:取代|替代|推翻|废弃|废除)\s*了?\s*\[?ADR-(\d+)\]?/;
export const RE_CLAIM_B = /ADR-(\d+)\s*[）)]?\s*(?:已\s*(?:废弃|过时|放弃|搁置|退役)|被\s*(?:取代|推翻|替代))/;

/** 由无状态正则派生一个带 g 的副本，供 String.prototype.matchAll 使用。 */
export function globalOf(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

// ② 目标级否定宣称：「不取代/未替代/没有废弃 ADR-NNN」
// 与 RE_NEGATED（仅判定「行内存在否定语境」）不同，本正则捕获被否定的具体目标编号，
// 供 gen-adr-supersede ②/④ 做目标级剔除——否则「本 ADR 不取代 ADR-100，同时取代 ADR-200」
// 整行 continue 会吞掉 ADR-200 的真实宣称（② 漏标假绿）。
export const RE_NEGATED_CLAIM = /(?:非|不|未|无|没有)\s*\*{0,2}\s*(?:取代|替代|推翻|废弃|废除|退役)\s*了?\s*\[?ADR-(\d+)\]?/;

// ③ 状态行自身废弃：带 ⚠️/🗑️/🧊/❌ 强调标记，或以废弃类词开头（不指明取代者）
// 兼容 AGENTS.md 合法状态 `🧊 已废弃` / `❌ 已取代`
export const RE_SELF_DEPRECATED =
  /(?:⚠️|🗑️|🧊|❌)\s*\**(?:(?:已废弃|已过时|已放弃|已搁置|已退役)|(?:整篇|全篇)\s*废弃)|^(?:已废弃|已过时|已放弃|已搁置|已退役|搁置|废弃|已取代)/;

// ④ 可疑信号强词：仅「推翻」与「过时」值得人工确认（决策冲突/文档漂移）
export const RE_DEPRECATED_WORD = /(推翻|已过时)/;
// ④ 否定语境过滤：「非推翻/不推翻/未推翻」等明确否认，不算冲突信号
export const RE_NEGATED = /(非|不|未|无|没有)\s*\*{0,2}\s*(?:取代|替代|推翻|废弃|废除|退役)/;

// ⑤ 表格弱宣称：行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」
export const RE_TABLE_FIRST_COL = /^\|\s*ADR-(\d+(?:\.\d+)?)/;
export const RE_TABLE_VERB = /本\s*ADR[^|]{0,30}(?:完全)?(?:替代|取代|推翻)/;
export const RE_TABLE_NEGATED = /(非|不|未|无|没有)\s*(?:替代|取代|推翻)/;