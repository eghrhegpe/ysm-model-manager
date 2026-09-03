// ===== 模型文件名解析 + 美化显示管线（类型化版 — ADR-014 P2）=====
import { renderFormattedText } from "../format/mc-format.ts";
import { esc } from "./html.ts";

/**
 * 禁用后缀正则——对齐 Go types.DisableSuffixes（新标准 .disabled 在前，历史 .ban 兼容）。
 */
const DISABLE_RE = /\.(disabled|ban)$/i;

/**
 * 剥离禁用后缀（.disabled / .ban，大小写不敏感）。
 * 前端单一事实来源——对齐 Go types.StripDisableSuffix，消灭多处内联口径漂移。
 */
export function stripDisableSuffix(name: string): string {
  return name.replace(DISABLE_RE, "");
}

/** @deprecated 用 stripDisableSuffix（保留别名防外部断链） */
export const stripBanSuffix = stripDisableSuffix;

/** 解析后的模型文件名字段 */
export interface ParsedModelName {
  raw: string;
  isBanned: boolean;
  author: string;
  work: string;
  chara: string;
  date: string;
  ext: string;
}

interface NameMark {
  idx: number;
  html: string;
  len: number;
}

/**
 * 括号风格注册表（YSM 生态核心约定，索引 4.7）：作者段 `[...]`（tag-author 青）、
 * 作品段 `【...】`/`《...》`（tag-work 灰，Design.md §3 语义色）。
 * parseModelName / renderDisplayName 共用，新增/调整括号风格只改本表。
 */
const BRACKET_STYLES = [
  { open: "[", close: "]", tag: "tag-author" },
  { open: "【", close: "】", tag: "tag-work" },
  { open: "《", close: "》", tag: "tag-work" },
] as const;

/** 从注册表构建括号段匹配正则（内容捕获，非全局） */
function bracketRe(style: (typeof BRACKET_STYLES)[number]): RegExp {
  return new RegExp(
    escRegex(style.open) + "([^" + escRegex(style.close) + "]+?)" + escRegex(style.close),
  );
}

/**
 * 解析模型文件名 → 结构化字段
 * 支持格式: [作者]【作品】角色变体2023-05.ysm
 * 也兼容: [作者]《作品》角色变体2023-05.ysm
 */
export function parseModelName(raw: string): ParsedModelName {
  const name = stripBanSuffix(raw);
  const extMatch = name.match(/\.(\w+)$/);
  const aMatch = name.match(/\[\[([^\]]+?)\]\]/) || name.match(bracketRe(BRACKET_STYLES[0]));
  const wMatch = name.match(bracketRe(BRACKET_STYLES[1])) || name.match(bracketRe(BRACKET_STYLES[2]));
  // P3 修复（子代理审计）：① 日期提取先剥括号段——`[作者]【2023】角色2024.ysm`
  // 原 dMatch 命中括号内 2023（静默取错日期）；② 修正则贪婪——`角色20230.ysm`
  // 原 `[-_.]?(\d{1,2})?` 把后随 0 当月份产出 `2023-0` 畸形日期
  // 剥离正则由注册表拼接（双括号作者段特判 + BRACKET_STYLES 三风格），与 render 共用
  const bracketStripRe = new RegExp(
    "\\[\\[[^\\]]+?\\]\\]" +
      BRACKET_STYLES.map(
        (s) => escRegex(s.open) + "[^" + escRegex(s.close) + "]+?" + escRegex(s.close),
      ).join("|"),
    "g",
  );
  const dateName = name.replace(bracketStripRe, "");
  // P3 修复（code review）：无分隔符 YYYYMM 月份恢复——`角色202305.ysm` 原正则
  // 要求分隔符才取月份（202305 → 只 "2023" 丢月份）；补 `(\d{2})` 分支并在下方
  // 校验月份 01-12（`20230` 尾随 0 不是合法月份 → 仍只取年份，防畸形回退）
  const dMatch = dateName.match(/(\d{4})(?:[-_.](\d{1,2})|(\d{2}))?/);

  const author = (aMatch ? aMatch[1] : "").trim();
  const work = (wMatch ? wMatch[1] : "").trim();
  // P3 修复（code review）：月份取值合并两分支（dMatch[2]=带分隔符、dMatch[3]=无分隔符
  // YYYYMM），且仅当月份 ∈ 01-12 才拼接——`20230` 尾随 0 不是合法月份 → 只取年份
  const rawMonth = dMatch ? (dMatch[2] || dMatch[3] || "") : "";
  const monthNum = rawMonth ? parseInt(rawMonth, 10) : 0;
  const date = dMatch
    ? rawMonth && monthNum >= 1 && monthNum <= 12
      ? dMatch[1] + "-" + rawMonth.padStart(2, "0")
      : dMatch[1]
    : "";

  let rest = name.replace(/\.\w+$/, "");
  if (aMatch) rest = rest.slice(aMatch[0].length);
  if (wMatch) {
    const wi = rest.indexOf(wMatch[0]);
    if (wi >= 0) rest = rest.slice(0, wi) + rest.slice(wi + wMatch[0].length);
  }
  rest = rest.replace(/^\[\]/, "").replace(/^【】/, "").replace(/^\s+/, "");
  rest = rest.replace(/\d{4}[-_.]?\d{0,2}/g, "").replace(/[\(（]\s*[\)）]/g, "");
  const chara = rest
    .replace(/[-_]{2,}/g, " ")
    .replace(/^[-_\s]+|[-_\s]+$/g, "")
    .replace(/_/g, " ");

  return {
    raw,
    isBanned: DISABLE_RE.test(raw),
    author,
    work,
    chara: chara || "",
    date,
    ext: extMatch ? extMatch[1] : "",
  };
}

