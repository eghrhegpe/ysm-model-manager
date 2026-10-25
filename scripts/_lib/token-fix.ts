/**
 * token-fix.ts — **自动令牌化**与 UI-Design 文档漂移判定（2026-10-25 沿真缝拆出）。
 *
 * 内容：fixLineTokens（单行等价替换，只动「有精确建议」的声明）与
 * checkLayoutDocDrift（文档记载值 vs 代码 fallback 的漂移项）。
 * 与 token-style.ts 的分工：本模块**写**（产出替换文本），style 只**判**。
 *
 * 依赖：./token-types.ts / ./token-glyph.ts / ./token-style.ts（属性正则原语）/
 *       ./token-suggest.ts / ./token-transition.ts / ./token-tables.ts。
 */
import { clip, isCommentLine } from "./token-glyph.ts";
import { propDeclRe, propValueRe } from "./token-style.ts";
import { suggestPaddingToken, suggestShadowToken, suggestToken } from "./token-suggest.ts";
import { COMBO_PADDING_TOKENS } from "./token-tables.ts";
import { suggestTransitionTokenExact } from "./token-transition.ts";
import type { TokenRawMap } from "./token-types.ts";

/** UI-Design.md 文档与代码的数值漂移项。 */
export interface DocDrift {
  /** 漂移主题（如 "preview-width"），供分组展示。 */
  topic: string;
  /** 该主题在文档中出现的所有数值（去重，保持出现顺序）。 */
  docValues: string[];
  /** 代码中的权威数值（从 `var(--x, <fallback>)` 的 fallback 取）。 */
  codeValue: string | null;
  /** 人类可读说明。 */
  detail: string;
}

/** 单次修复的记账条目。 */
export interface FixEdit {
  /** 被替换的原文（如 `font-size:13px`）。 */
  from: string;
  /** 替换后的文本（如 `font-size:var(--fs-md)`）。 */
  to: string;
  /** 该行修复了几处。 */
  count: number;
}

/**
 * 把一行里的「硬编码字号/圆角」替换为令牌引用（纯函数，供 --fix 与测试共用）。
 *
 * **只处理有精确令牌对应的声明**（`suggestToken` 返回非 null），其余原样保留——
 * 这一步是「机械等价替换」而非「语义重写」：
 *   - 值等价：`--fs-scale: 0px` 时 `var(--fs-md)` 渲染即 13px，视觉零变化；
 *   - 额外收益：此后跟随 `--fs-scale`（无障碍字号缩放）与主题。
 *
 * 不碰颜色：颜色令牌（`--status-error` 等）是**语义**映射（`#ff7b7b` 到底该是
 * error 还是别的，机器判不了），猜测替换属于「给错答案」，一律留给人工。
 *
 * 实现要点（安全第一）：
 *   - 用 `replace` 回调而非全局状态，逐处独立判定，避免正则 lastIndex 串扰；
 *   - **跳过已在 `var(...)` 内的值**：`font-size:var(--x,12px)` 的 fallback 不是
 *     违规（它本就是令牌形态），替换会破坏语义；
 *   - 同一行多处独立替换（`font-size:13px;border-radius:6px` 各改各的）。
 *
 * @returns { text, edits } —— text 为替换后文本（无改动则恒等于入参）；edits 为记账
 */
