#!/usr/bin/env node
/**
 * i18n-frozen-t-check.ts — 模块级「冻结 t()」检查（第五个 i18n 闸，2026-10-13）
 *
 * 立因（2026-10-13 诊断页锐评 P0）：`const OP_META = { import: { label: t("…") } }` 这类
 * **模块构建期**求值的 t() 把译文焊死在首查语言包上。而 locale.ts 自己写明（initI18n 头注）：
 * 组件渲染可能早于语言包就绪、customElements.define 在模块顶层同步执行——顶层求值时刻
 * 语言包未必已按用户偏好装载，tOf 回退链落 zh-CN；此后 `lang:changed` 只重建 DOM、**不重建
 * 模块**。后果：en/ja 界面上这些标签永远是中文，且既有四道 i18n 闸（key parity / 命名 /
 * UI 硬编码中文 / 死键）全部看不见——它们查「文案有没有包 t()」，而这里恰恰包了 t()，
 * 只是包得太早。这是四闸的公共盲区，不是又一类硬编码。
 *
 * 判定（确定性状态机，非启发式）：
 *   1. 遮罩注释 / TS 类型索引 / 字符串字面量（反引号 ${…} 插值块保留为代码态）；
 *   2. 花括号深度逐行跟踪；
 *   3. 行首匹配顶层 `const|let|var NAME … =`（该行行首深度须为 0）→ 进入该声明的
 *      **初始化区**，直到语句闭合（行尾 `;`）；初始化区内（行首深度 ≤1，即对象/数组
 *      字面量属性值、三元分支——全部是构建期求值位置）出现 `t(`/`tOf(` 调用 → 命中；
 *   4. `=> t(`（箭头体直接返回）不算——惰性闭包，调用期求值，是合法替代写法；
 *   5. 行级豁免台账 `// i18n-allow: <理由>`（命中行或上一行，同 pointer-allow 先例）。
 *
 * 判例（契约测试 tests/test_i18n_frozen_t_check.ts 逐条锁）：
 *   ✗ `const A = t("k");`                            —— 顶层焊死
 *   ✗ `const B = { x: t("k") };`                     —— 对象属性焊死（OP_META/VERDICT_BANDS 形态）
 *   ✗ `const C = { x: c ? t("k") : t("j") };`        —— 三元仍在构建期
 *   ✗ `const D =`（多行对象，内部 `label: t("k")`）   —— 跨行初始化区同样命中
 *   ✓ `const E = () => t("k");`                      —— 惰性工厂，调用期求值
 *   ✓ `function f() { return t("k") }`               —— 函数体（行首深度 ≥1 且非初始化区）
 *   ✓ `const F = { x: () => t("k") };`               —— 属性是闭包
 *   ✓ `const G = { k: "a.b.c" }; function h(){ t(G.k) }` —— 表存 key、消费点现译
 *
 * 修病口径：表只存 LocaleKey，消费点现调 t()（`diagnostics/conflicts.ts|RESOLVE_STRATEGIES` /
 * `copy-toast.ts` 范式）；或整表改惰性函数。
 *
 * 设计意图（为何存在 / 适用场景）：既有四道 i18n 闸（key parity / 三段式命名 / UI 硬编码中文 /
 * 死键）都建立在「文案是否被包进 t()」这一前提上，本闸守的是**包得太早**：模块构建期求值
 * 的 t() 把译文焊死在首查语言包上，而那四道闸在语义上全部看不见这种写法。
 * 适用场景 = 诊断页/元数据表这类「表驱动 + 模块级常量」的 UI（本次立因即诊断页锐评）；
 * 消费面为前端源码（.ts 与 .tsx）的模块顶层初始化区。判定刻意做成确定性状态机而非
 * 关键词 grep——`=> t(` 是合法惰性替代写法，纯 grep 必然误报。
 *
 * 依赖：node:fs / node:path / node:url + scripts/_lib/scan-files.ts
 * 用法：
 *   node scripts/i18n-frozen-t-check.ts            # 文本报告（warning，恒 0）
 *   node scripts/i18n-frozen-t-check.ts --json     # JSON（doctor/CI 消费）
 *   node scripts/i18n-frozen-t-check.ts --strict   # 有冻结点则 exit 1（门禁用）
 *
 * 退出码：warning 模式恒 0；--strict 且有命中 → 1；干净 → 0。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRoot, walk } from "./_lib/scan-files.ts";

const ROOT = getRoot();
const SRC = path.join(ROOT, "frontend", "src");

/** 遮罩注释（同长空格保偏移，行号才准；与 i18n-ui-check 同款）。 */
function maskComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** 遮罩 TS 类型索引访问里的引号（防类型 key 被当字符串吞掉配对，同 i18n-ui-check）。 */
function maskTsTypeIndex(src: string): string {
  return src.replace(/:\s*[A-Za-z$_][\w$]*\s*\[\s*["'][^"']*["']\s*\]/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

/**
 * 遮罩字符串字面量体（同长空格）；反引号的 `${…}` 插值块**保留代码态**——
 * `` const H = { x: `${t("k")}` } `` 依然构建期求值，须可命中。
 */
function maskStringBodies(src: string): string {
  const STR_RE = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;
  return src.replace(STR_RE, (_m, quote: string, inner: string) => {
    if (quote !== "`") return quote + inner.replace(/[^\n]/g, " ") + quote;
    let out = "";
    let i = 0;
    while (i < inner.length) {
      const open = inner.indexOf("${", i);
      if (open === -1) {
        out += inner.slice(i).replace(/[^\n]/g, " ");
        break;
      }
      out += inner.slice(i, open).replace(/[^\n]/g, " ");
      let depth = 0;
      let j = open + 2;
      for (; j < inner.length; j++) {
        if (inner[j] === "{") depth++;
        else if (inner[j] === "}") {
          if (depth === 0) break;
          depth--;
        }
      }
      out += inner.slice(open, Math.min(j + 1, inner.length));
      i = j < inner.length ? j + 1 : j;
    }
    return `\`${out}\``;
  });
}

/** t()/tOf( 调用点（前面不是标识符字符/点/`>`，排除箭头体与 xxx.t 属性调用）。 */
const T_CALL = /(^|[^A-Za-z0-9_$.>])(?:t|tOf)\s*\(/g;
/** 顶层声明起始行：`[export] const|let|var NAME [: 类型注解] =`（不含 ==、=>）。
 *  注解段用 `[^=]*`：泛型注解 `Record<string, { a: X; b: Y }>` 内含分号（OP_META /
 *  VERDICT_BANDS 实测形态），禁 `;` 的写法会漏匹配整条声明。类型注解出现 `=` 极罕见，
 *  贪心吞到行内最后一个等号边界即可（后置 `=(?![=>])` 再排除 ==/=>）。 */
const TOP_DECL = /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z$_][\w$]*\s*(?::[^=]*)?=(?![=>])/;
/** 上一行结尾是箭头 `=>`（跨行惰性体，豁免）。 */
const PREV_ARROW = /=>\s*$/;

/**
 * 纯核（供契约测试直测判据非空转，同 i18n-ui-check 惯例）：输入遮罩前源码文本，
 * 输出冻结命中（行号 + 所在声明名）。
 */
export function scanSourceText(raw: string): { line: number; decl: string }[] {
  const masked = maskStringBodies(maskTsTypeIndex(maskComments(raw)));
  const rawLines = raw.split("\n");
  const lines = masked.split("\n");

  const hits: { line: number; decl: string }[] = [];
  // 初始化区状态：正在某个顶层 const/let/var 的 `=` 右侧区域内
  let inInit = false;
  let initDecl = "";
  let depth = 0; // 当前行首的花括号深度（逐行累计净值）

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? "";
    const prevLine = lines[li - 1] ?? "";
    const startDepth = depth;
    {
      let d = 0;
      for (const ch of line) {
        if (ch === "{") d++;
        else if (ch === "}") d--;
      }
      depth = startDepth + d;
    }

    if (!inInit && startDepth === 0) {
      const m = TOP_DECL.exec(line);
      if (m) {
        inInit = true;
        initDecl = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z$_][\w$]*)/.exec(line)?.[1] ?? "";
      }
    }

    if (inInit && startDepth <= 1) {
      T_CALL.lastIndex = 0;
      let tm = T_CALL.exec(line);
      while (tm !== null) {
        const pos = tm.index + (tm[1]?.length ?? 0);
        const before = line.slice(0, pos);
        const arrowBody = /=>\s*$/.test(before) || (startDepth === 0 && PREV_ARROW.test(prevLine));
        if (!arrowBody) {
          const win = `${rawLines[li - 1] ?? ""}\n${rawLines[li] ?? ""}`;
          if (!/i18n-allow:/.test(win)) {
            hits.push({ line: li + 1, decl: initDecl });
            break; // 一行一句初始化区，命中一次即可（多调用同行不重复记账）
          }
        }
        tm = T_CALL.exec(line);
      }
      // 语句以分号收尾 → 初始化区退场（跨行的对象字面量到 `};` 才闭合）
      if (/;\s*$/.test(line)) {
        inInit = false;
        initDecl = "";
      }
    } else if (inInit && startDepth > 1) {
      // 初始化区里进了更深的块（理论上只应是嵌套对象/闭包体），仍等分号退场
      if (/;\s*$/.test(line) && depth <= 0) {
        inInit = false;
        initDecl = "";
      }
    }
  }
  return hits;
}

