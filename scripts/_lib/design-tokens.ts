/**
 * design-tokens.ts — 设计令牌守规判定纯函数层（scripts/_lib，2026-09 立）。
 *
 * 解决什么问题（为什么需要新闸）：
 *   `docs/UI-Design.md` 是项目唯一 UI 规范，明文规定「禁止硬编码 font-size / border-radius /
 *   内联 style / 硬编码颜色」。但规范**长期无机器守护**——实测（2026-09 全仓扫描）：
 *   - 内联 `style="..."`        471 处（views 域 445 处，其中 tpl-settings.ts 单文件 100 处）
 *   - 硬编码 `font-size: Npx`   222 处
 *   - 硬编码 `border-radius:Npx` 130 处
 *   而同一时刻 `var(--fs-*)` 325 处、`var(--radius-*)` 91 处**是正确写法的**。
 *   即：不是「体系没建立」，而是「体系与野路子并存」——一半代码守规、一半绕过。
 *   这比完全没规范更危险：切主题/改 --fs-scale 时出现「部分跟随、部分不跟随」的割裂，
 *   且因为无度量，没人知道债有多大（三子代理历次锐评均未发现，属横向统计盲区）。
 *
 * 本模块只做**纯判定**（零 IO、零顶层副作用），CLI 与测试共用：
 *   - parseTokenMap      : variables.css 文本 → 令牌名→值 映射（含 px 等价换算）
 *   - suggestToken       : 硬编码值 → 建议替换的令牌名（值相等才建议，不瞎猜）
 *   - findStyleAttrViolations : 单行文本 → 内联 style / 硬编码字号圆角命中
 *   - findEmojiIconViolations : 单行文本 → emoji 当图标命中
 *
 * 设计原则（三条都是踩过的坑）：
 *   1. **不误伤存量**：本层只「发现」，不含阻断——是否拦由 CLI 的 --strict/基线策略决定。
 *      仓库存量债巨大（471+222+130），一上来就 hard 会阻塞全体提交。
 *   2. **建议必须可信**：`suggestToken` 只在「令牌 px 值 == 硬编码值」时才给建议
 *      （如 6px→--radius-md、13px→--fs-md）。值不等时返回 null，宁可不说，不给错答案。
 *   3. **排除非 UI 代码**：注释行、测试文件、`coverage/` 构建产物、`upstream/` vendor
 *      一律不参与——否则噪声淹没真信号（见 isCommentLine / 各调用方过滤）。
 *
 * 依赖：零依赖（纯字符串处理；ROOT 等 IO 由调用方注入）。
 *
 * 用法：
 *   import { parseTokenMap, suggestToken, findStyleAttrViolations } from './_lib/design-tokens.ts';
 *
 * 退出码：本模块无独立 CLI（被 check-design-tokens.ts import）。
 */

import { suggestIconName } from "./icon-map.ts";

/** 违规种类（稳定标识，供 JSON 消费与基线 key）。 */
export type DesignViolationKind =
  | "inline-style-font-size"
  | "inline-style-radius"
  | "inline-style-color"
  | "css-font-size"
  | "css-radius"
  | "css-color"
  | "emoji-icon";

/** 单条命中。 */
export interface DesignViolation {
  kind: DesignViolationKind;
  /** 1-based 行号（调用方按行喂入时由 offset 提供；纯函数内不感知）。 */
  line: number;
  /** 命中的原始片段（截断展示，避免超长模板串刷屏）。 */
  snippet: string;
  /** 建议替换的令牌名（如 --fs-md）；无法可信建议时为 null。 */
  suggestion: string | null;
}

/** 令牌映射：令牌名 → 该令牌在**基准缩放**下的 px 数值（可换算时）。 */
export type TokenPxMap = Map<string, number>;

/** 令牌名 → 原始值文本（诊断展示用）。 */
export type TokenRawMap = Map<string, string>;

