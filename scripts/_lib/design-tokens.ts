/**
 * design-tokens.ts — 设计令牌守规判定纯函数层（scripts/_lib，2026-09 立）。
 *
 * 解决什么问题（为什么需要新闸）：
 *   `docs/UI-Design.md` 是项目唯一 UI 规范，明文规定「禁止硬编码 font-size / border-radius /
 *   内联 style / 硬编码颜色」。但规范**长期无机器守护**——立项时全仓扫描实测：
 *   硬编码字号/圆角各上百处、内联 style 数百处，而同一时刻 `var(--fs-*)` / `var(--radius-*)`
 *   已大量合规使用。即：不是「体系没建立」，而是「体系与野路子并存」——一半守规、一半绕过。
 *   这比完全没规范更危险：切主题/改 --fs-scale 时出现「部分跟随、部分不跟随」的割裂，
 *   且因为无度量，没人知道债有多大（三子代理历次锐评均未发现，属横向统计盲区）。
 *
 *   ⚠️ 具体存量条数**刻意不在此写死**——数字随收债漂移且无人维护（ADR-162 去行号精神）。
 *   权威数字见 `scripts/baseline/design-tokens-baseline.json` 的 `count` 字段，
 *   或随时 `node scripts/check-design-tokens.ts` 打印实况。
 *
 * 本模块只做**纯判定**（零 IO、零顶层副作用），CLI 与测试共用：
 *   - parseTokenMap      : variables.css 文本 → 令牌名→值 映射（含 px 等价换算）
 *   - suggestToken       : 硬编码值 → 建议替换的令牌名（值相等才建议，不瞎猜）
 *   - findStyleAttrViolations : 单行文本 → 内联 style / 硬编码字号圆角/阴影/过渡时长命中
 *   - findEmojiIconViolations : 单行文本 → emoji 当图标命中
 *
 * 设计原则（三条都是踩过的坑）：
 *   1. **不误伤存量**：本层只「发现」，不含阻断——是否拦由 CLI 的 --strict/基线策略决定。
 *      仓库存量债巨大，一上来就 hard 会阻塞全体提交。
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
  | "css-shadow"
  | "css-transition"
  | "inline-style-padding"
  | "css-padding"
  | "emoji-icon"
  | "toast-emoji-prefix"
  | "locale-emoji-prefix";

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
  // 基础字号（--fs-base-size: 13px 为基准）
  "--fs-tiny": 8,
  "--fs-xs": 11,
  "--fs-sm": 12,
  "--fs-base": 13,
  "--fs-md": 14,
  "--fs-lg": 15,
  "--fs-xl": 25,
  // 语义字号（同样派生自 --fs-base-size；此处为基准 13px 时的等价像素）
  "--fs-nav": 16,
  "--fs-tab": 13,
  "--fs-filter": 12,
  "--fs-btn-primary": 13,
  "--fs-btn-secondary": 12,
  "--fs-btn-tool": 12,
  // 圆角
  "--radius-xs": 3,
  "--radius-sm": 4,
  "--radius-md": 6,
  "--radius-lg": 8,
  "--radius-xl": 10,
  "--radius-pill": 20,
};

/**
 * padding 硬编码判定（2026-09 立闸；2026-09 ADR-294 升级 --sp-* 优先）。
 *
 * 为什么补：`docs/UI-Design.md` §5 间距系统明文「不要使用 3px、7px、9px 等
 * 非标准值。要么 4 的倍数，要么用上述层级」，且 §语义化间距变量定义了
 * [--pad-*] 垂直语义档、[--btn-padding-*] 完整简写档——但判定层原只覆盖
 * font-size/radius/color/emoji/shadow/transition，**padding 长期零守护**。
 * 实测全仓 454 处硬编码 padding（值高达 113 种），规范与实际严重漂移。
 *
 * [ADR-294 D2] 判定建议升级为 [--sp-*] 优先：存量 padding 主语义是**内容间距**
 * （4/8/12/16/24px，对应 §5 五档），非按钮垂直档（--pad-*）。故单值先落 [--sp-*]
 * （内容间距默认），[--pad-*] 仅承接 3/5/6px 这类 [--sp-*] 无档的按钮/标签垂直值。
 *
 * 判定口径（与 transition 反转同哲学——硬编码即债，能安全归位才给建议）：
 *   - **一律报**：`padding: Npx`（内联或 CSS 块，含 `0` 与组合值）→ 应走令牌档；
 *   - **只给精确建议**：单值 `padding: Npx` → 就近 [--sp-*]（内容间距）或 [--pad-*]；
 *     组合值（`4px 8px` 等）涉及横向语义，机械收敛是存量的事，建议给 null
 *     （照报但宁可不猜，与 transition 先例一致）。
 *
 * 档位基准值见下方表格，与 variables.css 的一致性由测试契约锁定。
 */
