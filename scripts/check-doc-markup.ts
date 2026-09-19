#!/usr/bin/env node
/**
 * check-doc-markup.ts — docs/ markdown 的 Vue 模板安全性检查（裸尖括号）。
 *
 * 背景：VitePress 把 docs 下每个 .md 编译成 Vue SFC。markdown-it 只把**合法 HTML 标签**
 * 放行为原始 HTML，其余尖括号转义成 &lt;——被放行的裸标签会被 Vue 当成元素，其外层元素
 * 闭合时抛 `Element is missing end tag` 并**中断整站构建**（GitHub Pages 部署连续失败）。
 * 实证事故：docs/knowledge/go-scanner.md 的 `rust_backend_<os>.go` 漏了反引号，
 * Pages 自 2026-09-18 起连续失败 6 次才被定位（提交 cb4f73396 修）。
 *
 * 判定规则（对齐 VitePress 真实 markdown-it 渲染器）：
 *   命中 = 行内代码 / 围栏代码 / frontmatter 之外的 `<` 同时满足
 *     ① 形如合法 HTML 开标签（markdown-it open_tag：ASCII 标签名 + 合法属性 + `>` 或 `/>`）
 *     ② 非自闭合 `/>`、非 void 标签
 *     ③ 同一文件内找不到配对的 `</name>`（配对也须在代码之外——见 scanText 注释）
 *   三条齐 → Vue 必然在某个外层元素闭合时报错（markdown 总会把内容包进
 *   `<p>`/`<li>`/`<h2>`/`<td>` 之类），故判 ERROR，无需真跑一次构建。
 *
 * 实证依据（2026-09-19 用 VitePress 的 createMarkdownRenderer 逐例验证，并用真实
 * `vitepress build` 做探针裁决：探针里的裸标签 → 构建 exit 1 且报错落在该文件）：
 *   `<os>` / `rust_backend_<os>.go` → 放行(危险)；`Map<url, Texture>`、`<ISO时间>`、
 *   `<commit hash 或 "…">`、`<tag/data-testid)`、`a < b 且 c > d` → 转义(安全)；
 *   `<br>` / `<hr>` / `<img src="x">` → 放行但 void(无害)；`` `<os>` `` → 代码内已转义(安全)。
 *   全 docs 语料实测 0 命中（无存量债，故不设 baseline）。
 *
 * 已知盲区（刻意不判，宁漏勿误报）：跨行的多行开标签；docs/ 之外不在域内（VitePress 只建 docs）。
 *
 * 设计意图：把「VitePress 能不能建成」这类**部署期才暴露**的断裂，前移到提交 / 推送期做
 *           确定性判定——不必真跑一次 50s 构建，也不依赖 docs/node_modules 是否安装
 *           （零依赖，杜绝「环境缺依赖 → 闸恒空转」的摆设风险）。
 *
 * 依赖：node:fs / node:path / node:url + _lib/scan-files.ts（ROOT、walk）+ _lib/parse-args.ts。
 *
 * 用法：
 *   node scripts/check-doc-markup.ts            # 文本报告
 *   node scripts/check-doc-markup.ts --json     # JSON（CI / doctor / pre-push-gate 消费）
 *
 * 退出码：0 通过 / 1 存在裸标签。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, walk } from "./_lib/scan-files.ts";

const DOCS_DIR = path.join(ROOT, "docs");

/**
 * HTML void 标签：无闭合体，放行为原始 HTML 也无害（Vue 的 isVoidTag 同源集合）。
 */
export const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// ── markdown-it 的 HTML 开标签识别（逐段内联自其 lib/common/html_re.mjs，
//    为的是零依赖复用同一判定口径；改动请对照上游同名常量）──
const MI_ATTR_NAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const MI_UNQUOTED = "[^\"'=<>`\\x00-\\x20]+";
const MI_SINGLE_QUOTED = "'[^']*'";
const MI_DOUBLE_QUOTED = '"[^"]*"';
const MI_ATTR_VALUE = `(?:${MI_UNQUOTED}|${MI_SINGLE_QUOTED}|${MI_DOUBLE_QUOTED})`;
const MI_ATTRIBUTE = `(?:\\s+${MI_ATTR_NAME}(?:\\s*=\\s*${MI_ATTR_VALUE})?)`;
/** 锚定在 `<` 处匹配合法开标签；m[1] = 标签名。 */
const OPEN_TAG_RE = new RegExp(`^<([A-Za-z][A-Za-z0-9-]*)${MI_ATTRIBUTE}*\\s*\\/?>`);
/** 闭合标签（收集配对用）。 */
const CLOSE_TAG_RE = /<\/([A-Za-z][A-Za-z0-9-]*)\s*>/g;

export interface Hit {
  file: string;
  line: number;
  col: number;
  tag: string;
  snippet: string;
  reason: string;
}

/**
 * 行内代码区间（markdown-it code_inline 口径）：
 * N 个反引号开启，遇到**恰好** N 个反引号闭合；找不到闭合则整段按普通文本处理（不当代码）。
 */
export function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (i + n < line.length && line[i + n] === "`") n++;
    const openEnd = i + n;
    let j = openEnd;
    let closed = -1;
    while (j < line.length) {
      if (line[j] === "`") {
        let m = 0;
        while (j + m < line.length && line[j + m] === "`") m++;
        if (m === n) {
          closed = j;
          break;
        }
        j += m;
        continue;
      }
      j++;
    }
    if (closed === -1) {
      i = openEnd;
      continue;
    }
    ranges.push([i, closed + n]);
    i = closed + n;
  }
  return ranges;
}