/**
 * 硬编码 px 值 → 令牌名 的候选表（值必须精确相等才建议）。
 *
 * 数据来源：`frontend/css/variables.css` 的 `--fs-*` / `--radius-*` 基准值注释
 * （如 `--fs-md: calc(var(--fs-base-size) + 1px + var(--fs-scale)); /* 13px @ 基准 *\/`）。
 * 之所以**硬编码此表**而非运行时解析 calc()：calc 表达式里 `--fs-scale` 是运行时变量，
 * 静态求值需要一套 CSS calc 解释器，收益为零——这里是「建议替换」不是「语义判定」，
 * 表与 variables.css 的一致性由 tests/test_design_tokens.ts 的契约用例锁定
 * （解析 variables.css 真实文本比对，漂移即测试红）。
 */
export const TOKEN_PX_BASELINE: Readonly<Record<string, number>> = {
  // 基础字号（--fs-base-size: 12px 为基准）
  "--fs-tiny": 7,
  "--fs-xs": 10,
  "--fs-sm": 11,
  "--fs-base": 12,
  "--fs-md": 13,
  "--fs-lg": 14,
  "--fs-xl": 24,
  // 语义字号
  "--fs-nav": 13,
  "--fs-tab": 12,
  "--fs-filter": 11,
  "--fs-btn-primary": 12,
  "--fs-btn-secondary": 11,
  "--fs-btn-tool": 10,
  // 圆角
  "--radius-xs": 3,
  "--radius-sm": 4,
  "--radius-md": 6,
  "--radius-lg": 8,
  "--radius-xl": 10,
  "--radius-pill": 20,
};

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
 * 是否为注释行（`//` 或块注释续行 `*`）。注释里的样式示例不算违规——
 * 实测全仓仅 1 处 `font-size:Npx` 落在注释里，但口径必须一开始就对，
 * 否则文档性注释会被反复误报。
 */
export function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 截断 snippet 到合理长度（模板串可能极长，全量输出会淹没终端）。 */
function clip(s: string, max = 120): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

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

  let text = apply(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g, "font-size");
  text = text.replace(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/g, (match, px: string, offset: number) => {
    if (inVar(offset)) return match;
    const token = suggestToken(Number(px), "border-radius", tokenMap);
    if (!token) return match;
    const to = `border-radius:var(${token})`;
    edits.push({ from: match, to, count: 1 });
    return to;
  });

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

/**
 * 扫描单行文本中的设计令牌违规。
 *
 * 覆盖四类（**均对应 UI-Design.md 明文规则**，不自造规则）：
 *   ① font-size:Npx（内联或 CSS 块）→ 违反「禁止硬编码 font-size: Npx」
 *   ② border-radius:Npx（内联或 CSS 块）→ 违反「禁止硬编码 border-radius: Npx」
 *   ③ 内联 style 里的硬编码颜色（#rrggbb / rgb() / rgba() 字面量）
 *      → 违反「永远不做 color: #cdd6f4 之类的硬编码」
 *   ④ emoji 当图标（见 findEmojiIconViolations）
 *
 * ⚠️ **不报告「合法的内联 style」**：UI-Design.md 仅在「艺术字体」场景明文禁止内联
 * style（§4 规则「创作者名字…禁止内联 style」），并未全仓禁用内联 style。曾经设计过
 * 一个 `inline-style-other` 类别把「一切内联」都算违规——那是**自造规则**，会把
 * `style="display:flex"` 这类合规布局判成债，用噪声淹没真信号。故只报「内联里
 * 确实违反明文令牌规则」的那些（字号/圆角/颜色硬编码）。
 *
 * @param line      单行文本（已归一化）
 * @param lineNo    1-based 行号（回填到结果）
 * @param tokenMap  令牌映射（供 suggestToken 校验存在性）；可空
 */
