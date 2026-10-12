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
 *   3. 双通道入候选（D3 补，2026-10-12——原单 HTML 判据对无标记的 UI 值字段全绿放行，
 *      即「检查器承诺 > 检查器射程」）：
 *      通道一 · 字面量同时含 [汉字] + [HTML 信号] → 候选（渲染进 DOM 的模板）；
 *      通道二 · 字面量含 [汉字] 且所在行是 UI 值字段上下文（`value|text|tooltip` 赋值）
 *               → 候选（MenuNode schema 的 value 侧——D2 病灶形态 `${n} 个` 无 HTML 信号，
 *               正是通道一漏的那族）。
 *      通道三 · 字面量含 [汉字] 且行内前缀是错误构造头（`throw new Error` / `reject(new Error)`
 *               / `throw new TypeError`）→ 候选（ADR-331 §2.5：throw/reject 中文会经
 *               friendlyError/showLoadFailure 上屏，属用户可见硬编码）。内部诊断走台账豁免：
 *               `// i18n-allow: 内部诊断` 行注（命中行或上一行）即跳过（ADR-331 §2.4）。
 *               label 侧不查：判净#5 裁决「label: 静态中文 = 键缺失合法回退」。
 *   4. 若该字面量是 `t("...")` 直接参数（前缀 `\bt(\s*`）→ 已翻译，跳过；
 *   5. 排除：语言选择器原生名（value="zh-CN"/"en"/"ja" 的 option 文本，标准 UX 刻意不翻）、
 *      行级豁免尾注 `// i18n-allow: <理由>`（同 r8-allow/pointer-allow 先例，命中行或上一行）。
 *
 * HTML 信号 = 含 `<字母|/|!` 标签，或 class=/data-testid/placeholder=/title=/id=/</
 *             /<option/<button 之一。只抓「渲染到 DOM 的用户可见文本」，避开标识符/数据映射。
 *
 * 设计意图：i18n 化后 UI 组件硬写中文且零 t() 调用，是"动态菜单漏译"盲区——
 * key 检查器只看语言包文件，对组件源码里的硬编码中文完全失明。
 * 本脚本补全这道防线，从源头堵住硬编码中文。
 *
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.ts
 * 用法：
 *   node scripts/i18n-ui-check.ts            # 文本报告（warning，不阻断）
 *   node scripts/i18n-ui-check.ts --json     # JSON（doctor/CI 消费）
 *   node scripts/i18n-ui-check.ts --strict   # 有漂移则 exit 1（CI 强阻断）
 *
 * 退出码：warning 模式恒 0（靠 doctor 侧 WARN 渲染）；--strict 且有漂移 → 1；干净 → 0。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRoot, walk } from "./_lib/scan-files.ts";

const ROOT = getRoot();
const SRC = path.join(ROOT, "frontend", "src");

const HAN = /[一-鿿]/;
const HTML_SIGNAL =
  /<[a-zA-Z/!]|class\s*=|data-testid|placeholder\s*=|title\s*=|id\s*=|<\/|<option|<button/;