/** 位置是否落在任一 code 区间内。 */
function inRanges(ranges: Array<[number, number]>, pos: number): boolean {
  return ranges.some(([a, b]) => pos >= a && pos < b);
}

/**
 * 逐行遍历「参与 Vue 模板的上下文」：跳过围栏代码与 frontmatter，
 * 并给出该行的行内代码区间（调用方据此排除代码内的尖括号）。
 */
export function forEachContentLine(
  lines: string[],
  fn: (line: string, li: number, code: Array<[number, number]>) => void,
): void {
  let fence: string | null = null;
  let inFrontmatter = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? "";
    const fenceMarker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fenceMarker) {
      if (fence === null) fence = fenceMarker;
      else if (fence === fenceMarker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    // frontmatter：首行 --- 起、下一个 --- 止（其内容不进 Vue 模板）
    if (li === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    fn(line, li, inlineCodeRanges(line));
  }
}

/**
 * 扫描一段 markdown 源文本，返回裸标签命中（纯函数，零 IO——契约测试的绑定面）。
 *
 * ⚠️ 闭合标签的收集也必须过同一套代码感知扫描：行内代码里的 `</os>` 已被 markdown-it
 * 转义成 `&lt;/os&gt;`，Vue 根本看不到；若把它计为配对，就会把真命中「救」成假阴性
 * （探针实测踩过：`` `<os>` `` 与 `` `</os>` `` 同现时漏报）。
 */
export function scanText(rel: string, src: string): Hit[] {
  const hits: Hit[] = [];
  const lines = src.split(/\r?\n/);

  const closeNames = new Set<string>();
  forEachContentLine(lines, (line, _li, code) => {
    for (const m of line.matchAll(CLOSE_TAG_RE)) {
      const name = m[1];
      if (!name) continue;
      if (inRanges(code, m.index ?? 0)) continue;
      closeNames.add(name.toLowerCase());
    }
  });

  forEachContentLine(lines, (line, li, code) => {
    let searchFrom = 0;
    while (searchFrom < line.length) {
      const c = line.indexOf("<", searchFrom);
      if (c === -1) break;
      searchFrom = c + 1;
      if (inRanges(code, c)) continue;
      const rest = line.slice(c);
      const m = OPEN_TAG_RE.exec(rest);
      if (!m) continue; // markdown-it 会转义 → 安全
      const tagName = m[1];
      if (!tagName) continue;
      const raw = m[0] ?? "";
      const tag = tagName.toLowerCase();
      if (/\/>$/.test(raw)) continue; // 自闭合
      if (VOID_TAGS.has(tag)) continue; // void 标签
      if (closeNames.has(tag)) continue; // 文件内有配对闭合
      hits.push({
        file: rel,
        line: li + 1,
        col: c + 1,
        tag: tagName,
        snippet: rest.slice(0, 60),
        reason: `<${tagName}> 会被 Vue 当成未闭合元素（无配对 </${tagName}>）`,
      });
    }
  });
  return hits;
}

/** 单文件入口（读盘后交给 scanText）。 */
function scanFile(abs: string, rel: string): Hit[] {
  try {
    return scanText(rel, fs.readFileSync(abs, "utf8"));
  } catch {
    return [];
  }
}

/** 收集待检 md：VitePress 构建域 = docs/ 下非点目录、非 node_modules/dist/public，再排除 srcExclude 的 archive/。 */
export function collectDocs(): Array<{ abs: string; rel: string }> {
  const files = walk(DOCS_DIR, {
    exts: [".md"],
    rel: true,
    skipDir: (n) => n.startsWith(".") || n === "node_modules" || n === "dist" || n === "public",
    skipFile: (n) => n.startsWith("."),
  }) as Array<{ abs: string; rel: string }>;
  return files.filter((f) => !f.rel.startsWith("archive/"));
}

function main(): void {
  const files = collectDocs();
  const hits: Hit[] = [];
  // 缺 docs/（异常仓库结构）时按无文件处理，不误报
  if (fs.existsSync(DOCS_DIR)) for (const f of files) hits.push(...scanFile(f.abs, f.rel));

  const errors = hits.map(
    (h) => `${h.file}:${h.line}:${h.col} 裸标签 <${h.tag}> —— ${h.reason}；修法：包进行内反引号`,
  );

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: { files: files.length, errors: errors.length },
          errors,
          items: hits,
        },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
  }

  console.log("══════════════════════════════════════");
  console.log(" docs markdown 裸标签检查 (check-doc-markup)");
  console.log("══════════════════════════════════════");
  console.log(`扫描 ${files.length} 个 md（docs/，排除 archive 冻结区），ERROR ${errors.length} 条`);
  console.log("──────────────────────────────────────");
  for (const e of errors) console.log(`❌ ${e}`);
  if (!errors.length)
    console.log("✅ 无裸标签：全站 markdown 不会因未闭合元素中断 VitePress 构建。");
  process.exit(errors.length ? 1 : 0);
}

const args = parseArgs(process.argv.slice(2), { bools: ["json"] });
if (args.unknown.length) console.warn(`忽略未知参数: ${args.unknown.join(", ")}`);
const JSON_OUT = args.json as boolean;

const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) main();