export function fixLineTokens(
  line: string,
  tokenMap?: TokenRawMap | null,
): { text: string; edits: FixEdit[] } {
  if (isCommentLine(line)) return { text: line, edits: [] };
  const edits: FixEdit[] = [];

  // 跳过已包裹在 var(...) 里的片段：先记录所有 var(...) 区间，落在区间内的不替换。
  const varSpans: Array<[number, number]> = [];
  for (const m of line.matchAll(/var\([^)]*\)/g)) {
    if (m.index !== undefined) varSpans.push([m.index, m.index + m[0].length]);
  }
  const inVar = (idx: number) => varSpans.some(([a, b]) => idx >= a && idx < b);

  const apply = (re: RegExp, prop: string): string =>
    line.replace(re, (match, px: string, offset: number) => {
      if (inVar(offset)) return match;
      const token = suggestToken(Number(px), prop, tokenMap);
      if (!token) return match;
      const to = `${prop}:var(${token})`;
      edits.push({ from: match, to, count: 1 });
      return to;
    });

  let text = apply(propDeclRe("font-size"), "font-size");
  text = text.replace(propDeclRe("border-radius"), (match, px: string, offset: number) => {
    if (inVar(offset)) return match;
    const token = suggestToken(Number(px), "border-radius", tokenMap);
    if (!token) return match;
    const to = `border-radius:var(${token})`;
    edits.push({ from: match, to, count: 1 });
    return to;
  });

  // box-shadow：值等价替换（归一化后与令牌完全同值才替换，故视觉零变化）。
  text = text.replace(propValueRe("box-shadow"), (match, val: string, offset: number) => {
    if (inVar(offset)) return match;
    const v = val.trim();
    const token = suggestShadowToken(v, tokenMap);
    if (!token) return match;
    const to = `box-shadow:var(${token})`;
    edits.push({ from: match, to, count: 1 });
    return to;
  });

  // transition：**仅在时长与缓动双双与令牌一致时**整值替换（见 suggestTransitionTokenExact
  // 的三条安全前提）。多属性值（`background .12s, color .12s`）、缓动不匹配
  // （`transform .25s ease` vs --tr-enter 的 ease-out）、无对应令牌（0.2s/0.06s）一律不碰——
  // 这些由报告层提示、人工判断「是对齐令牌还是令牌该加档」。
  text = text.replace(propValueRe("transition"), (match, val: string, offset: number) => {
    if (inVar(offset)) return match;
    const token = suggestTransitionTokenExact(val.trim(), tokenMap);
    if (!token) return match;
    const to = `transition:var(${token})`;
    edits.push({ from: match, to, count: 1 });
    return to;
  });

  // padding：单值（padding: Npx）且垂直档 ≤2px 替换；组合值**精确命中组合档表**
  // （ADR-295 COMBO_PADDING_TOKENS）时替换（值等价）。其余组合/calc/var 不碰
  // （横向语义是作者裁量，机械就近会给错答案）。排除 padding-block/padding-inline 子属性。
  text = text.replace(
    /(?<![\w-])padding(?![-a-z])\s*:\s*([^;"'`}]+)/g,
    (match, val: string, offset: number) => {
      if (inVar(offset)) return match;
      const v = val.trim();
      if (!/^\d+(?:\.\d+)?px$/.test(v) && !COMBO_PADDING_TOKENS[v]) return match; // 仅单值 px 或组合档命中
      const token = suggestPaddingToken(v, tokenMap);
      if (!token) return match;
      const to = `padding:var(${token})`;
      edits.push({ from: match, to, count: 1 });
      return to;
    },
  );

  return { text, edits };
}

/**
 * 校验 UI-Design.md 中记录的布局数值与代码实际值是否一致。
 *
 * 为什么需要：`docs/UI-Design.md` 自称「唯一规范」，但规范里的数值靠人手抄——
 * 实测漂移（2026-09）：`--preview-width` 在 **同一节内** 出现两个不同值
 * （布局图写 240px、CSS 示例写 200px），而代码实际是 `var(--preview-width,220px)`
 * ——**三处三个数**。数值漂移不会让构建失败、不会被 typecheck 发现，只会让人
 * 按错的尺寸做设计。这是「文档即规范」类项目的固有风险，必须机器对账。
 *
 * 判定口径（收紧以防误报）：
 *   - 只对**已在代码中有权威 fallback** 的令牌做对账（当前 = --preview-width）；
 *   - 文档中同一令牌出现多值 → 内部即矛盾，直接报漂移；
 *   - 文档值与代码 fallback 不等 → 报漂移；
 *   - 找不到该令牌的文档记载 → 不报（可能已改写表达方式，由人工确认）。
 *
 * @param docText      UI-Design.md 全文
 * @param codeFallback 代码中的权威值（如 "220px"）；null = 未取到，跳过该项
 */
export function checkLayoutDocDrift(docText: string, codeFallback: string | null): DocDrift[] {
  const out: DocDrift[] = [];
  // ① 显式令牌形态：`var(--preview-width, Npx)`
  const explicit = [...docText.matchAll(/--preview-width\s*,\s*(\d+px)/g)].map((m) => m[1]!);
  // ② 布局三栏图形态：图里数字与 "preview" **不在同一行**（ASCII 表头一行、数值一行），
  //    故不能用「同行包含 preview」判定。正确做法 = **按列对齐**：找到表头行里
  //    "preview" 的字符列位，再去下一行的同一列位取数字。
  //    （曾用「取下一行所有数字」，把 sidebar 的 300px 也误算成 preview 值 → 假阳性。
  //     这类误报会让人不信任闸门，必须按列精确取。）
  const lines = docText.split("\n");
  const diagram: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i] ?? "";
    const hm = /preview/i.exec(header);
    if (!hm) continue;
    const next = lines[i + 1] ?? "";
    // 下一行须是同一张表的值行（含 px / 1fr 且含竖线分隔）
    if (!/[│|]/.test(next) || !/(px|1fr)/.test(next)) continue;
    // 按列取：以竖线切分列，找到 preview 所在列序号，取下一行同列值
    const cols = (s: string) => s.split(/[│|]/);
    const hCols = cols(header);
    const vCols = cols(next);
    const idx = hCols.findIndex((c) => /preview/i.test(c));
    if (idx < 0) continue;
    const cell = (vCols[idx] ?? "").trim();
    const vm = /^(\d+px)$/.exec(cell);
    if (vm) diagram.push(vm[1]!);
  }
  const docValues = [...new Set([...explicit, ...diagram])];

  if (docValues.length === 0) return out;

  if (docValues.length > 1) {
    out.push({
      topic: "--preview-width",
      docValues,
      codeValue: codeFallback,
      detail: `文档内自相矛盾：同一令牌出现多个值 ${docValues.join(" / ")}`,
    });
    return out;
  }
  if (codeFallback && docValues[0] !== codeFallback) {
    out.push({
      topic: "--preview-width",
      docValues,
      codeValue: codeFallback,
      detail: `文档记载 ${docValues[0]}，代码 fallback 为 ${codeFallback}`,
    });
  }
  return out;
}
