// ===== HTML 转义 / 搜索高亮（类型化版 — ADR-014 P2）=====

/** HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） */
export function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 搜索高亮（返回 HTML 字符串）=====

/** 关键词高亮：转义 + <mark> 包裹命中段 */
export function hl(text: string, query?: string): string {
  if (!query) return esc(text);
  const lq = query.toLowerCase();
  const lowered = text.toLowerCase();
  const idx = lowered.indexOf(lq);
  if (idx === -1) return esc(text);
  // P3 修复：Unicode 大小写折叠可改变串长（如土耳其语 İ → "i̇" 2 码元）——
  // 折叠后的 idx 用于切片原始 text 会静默错切（空 mark 或截断）；
  // text 折叠后长度变化时降级为纯转义，防错位（查 text 侧而非 query 侧——
  // İ 折叠发生在 text；query 如 "b" 折叠长度不变）
  if (lowered.length !== text.length) return esc(text);
  // 三个片段分别从「原始 text」切片再各自 esc()，避免双重转义，
  // 且不能用已转义串按原始索引切（&lt; 等会错位，回归测试锁定）
  const before = esc(text.substring(0, idx));
  const match = esc(text.substring(idx, idx + query.length));
  const after = esc(text.substring(idx + query.length));
  return before + "<mark>" + match + "</mark>" + after;
}
