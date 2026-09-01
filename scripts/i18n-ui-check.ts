#!/usr/bin/env node
/**
 * i18n-ui-check.ts — i18n UI 漂移检查（治本：堵住"动态菜单漏译"盲区）
 *
 * 背景：
 *   既有 i18n-check.ts 只查语言包(key parity/占位符/zh-CN 漏译/语言清单漂移)，
 *   对「组件源码里硬写中文、且完全没调 t()」的 UI 完全失明——这类字符串切语言永远是
 *   中文，但 key 检查器永远不报错（假绿）。典型：tpl.ts / render.ts / dialogs 里
 *   用模板字符串拼的中文按钮、下拉项、placeholder、空状态文案。
 *
 *   本脚本专门抓这一类：扫描 frontend/src 下所有 .ts（排除 *.test.ts 与语言包源），
 *   命中「含 HTML 标记 + 含中文 + 未包 t()」的字符串即判为漂移。
 *
 * 判定（精确、低误报）：
 *   1. 先遮罩注释（行/块注释 → 同长空格，保留换行与偏移，行号才准）；
 *   2. 抽所有字符串字面量（单/双/反引号，反引号可跨行）；
 *   3. 字面量同时含 [汉字] + [HTML 信号] → 候选；
 *   4. 若该字面量是 `t("...")` 直接参数（前缀 `\bt(\s*`）→ 已翻译，跳过；
 *   5. 排除：语言选择器原生名（value="zh-CN"/"en"/"ja" 的 option 文本，标准 UX 刻意不翻）。
 *
 * HTML 信号 = 含 `<字母|/|!` 标签，或 class=/data-testid/placeholder=/title=/id=/</
 *             /<option/<button 之一。只抓「渲染到 DOM 的用户可见文本」，避开标识符/数据映射。
 *
 * 设计意图：i18n 化后 UI 组件硬写中文且零 t() 调用，是"动态菜单漏译"盲区——
 * key 检查器只看语言包文件，对组件源码里的硬编码中文完全失明。
 * 本脚本补全这道防线，从源头堵住硬编码中文。
 *
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.ts
 *
 * 用法：
 *   node scripts/i18n-ui-check.ts            # 文本报告（warning，不阻断）
 *   node scripts/i18n-ui-check.ts --json     # JSON（doctor/CI 消费）
 *   node scripts/i18n-ui-check.ts --strict   # 有漂移则 exit 1（CI 强阻断）
 *
 * 退出码：warning 模式恒 0（靠 doctor 侧 WARN 渲染）；--strict 且有漂移 → 1；干净 → 0。
 */

import fs from "node:fs";
import path from "node:path";
import { getRoot } from "./_lib/scan-files.ts";

const ROOT = getRoot();
const SRC = path.join(ROOT, "frontend", "src");
const LOCALE_DIR = path.join(SRC, "core", "i18n", "locales");

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const STRICT = args.has("--strict");
// 未知 flag 白名单拦截（批次4 P2）：`--stric` 拼错会被 Set 静默忽略 → 严格门禁悄悄关闭（假绿）。
// 与 link-checker/codemod 同款守卫，拼错即退 1。
const KNOWN_FLAGS = new Set(["--json", "--strict", "--help", "-h"]);
const unknownFlags = [...args].filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
if (unknownFlags.length) {
  console.error(`[i18n-ui-check] 未知 flag: ${unknownFlags.join(", ")}（支持 --json / --strict）`);
  process.exit(1);
}

const HAN = /[一-鿿]/;
const HTML_SIGNAL =
  /<[a-zA-Z/!]|class\s*=|data-testid|placeholder\s*=|title\s*=|id\s*=|<\/|<option|<button/;
// 语言选择器原生名（刻意不翻，标准 UX）
const LANG_PICKER = /value="(zh-CN|en|ja)"/;

/** 把注释遮罩成同长空格（保留换行与字符偏移，行号才准）。 */
function maskComments(src: string) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * 遮罩 TS 类型索引访问（如 `: BedrockGeometry["bones"]`）里的引号，避免类型 key 被误当字符串。
 * 注意：曾存在 maskRegexLiterals 遮罩「正则字面量体内引号」，经实测为净负资产——
 * 它把 `replace(/\\/g, "/")` 整段遮成空格（连引号一起遮没），破坏全局引号配对平衡，
 * 导致后续 STR_RE 跨行误配、把几十行代码吞进一个"字符串"（wasm.ts 4 处误报的根因）；
 * 且其声称要防的"正则含引号被误当字符串"全仓零发生（去掉后零新误报）。已删除。
 */