/** 间距五档（ADR-294）：内容间距标量，4 的倍数 ∩ §5 层级。 */
export const SP_TOKEN_VERTICAL: Readonly<Record<string, number>> = {
  "--sp-1": 4,
  "--sp-2": 8,
  "--sp-3": 12,
  "--sp-4": 16,
  "--sp-5": 24,
};
/** 按钮/标签垂直档（3-6px）。 */
export const PAD_TOKEN_VERTICAL: Readonly<Record<string, number>> = {
  "--pad-btn-tool": 3,
  "--pad-filter": 4,
  "--pad-btn-secondary": 4,
  "--pad-tab": 5,
  "--pad-btn-primary": 5,
  "--pad-nav": 6,
};

/**
 * [--sp-*] 的地板值 = §5 层级1（4px）。低于它的值不属内容间距语义
 * （见 nearestPadToken 的 ADR-295 附则）。
 */
export const SP_FLOOR_PX = 4;

/**
 * 组合 padding 档（ADR-295 D1 — 高频「垂直+横向」组合值的标准归档）。
 *
 * 为什么补：ADR-294 三波收债后剩 377 条，量化显示前 13 高频值占 185 条（52%），
 * 垂直分量全对齐既有档、横向无档可归（10/6/8px 属 §5 层级区间下沿非标准值）。
 * D4 原「明拒不建组合档」的保守立场以本档表**取代**（见 ADR-295），但保留防膨胀
 * 精神——只建覆盖率高的档，不为孤品建档。
 *
 * 键 = 源组合值（`垂直px 横向px`），值 = 目标令牌名。
 * ⚠️ 本表只给**精确命中**建议，不做就近——组合值就近会给错答案（横向语义是作者裁量）。
 * 与 SP/PAD 垂直表的「近档 ≤2px」哲学不同轨。
 *
 * 展开值对账由契约测试锁定（tests/test_design_tokens.ts：解析 variables.css 的声明，
 * 须等于 COMBO_EXPANSION 的期望 px）——**防「令牌名写对、展开值写错」的静默位移**
 * （本表初稿即踩过：--sp-vh-btn 误写 var(--sp-3)=12px，而源值是 10px）。
 *
 * 覆盖高频值（2026-09-22 实测）：
 *   `2px 8px`×25 按钮/标签小控件 → --btn-padding-tool-lg（垂直 2→3px，+1px 映射按钮最小档，已拍板）
 *   `4px 8px`×12 次要按钮/列表项 → --btn-padding-md（值等价，复用既有档）
 *   `3px 6px`×3  工具栏小按钮   → --btn-padding-sm（值等价，复用既有档）
 *   `4px 12px`×12 筛选/操作按钮 → --btn-padding-filter-lg（值等价）
 *   `6px 10px`×13 列表行/菜单项 → --sp-vh-btn（值等价，内容间距组合）
 *   `8px 12px`×15 滚动容器/卡片正文/设置行 → --sp-vh-pane（值等价）
 *   `24px 12px`×6 进度块/空态区块 → --sp-vh-block（值等价）
 *
 * ⚠️ 只收录**内容/按钮语义明确且覆盖率≥5** 的组合（ADR-295 D4 防膨胀口径）；
 * `8px 0`/`12px 0`/`12px 16px`/`0 8px` 这类低频或方向残缺值**不建档**（留存量债）。
 */
