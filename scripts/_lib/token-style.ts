/**
 * token-style.ts — 内联 style / CSS 块**硬编码判定**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 覆盖六类：font-size / border-radius / color / box-shadow / transition / padding，
 * 外加中性色豁免（isNeutralColor）与属性声明正则原语（propDeclRe / propValueRe /
 * splitTopLevelCommas —— 后者供 token-fix.ts 的自动令牌化复用）。
 *
 * 本模块只**判**不写；写（产出替换文本）在 token-fix.ts。
 *
 * 依赖：./token-types.ts / ./token-glyph.ts / ./token-suggest.ts / ./token-transition.ts。
 */
import { clip, isCommentLine } from "./token-glyph.ts";
import { suggestPaddingToken, suggestShadowToken, suggestToken } from "./token-suggest.ts";
import {
  hasCustomEasing,
  isRealtimeFeedbackTransition,
  suggestTransitionTokenExact,
  TR_EXEMPT_MARKER,
} from "./token-transition.ts";
import type { DesignViolation, TokenRawMap } from "./token-types.ts";

/**
 * 「真实 CSS 属性声明」正则工厂——**必须带属性名左边界**。
 *
 * 为什么需要（2026-09 实测踩坑）：朴素写法 `font-size\s*:\s*(\d+)px` 会匹配到
 * **自定义属性名以该串结尾**的声明：
 *     `--uih-section-title-font-size: 11px;`   ← 被误判成 font-size 属性
 *     `--foo-border-radius: 6px;`              ← 被误判成 border-radius 属性
 * 后果分两层：① 报告层假阳性（把令牌定义当违规）；② **--fix 层会真的改写令牌定义**
 *     `--uih-section-title-font-size: 11px` → `--uih-section-title-font-size:var(--fs-sm)`
 * 而 `--uih-*` 前缀的存在意义（见 components-styles.ts 头注）正是**隔离于 ysm 全局
 * 主题令牌**，被改写即破坏该隔离——这是「自动修复」造成的静默语义损坏，比不修更糟。
 * （实测该 bug 已在 components-styles.ts 上真实触发过一次。）
 *
 * 边界口径：属性名左侧不得是标识符字符或 `-`（用 `(?<![\w-])`），
 * 这样 `--x-font-size:` 里 `font-size` 左侧是 `-` → 不匹配；
 * 而 `.a{font-size:` / `;font-size:` / `{ font-size:` 左侧是 `{;` 或空白 → 匹配。
 */
