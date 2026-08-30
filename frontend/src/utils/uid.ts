// ===== 唯一 id 生成器（单一事实源）=====
// 从 ui-advanced-rows 抽出的公共工具：替换 `Math.random().toString(36).slice(...)`——
// 非确定性 id 导致测试无法稳定定位、快照不稳定（jscpd/ADR-005 同源治理）。
// 优先 crypto.randomUUID（WebView2 原生、格式标准）；环境不支持时回退计数器
// （jsdom/旧内核），保证任何环境都有稳定且唯一的 id。

/** 回退计数器（crypto.randomUUID 不可用时；模块级自增保证会话内唯一） */
let fallbackSeq = 0;

/**
 * 生成唯一 id。
 * @param prefix 可选前缀（便于 DOM 中辨识来源，如 "vec3-"）
 */
export function uid(prefix = ""): string {
  const rnd =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `uid-${Date.now().toString(36)}-${(fallbackSeq++).toString(36)}`;
  return prefix ? `${prefix}${rnd}` : rnd;
}