/** 转义正则特殊字符 */
function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 渲染美化文件名 HTML（通用接口）
 * 应用 CSS 变量: --meta-author, --meta-work, --meta-date
 * @param raw 原始文件名
 * @param opts 选项对象或模板字符串（兼容旧调用，当前未使用）
 */
export function renderDisplayName(raw: string, _opts?: unknown): string {
  const p = parseModelName(raw);
  if (p.isBanned) return esc(p.raw);

  // 在原文件名上着色，保留原有顺序，不重新排列
  let name = raw.replace(/\.\w+$/, "");

  // 先找到所有匹配位置，按文件中的原始顺序排序
  const matches: NameMark[] = [];

  // 匹配括号段（注册表驱动，索引 4.7）：[作者]/【作品】/《作品》共用 BRACKET_STYLES
  for (const style of BRACKET_STYLES) {
    const re = new RegExp(escRegex(style.open) + "([^" + escRegex(style.close) + "]+?)" + escRegex(style.close), "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(name)) !== null) {
      matches.push({
        idx: m.index,
        // P3 修复（子代理审计，问题 14）：`[ ]` 是作者段——原标 tag-work 与头注释
        // 「--meta-author/--meta-work/--meta-date」及 summarize.ts:113 的 tag-author
        // 不一致（Design.md §3 语义色：作者青 / 作品灰）；【】/《》保持 tag-work
        html: '<span class="' + style.tag + '">' + esc(m[0]) + "</span>",
        len: m[0].length,
      });
    }
  }

  // 匹配日期
  if (p.date) {
    // P3 修复（子代理审计）：分隔符通配检索——parseModelName 把 `2023.05`/`2023_05`
    // 归一为 `2023-05`，原字面搜索对原文 `角色2023.05.ysm` 搜不到 → 日期永不高亮；
    // `-` 通配 `[-_.]` 三态分隔符（escRegex 已转义其余字符）
    const re4 = new RegExp(escRegex(p.date).replace(/-/g, "[-_.]"), "g");
    let m4: RegExpExecArray | null;
    while ((m4 = re4.exec(name)) !== null) {
      // P3 修复：剔除与既有括号段（[ ]/【 】/《 》）区间重叠的日期命中——
      // `【2023】角色.ysm` 中 date(2023) 与 work(【2023】) 区间重叠，反向替换后
      // 内部 token 泄漏到 UI（输出 `KEN%%】角色` 残渣）。日期在括号内时括号段已包含它。
      const overlaps = matches.some(
        (m) => m4!.index < m.idx + m.len && m4!.index + m4![0].length > m.idx,
      );
      if (overlaps) continue;
      matches.push({
        idx: m4.index,
        html: '<span class="tag-date">' + esc(m4[0]) + "</span>",
        len: m4[0].length,
      });
    }
  }

  // 按文件中出现的顺序排序
  matches.sort((a, b) => a.idx - b.idx);

  // P3 修复（审核）：光标式重组替换原占位符 token 方案——原 `%%TOKEN%%` 占位串
  // 与文件名内文字面量碰撞时（文件名恰含 %%TOKEN%%）会静默丢字（实测
  // "角色%%TOKEN%%2023.ysm" 输出丢失 %%TOKEN%%）。改为按匹配区间直接切分原文：
  // 每段原文过 renderFormattedText（§ 分节符色 + 转义），区间处插入匹配 span。
  let cursor = 0;
  let html = "";
  for (const m of matches) {
    html += renderFormattedText(name.slice(cursor, m.idx));
    html += m.html;
    cursor = m.idx + m.len;
  }
  html += renderFormattedText(name.slice(cursor));

  return html;
}

/** renderModelName = renderDisplayName 别名，options.showExt 支持 */
export function renderModelName(raw: string, options: { tpl?: unknown; showExt?: boolean } = {}): string {
  const p = parseModelName(raw);
  return (
    renderDisplayName(raw, options.tpl) +
    (options.showExt && p.ext ? `<span class="tag-ext">.${esc(p.ext)}</span>` : "")
  );
}

/** 搜索高亮版：先对纯文本高亮，再渲染 HTML，避免 keyword 命中 HTML 标签内容破坏 DOM */
export function renderModelNameWithHighlight(raw: string, keyword?: string, options: { tpl?: unknown; showExt?: boolean } = {}): string {
  const p = parseModelName(raw);
  // 对纯文本（不含扩展名）做高亮
  const plain = raw.replace(/\.\w+$/, "");
  let highlighted = plain;
  if (keyword) {
    const re = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    highlighted = highlighted.replace(re, "<mark>$1</mark>");
  }
  // P2 修复：高亮结果必须逐段转义后再拼回（<mark> 除外）——
  // 原实现直接拼接 highlighted（文件名含 <script>/<img onerror> 时注入 HTML），
  // 且绕过 renderDisplayName 的 esc 契约，是 display 管线唯一未转义输出口。
  // 策略：拆出 <mark>…</mark> 段，内容 esc 后重组。
  let safe = "";
  let rest = highlighted;
  let m: RegExpExecArray | null;
  const markRe = /<mark>(.*?)<\/mark>/g;
  let last = 0;
  while ((m = markRe.exec(rest)) !== null) {
    safe += esc(rest.slice(last, m.index)) + "<mark>" + esc(m[1]) + "</mark>";
    last = m.index + m[0].length;
  }
  safe += esc(rest.slice(last));
  const extHtml = options.showExt && p.ext ? `<span class="tag-ext">.${esc(p.ext)}</span>` : "";
  return safe + extHtml;
}
