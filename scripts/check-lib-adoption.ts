#!/usr/bin/env node
/**
 * check-lib-adoption.ts — _lib 共享层采用率检查（治理杠杆的「采用率闸门」）。
 *
 * 设计意图：scripts/_lib/ 现有 25 个共享模块，但只有 proc.mjs 配了专属采用率
 * 闸门（check-proc-adoption.ts），结果是非直调占比 100% 全收敛；其余 24 个模块
 * 零闸门、纯靠自觉（parse-args 仅 37/95 采用，多脚本仍各自内联 walk/符号提取）。
 * 本脚本把「proc 的成功经验」推广为规则驱动的通用闸门：
 *   规则表（模块 → 手搓特征 / 采用特征）驱动，新增模块只需加一行 RULES。
 * 与相邻脚本的分工（避免重复告警）：
 *   - check-proc-adoption.ts：专管子进程（proc.mjs），本脚本显式跳过该模块；
 *   - check-script-hygiene.ts：管文件头 / 退出码 / --json 契约 / argv 契约，
 *     其共享层口径只认 `^function walk(` 等窄命名（改名 collectScripts 即绕过）；
 *     本脚本按「能力是否被手搓」判定，覆盖 frontmatter / source-graph / to-posix
 *     等 hygiene 完全未触及的模块，且同时给出全模块采用率全景。
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.ts
 *
 * 用法：
 *   node scripts/check-lib-adoption.ts           # 文本报告（采用率全景 + 违规清单）
 *   node scripts/check-lib-adoption.ts --json    # JSON（doctor/CI 消费）
 *   node scripts/check-lib-adoption.ts --strict  # 有违规 → 退出码 1
 *
 * 退出码：默认 0（提示工具，WARN 不阻断）；--strict 且存在违规 → 1。
 */
import fs from "node:fs";
import path from "node:path";
import { collectScripts, SCRIPTS_DIR } from "./_lib/collect-scripts.ts";

const LIB_DIR = path.join(SCRIPTS_DIR, "_lib");

const JSON_OUT = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");

/**
 * 规则表：_lib 模块 → 手搓特征 / 采用特征 / 迁移建议。
 * 判定（行级粒度）：逐行扫 smell（注释行遮蔽），命中即违规，分两类——
 *   missing = 文件未 import 该模块（有能力却手搓）；
 *   remnant = 文件已 import，但仍有手搓残留（接入了，没用尽）。
 * 早期实现为文件级豁免（import 过即整文件放过），会让「接入三成」的文件长期
 * 逃检（实证 gen-vitepress-sidebar.ts 已 import toPosix 却仍有 7 处手搓），
 * 2026-09 下沉为行级；smell 允许有界跨行正则，以便把薄包装排除在违规外。
 * proc.mjs 不在此表：由 check-proc-adoption.ts 专管，避免重复告警。
 */
