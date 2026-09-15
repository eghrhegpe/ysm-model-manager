#!/usr/bin/env node
/**
 * check-ctx-menu-i18n.ts — 右键菜单 i18n key 存在性门禁（右键菜单契约护栏）
 *
 * 背景（2026-09-01 复盘）：右键菜单的「声明 ↔ handler ↔ i18n」三件套里，
 *   - menu-defs.ts 的 label 用 t("menu.xxx")（原文为 tr("menu.xxx", "Fallback")）
 *   - context-menu*-handlers.ts 的 toast 用 t("ctx.xxx")
 * 两套命名空间靠人工对齐。键缺失时运行时静默回退——原 tr() 回退 Fallback（英文），
 * 现 t() 回显键名——所以「新增菜单项忘了把 key 写进 zh-CN.ts」只会让那一项永远显示
 * 错误文案，之前只能靠人工 review / e2e 发现。
 *
 * 本脚本把这个盲区补成 CI 硬门禁：扫描源文件里所有「首参为字符串字面量」的
 * t("key") / tr("key", …) 调用，逐一核对 key 是否存在于 zh-CN 基准语言包（单一事实源）。
 * 缺失即违规，阻断推送（与 check-menu-health 同口径：漏 i18n 会破坏菜单文案契约）。
 *
 * ⚠️ 路径失效事故与空域防线（2026-09 修复，务必读完再改本文件）：
 *   SOURCE_FILES 曾长期指向 `frontend/src/core/*`，而 context-menu 代码早已迁到
 *   `features/context-menu/`（commit 9b554d496「迁出 core 的后续删除」）——**5/5 路径失效**。
 *   叠加原先「文件不存在即 continue」的容错，闸**扫零文件却报**
 *   「✅ 全部 0 个 key 均存在于 zh-CN 基准包」——把空转打印成了绿。
 *   更隐蔽的是：知识卡把它记作「tr 根除后 0 命中恒绿——休眠闸，防 tr() 回潮才重新咬人」，
 *   归因于 tr 根除；而真实死因是路径漂移——**即便 tr 回潮也照样扫不到**，假前提被写成了结论。
 *   三重修法（缺一不可）：
 *     ① 重指真实路径（`features/context-menu/*`）；
 *     ② 正则同时覆盖 `t()` 与 `tr()`（后者留作回潮绊线）；
 *     ③ **空域 fail-loud**：扫到 0 个文件或 0 个键 → exit 2，绝不把「什么都没看」报成绿。
 *   结构性教训：**硬编码路径清单 + 「文件不存在就跳过」= 静默归零**，必须显式断言非空。
 *
 * 为什么只查字面量 t("...") 而忽略 t(tpl.x, ...)：
 *   后者首参是变量（dialog 模板对象），不是 key 字符串，静态扫描无意义；
 *   右键菜单契约关心的就是手写 key。注释里的示例也一并 strip，避免误报。
 *
 * 复用：ROOT 取自 _lib/scan-files.ts；参数解析用 _lib/parse-args.ts；zh-CN key
 * 提取正则与 i18n-check.ts 同源。零依赖（仅 node:fs/path/url）。
 *
 * 设计意图：把右键菜单「声明 ↔ handler ↔ i18n」三件套的 key 对齐盲区做成 CI
 *           硬门禁，让「新增菜单项忘了写 zh-CN」在推送前被拦下而非静默回退。
 *
 * 用法：
 *   node scripts/check-ctx-menu-i18n.ts            # 文本报告（不阻断，打印缺失项）
 *   node scripts/check-ctx-menu-i18n.ts --json     # JSON 输出（pre-push-gate 消费）
 *   node scripts/check-ctx-menu-i18n.ts --strict   # 有缺失则 exit 1（CI 强阻断）
 *
 * 退出码：干净 → 0；--strict 且有缺失 → 1；非 strict 恒 0（靠 _summary.ok 判据）；
 *         扫描域为空（源文件全失效 / 零字面量键）→ 2（fail-loud，防空转报绿）。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

// ── 被扫描的源文件（相对 ROOT）──
// ⚠️ 这 5 个路径曾写成 `frontend/src/core/*`，代码迁到 features/ 后未同步 →
// 5/5 失效 + 旧容错静默跳过 = 闸扫零文件报绿（详见文件头「路径失效事故」）。
// 改动本清单后务必跑 `node scripts/check-ctx-menu-i18n.ts` 确认输出的是**非 0** 个键。
// 导出供契约测试做「清单内文件全部存在」回归锁——这是防路径漂移再次静默的正面防线。
export const SOURCE_FILES = [
  "frontend/src/features/context-menu/menu-defs.ts",
  "frontend/src/features/context-menu/context-menu-handlers.ts",
  "frontend/src/features/context-menu/context-menu-file-handlers.ts",
  "frontend/src/features/context-menu/context-menu-dir-handlers.ts",
  "frontend/src/features/context-menu/context-menu-shared.ts",
];
const LOCALE_FILE = "frontend/src/locales/zh-CN.ts";

// ── 参数（仅 CLI 入口解析；模块被 import 时不执行）──
function parseCliArgs() {
  const { json, strict, help, unknown } = parseArgs(process.argv.slice(2), {
    bools: ["json", "strict"],
    strings: [],
    defaults: {},
  });
  if (help) {
    const src = fs.readFileSync(process.argv[1]!, "utf-8");
    const s = src.indexOf("/**");
    const e = src.indexOf("*/", s);
    console.log(
      src
        .slice(s, e + 2)
        .replace(/^ \* ?/gm, "")
        .trim(),
    );
    process.exit(0);
  }
  if (unknown?.length) {
    console.error(`❌ 未知参数: ${unknown.join(", ")}（--help 查看用法）`);
    process.exit(2);
  }
  return { json, strict };
}