export function propDeclRe(prop: string): RegExp {
  return new RegExp(`(?<![\\w-])${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "g");
}

/**
 * 「任意 CSS 属性值」提取正则工厂（值到 `;` / 引号 / **`}`** / 反引号 为止）。
 *
 * ⚠️ 停止符必须含 `}`（2026-09 实测踩坑）：本仓样式多为**压缩成单行的模板串**
 * （`...;transition:background .12s ease}`），漏掉 `}` 会让值尾带上规则块闭合括号，
 * 于是精确比对（shadow/transition 的整值等价判定）恒不匹配——**闸静默漏报**：
 * 实测 fab.ts / tooltip.ts / app-preview/css.ts 共 6 处可修的 transition
 * 因此被 `--fix` 跳过，且报告层也照样命中（因为报告只看时长子串，不看结尾）。
 * 这类「报告能命中、修复却不生效」的不对称最难察觉，故抽成单一出口。
 *
 * ⚠️ 左边界同 `propDeclRe`（2026-09 补）：无边界时 `--uih-collapsible-panel-transition:`
 * 这类**自定义属性定义**会被误当成 transition 声明并计入违规（实测该假阳性一直挂在
 * 基线里）。凡「属性名可能作为更长标识符后缀出现」的场景都必须带边界。
 */
export function propValueRe(prop: string, flags = "g"): RegExp {
  return new RegExp(`(?<![\\w-])${prop}\\s*:\\s*([^;"'\`}]+)`, flags);
}

/**
 * 按**顶层逗号**切分 CSS 值（忽略括号内的逗号）。
 *
 * 为什么不能直接 `.split(",")`（2026-09 实测踩坑）：CSS 函数参数里含逗号，
 * `transform .2s cubic-bezier(.34,1.56,.64,1)` 用朴素 split 会碎成
 * `[transform .2s cubic-bezier(.34, 1.56, .64, 1)]` 四段——后三段既无 var()、又不含
 * `cubic-bezier(` 子串，于是**自定义缓动豁免失效**、误报为违规（实测 content-layout
 * 的 `.num` bump 即因此被误报）。判定必须按顶层逗号分量进行。
 */
export function splitTopLevelCommas(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
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
  //    注意用 propDeclRe 取**属性名左边界**：否则 `--x-font-size: 11px` 这类
  //    自定义属性定义会被误判（并会被 --fix 改写，见 propDeclRe 注释）。
  const fsRe = propDeclRe("font-size");
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
  const brRe = propDeclRe("border-radius");
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

  // ⑤ 硬编码 box-shadow / transition（[gap 补齐 2026-09] UI-Design.md §7/§7.1 明文
  //    「所有 box-shadow 必须使用 --shadow-*」「所有 transition 时长必须使用 --tr-*」，
  //    但本模块原只覆盖 font-size/radius/color/emoji 四类——这两类**长期零守护**，
  //    新代码写死阴影/时长不会被任何闸拦下，属「有规范无断言」的漏网面。
  //
  //    口径刻意**极窄**（这是本类不产生噪声的关键，勿放宽）：
  //      - box-shadow：仅当归一化后与某 --shadow-* **完全同值**时报。非令牌阴影
  //        （焦点环 color-mix、比 --shadow-xl 更重的浮层阴影）是设计意图，报即噪声。
  //        实测全仓仅 1 处命中——正是「真债少而精」的预期形态。
  //      - transition（[判定反转 2026-09]）：**除豁免外一律报**，不再「只报能建议令牌的」。
  //        反转前的口径是「时长与某 --tr-* 相等才报」，后果是 `.2s`/`.1s`/`.3s`/`.4s` 这类
  //        不撞任何令牌的硬编码时长**全部隐形**（实测盲区 11 处声明点）——闸对本该管的
  //        「硬编码时长」失明，只抓得住「差一点就对了」的那些。
  //        现口径：逐分量判定，命中任一豁免即放过，否则报（建议令牌可为 null）。
  //        三条豁免见 isRealtimeFeedbackTransition（跟手/进度条）/ hasCustomEasing（回弹）/
  //        TR_EXEMPT_MARKER（注释留档的「非它不可」）。
  //    二者均只扫 CSS 文本（含内联 style 体与 CSS 块），故用 line 全文——与颜色判定
  //    不同，此处不需要区分内外（规范对两者同等禁止，且 box-shadow 罕见于内联）。
  for (const sm2 of line.matchAll(propValueRe("box-shadow"))) {
    const v = (sm2[1] ?? "").trim();
    if (!v || /^var\(/.test(v) || /^(none|inherit|initial|unset)$/.test(v)) continue;
    const tok = suggestShadowToken(v, tokenMap);
    if (!tok) continue; // 非令牌阴影：设计意图，不报（防噪声淹没真信号）
    out.push({
      kind: "css-shadow",
      line: lineNo,
      snippet: clip(`box-shadow:${v}`),
      suggestion: tok,
    });
  }
  // 注释豁免标记：整行任一处理由 tr-exempt 覆盖（见 TR_EXEMPT_MARKER）
  const trExempted = line.includes(TR_EXEMPT_MARKER);
  for (const tm of line.matchAll(propValueRe("transition"))) {
    const v = (tm[1] ?? "").trim();
    if (!v || /^(none|inherit|initial|unset)$/.test(v)) continue;
    if (trExempted) continue;
    // 逐分量判定：已含 var() 的分量视为合规（已令牌化，含复合值里只改了一半的情况）。
    // 必须按**顶层逗号**切分——朴素 split(",") 会把 cubic-bezier(a,b,c,d) 切碎，
    // 导致自定义缓动豁免失效（见 splitTopLevelCommas 注释）。
    const offending = splitTopLevelCommas(v).find(
      (p) => !/var\(/.test(p) && !isRealtimeFeedbackTransition(p) && !hasCustomEasing(p),
    );
    if (!offending) continue;
    out.push({
      kind: "css-transition",
      line: lineNo,
      snippet: clip(`transition:${v}`),
      // 建议与 --fix 同口径（suggestTransitionTokenExact：时长 + 缓动双匹配）——
      // 若这里按「只比时长」给建议，会出现「报告说建议 --tr-enter、--fix 却不改」
      // 的自相矛盾（`transform .25s` 缓动为隐式 ease ≠ --tr-enter 的 ease-out）。
      // 给不出安全建议就 null：报告仍保留，供人工决定归位/加档/写 tr-exempt。
      suggestion: suggestTransitionTokenExact(offending, tokenMap),
    });
  }

  // ⑥ padding 硬编码（[gap 补齐 2026-09] UI-Design.md §5 + §语义化间距变量明文）
  //    「不要使用 3px、7px、9px 等非标准值。要么 4 的倍数，要么用上述层级」，
  //    且 `--pad-*` 垂直语义档 / `--btn-padding-*` 完整简写档早已定义——
  //    但判定层原只覆盖 font-size/radius/color/shadow/transition，padding 长期零守护。
  //
  //    判定口径（与 transition 反转同哲学：硬编码即债，能安全归位才给建议）：
  //      - 一律报 `padding: Npx`（内联或 CSS 块，含 0 与组合值）；
  //      - **纯零豁免**：`padding: 0`（全分量 0）令牌化无意义（--pad-* 无 0 档），
  //        与 border-radius:0 同哲学放行；但 `0 8px` 这类「0 + 非 0」仍报（非 0 是真债）；
  //      - 建议：单值 `padding: Npx` → 就近垂直档 `--pad-*`（suggestPaddingToken）；
  //        组合值（涉及横向语义，机械收 `--btn-padding-*` 属存量收敛）→ null，照报不猜。
  //
  //    ⚠️ 必须排除 `padding-block`/`padding-inline` 子属性：`propValueRe("padding")`
  //    会误匹配它们（padding 前是 `{` 或空白 → 左边界放行）。加 `(?![-a-z])` 防后缀。
  const padRe = /(?<![\w-])padding(?![-a-z])\s*:\s*([^;"'`}]+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = padRe.exec(line)) !== null) {
    const val = (pm[1] ?? "").trim().replace(/\s+/g, " ");
    if (!/^(?:\d+(?:\.\d+)?px|0)(?:\s+(?:\d+(?:\.\d+)?px|0)){0,3}$/.test(val)) continue; // 非纯 px 组合不判
    // 纯零豁免：全分量都是 0 / 0px（令牌化无意义，同 border-radius:0）
    if (/^(?:0|0px)(?:\s+(?:0|0px)){0,3}$/.test(val)) continue;
    out.push({
      kind: inlineBodies.some((b) => b.includes(`padding:`))
        ? "inline-style-padding"
        : "css-padding",
      line: lineNo,
      snippet: clip(`padding:${val}`),
      suggestion: suggestPaddingToken(val, tokenMap),
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
    const rgb =
      h.length >= 6 ? [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)] : h.slice(0, 3).split("");
    const vals = rgb.map((x) =>
      x.length === 1 ? Number.parseInt(x + x, 16) : Number.parseInt(x, 16),
    );
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