export const COMBO_PADDING_TOKENS: Readonly<Record<string, { token: string }>> = {
  "2px 8px": { token: "--btn-padding-tool-lg" },
  "4px 8px": { token: "--btn-padding-md" },
  "3px 6px": { token: "--btn-padding-sm" },
  "4px 12px": { token: "--btn-padding-filter-lg" },
  "6px 10px": { token: "--sp-vh-btn" },
  "8px 12px": { token: "--sp-vh-pane" },
  "24px 12px": { token: "--sp-vh-block" },
};

/**
 * 组合档的**期望展开值**（[垂直, 横向] px @ `--fs-scale:0`），供契约测试与
 * variables.css 声明文本对账——单一事实源是 CSS，本表是「期望」侧。
 * 与源值的差值即**已拍板的位移**（当前仅 tool-lg 垂直 +1px）。
 */
export const COMBO_EXPANSION: Readonly<Record<string, readonly [number, number]>> = {
  "--btn-padding-tool-lg": [3, 8],
  "--btn-padding-md": [4, 8],
  "--btn-padding-sm": [3, 6],
  "--btn-padding-filter-lg": [4, 12],
  "--sp-vh-btn": [6, 10],
  "--sp-vh-pane": [8, 12],
  "--sp-vh-block": [24, 12],
};

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
 * `--shadow-*` 令牌的**归一化值**（供 box-shadow 精确比对）。
 *
 * 归一化口径见 `normalizeShadowValue`——把 `rgba(0,0,0,.25)` 与
 * `rgba(0, 0, 0, 0.25)` 归到同一形态。值来自 `frontend/css/variables.css`。
 *
 * ⚠️ **只用于「精确相等才建议」的比对**，不做数值近似：实测全仓硬编码 box-shadow
 * 里绝大多数是刻意的非令牌值（焦点环 `0 0 0 3px color-mix(...)`、比 `--shadow-xl`
 * 更重的浮层阴影 `0 8px 24px rgba(0,0,0,.5)`）。对这些报违规＝把设计意图当债务，
 * 属本模块注释里批判过的「自造规则」，故一律不报。仅「与某令牌完全同值」者报。
 */
export const SHADOW_TOKEN_VALUES: Readonly<Record<string, string>> = {
  "--shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.06)",
  "--shadow-md": "0 2px 8px rgba(0, 0, 0, 0.1)",
  "--shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.15)",
  "--shadow-xl": "0 8px 32px rgba(0, 0, 0, 0.25)",
};

/**
 * `--tr-*` 令牌的**时长分量**（秒）→ 令牌名。
 *
 * 为什么只比时长分量、不比整条 transition：实测 transition 是复合值
 * （`background .12s ease` / `all .15s ease` / `transform .2s cubic-bezier(...)`），
 * 属性名与缓动函数千变万化，整值精确相等几乎永不命中（实测全仓 0 例），
 * 而**时长**才是令牌真正约定的部分（`--tr-fast/normal/enter` 的差异就在时长与缓动）。
 * 故口径：transition 里出现「与某令牌时长相等」的时长分量 → 提示改用该令牌。
 *
 * 取 0.12 / 0.15 / 0.25 三档（对应 --tr-fast / --tr-normal / --tr-enter）。
 * 注意 `--tr-fast` 与 `--tr-normal` 的缓动同为 ease、仅时长不同，故按值即可区分。
 */
export const TRANSITION_TOKEN_DURATIONS: Readonly<Record<string, number>> = {
  "--tr-fast": 0.12,
  "--tr-normal": 0.15,
  "--tr-enter": 0.25,
};

