/**
 * design-tokens.ts — 设计令牌守规判定层的**单一入口**（scripts/_lib，2026-09 立）。
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
 * 结构（2026-10-25 沿真缝拆分，ADR-234 D3 `_lib` 400 行硬红线；1391 → 本文件 153 行）：
 *   本文件              —— 单一入口：把八个模块的导出面原样透出 + findViolationsOnLines（组合器）
 *   ./token-types.ts    —— DesignViolationKind / DesignViolation / TokenPxMap / TokenRawMap
 *   ./token-tables.ts   —— 全部令牌值表（字号/圆角/间距/组合 padding/阴影/过渡）
 *   ./token-suggest.ts  —— parseTokenMap + 硬编码值 → 令牌名建议器
 *   ./token-transition.ts —— 实时反馈豁免判据 + transition 整值精确建议
 *   ./token-glyph.ts    —— isCommentLine / clip / 字形正则原语
 *   ./token-style.ts    —— 内联 style 与 CSS 块六类硬编码判定 + 中性色豁免
 *   ./token-fix.ts      —— 自动令牌化（fixLineTokens）+ UI-Design 文档漂移
 *   ./token-emoji.ts    —— emoji 图标位 / toast 前缀 / locale 前缀扫描
 *
 * 为什么这样切：原文件四簇关注点（令牌表+建议器 / 实时反馈 / doc 漂移+style 扫描 /
 * emoji 扫描）之间只有**单向**依赖（表 → 建议器 → 判定器 → 组合器），切面即依赖方向；
 * 拆分**逐段 verbatim 搬移、零行为改写**（ADR-234 D3 的硬要求：上一轮夹带行为改写被回滚），
 * 搬完以 `check-design-tokens` 全量基线逐条比对确认零行为变更。
 *
 * 依赖：零外部依赖（纯字符串处理；ROOT 等 IO 由调用方注入）。
 *
 * 用法（导出面与拆分前**完全一致**，消费方 import 路径零改动）：
 *   import { parseTokenMap, suggestToken, findStyleAttrViolations } from './_lib/design-tokens.ts';
 *
 * 退出码：本模块无独立 CLI（被 check-design-tokens.ts import）。
 */

import { clip, isCommentLine } from "./token-glyph.ts";
import {
  findEmojiIconViolations,
  findLocaleEmojiPrefixViolations,
  findToastEmojiPrefixViolations,
  findToastEmojiPrefixWindowViolations,
} from "./token-emoji.ts";
import { findStyleAttrViolations } from "./token-style.ts";
import type { DesignViolation, TokenRawMap } from "./token-types.ts";

// 八个子模块的导出面原样透出（消费方 import 路径零改动，是拆分零行为变更的保证）。
export type { DesignViolation, DesignViolationKind, TokenPxMap, TokenRawMap } from "./token-types.ts";
export {
  COMBO_EXPANSION,
  COMBO_PADDING_TOKENS,
  PAD_TOKEN_VERTICAL,
  SHADOW_TOKEN_VALUES,
  SP_FLOOR_PX,
  SP_TOKEN_VERTICAL,
  TOKEN_PX_BASELINE,
  TRANSITION_TOKEN_DURATIONS,
  TRANSITION_TOKEN_VALUES,
} from "./token-tables.ts";
export {
  nearestPadToken,
  parseTokenMap,
  suggestPaddingToken,
  suggestShadowToken,
  suggestToken,
  suggestTransitionToken,
  normalizeShadowValue,
} from "./token-suggest.ts";
export {
  hasCustomEasing,
  isRealtimeFeedbackTransition,
  REALTIME_FEEDBACK_MAX_SECS,
  REALTIME_FEEDBACK_PROPS,
  suggestTransitionTokenExact,
  TR_EXEMPT_MARKER,
} from "./token-transition.ts";
export {
  COMBINING_MARKS,
  GLYPH_CLUSTER,
  GRAPHIC_EMOJI,
  hasGraphicEmoji,
  isCommentLine,
} from "./token-glyph.ts";
export {
  findStyleAttrViolations,
  isNeutralColor,
  propDeclRe,
  propValueRe,
  splitTopLevelCommas,
} from "./token-style.ts";
export { checkLayoutDocDrift, fixLineTokens, type DocDrift, type FixEdit } from "./token-fix.ts";
export {
  findEmojiIconViolations,
  findLocaleEmojiPrefixViolations,
  findToastEmojiPrefixViolations,
  findToastEmojiPrefixWindowViolations,
} from "./token-emoji.ts";

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
      // ADR-298 门禁勘误：多行 toast 载荷窗口（本仓主流形态，单行检测器看不见）
      ...findToastEmojiPrefixWindowViolations(all, ln),
      ...(opts?.locale ? findLocaleEmojiPrefixViolations(line, ln) : []),
    );
  }
  return out;
}