export function findStyleAttrViolations(
  line: string,
  lineNo: number,
  tokenMap?: TokenRawMap | null,
): DesignViolation[] {
  if (isCommentLine(line)) return [];
  const out: DesignViolation[] = [];

  // ── 提取内联 style 属性体，用于颜色判定（字号/圆角不区分内外，见下）──
  const styleRe = /\bstyle\s*=\s*(["'])((?:(?!\1).)*)\1/g;
  const inlineBodies: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(line)) !== null) inlineBodies.push(sm[2] ?? "");

  // ① font-size:Npx —— 内联与 CSS 块统一判定（规范对两者同等禁止）
  const fsRe = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;
  let fm: RegExpExecArray | null;
  while ((fm = fsRe.exec(line)) !== null) {
    const px = Number(fm[1]);
    out.push({
      kind: inlineBodies.some((b) => b.includes(fm![0]))
        ? "inline-style-font-size"
        : "css-font-size",
      line: lineNo,
      snippet: clip(line),
      suggestion: suggestToken(px, "font-size", tokenMap),
    });
  }

  // ② border-radius:Npx
  const brRe = /border-radius\s*:\s*(\d+(?:\.\d+)?)px/g;
  let bm: RegExpExecArray | null;
  while ((bm = brRe.exec(line)) !== null) {
    const px = Number(bm[1]);
    out.push({
      kind: inlineBodies.some((b) => b.includes(bm![0])) ? "inline-style-radius" : "css-radius",
      line: lineNo,
      snippet: clip(line),
      suggestion: suggestToken(px, "border-radius", tokenMap),
    });
  }

  // ③ 硬编码颜色（内联 style 与 CSS 块**同等对待**）
  //
  //    曾只收内联面，理由是「CSS 块的颜色由主题体系管」——但实测该理由不成立：
  //    同一处违规写在内联里会被报、写在 CSS 块里（`.x { color:#f00 }`）就完全隐形，
  //    判定随「写法位置」漂移，是自相矛盾的口径（探针实测确认）。
  //
  //    范围收紧以防噪声（这两条是刻意的，不是遗漏）：
  //      - 只认**颜色属性**（color / background / border-color 等），不认
  //        `box-shadow: 0 1px 3px rgba(0,0,0,.06)` 这类阴影/遮罩里的中性值
  //        ——它们在深色浅色主题下都用同一低透明黑，属合理写法，报了是噪声。
  //      - 跳过中性色（#000/#fff/纯 rgba 黑白）：这些跨主题通用，令牌化收益低。
  const COLOR_PROP = "(?:color|background|background-color|border-color|fill|stroke)";
  // 注意：COLOR_PROP 是非捕获组，故颜色值是**第 1 组**（曾误读 cm[2] → 恒 undefined →
  // 颜色违规全被 continue 吞掉，探针实测发现）。
  const COLOR_VAL = "(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\))";
  for (const body of inlineBodies) {
    const re = new RegExp(`${COLOR_PROP}\\s*:\\s*${COLOR_VAL}`, "g");
    let cm: RegExpExecArray | null;
    while ((cm = re.exec(body)) !== null) {
      if (!cm[1] || isNeutralColor(cm[1])) continue;
      out.push({
        kind: "inline-style-color",
        line: lineNo,
        snippet: clip(`style="${body}"`),
        suggestion: null,
      });
    }
  }

  // CSS 块面：去除内联 style 体后剩下的文本（避免与上面重复计数）
  let rest = line;
  for (const body of inlineBodies) rest = rest.replace(body, "");
  const cssColorRe = new RegExp(`${COLOR_PROP}\\s*:\\s*${COLOR_VAL}`, "g");
  let ccm: RegExpExecArray | null;
  while ((ccm = cssColorRe.exec(rest)) !== null) {
    if (!ccm[1] || isNeutralColor(ccm[1])) continue;
    out.push({
      kind: "css-color",
      line: lineNo,
      snippet: clip(rest),
      suggestion: null,
    });
  }

  return out;
}

/**
 * 中性色判定：纯黑/纯白及其透明变体。这类值在深色与浅色主题下都用同一个值
 * （如遮罩 `rgba(0,0,0,.5)`、描边 `#fff`），令牌化收益低，计入会形成噪声。
 * 有彩色（带 RGB 分量差）或品牌色一律不算中性。
 */