// main 守卫：被契约测试 import（取 scanSourceText 纯核）时不得执行全仓扫描、更不得
// process.exit（同 i18n-ui-check 惯例）。
function main(): void {
  const args = new Set(process.argv.slice(2));
  const JSON_OUT = args.has("--json");
  const STRICT = args.has("--strict");
  const KNOWN_FLAGS = new Set(["--json", "--strict", "--help", "-h"]);
  const unknownFlags = [...args].filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknownFlags.length) {
    console.error(
      `[i18n-frozen-t-check] 未知 flag: ${unknownFlags.join(", ")}（支持 --json / --strict）`,
    );
    process.exit(1);
  }

  const LOCALE_DIR = path.join(SRC, "locales");
  const files = walk(SRC, {
    exts: [".ts"],
    skipDir: (name) => path.join(SRC, name) === LOCALE_DIR,
    skipFile: /\.test\.ts$/,
  }) as string[];

  const report: { file: string; hits: { line: number; decl: string }[] }[] = [];
  let total = 0;
  for (const f of files) {
    const hits = scanSourceText(fs.readFileSync(f, "utf8"));
    if (hits.length) {
      total += hits.length;
      report.push({ file: path.relative(ROOT, f).split(path.sep).join("/"), hits });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ frozen: total, files: report.length, details: report }, null, 2));
    process.exit(STRICT && total ? 1 : 0);
  }

  console.log("i18n 模块级冻结 t() 检查 (i18n-frozen-t-check)");
  console.log(
    "规则: 顶层 const/let 初始化区（行首深度 ≤1）内 t()/tOf() → 构建期焊死译文，lang:changed 不重建模块（豁免: => t( 惰性 / i18n-allow 台账）",
  );
  console.log(`扫描: ${files.length} 个 .ts`);
  console.log("─".repeat(60));
  if (!total) {
    console.log("✅ 未发现模块级冻结 t()（译文表均走 key + 消费点现译，或惰性函数）");
  } else {
    for (const r of report) {
      console.log(`📄 ${r.file}  (${r.hits.length} 处)`);
      for (const h of r.hits) console.log(`   L${h.line}: ${h.decl}`);
    }
    console.log("─".repeat(60));
    console.log(
      `共 ${total} 处冻结点，涉及 ${report.length} 个文件——修法：表存 LocaleKey + 消费点现调 t()，或整表改 () => t()`,
    );
  }
  process.exit(STRICT && total ? 1 : 0);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