// 通道二（D3 补）：UI 值字段上下文行——MenuNode schema `value:` / 控件 text/tooltip 侧。
// 判据取「行首到字面量之间的赋值头」：`value:` `text:` `tooltip:`（含对象字面量同行形态，
// 如 `{ id, kind, labelKey, value: "中文" }` 与 `value: \`模板\``）。
const UI_VALUE_ASSIGN =
  /^\s*(?:value|text|tooltip)\s*[:=]\s*["'`]?\s*$|[{,]\s*(?:value|text|tooltip)\s*[:=]\s*["'`]?\s*$/;
// 通道三（D1 收口配套）：throw new Error(中文) / reject(new Error(中文)) —— 错误构造点。
// 这些串不进 DOM（无 HTML 信号）、非 value/text/tooltip 赋值，但会经 friendlyError/showLoadFailure
// 上屏，属用户可见硬编码中文。判据取「行首到字面量之间的错误构造头」。
const THROW_REJECT =
  /(?:throw\s+new\s+Error|reject\s*\(\s*new\s+Error|throw\s+new\s+TypeError)\s*\(/;
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
  return src.replace(/:\s*[A-Za-z$_][\w$]*\s*\[\s*["'][^"']*["']\s*\]/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

/** 字符串字面量正则：单/双/反引号，反引号可跨行。 */
const STR_RE = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;

/**
 * 纯核（D3 补后导出供契约测试直测「判据非空转」，同 _lib/innerhtml-hygiene 惯例）：
 * 输入遮罩前源码文本，输出漂移命中（行号 + 片段）。
 * 行号反查用二分（原线性 lineOf 在 622 文件全扫下 O(n²) 热点，随本次重构移除）。
 */
export function scanSourceText(raw: string) {
  const masked = maskTsTypeIndex(maskComments(raw));
  const rawLines = raw.split("\n");
  const maskedLines = masked.split("\n");
  // 行首偏移表：由字面量起点反查所在行（行号语义与 mask 等长替换保持一致）
  const lineStarts: number[] = [];
  {
    let acc = 0;
    for (const l of maskedLines) {
      lineStarts.push(acc);
      acc += l.length + 1;
    }
  }
  const lineIndexOf = (idx: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const hits: { line: number; snippet: string }[] = [];
  STR_RE.lastIndex = 0;
  let m = STR_RE.exec(masked);
  while (m !== null) {
    const cur = m; // 本轮快照：各 continue 分支不影响顶部统一递进
    m = STR_RE.exec(masked);
    const lit = cur[2]!;
    const start = cur.index;
    if (!HAN.test(lit)) continue;
    if (/\bt\(\s*$/.test(masked.slice(0, start))) continue; // 已翻译
    // 拼接链（'a' + t("key") + 'b'）：剥离其中的 t("key") 调用段，若剩余中文都在 t() 里则视为已翻译
    if (/\bt\(/.test(lit)) {
      const strippedT = lit.replace(/\bt\s*\(\s*"[^"]*"(?:\s*,\s*\{[^}]*\})?\s*\)/gs, "");
      if (!HAN.test(strippedT)) continue;
    }
    if (cur[1] === "`") {
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
        i = j < lit.length ? j + 1 : j; // 跳到插值块之后
      }
      if (!HAN.test(stripped)) continue;
    }
    if (LANG_PICKER.test(lit)) continue; // 语言选择器原生名
    // 三通道判据（D3 双通道 + D1 收口补 THROW_REJECT 通道）：t()/插值剥离之后、入册之前。
    const lineIdx = lineIndexOf(start);
    if (HTML_SIGNAL.test(lit)) {
      // 通道一（原判据）：字面量自带 HTML 标记 → 渲染模板，直接入册。
    } else {
      // 通道二 / 三（新补）：字面量之前的行内前缀匹配 UI 值字段 / 错误构造头。
      const linePrefix = maskedLines[lineIdx]!.slice(0, start - lineStarts[lineIdx]!);
      if (!UI_VALUE_ASSIGN.test(linePrefix) && !THROW_REJECT.test(linePrefix)) continue;
      // 行级豁免台账（同 pointer-allow 先例）：`// i18n-allow: <理由>` 命中行或上一行
      // ——用 raw 原文行判（masked 把注释遮成空格，豁免注必须看得见原文才生效）。
      // 通道三特例：内部诊断 throw/reject 中文靠 `// i18n-allow: 内部诊断` 豁免（ADR-331 §2.4）。
      const win = `${rawLines[lineIdx - 1] ?? ""}\n${rawLines[lineIdx] ?? ""}`;
      if (/i18n-allow:/.test(win)) continue;
    }
    hits.push({
      line: lineIdx + 1,
      snippet: lit.length > 60 ? `${lit.slice(0, 57)}…` : lit,
    });
  }
  return hits;
}

function scanFile(file: string) {
  return scanSourceText(fs.readFileSync(file, "utf8"));
}

// main 守卫：本文件被契约测试 import（取 scanSourceText 纯核）时不得执行全仓扫描、
// 更不得 process.exit（会杀死测试进程）；仅 `node scripts/i18n-ui-check.ts` 直跑才扫。
// flag 解析亦移入 main——顶层读 process.argv 会让 import 方（测试运行器）的 argv 被
// 当成本脚本参数（未知 flag 直接 exit 1，全绿也变崩）。
function main(): void {
  const args = new Set(process.argv.slice(2));
  const JSON_OUT = args.has("--json");
  const STRICT = args.has("--strict");
  // 未知 flag 白名单拦截（批次4 P2）：`--stric` 拼错会被 Set 静默忽略 → 严格门禁悄悄关闭（假绿）。
  // 与 link-checker/codemod 同款守卫，拼错即退 1。
  const KNOWN_FLAGS = new Set(["--json", "--strict", "--help", "-h"]);
  const unknownFlags = [...args].filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknownFlags.length) {
    console.error(
      `[i18n-ui-check] 未知 flag: ${unknownFlags.join(", ")}（支持 --json / --strict）`,
    );
    process.exit(1);
  }

  // 复用共享层 walk（原为自研递归）。
  // 「跳过语言包源」从死分支修正为生效（2026-09）：原自研实现比对 `path.resolve(p) === LOCALE_DIR`
  // 且 LOCALE_DIR 写作 src/core/i18n/locales，但该目录在 i18n 迁移后已不存在——语言包实际在
  // src/locales/{en,ja,zh-CN}.ts，判断恒 false（死分支），语言包源长期被误扫。
  // 后果实证：修复前 13 处告警（ja 6 + zh-CN 7）全部来自语言包自身译文——语言包里的
  // `"content.errNoIndex": "❌ 无 index.json<br>"` 这类含 HTML 标签的富文本译文，
  // 天然命中「HTML 信号 + 中文 + 未包 t()」，但它本身就是译文、不是硬编码 UI。
  // 按原设计意图排除（语言包是译文的源头，不该被当违规源）。
  const LOCALE_DIR = path.join(SRC, "locales");
  const files = walk(SRC, {
    exts: [".ts"],
    skipDir: (name) => path.join(SRC, name) === LOCALE_DIR,
    skipFile: /\.test\.ts$/,
  }) as string[];
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
  console.log(
    "规则: 中文 +（HTML 信号 ∪ UI 值字段上下文 ∪ throw/reject 错误构造）+ 未包 t() → 漂移（已排除语言包/测试/语言选择器原生名/i18n-allow 台账）",
  );
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
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