// ── 注释剥离（保留字符串，避免误删含 // 或 /* 的字面量）──
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr: string | null = null;
  let esc = false;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 只抓「首参为字符串字面量」的键调用，key 必须形如 ns.entity。
// 覆盖 `t("key")`（现行）与 `tr("key", …)`（已由 ADR-210 D3 根除，保留作**回潮绊线**）。
// `(?<![\w.])` 左边界：挡掉 `foo.t("x")` 这类同名方法调用（与 design-tokens 的 propDeclRe 同款纪律）。
const LITERAL_KEY_RE = /(?<![\w.])(?:tr|t)\(\s*(['"])([A-Za-z][\w.]*)\1/g;

/** 扫描结果：键映射 + 实际读到的文件 / 清单里已失效的文件（空域防线依据）。 */
export interface CtxMenuScan {
  /** key → 来源文件（rel） */
  keys: Map<string, string>;
  /** 真实存在并已扫描的源文件（rel） */
  filesScanned: string[];
  /** 清单里但已不存在的源文件（rel）——路径漂移信号 */
  filesMissing: string[];
}

/**
 * 收集源文件里用到的字面量键。
 *
 * 返回 `filesMissing` 供调用方做**空域断言**：单文件缺失只是容错（重命名/临时移除），
 * 但**全部缺失**意味着路径清单整体漂移——此时静默 return 空 Map 就是本文件头里
 * 那次「扫零文件报绿」事故的成因，故必须由调用方 fail-loud。
 */
export function collectUsedKeys(): CtxMenuScan {
  const keys = new Map<string, string>(); // key -> 来源文件（rel）
  const filesScanned: string[] = [];
  const filesMissing: string[] = [];
  for (const rel of SOURCE_FILES) {
    const abs = path.resolve(ROOT, rel);
    if (!fs.existsSync(abs)) {
      filesMissing.push(rel); // 单文件不存在不误阻断，但计入漂移信号
      continue;
    }
    filesScanned.push(rel);
    const src = stripComments(fs.readFileSync(abs, "utf-8"));
    // matchAll 内部克隆正则，不推进 LITERAL_KEY_RE.lastIndex，与原 exec 循环逐文件扫描语义一致
    for (const m of src.matchAll(LITERAL_KEY_RE)) {
      const key = m[2]!;
      if (!keys.has(key)) keys.set(key, rel);
    }
  }
  return { keys, filesScanned, filesMissing };
}

// zh-CN 基准语言包的全部 key（与 i18n-check.ts extractKeys 同源）
function collectZhCNKeys(): Set<string> {
  const abs = path.resolve(ROOT, LOCALE_FILE);
  const text = fs.readFileSync(abs, "utf-8");
  const keys = new Set<string>();
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*(?!function\b|\()/gm;
  for (const m of text.matchAll(re)) keys.add(m[1]!);
  return keys;
}

/** 纯函数：在用的 key 中存在、但 zh-CN 基准包缺失的，即违规。导出供契约测试。 */
export function findMissingKeys(
  used: Map<string, string>,
  base: Set<string>,
): { key: string; file: string }[] {
  const missing: { key: string; file: string }[] = [];
  for (const [key, file] of used) {
    if (!base.has(key)) missing.push({ key, file });
  }
  return missing.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function main() {
  const { json, strict } = parseCliArgs();
  const scan = collectUsedKeys();

  // ── 空域防线（fail-loud）：绝不再把「什么都没看」报成绿 ──
  // 成因与代价见文件头「路径失效事故」：硬编码路径清单 + 静默跳过 = 静默归零，
  // 而零违规恰好是「最绿」的报告——这类假绿比没有检查更危险。
  if (scan.filesScanned.length === 0) {
    const msg = `SOURCE_FILES 全部不存在（路径清单已整体漂移）——扫描域为空，拒绝报绿。首个失效路径：${scan.filesMissing[0]}`;
    if (json) {
      console.log(
        JSON.stringify(
          {
            _summary: { ok: false, error: msg, total: 0, violations: 0, filesScanned: 0 },
            scope: SOURCE_FILES,
            filesMissing: scan.filesMissing,
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    console.error(`❌ ${msg}`);
    process.exit(2);
  }

  const used = scan.keys;
  const baseKeys = collectZhCNKeys();
  const missing = findMissingKeys(used, baseKeys);

  // 文件在、但一个字面量键都没扫到 → 同样可疑（正则失效或键全动态化），fail-loud 而非报绿
  if (used.size === 0) {
    const msg = `扫描到 ${scan.filesScanned.length} 个源文件但 0 个字面量键——匹配正则可能失效或键已全动态化，拒绝报绿。`;
    if (json) {
      console.log(
        JSON.stringify(
          {
            _summary: {
              ok: false,
              error: msg,
              total: 0,
              violations: 0,
              filesScanned: scan.filesScanned.length,
            },
            scope: SOURCE_FILES,
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    console.error(`❌ ${msg}`);
    process.exit(2);
  }

  const ok = missing.length === 0;
  const summary = {
    ok,
    total: used.size,
    violations: missing.length,
    filesScanned: scan.filesScanned.length,
    missing,
  };

  if (json) {
    console.log(
      JSON.stringify({ _summary: summary, scope: SOURCE_FILES, locale: LOCALE_FILE }, null, 2),
    );
    process.exit(ok || !strict ? 0 : 1);
  }

  // 文本模式
  console.log(
    `右键菜单 i18n key 门禁 — 扫描 ${scan.filesScanned.length} 文件 / ${used.size} 个 t()|tr() key ↔ ${LOCALE_FILE}`,
  );
  if (ok) {
    console.log(`✅ 全部 ${used.size} 个 key 均存在于 zh-CN 基准包（无静默回退）。`);
  } else {
    console.log(`⚠ ${missing.length} 个 key 在用但 zh-CN.ts 缺失（运行时静默回退）：`);
    for (const { key, file } of missing) {
      console.log(`  ${key}  ←  ${file}`);
    }
    console.log("  请在 frontend/src/locales/zh-CN.ts 补该 key，然后重跑本脚本。");
    if (strict) {
      console.error(`\n[check-ctx-menu-i18n] --strict: ${missing.length} 缺失 key → 阻断。`);
      process.exit(1);
    }
  }
  process.exit(0);
}

// 仅当本文件被直接调用（node scripts/check-ctx-menu-i18n.ts）时执行 CLI；
// 被 import（契约测试）时只导出纯函数，不跑 CLI、不 process.exit。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