function maskTsTypeIndex(src: string) {
  return src.replace(
    /:\s*[A-Za-z$_][\w$]*\s*\[\s*["'][^"']*["']\s*\]/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

/** 字符串字面量正则：单/双/反引号，反引号可跨行。 */
const STR_RE = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;

function lineOf(src: string, idx: number) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function scanFile(file: string) {
  const raw = fs.readFileSync(file, "utf8");
  const masked = maskTsTypeIndex(maskComments(raw));
  const hits: { line: number; snippet: string }[] = [];
  STR_RE.lastIndex = 0;
  let m;
  while ((m = STR_RE.exec(masked)) !== null) {
    const lit = m[2]!;
    const start = m.index;
    if (!HAN.test(lit)) continue;
    if (!HTML_SIGNAL.test(lit)) continue;
    if (/\bt\(\s*$/.test(masked.slice(0, start))) continue; // 已翻译
    // 拼接链（'a' + t("key") + 'b'）：剥离其中的 t("key") 调用段，若剩余中文都在 t() 里则视为已翻译
    if (/\bt\(/.test(lit)) {
      const strippedT = lit.replace(/\bt\s*\(\s*"[^"]*"(?:\s*,\s*\{[^}]*\})?\s*\)/gs, "");
      if (!HAN.test(strippedT)) continue;
    }
    if (m[1] === "`") {
      // 模板字符串：剥离所有 ${...} 插值块（支持嵌套大括号），若剩余不含中文则已翻译。
      // 插值块内要么是 t() 调用、要么是 JS 逻辑/数据值，都不作为 UI 文本判定。
      let stripped = "";
      let i = 0;
      while (i < lit.length) {
        const open = lit.indexOf("${", i);
        if (open === -1) {
          stripped += lit.slice(i);
          break;
        }
        // 拷贝 ${ 之前的内容
        stripped += lit.slice(i, open);
        // 找插值块的结束 }（跳过 "${"，对内部嵌套大括号计数）
        let depth = 0;
        let j = open + 2;
        for (; j < lit.length; j++) {
          if (lit[j] === "{") depth++;
          else if (lit[j] === "}") {
            if (depth === 0) break;
            depth--;
          }
        }
        i = (j < lit.length ? j + 1 : j); // 跳到插值块之后
      }
      if (!HAN.test(stripped)) continue;
    }
    if (LANG_PICKER.test(lit)) continue; // 语言选择器原生名
    hits.push({ line: lineOf(masked, start), snippet: lit.length > 60 ? lit.slice(0, 57) + "…" : lit });
  }
  return hits;
}

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (path.resolve(p) === LOCALE_DIR) continue; // 跳过语言包源
      walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
}

const files: string[] = [];
walk(SRC, files);
const report: { file: string; hits: { line: number; snippet: string }[] }[] = [];
let total = 0;
for (const f of files) {
  const hits = scanFile(f);
  if (hits.length) {
    total += hits.length;
    report.push({ file: path.relative(ROOT, f).split(path.sep).join("/"), hits });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ drift: total, files: report.length, details: report }, null, 2));
  process.exit(STRICT && total ? 1 : 0);
}

console.log("i18n UI 漂移检查 (i18n-ui-check)");
console.log("规则: 含 HTML 标记 + 含中文 + 未包 t() → 漂移（已排除语言包/测试/语言选择器原生名）");
console.log(`扫描: ${files.length} 个 .ts`);
console.log("─".repeat(60));
if (!total) {
  console.log("✅ 未发现硬编码中文 UI（动态菜单已接入 t()）");
} else {
  for (const r of report) {
    console.log(`📄 ${r.file}  (${r.hits.length} 处)`);
    for (const h of r.hits) console.log(`   L${h.line}: ${h.snippet}`);
  }
  console.log("─".repeat(60));
  console.log(`共 ${total} 处漂移，涉及 ${report.length} 个文件`);
}
process.exit(STRICT && total ? 1 : 0);