const RULES = [
  {
    lib: "scan-files.ts",
    capability: "文件遍历 / 仓库根定位",
    smells: [
      // 自研遍历判据 = 函数体内直接 readdirSync。薄包装（`return walk(dir, {...})`）
      // 体内无 readdirSync，自然豁免——实测 css-layer-check.ts 的 walkDir 即此形态，
      // 若只认函数名会持续误报。上界 800 字符 + 不越过顶格 `}`：防跨函数误匹配。
      /^function\s+(?:walk|walkDir|collectFiles|scanDir|collectScripts)\s*\([^)]*\)[^{]*\{(?:(?!\n\})[\s\S]){0,800}?readdirSync/m,
      /^const (?:walk|walkDir)\s*=/m,
    ],
    advice: "import { walk, ROOT } from './_lib/scan-files.ts'",
  },
  {
    lib: "parse-args.ts",
    capability: "CLI 参数解析（含 unknown 白名单拦截）",
    smells: [/^function (?:parseArgs|parseCli)\s*\(/m, /^const parseArgs\s*=/m],
    advice: "import { parseArgs } from './_lib/parse-args.ts'",
  },
  {
    lib: "frontmatter.ts",
    capability: "YAML frontmatter 解析",
    smells: [
      /^function (?:parseFrontmatter|readFrontmatter|splitFrontmatter|parseMeta)\s*\(/m,
      /split\(\s*['"]---['"]\s*\)/,
    ],
    advice: "import { parseFrontmatter } from './_lib/frontmatter.ts'",
  },
  {
    lib: "source-graph.ts",
    capability: "源码符号 / 顶层声明提取",
    // 刻意不含 `collectSymbols`：该名语义过泛（单文件符号提取与多文件聚合都叫这名）。
    // 实证 gen-knowledge-symbols.ts 的同名函数是「遍历 source_files、
    // 逐个调 getExportedSymbolsAny 再聚合」的上层逻辑，非重复实现——列入即持续误报。
    smells: [
      /^function (?:getExportedSymbols|getGoExportedSymbols|getJsExportedSymbols|goTopFuncs|tsTopDecls)\s*\(/m,
    ],
    advice: "import { getExportedSymbolsAny, topDeclsAny } from './_lib/source-graph.ts'",
  },
  {
    lib: "to-posix.ts",
    capability: "Windows 反斜杠 → 正斜杠归一",
    smells: [/\.replace\(\/\\\\\/g,\s*['"]\/['"]\)/],
    advice: "import { toPosix } from './_lib/to-posix.ts'",
  },
  {
    lib: "git-ref.ts",
    capability: "git ref / commit oid 解析",
    smells: [/^function (?:resolveRef|toOid|parseRef|gitRef)\s*\(/m],
    advice: "import { resolveRef } from './_lib/git-ref.ts'",
  },
];

/**
 * 采用特征：脚本 import 了该模块即视为已接入。
 *
 * 锚定「真实 import 语句」（行首 import + 引号路径），而非文本中出现模块名——
 * 否则本文件 RULES 里的 advice 字符串、to-posix.ts 头部注释提及模块名时
 * 都会被误判为「已接入」。路径不做 `_lib/` 前缀限定，故 `_lib` 内部文件的
 * 相对导入（`./to-posix.ts`）同样识别。
 */
function adoptedRe(lib: string) {
  const esc = lib.replace(/\./g, "\\.");
  return new RegExp(`^\\s*import\\b[^;]*?["'][^"'\\n]*${esc}["']`, "m");
}

/**
 * 注释行遮蔽（保留行号）：`//` 行注释、`/*` 起始块注释及其 `*` 续行整行清空。
 *
 * 遮蔽而非跳过的理由：块注释跨多行，跳行会打乱行号；且 smell 支持跨行匹配
 * （见 scanSmellLines 的 walk 自研特征），必须在同一坐标系里比对。
 * 只遮蔽「整行注释」，不处理行尾注释——`code(); // 说明` 这类行仍是代码行，
 * 其手搓应按违规计（实证 check-biome.ts:67 即「代码 + 行尾注释」形态）。
 */
function maskCommentLines(text: string): string {
  let inBlock = false;
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (inBlock) {
        if (t.includes("*/")) inBlock = false;
        return "";
      }
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) inBlock = true;
        return "";
      }
      if (t.startsWith("//") || t.startsWith("*")) return "";
      return line;
    })
    .join("\n");
}

/**
 * 扫 smell，返回命中起始行号（1-based，去重升序）。
 *
 * 检测粒度必须下沉到「行」：文件级豁免（import 过就整文件放过）会让
 * 「已接入却只用了三成」的文件长期逃检——实证 gen-vitepress-sidebar.ts
 * 第 28 行已 import toPosix，同文件内仍有 7 处手搓残留。
 *
 * 在遮蔽后的全文上做全局匹配（而非逐行 test），以便 smell 用有界跨行正则
 * 表达「自研实现」特征（如函数体内出现 readdirSync），把薄包装排除在违规外。
 */
function scanSmellLines(text: string, smells: RegExp[]): number[] {
  const masked = maskCommentLines(text);
  const hits = new Set<number>();
  for (const re of smells) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null = g.exec(masked);
    while (m) {
      hits.add(masked.slice(0, m.index).split("\n").length);
      if (g.lastIndex === m.index) g.lastIndex++; // 零宽匹配防死循环
      m = g.exec(masked);
    }
  }
  return [...hits].sort((a, b) => a - b);
}

/** 收集 _lib 共享模块（排除测试）。 */
function collectLibs() {
  if (!fs.existsSync(LIB_DIR)) return [];
  return fs
    .readdirSync(LIB_DIR)
    .filter(
      (f) =>
        (f.endsWith(".mjs") || f.endsWith(".ts")) &&
        !f.endsWith(".test.mjs") &&
        !f.endsWith(".test.ts"),
    )
    .sort();
}

/** 统计每个 _lib 模块被多少脚本引用（采用率全景）。 */
function adoptionTable(files: string[], texts: Map<string, string>, libs: string[]) {
  return libs.map((lib) => {
    const re = adoptedRe(lib);
    const users = files.filter((f) => re.test(texts.get(f) as string));
    return { lib, users: users.length, scripts: users };
  });
}

function main() {
  const files = collectScripts();
  const texts = new Map(files.map((f) => [f, fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8")]));
  const libs = collectLibs();

  // 违规：手搓了某模块能覆盖的能力。两类——
  //   missing：完全未 import 该模块（有能力却手搓）
  //   remnant：已 import 但文件内仍有手搓残留（接入了，没用尽）
  const violations: any[] = [];
  for (const rule of RULES) {
    const adopted = adoptedRe(rule.lib);
    for (const f of files) {
      const text = texts.get(f) as string;
      const lines = scanSmellLines(text, rule.smells);
      if (!lines.length) continue; // 无手搓特征 → 无关文件
      const kind = adopted.test(text) ? "remnant" : "missing";
      violations.push({
        script: f,
        lib: rule.lib,
        capability: rule.capability,
        advice: rule.advice,
        kind,
        lines,
      });
    }
  }

  const table = adoptionTable(files, texts, libs);
  const unused = table.filter((r) => r.users === 0);

  if (JSON_OUT) {
    const ok = STRICT ? violations.length === 0 : true;
    console.log(
      JSON.stringify(
        {
          _summary: {
            scripts: files.length,
            libs: libs.length,
            violations: violations.length,
            unusedLibs: unused.length,
            ok,
          },
          adoption: table.map(({ lib, users }) => ({ lib, users })),
          violations,
        },
        null,
        2,
      ),
    );
    if (STRICT && violations.length) process.exit(1);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" _lib 共享层采用率检查 (check-lib-adoption)");
  console.log("══════════════════════════════════════");
  console.log(
    `扫描 ${files.length} 个脚本 × ${libs.length} 个 _lib 模块，违规 ${violations.length} 条`,
  );
  console.log("──────────────────────────────────────");
  const missing = violations.filter((v) => v.kind === "missing");
  const remnant = violations.filter((v) => v.kind === "remnant");
  if (missing.length) {
    console.log("【有能力未用】手搓了 _lib 已提供的能力，却未 import：");
    for (const v of missing) {
      console.log(`⚠ ${v.script}：手搓「${v.capability}」(L${v.lines.join(",")}) → ${v.advice}`);
    }
  }
  if (remnant.length) {
    console.log("【已接入未用尽】import 了 _lib 模块，文件内仍有手搓残留：");
    for (const v of remnant) {
      console.log(
        `⚠ ${v.script}：${v.lines.length} 处手搓「${v.capability}」(L${v.lines.join(",")}) → 改用 ${v.advice}`,
      );
    }
  }
  if (!violations.length) {
    console.log("✅ 未发现「有能力未用」的脚本。");
  }

  console.log("\n【采用率全景】被引用脚本数 / 脚本总数");
  for (const { lib, users } of table) {
    const bar =
      users === 0
        ? "—"
        : "█".repeat(Math.min(20, Math.max(1, Math.round((users / files.length) * 20))));
    console.log(`  ${lib.padEnd(30)} ${String(users).padStart(3)}  ${bar}`);
  }
  if (unused.length) {
    console.log(`\n⚠ 零引用模块 ${unused.length} 个：${unused.map((u) => u.lib).join(", ")}`);
    console.log("  （可能是写得过早的抽象，或已被取代——建议评估归档）");
  }
  console.log("\n（WARN 不阻断；加 --strict 后退出码 1）");
  if (STRICT && violations.length) process.exit(1);
}

main();
