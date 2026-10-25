/**
 * token-glyph.ts — 文本与字形**基础原语**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 内容：注释行判定（isCommentLine）、片段截断（clip）、图形 emoji 字形正则与
 * 字形簇（GRAPHIC_EMOJI / COMBINING_MARKS / GLYPH_CLUSTER / hasGraphicEmoji）。
 * 这三处被 style 扫描、emoji 扫描、fix 共同依赖，故下沉为最底层无依赖模块。
 *
 * 依赖：零（纯字符串处理）。
 */
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
export function clip(s: string, max = 120): string {
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
