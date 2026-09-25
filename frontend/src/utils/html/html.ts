// ===== HTML 转义 / 搜索高亮（类型化版 — ADR-014 P2）=====

/** HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） */
export function esc(s: string | null | undefined): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 非字符串入参的转义适配（EscFn 形状 `(s: unknown) => string`）。
 *
 * 立因（2026-09 锐评收债）：诊断页的生产接线（`views/app-content/init-pages.ts` 的
 * `(s) => esc(s == null ? "" : String(s))`）与 14 处测试夹具各自手写同义实现，而夹具已
 * **分裂成三种转义表**（3 实体 / 4 实体 / 5 实体）——「测试绿」因而无法证明生产渲染正确
 * （`>` 与 `'` 在两版夹具里根本不转义）。收成此单点后，生产与夹具消费同一函数，
 * 转义表改动不可能再单向漂移。
 *
 * 与 `esc` 的唯一差别是**入参收窄**：`null/undefined → ""`、其余 `String(s)` 后走同一张表。
 */
export function escUnknown(s: unknown): string {
  return esc(s == null ? "" : String(s));
}

// ===== 搜索高亮（返回 HTML 字符串）=====

/**
 * 关键词高亮：转义 + <mark> 包裹全部命中段（全匹配，非仅首中）。
 * 此前仅高亮首次命中，搜索场景需要全匹配。
 *
 * 边界：空 query → 纯转义；Unicode 大小写折叠改变串长 → 降级纯转义；
 * 重叠匹配（query="aa", text="aaa"）→ 非重叠语义，与 String.prototype.match 一致。
 */
export function hl(text: string | null | undefined, query?: string): string {
  if (text == null) return "";
  if (!query) return esc(text);
  const lq = query.toLowerCase();
  const lowered = text.toLowerCase();
  // Unicode 大小写折叠可改变串长（如土耳其语 İ → "i̇" 2 码元）——
  // 折叠后的 idx 用于切片原始 text 会静默错切（空 mark 或截断）；
  // 查 text 侧而非 query 侧——İ 折叠发生在 text；query 如 "b" 折叠长度不变
  if (lowered.length !== text.length) return esc(text);

  let result = "";
  let cursor = 0;
  for (;;) {
    const matchIdx = lowered.indexOf(lq, cursor);
    if (matchIdx === -1) break;
    // 各片段分别从「原始 text」切片再各自 esc()，避免双重转义，
    // 且不能用已转义串按原始索引切（&lt; 等会错位，回归测试锁定）
    result += esc(text.substring(cursor, matchIdx));
    result += `<mark>${esc(text.substring(matchIdx, matchIdx + query.length))}</mark>`;
    cursor = matchIdx + query.length;
  }
  result += esc(text.substring(cursor));
  return result;
}
