/**
 * token-suggest.ts — 硬编码值 → 令牌名**建议器**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 设计原则（原注释保留在各函数上方）：只在「值与令牌精确相等」时才给建议，
 * 宁可不说也不给错答案；组合值/多属性一律返回 null。
 *
 * 依赖：./token-tables.ts（值表）/ ./token-types.ts（映射类型）。
 */
import { COMBO_PADDING_TOKENS, PAD_TOKEN_VERTICAL, SHADOW_TOKEN_VALUES, SP_FLOOR_PX, SP_TOKEN_VERTICAL, TOKEN_PX_BASELINE, TRANSITION_TOKEN_DURATIONS } from "./token-tables.ts";
import type { TokenRawMap } from "./token-types.ts";

/**
 * 取最近间距档令牌名（**就近归档**，距离 ≤2px 才建议；孤品返回 null）。
 * 优先 [--sp-*]（内容间距默认语义），次选 [--pad-*]（按钮/标签垂直档）。
 *
 * [ADR-295 附则] **低于 §5 层级1（4px）的值不推 [--sp-***：§5 间距层级从 4px 起步
 * （层级1 = 4px），1–3px 属**按钮/标签垂直档领地**（--pad-* 的 3px 是按钮最小档）。
 * 反例（本规则立前实测）：`padding:2px` 距 [--sp-1](4px) 差 2px、距 [--pad-btn-tool](3px)
 * 差 1px，却因「[--sp-*] 优先」压过更近的按钮档 → 建议 +2px 位移的内容间距档，
 * 语义与位移双错。故 px < 4 时跳过 [--sp-*] 候选，只留 [--pad-*]。
 */
export function nearestPadToken(px: number, tokenMap?: TokenRawMap | null): string | null {
  // [ADR-295 附则] §5 层级1 起点 4px；低于它属按钮垂直档领地，[--sp-*] 不参与
  const belowSpFloor = px < SP_FLOOR_PX;
  // ① 精确命中：--sp-* 优先（内容间距默认），--pad-* 次之
  if (!belowSpFloor) {
    for (const [name, v] of Object.entries(SP_TOKEN_VERTICAL)) {
      if (tokenMap && !tokenMap.has(name)) continue;
      if (v === px) return name;
    }
  }
  for (const [name, v] of Object.entries(PAD_TOKEN_VERTICAL)) {
    if (tokenMap && !tokenMap.has(name)) continue;
    if (v === px) return name;
  }
  // ② 非精确：收集 ≤2px 候选，按「--sp-* 优先 → 距离近」排序
  const cands: Array<{ name: string; dist: number; priority: number }> = [];
  if (!belowSpFloor) {
    for (const [name, v] of Object.entries(SP_TOKEN_VERTICAL)) {
      if (tokenMap && !tokenMap.has(name)) continue;
      const dist = Math.abs(v - px);
      if (dist <= 2) cands.push({ name, dist, priority: 2 });
    }
  }
  for (const [name, v] of Object.entries(PAD_TOKEN_VERTICAL)) {
    if (tokenMap && !tokenMap.has(name)) continue;
    const dist = Math.abs(v - px);
    if (dist <= 2) cands.push({ name, dist, priority: 1 });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.priority - a.priority || a.dist - b.dist);
  return cands[0]!.name;
}

/**
 * padding 组合值 → 建议令牌名。单值走就近垂直档；组合值走 [COMBO_PADDING_TOKENS]
 * **精确命中**（ADR-295）。
 *
 * 安全边界（防给错答案）：
 *   - 非 px 分量（calc/var/auto/百分比/inherit）→ null；
 *   - 组合值（2/3/4 分量）→ 仅当 [COMBO_PADDING_TOKENS] **精确命中**时给建议；
 *     不在表中的组合值 → null（横向语义是作者裁量，机械就近会给错答案）；
 *   - 孤品（单值但无 ≤2px 的垂直档）→ null。
 */
export function suggestPaddingToken(value: string, tokenMap?: TokenRawMap | null): string | null {
  const v = value.trim().replace(/\s+/g, " ");
  const parts = v.split(" ").filter(Boolean);
  if (parts.length !== 1) {
    // 组合值：精确命中组合档表（值等价）才建议；tokenMap 存在时也须该令牌已定义
    const hit = COMBO_PADDING_TOKENS[v];
    if (!hit) return null;
    if (tokenMap && !tokenMap.has(hit.token)) return null;
    return hit.token;
  }
  const single = parts[0];
  if (single === undefined) return null;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(single);
  if (!m) return null; // 0 / calc / var / 百分比不猜
  return nearestPadToken(Number(m[1]), tokenMap);
}

