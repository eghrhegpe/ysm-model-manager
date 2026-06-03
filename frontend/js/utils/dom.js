// ===== HTML 转义 =====
export function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ===== 搜索高亮（返回 HTML 字符串） =====
export function hl(text, query) {
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