/**
 * `--tr-*` 令牌的**完整简写值**（时长 + 缓动），供「整值等价替换」判定。
 *
 * 与 `TRANSITION_TOKEN_DURATIONS` 分工：
 *   - 前者供**报告**（时长撞车即提示，即使缓动不同也让作者知道有此令牌可对齐）；
 *   - 本表供 **--fix**（整值替换，必须时长与缓动**双双**一致才动，否则会改语义）。
 *
 * 为什么必须分两档（实测教训）：`transform .25s ease` 与 `--tr-enter`（`0.25s ease-out`）
 * 时长相同但缓动不同——若只看时长就自动替换，会把「平滑 ease」偷偷变成「减速 ease-out」，
 * 属**静默改变动效观感**。这类必须留给人工判断（是要对齐令牌，还是令牌该加一档）。
 */
export const TRANSITION_TOKEN_VALUES: Readonly<Record<string, { dur: number; ease: string }>> = {
  "--tr-fast": { dur: 0.12, ease: "ease" },
  "--tr-normal": { dur: 0.15, ease: "ease" },
  "--tr-enter": { dur: 0.25, ease: "ease-out" },
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

/**
 * 「实时反馈」类过渡的属性白名单——这些属性上的短时长 + `linear` **不适用令牌体系**。
 *
 * 为什么需要（实测教训）：滑块跟手（`.cs-fill { transition: width 0.06s linear }`、
 * `.cs-thumb { transition: left 0.06s linear }`）语义是**跟手**而非**缓动**——它跟随
 * pointermove 的实时位置，每帧都在重设目标值。这类过渡若套 `--tr-fast`（0.12s）会
 * 叠加进拖拽回路，观感从「跟手」退化为「拖泥带水」。
 *
 * 因此本仓 `docs/UI-Design.md` §7 明确把「拖拽跟手 / 进度条填充」列为**不违规例外**。
 * 本表是该例外在判定层的唯一表达，**不是豁免清单**：它描述的是「这类过渡不适用令牌」
 * 这一条**规则**，而非「这几个文件不要报」——后者会与 baseline 形成双真相源并漂移。
 *
 * 准入三条（须同时满足，见 `isRealtimeFeedbackTransition`）：
 *   ① 属性属于跟手类（几何位移/尺寸：width/height/left/top/right/bottom/transform 的位移分量）；
 *   ② 缓动为 `linear`（跟手必须线性；缓动函数会让位置滞后于指针）；
 *   ③ 时长 < 0.1s（足够短以致不被感知为「动画」，纯为消除抖动）。
 */
export const REALTIME_FEEDBACK_PROPS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "left",
  "top",
  "right",
  "bottom",
]);

/** 实时反馈类过渡的时长上限（秒）——达到或超过即视为常规过渡，须套令牌。 */
export const REALTIME_FEEDBACK_MAX_SECS = 0.1;

/**
 * 判定一条 transition 是否属「实时反馈」（跟手）——是则**不适用令牌**，报告层应放过。
 *
 * 与 `suggestTransitionToken` 的关系：后者按「时长是否撞令牌」机械匹配，会把它当成
 * 「无对应令牌的硬编码时长」；本函数在报告层**先于**令牌匹配生效，识别出跟手语义后
 * 直接排除，避免规则把一条正确的写法长期挂在基线里当「永远不会修的债」。
 *
 * 只处理**单属性**值（`width 0.06s linear`）；多属性值返回 false（交由既有逻辑报告）。
 *
 * @param value transition 属性值（如 `width 0.06s linear`）
 */
export function isRealtimeFeedbackTransition(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(",")) return false;
  const m = /^([a-z-]+)\s+(\d*\.?\d+)(s|ms)\s*(.*)$/i.exec(v);
  if (!m) return false;
  const prop = (m[1] ?? "").toLowerCase();
  if (!REALTIME_FEEDBACK_PROPS.has(prop)) return false;
  const rawNum = Number(m[2]);
  const secs = m[3] === "ms" ? rawNum / 1000 : rawNum;
  if (!(secs < REALTIME_FEEDBACK_MAX_SECS)) return false; // 须严格短于上限
  const ease = (m[4] ?? "").trim().toLowerCase();
  return ease === "linear"; // 跟手必须线性
}