/**
 * 从 variables.css 文本解析 `--name: value;` 声明。
 *
 * 只做**朴素声明扫描**（不实现完整 CSS 解析器）：匹配行内的 `--x: y;`。
 * 多行 calc()（如 `--fs-btn-primary: calc(\n 12px + var(--fs-scale)\n);`）的值会
 * 跨行截断——但那些令牌的 px 值来自 TOKEN_PX_BASELINE 表，此处仅需「令牌存在性」，
 * 故截断无害（存在性判定只看名字，不看值）。
 *
 * @param cssText variables.css 全文（调用方已归一化 CRLF）
 * @returns 令牌名 → 原始值（截断到首个 `;` 或行尾）
 */
export function parseTokenMap(cssText: string): TokenRawMap {
  const map: TokenRawMap = new Map();
  for (const rawLine of cssText.split("\n")) {
    // 去掉行注释后再匹配，避免注释里的 `--x: 1px` 混入
    const line = rawLine.replace(/\/\*.*?\*\//g, "");
    const m = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]*)/.exec(line);
    if (m?.[1]) map.set(m[1], (m[2] ?? "").trim());
  }
  return map;
}

/**
 * 硬编码 px 值 → 建议令牌名（**值精确相等才建议**，否则 null）。
 *
 * 语义要点：这是本脚本最有价值也最容易出错的地方——建议错了比不建议更糟
 * （用户会盲信建议去替换）。故只认精确相等，且多个令牌等值时按 TOKEN_PX_BASELINE
 * 声明顺序取首个（表把基础字号排在语义字号前，倾向建议通用令牌）。
 *
 * @param px       硬编码数值（不含单位）
 * @param prop     CSS 属性名（font-size → 只在字号表里找；border-radius → 只在圆角表里找）
 * @param tokenMap 已解析的令牌映射（用于校验建议的令牌**真实存在**，防表里有、css 里无）
 */
export function suggestToken(
  px: number,
  prop: string,
  tokenMap?: TokenRawMap | null,
): string | null {
  const isFont = /font-size/.test(prop);
  const isRadius = /border-radius/.test(prop);
  if (!isFont && !isRadius) return null;
  for (const [name, value] of Object.entries(TOKEN_PX_BASELINE)) {
    const nameIsFont = name.startsWith("--fs-");
    const nameIsRadius = name.startsWith("--radius-");
    if (isFont && !nameIsFont) continue;
    if (isRadius && !nameIsRadius) continue;
    if (value !== px) continue;
    // 令牌必须真实存在于 variables.css（防 TOKEN_PX_BASELINE 表漂移成第二事实源）
    if (tokenMap && !tokenMap.has(name)) continue;
    return name;
  }
  return null;
}

/**
 * 阴影值归一化（供 box-shadow 与令牌精确比对）。
 *
 * 归一的只是**书写形态**，不含任何数值近似：
 *   - 空白收敛：`0  1px   3px` → `0 1px 3px`
 *   - 逗号后补空格：`rgba(0,0,0,.25)` → `rgba(0, 0, 0, .25)`
 *   - alpha 前导零补齐：`.25` → `0.25`
 * 归一后仍不相等者一律**不报**（见 SHADOW_TOKEN_VALUES 的注释：非令牌阴影是设计意图）。
 */
export function normalizeShadowValue(v: string): string {
  return v
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*\.(\d)/g, ", 0.$1")
    .replace(/\(\.(\d)/g, "(0.$1")
    .toLowerCase();
}

/**
 * 硬编码阴影值 → 建议令牌名（**归一化后精确相等才建议**，否则 null）。
 *
 * 与 `suggestToken` 同一哲学：建议错了比不建议更糟。故只认「与某 `--shadow-*`
 * 完全同值」的写法，且要求该令牌真实存在于 variables.css。
 */
export function suggestShadowToken(value: string, tokenMap?: TokenRawMap | null): string | null {
  const norm = normalizeShadowValue(value);
  for (const [name, tokVal] of Object.entries(SHADOW_TOKEN_VALUES)) {
    if (normalizeShadowValue(tokVal) !== norm) continue;
    if (tokenMap && !tokenMap.has(name)) continue;
    return name;
  }
  return null;
}

/**
 * 硬编码 transition 值 → 建议令牌名（**时长分量与某令牌相等才建议**，否则 null）。
 *
 * 命中即返回该令牌；一条 transition 里多处时长等值只报一次（由调用方去重）。
 */
export function suggestTransitionToken(
  value: string,
  tokenMap?: TokenRawMap | null,
): string | null {
  // 取所有时长分量：0.12s / .12s / 120ms
  for (const m of value.matchAll(/(\d*\.?\d+)(s|ms)\b/g)) {
    const raw = Number(m[1]);
    const secs = m[2] === "ms" ? raw / 1000 : raw;
    for (const [name, dur] of Object.entries(TRANSITION_TOKEN_DURATIONS)) {
      if (Math.abs(dur - secs) > 1e-6) continue;
      if (tokenMap && !tokenMap.has(name)) continue;
      return name;
    }
  }
  return null;
}
