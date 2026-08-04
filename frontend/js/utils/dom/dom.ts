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
  const s = esc(text);
  if (!query) return s;
  const lq = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(lq);
  if (idx === -1) return s;
  const before = esc(text.substring(0, idx));
  const match = esc(text.substring(idx, idx + query.length));
  const after = esc(text.substring(idx + query.length));
  return before + "<mark>" + match + "</mark>" + after;
}