/**
 * 自定义缓动函数判定（`cubic-bezier(...)` / `steps(...)`）——命中则该过渡**不套令牌**。
 *
 * 为什么需要：`--tr-*` 三档的缓动是固定关键字（`ease` / `ease-out`），**无法表达回弹
 * （overshoot）或阶跃**。本仓有多处刻意的回弹动效（如 `.stat-card .num` 的 bump
 * `cubic-bezier(.34,1.56,.64,1)`、`.rec-card` hover 上浮），套任一令牌都会把回弹抹成
 * 直落——那是把设计意图当债务。故这类按 UI-Design.md §7「说明为何非它不可」豁免。
 *
 * 与 `isRealtimeFeedbackTransition` 并列，同属**规则**（哪类写法不适用令牌），
 * 不是文件/行号豁免清单（后者会与 baseline 形成双真相源）。
 */
export function hasCustomEasing(value: string): boolean {
  return /cubic-bezier\(|steps\(/i.test(value);
}

/**
 * 「非它不可」注释豁免标记（UI-Design.md §7 的机器可读出口）。
 *
 * 用法：在**同一行**的 CSS 注释里写 `tr-exempt: <理由>`，该行的 transition 即不报。
 *   `.x { transition: opacity .4s; /* tr-exempt: 涟漪需缓慢浮现 *\/ }`
 *
 * 为什么必须同行：判定层是**逐行**纯函数（`findStyleAttrViolations(line, lineNo, …)`），
 * 不持有上文；跨行回溯会把签名与所有调用方一起复杂化，收益不抵成本。
 *
 * 这是**最后手段**，仅在「既非跟手、又无自定义缓动、且现有三档确实表达不了」时使用——
 * 每处命中都应在注释里写清理由，便于 review 与未来复审。
 */
export const TR_EXEMPT_MARKER = "tr-exempt";

/** 缓动关键字白名单（用于区分「缓动缺省」与「显式写了别的缓动」）。 */
const EASE_KEYWORDS = new Set([
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
]);

/**
 * transition 值 → **可整值替换**的令牌名（时长与缓动双双一致才返回，否则 null）。
 *
 * 与 `suggestTransitionToken`（只比时长，供报告）严格区分：本函数是 **--fix 的准入闸**。
 *
 * 三条安全前提（缺一不可，均为「不改语义」服务）：
 *   ① **单属性单时长**：值形如 `<prop> <dur> [<ease>]`。多属性值
 *      （`background .12s, color .12s`）**一律不整值替换**——用 `var(--tr-fast)` 覆盖
 *      会把两个属性塌缩成一个，语义直接丢失。这类由报告层提示、人工逐条处理。
 *   ② **时长与令牌相等**（数值级，`.12s` 与 `0.12s` 视为同）。
 *   ③ **缓动与令牌相等**：缺省缓动按 CSS 规范视为 `ease`；显式写了 `linear` /
 *      `cubic-bezier(...)` 等与令牌不同的一律拒绝——否则会把「平滑 ease」偷偷换成
 *      「减速 ease-out」，属静默改变动效观感。
 *
 * @param value     transition 属性值（如 `background .12s ease`）
 * @param tokenMap  已解析令牌映射（校验令牌真实存在）
 */
export function suggestTransitionTokenExact(
  value: string,
  tokenMap?: TokenRawMap | null,
): string | null {
  const v = value.trim();
  if (!v || v.includes(",")) return null; // 前提①：多属性不整值替换
  const m = /^([a-z-]+)\s+(\d*\.?\d+)(s|ms)\s*(.*)$/i.exec(v);
  if (!m) return null;
  const prop = (m[1] ?? "").toLowerCase();
  if (prop === "none") return null; // `transition: none` 之类
  const rawNum = Number(m[2]);
  const secs = m[3] === "ms" ? rawNum / 1000 : rawNum;
  const easeRaw = (m[4] ?? "").trim();
  // 缓动可能是多值（`ease 0.1s` 之类非常规写法）——只认单 token 或空
  if (easeRaw.includes(" ")) return null;
  const ease = easeRaw === "" ? "ease" : easeRaw.toLowerCase(); // 前提③：缺省 = ease
  if (easeRaw !== "" && !EASE_KEYWORDS.has(ease)) return null; // cubic-bezier()/steps() 等不碰

  for (const [name, tok] of Object.entries(TRANSITION_TOKEN_VALUES)) {
    if (Math.abs(tok.dur - secs) > 1e-6) continue;
    if (tok.ease !== ease) continue;
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

/**
 * emoji 图形字符 + 尾部组合符（变体选择符 / ZWJ）——供各 emoji 判定复用。
 *
 * ⚠️ 关于 \uFE0F 与 ZWJ：它们是**组合字符**，写进 `+` 字符类会让正则语义模糊
 * （biome noMisleadingCharacterClass 实测告警），且会把 `♻️` 匹配成孤立的 `♻`
 * （丢失变体，显示成与源码不同的字形）。改为「图形字符 + 尾部组合符*」序列。
 */
// U+2300-23FF（⌚⌛⏰⏳⏸⏹…「杂项技术符号」）补于 2026-09：`⏳`=U+231B 落在原四段
// 之外，`textContent = "⏳"` 类单字形槽整类逃逸（实测 5 处，已收）。与
// `frontend/src/utils/icon/glyph-only-slots.test.ts` 的 GRAPHIC 保持逐字一致。
export const GRAPHIC_EMOJI =
  "[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]";
export const COMBINING_MARKS = "[\u{FE0F}\u{200D}]";

/** 行内是否含图形 emoji 字形（**预筛**用：check-design-tokens 的快速跳过表）。
 *
 * 与判定层共用同一字符集是**硬要求**：预筛若比判定窄，命中行在预筛即被
 * `continue` 跳过、永远到不了判定函数——「闸形同虚设且极难察觉」（同上方
 * 关键词表的教训）。实测踩过：预筛原**硬编码四段**（缺 2190-21FF 与
 * 2300-23FF），`⏳` 类单字形槽整类静默逃逸（2026-09 修，实测 6 处）。
 */
const GRAPHIC_EMOJI_RE = new RegExp(GRAPHIC_EMOJI, "u");
export function hasGraphicEmoji(line: string): boolean {
  return GRAPHIC_EMOJI_RE.test(line);
}
/** 单个字形簇（一捕获组），供 `["'\x60]` 开头的字面量前缀检测复用。 */
export const GLYPH_CLUSTER = `(${GRAPHIC_EMOJI}${COMBINING_MARKS}*(?:${GRAPHIC_EMOJI}${COMBINING_MARKS}*)*)`;

/**
 * 「前缀型状态符号」语义名集合（ADR-267 决策 #4）。
 *
 * 判定口径：仅当某 emoji 的 icon-map 语义名落在本集合内，它**作为字符串左前缀**（toast
 * 载荷 / locale 值 / `/` 子句前）出现时，才判为「冗余的状态符号」：
 *   - toast 载荷前导 → type 已驱动语义图标（success/error/warning/info…），去 emoji 不丢语义；
 *   - locale 值前导 / `/` 子句前导 → 同 toast 语义，属状态反馈，非内容。
 *
 * 刻意**不含**动作/内容类语义（delete/folder/open/search/tag/hint/recycle…）——它们是按钮/
 * 面板的**可操作图标**，无 type 图标承托，去掉即丢视觉（ADR-238 结构图标域另论）。故
 * 保留的按钮图标（如 `🗑️ 删除`、`📂 浏览本地模型`）与提示正文（`💡 如果…`）不会被误报。
 */
export const STATUS_ICON_NAMES: ReadonlySet<string> = new Set([
  "success",
  "error",
  "warning",
  "info",
  "fatal",
  "skip",
  "blocked",
  "stop",
  "restricted",
]);

/** 若字形是「前缀型状态符号」（icon-map 语义名 ∈ STATUS_ICON_NAMES），返回建议语义名；否则 null。 */
function statusSuggestionOf(glyph: string): string | null {
  const name = suggestIconName(glyph);
  return name && STATUS_ICON_NAMES.has(name) ? `UI_ICONS.${name}` : null;
}

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
    new RegExp(`(?<![\\w-])padding(?![-a-z])\\s*:\\s*([^;"'\`}]+)`, "g"),
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
  const padRe = new RegExp(`(?<![\\w-])padding(?![-a-z])\\s*:\\s*([^;"'\`}]+)`, "g");
  let pm: RegExpExecArray | null;
  while ((pm = padRe.exec(line)) !== null) {
    const val = (pm[1] ?? "").trim().replace(/\s+/g, " ");
    if (!/^(?:\d+(?:\.\d+)?px|0)(?:\s+(?:\d+(?:\.\d+)?px|0)){0,3}$/.test(val)) continue; // 非纯 px 组合不判
    // 纯零豁免：全分量都是 0 / 0px（令牌化无意义，同 border-radius:0）
    if (/^(?:0|0px)(?:\s+(?:0|0px)){0,3}$/.test(val)) continue;
    out.push({
      kind: inlineBodies.some((b) => b.includes(`padding:`)) ? "inline-style-padding" : "css-padding",
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
  // 字形序列用模块级 GRAPHIC_EMOJI/COMBINING_MARKS（逻辑见上方模块常量注释）。
  const re = new RegExp(`(?:>|["'\x60])\\s?${GLYPH_CLUSTER}(?=\\s*["'\x60]|\\s*<|\\s|$)`, "gu");
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

/**
 * toast 载荷「前缀型状态符号」检测（ADR-267 门禁补盲）。
 *
 * 背景：`findEmojiIconViolations` 只认「HTML 标签图标位 + 字面量 emoji」，扫不到运行时
 * toast 载荷——`check-design-tokens` 对 `toast("❌ …")` / `bus.emit("toast:show", { msg: "⚠️ …" })`
 * 这类**经变量/参数传进渲染层**的前缀 emoji 完全失明（toast 渲染层走 `esc()` 文本槽，
 * 无字面量可被该函数命中）。本 ADR 清理后需防「再引入」，故在此收口。
 *
 * 判定口径（收紧以防误报）：
 *   - 只认 toast 载荷构造行：`toast(` / `toastError(` / `bus.emit("toast:show", …)`。
 *   - 只报「字符串字面量**开头**紧跟的状态符号」（引号/反引号 + 空白 + 状态 emoji）。
 *   - 语义名须 ∈ STATUS_ICON_NAMES（success/error/warning/…）——toast 的 type 已驱动同款
 *     状态图标，这类前缀纯属信息冗余；动作/内容字形（如 `📦 打包完成`）无 type 图标承托，
 *     不是「前缀型状态符号」，不碰。
 */
export function findToastEmojiPrefixViolations(line: string, lineNo: number): DesignViolation[] {
  if (isCommentLine(line)) return [];
  // 只认 toast 载荷构造行的特征；无 toast 特征的行一律不参与（防普通字符串误报）
  if (!/toast\(|toastError\(|bus\.emit\(\s*["'\x60]toast:show["'\x60]/.test(line)) return [];
  const out: DesignViolation[] = [];
  const re = new RegExp(`["'\x60]\\s*${GLYPH_CLUSTER}`, "gu");
  for (const m of line.matchAll(re)) {
    const glyph = m[1] ?? "";
    const suggestion = statusSuggestionOf(glyph);
    if (!suggestion) continue;
    out.push({
      kind: "toast-emoji-prefix",
      line: lineNo,
      snippet: clip(glyph),
      suggestion,
    });
  }
  return out;
}

/**
 * locale 值「前缀型状态符号」检测（ADR-267 门禁补盲）。
 *
 * 背景：locale 源（frontend/src/locales/*.ts）的**值**里若再注入 `"❌ …"` / `"✅ …"` 前缀，
 * 经 `t()` 产出的 msg 会带进 toast 载荷，同样逃过 `findEmojiIconViolations`（无标签图标位）。
 * 本函数只在 locale 文件域调用（见 check-design-tokens.ts），覆盖三种形态：
 *   ① 叶子值行：`"key": "✅ 值…"`（状态 emoji 在值首）；
 *   ② 多行值续行：`  "✅ 值…"`（值跨行时状态 emoji 落在续行首）；
 *   ③ 值内 `/` 子句：`"{ok} 已移动 / ❌ {fail} 失败"`（ctx.moveOkPartial 形态）。
 * 语义名须 ∈ STATUS_ICON_NAMES；动作/内容字形（🗑️删除/📂浏览/💡提示…）不在此列，不误报。
 */
export function findLocaleEmojiPrefixViolations(line: string, lineNo: number): DesignViolation[] {
  if (isCommentLine(line)) return [];
  const out: DesignViolation[] = [];
  const push = (glyph: string): void => {
    const suggestion = statusSuggestionOf(glyph);
    if (!suggestion) return;
    out.push({
      kind: "locale-emoji-prefix",
      line: lineNo,
      snippet: clip(glyph),
      suggestion,
    });
  };
  // ① 叶子值行：`"key": "值"` —— 值首状态 emoji
  const leaf = new RegExp(`^\\s*"(?:[^"\\\\]|\\\\.)+":\\s*["'\x60]\\s*${GLYPH_CLUSTER}`, "u").exec(
    line,
  );
  if (leaf) push(leaf[1] ?? "");
  // ② 多行值续行：`  "值…"` —— 续行首状态 emoji（与 ① 互斥，防同一字面量重复计数）
  // 排除对象键名行（`"✅ key": "值"`）：键名以 emoji 开头是合法的 key 命名（非值前缀），
  // 须以 `^\s*"[^"]*"\s*:` 识别并跳过，避免 ② 把 key 误当 value 续行而误报
  if (!leaf) {
    const isKeyLine = /^\s*"(?:[^"\\]|\\.)*"\s*:/.test(line);
    if (!isKeyLine) {
      const cont = new RegExp(`^\\s*["'\x60]\\s*${GLYPH_CLUSTER}`, "u").exec(line);
      if (cont) push(cont[1] ?? "");
    }
  }
  // ③ `/` 子句分隔：值内 ` / ❌ …`（ctx.moveOkPartial 形态）
  const slash = new RegExp(`\\/\\s*${GLYPH_CLUSTER}`, "gu");
  for (const m of line.matchAll(slash)) push(m[1] ?? "");
  return out;
}

/**
 * 行级判定：只判「指定行号集合」上的违规——「只对自己动过的行负责」（ADR-256）。
 *
 * 与逐行扫全文件的区别**只在判哪些行**：判定函数与建议逻辑完全复用，
 * 保证「同一行、同函数、同结论」；输出按行号升序，便于对照 diff 人工核对。
 *
 * 为何需要它：基线文件级判定（键 = `file:line:kind`）在 116 提交窗实测中，added 330 条里
 * 322 条（97.6%）是**行位移幻影**（存量违规被挤到新行号），真新增候选仅 8；行级判定天然免疫
 * 位移。「同行替换同类」会因键相同被判存量（机制性盲区，本窗口实测 0 次），行级同样免疫。
 *
 * @param text     文件全文（**提交侧 blob**，不是工作区内容）
 * @param lines    新增行号集合（1-based，来自 git diff --unified=0）
 * @param tokenMap 令牌映射（供 suggestToken 校验存在性）；可空
 * @param opts     可选项：`locale` = 该文件属 locale 源域（额外跑 locale 值前缀检测）
 */
export function findViolationsOnLines(
  text: string,
  lines: Iterable<number>,
  tokenMap?: TokenRawMap | null,
  opts?: { locale?: boolean },
): DesignViolation[] {
  const all = text.split("\n");
  const wanted = [...new Set(lines)].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const out: DesignViolation[] = [];
  for (const ln of wanted) {
    if (ln < 1 || ln > all.length) continue;
    const line = all[ln - 1] ?? "";
    out.push(
      ...findStyleAttrViolations(line, ln, tokenMap),
      ...findEmojiIconViolations(line, ln),
      ...findToastEmojiPrefixViolations(line, ln),
      ...(opts?.locale ? findLocaleEmojiPrefixViolations(line, ln) : []),
    );
  }
  return out;
}
