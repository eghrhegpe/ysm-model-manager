/**
 * adr-status-categories.ts — ADR 状态分类与归一化共享模块。
 *
 * 单一事实源 + 唯一分类入口 classifyStatus / normalizeState。
 * 使用方：gen-docs-index / check-adr-health / check-adr-status（待新增）。
 *
 * YSM 使用 5 状态值域（与 BABY MikuMikuAR 的 5 桶不同，此处为 YSM 定制）：
 *   ✅ 已采纳 / 🔄 部分采纳 / 🧊 已废弃 / ❌ 已取代 / ⚠️ 已采纳（违规或未修复）
 *   + 兜底 unknown
 *
 * BABY 版（5 桶：推进中/规划中/已落地/已归档/其他）为执行状态分类；
 * YSM 版（5 态 + 1 unknown）为采纳状态分类，两者语义不同不可混用。
 *
 * 各脚本禁止各自维护词表，补词/删词只改此处。零依赖。
 */

// ── 状态归一化（check-adr-health 兼容）──
// 精确优先顺序：partial 必须早于 accepted（'Partially Accepted' 含 'Accepted' 子串）。
// 与 check-adr-health.ts normalizeState 同口径（已同步）。
const _RE_PARTIAL = /部分采纳|部分|Partially Accepted|partially|🔄/;
const _RE_DEPRECATED = /已废弃|废弃|Deprecated|deprecated|🧊/;
const _RE_SUPERSEDED = /已取代|取代|Superseded|superseded|❌/;
const _RE_ACCEPTED = /已采纳|采纳|Accepted|accepted|✅/;

/**
 * 状态归一化（check-adr-health 兼容入口）。
 * 返回 { key, raw }；key ∈ 'accepted'|'partial'|'deprecated'|'superseded'|'unknown'。
 */
export function normalizeState(raw: string): { key: string; raw: string } {
  if (!raw) return { key: 'unknown', raw: '(未标注状态)' };
  const s = raw.trim();
  // ❌ 行首优先：`❌ 已取代（xxx 决策废弃 xxx）` 中「决策废弃」是描述性正文，
  // 非状态标识，不能被 _RE_DEPRECATED 的「废弃」子串误抢（ADR-050 回归用例）
  if (/^❌/.test(s)) return { key: 'superseded', raw: s };
  if (/^🧊/.test(s)) return { key: 'deprecated', raw: s };
  if (_RE_PARTIAL.test(s)) return { key: 'partial', raw: s };
  if (_RE_DEPRECATED.test(s)) return { key: 'deprecated', raw: s };
  if (_RE_SUPERSEDED.test(s) && !_RE_ACCEPTED.test(s))
    return { key: 'superseded', raw: s };
  if (_RE_ACCEPTED.test(s)) return { key: 'accepted', raw: s };
  return { key: 'unknown', raw: s };
}

export const STATE_LABEL: Record<string, string> = {
  accepted: '✅ 已采纳',
  partial: '🔄 部分采纳',
  deprecated: '🧊 已废弃',
  superseded: '❌ 已取代',
  replaced: '❌ 已取代', // classifyStatus 返回 'replaced'（与 DISPLAY_GROUPS.key 对齐），normalizeState 返回 'superseded'
  unknown: '❓ 未知',
  unfixed: '⚠️ 已采纳（违规或未修复）',
};

// ── 规范索引分组（gen-docs-index 用）──
// 5 个索引桶 + unknown 兜底；顺序与 INDEX_GROUPS 常量同步。
export const DISPLAY_GROUPS = [
  { key: 'unfixed', label: '⚠️ 已采纳但遗留未修复', anchor: '已采纳但遗留未修复' },
  { key: 'partial', label: '🔄 部分采纳', anchor: '部分采纳' },
  { key: 'accepted', label: '✅ 已采纳', anchor: '已采纳' },
  { key: 'replaced', label: '❌ 已取代', anchor: '已取代' },
  { key: 'deprecated', label: '🧊 已废弃', anchor: '已废弃' },
  { key: 'unknown', label: '❓ 未归类', anchor: '未归类' },
];

/**
 * 状态 → 索引分组 key（唯一分类入口，供 gen-docs-index 分组表）。
 * 顺序敏感：unfixed 必须早于 accepted（含「违规未修复」的已采纳状态分流到 unfixed）。
 * 行首 emoji 优先：`❌ 已取代` → replaced，`🧊 已废弃` → deprecated，
 * 不受正文中「废弃/过时」等描述词干扰（ADR-050 回归用例）。
 */
export function classifyStatus(raw: string) {
  const s = raw.trim();
  // 行首 emoji 优先
  if (/^❌/.test(s)) return 'replaced';
  if (/^🧊/.test(s)) return 'deprecated';
  if (/^🔄/.test(s)) return 'partial';
  if (/^⚠️/.test(s)) return 'unfixed';
  const { key } = normalizeState(raw);
  if (key === 'accepted' && (/违规|不一致|未修复/.test(s)) && !/已修复/.test(s))
    return 'unfixed';
  if (key === 'accepted') return 'accepted';
  if (key === 'partial') return 'partial';
  if (key === 'deprecated') return 'deprecated';
  if (key === 'superseded') return 'replaced';
  if (key === 'unknown') return 'unknown';
  return 'unknown';
}

// ── 技术债关键词 ──
export const TECHNICAL_DEBT_KEYWORDS = [
  '已废弃', '已放弃', '已搁置', '搁置', '废弃',
  '待立项', '草案', '提案', 'Proposed',
  '规划中', '部分实现', '待推进',
  '已过时', '已淘汰', '已替换', '已取代',
  '违规', '不一致', '未修复',
];