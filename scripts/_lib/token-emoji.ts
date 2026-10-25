/**
 * token-emoji.ts — emoji / 状态字形**违规扫描**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 四个对外入口（按立闸先后）：findEmojiIconViolations（ADR-238 图标位）→
 * findToastEmojiPrefixViolations（ADR-267 单行 toast 前缀）→
 * findToastEmojiPrefixWindowViolations（ADR-298 多行窗口）→
 * findLocaleEmojiPrefixViolations（ADR-267 locale 值前缀）。
 * 共同判据：字形语义名须 ∈ STATUS_ICON_NAMES 才报；动作/内容字形（📦 打包完成）不碰。
 *
 * 依赖：./token-types.ts / ./token-glyph.ts / ./icon-map.ts。
 */
import { suggestIconName } from "./icon-map.ts";
import { clip, GLYPH_CLUSTER, isCommentLine } from "./token-glyph.ts";
import type { DesignViolation } from "./token-types.ts";

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
/** toast 载荷锚点行特征（`bus.emit("toast:show"` / `toast(` / `toastError(`） */
const TOAST_ANCHOR_RE = /toast\(|toastError\(|bus\.emit\(\s*["'\x60]toast:show["'\x60]/;

/**
 * 单行内「引号/反引号后紧跟状态字形」扫描原语（**不含** toast 锚点特征判定）。
 *
 * 拆出它的原因：多行窗口需要对 `msg:` 行扫描，而该行不含 `toast:show` 锚点特征——
 * 若直接复用 `findToastEmojiPrefixViolations`（自带锚点门槛），窗口内逐行调用必然
 * 全部返回空，闸再度静默失明（实测踩过：修好窗口后仍 0 命中，根因即此）。
 */
function scanStatusPrefixGlyphs(line: string, lineNo: number): DesignViolation[] {
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

export function findToastEmojiPrefixViolations(line: string, lineNo: number): DesignViolation[] {
  if (isCommentLine(line)) return [];
  // 只认 toast 载荷构造行的特征；无 toast 特征的行一律不参与（防普通字符串误报）
  if (!TOAST_ANCHOR_RE.test(line)) return [];
  return scanStatusPrefixGlyphs(line, lineNo);
}

/** toast 多行窗口扫描行数（锚点行之后） */
const TOAST_WINDOW_LINES = 4;

/**
 * toast 载荷「前缀型状态符号」**多行窗口**检测（ADR-298 门禁勘误）。
 *
 * 背景：`findToastEmojiPrefixViolations` 要求锚点与 emoji 字面量**同行**，而本仓
 * toast 载荷几乎全是多行对象字面量形态：
 *   bus.emit("toast:show", {
 *     msg: `❌ ${friendlyError(e)}`,   ← emoji 在下一行，同行判定永久失明
 *   });
 * 实测该形态漏报整个 `msg:` 行的状态前缀（横跨 app-tree / sidebar / community /
 * maintenance 等 12+ 模块），闸注释自称「ADR-267 已收口」实则只收口单行形态。
 *
 * 判定口径（收紧以防误报）：锚点行无同行命中时，向后拼 ≤{@link TOAST_WINDOW_LINES}
 * 行扫描（用 `scanStatusPrefixGlyphs` 原语，**非**带锚点门槛的单行检测器），
 * 命中**归属锚点行号**（报错定位指向载荷构造处）。
 *
 * 已知残余：若只在 `msg:` 行新增（锚点行是存量），行级判定放行（罕见，可接受）。
 */
export function findToastEmojiPrefixWindowViolations(
  lines: readonly string[],
  anchorLineNo: number,
): DesignViolation[] {
  const anchor = lines[anchorLineNo - 1];
  if (anchor === undefined || isCommentLine(anchor)) return [];
  if (!TOAST_ANCHOR_RE.test(anchor)) return [];
  // 同行已由单行检测器覆盖 → 不重复计
  if (scanStatusPrefixGlyphs(anchor, anchorLineNo).length > 0) return [];
  const out: DesignViolation[] = [];
  for (let i = 1; i <= TOAST_WINDOW_LINES; i++) {
    const ln = anchorLineNo + i;
    const line = lines[ln - 1];
    if (line === undefined) break;
    // 窗口在载荷构造块内：遇闭合/新语句即停（防跨块误报）
    if (/^\s*\}\s*\)/.test(line) || /^\s*(const|let|return|function|export)\b/.test(line)) break;
    if (isCommentLine(line)) continue;
    for (const v of scanStatusPrefixGlyphs(line, ln)) {
      out.push({ ...v, line: anchorLineNo }); // 归属锚点行
    }
    if (/msg\s*:/.test(line)) break; // msg 已见即可停（toast 只有一个 msg 槽）
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
