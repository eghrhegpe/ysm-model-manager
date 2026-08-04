// ===== 模型文件名解析 + 美化显示管线（类型化版 — ADR-014 P2）=====
import { renderFormattedText } from "../format/mc-format.ts";
import { esc } from "./dom.ts";

/** 解析后的模型文件名字段 */
export interface ParsedModelName {
  raw: string;
  isBanned: boolean;
  author: string;
  work: string;
  chara: string;
  character: string;
  date: string;
  ext: string;
}

interface NameMark {
  idx: number;
  html: string;
  len: number;
}

/**
 * 解析模型文件名 → 结构化字段
 * 支持格式: [作者]【作品】角色变体2023-05.ysm
 * 也兼容: [作者]《作品》角色变体2023-05.ysm
 */
export function parseModelName(raw: string): ParsedModelName {
  const name = raw.endsWith(".ban") ? raw.slice(0, -4) : raw;
  const extMatch = name.match(/\.(\w+)$/);
  const aMatch = name.match(/\[\[([^\]]+?)\]\]/) || name.match(/\[([^\]]+?)\]/);
  const wMatch = name.match(/【([^】]+?)】/) || name.match(/《([^》]+?)》/);
  const dMatch = name.match(/(\d{4})[-_.]?(\d{1,2})?/);

  const author = (aMatch ? aMatch[1] : "").trim();
  const work = (wMatch ? wMatch[1] : "").trim();
  const date = dMatch
    ? dMatch[2]
      ? dMatch[1] + "-" + dMatch[2].padStart(2, "0")
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
    isBanned: raw.endsWith(".ban"),
    author,
    work,
    chara: chara || "",
    character: chara || "",
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
export function renderDisplayName(raw: string, opts?: unknown): string {
  const p = parseModelName(raw);
  if (p.isBanned) return esc(p.raw);

  // 在原文件名上着色，保留原有顺序，不重新排列
  let name = raw.replace(/\.\w+$/, "");

  // 先找到所有匹配位置，按文件中的原始顺序排序
  const matches: NameMark[] = [];

  // 匹配 [xxx]
  const re1 = /\[([^\]]+?)\]/g;
  let m1: RegExpExecArray | null;
  while ((m1 = re1.exec(name)) !== null) {
    matches.push({
      idx: m1.index,
      html: '<span class="tag-work">' + esc(m1[0]) + "</span>",
      len: m1[0].length,
    });
  }

  // 匹配 【xxx】
  const re2 = /【([^】]+?)】/g;
  let m2: RegExpExecArray | null;
  while ((m2 = re2.exec(name)) !== null) {
    matches.push({
      idx: m2.index,
      html: '<span class="tag-work">' + esc(m2[0]) + "</span>",
      len: m2[0].length,
    });
  }

  // 匹配 《xxx》
  const re3 = /《([^》]+?)》/g;
  let m3: RegExpExecArray | null;
  while ((m3 = re3.exec(name)) !== null) {
    matches.push({
      idx: m3.index,
      html: '<span class="tag-work">' + esc(m3[0]) + "</span>",
      len: m3[0].length,
    });
  }

  // 匹配日期
  if (p.date) {
    const re4 = new RegExp(escRegex(p.date), "g");
    let m4: RegExpExecArray | null;
    while ((m4 = re4.exec(name)) !== null) {
      matches.push({
        idx: m4.index,
        html: '<span class="tag-date">' + esc(m4[0]) + "</span>",
        len: m4[0].length,
      });
    }
  }

  // 按文件中出现的顺序排序
  matches.sort((a, b) => a.idx - b.idx);

  // 从后往前替换，避免 idx 偏移
  let marked = name;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    marked = marked.slice(0, m.idx) + "%%TOKEN%%" + marked.slice(m.idx + m.len);
  }

  // 拆分后对非 token 部分渲染 § 分节符颜色 + 转义，再拼回 token 的 HTML
  const parts = marked.split("%%TOKEN%%");
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    html += renderFormattedText(parts[i]);
    if (i < matches.length) html += matches[i].html;
  }

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

/** 搜索高亮版 */
export function renderModelNameWithHighlight(raw: string, keyword?: string, options: { tpl?: unknown; showExt?: boolean } = {}): string {
  let html = renderDisplayName(raw, options);
  if (keyword) {
    const re = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    html = html.replace(re, "<mark>$1</mark>");
  }
  return html;
}