export function isNeutralColor(v: string): boolean {
  const s = v.trim().toLowerCase();
  // 十六进制：#000 / #000000 / #fff / #ffffff（含 4/8 位带 alpha 形态）
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex?.[1]) {
    const h = hex[1];
    const rgb = h.length >= 6 ? [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)] : h.slice(0, 3).split("");
    const vals = rgb.map((x) => (x.length === 1 ? Number.parseInt(x + x, 16) : Number.parseInt(x, 16)));
    return vals.every((x) => x === 0 || x === 255);
  }
  // rgb()/rgba()：三通道全 0 或全 255 视为中性（忽略 alpha）
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  if (fn?.[1]) {
    const parts = fn[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((x) => Number.parseFloat(x));
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) {
      return parts.every((x) => x === 0 || x === 255);
    }
  }
  return false;
}

/**
 * emoji 当图标检测。
 *
 * 背景：主导航等位置大面积用 emoji 充当图标（实测 `tpl.ts` 29 处、`tpl-oldest.ts` 10 处），
 * 而仓库自身有 `utils/icon/icon.ts` + SVG 体系（20 处 `<svg>`）。后果具体：
 *   ① 跨平台渲染不一致（WebView2 / Android WebView / 浏览器三套 emoji 字体）；
 *   ② emoji 自带颜色，**不受主题控制**（切主题时图标不变，破坏一致性）；
 *   ③ 不参与 `--fs-scale` 缩放（emoji 随字体渲染但尺寸不可控）。
 *
 * 判定口径（收紧以防误报）：
 *   - 只在**模板/HTML 上下文**里统计：行内需含 `class="` 或 `<button` / `<div` / `<span`
 *     等标签特征——纯逻辑字符串（如日志文案 "❌ 失败"）不算 UI 图标。
 *   - 排除 `esc()` / `t()` 的 i18n 文案里的 emoji？不做——文案里的 emoji 同样是
 *     不受控图标，但阈值放宽：本函数只报「标签内容起始处的 emoji」（`>😀` 或
 *     `"😀 ' +` 形态），即典型的「图标位」。
 *
 * @param line 单行文本
 * @param lineNo 1-based 行号
 */
export function findEmojiIconViolations(line: string, lineNo: number): DesignViolation[] {
  if (isCommentLine(line)) return [];
  // 模板/HTML 上下文门槛：无标签特征的行不参与（防日志文案误报）
  if (!/class\s*=|<\w+|data-testid/.test(line)) return [];
  const out: DesignViolation[] = [];
  // 图标位形态（两种都覆盖）：
  //   ① HTML 内容起始：`>📁`
  //   ② 模板串里的图标前缀：`>📁 ' +` / `'📁 ' +` / `"🎮 "`
  //      ——这是本仓**最常见**的形态（tpl.ts 的 repo-tab 全是 `>📁 ' + t("...")`）。
  //      曾只认「引号后紧跟 emoji」，漏掉 emoji 后带空格再闭合引号的写法（`>📁 ' +`），
  //      造成整类真阳性漏报——由探针实测发现。
  //
  // 关于 `\uFE0F`（变体选择符）与 ZWJ：它们是**组合字符**，写进 `+` 字符类会让正则
  // 语义模糊（biome noMisleadingCharacterClass 实测告警），且会把 `♻️` 匹配成孤立的
  // `♻`（丢失变体，显示成与源码不同的字形）。改为「图形字符 + 尾部组合符*」序列。
  const GRAPHIC = "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2190}-\\u{21FF}]";
  const COMBINING = "[\\u{FE0F}\\u{200D}]";
  const re = new RegExp(
    `(?:>|["'\`])\\s?(${GRAPHIC}${COMBINING}*(?:${GRAPHIC}${COMBINING}*)*)(?=\\s*["'\`]|\\s*<|\\s|$)`,
    "gu",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const glyph = m[1] ?? "";
    if (!glyph) continue;
    // ADR-238 D4：附**建议图标名**（如 ⚠️ → UI_ICONS.warning），使 emoji 债从
    // 「一堆字形」变成「按语义名可机械收敛的清单」——与令牌债的 `13px → var(--fs-md)`
    // 建议同构。未收录的字形返回 null（宁可不建议，也不猜错语义）。
    const iconName = suggestIconName(glyph);
    out.push({
      kind: "emoji-icon",
      line: lineNo,
      snippet: clip(glyph),
      suggestion: iconName ? `UI_ICONS.${iconName}` : null,
    });
  }
  return out;
}
