#!/usr/bin/env node
/**
 * check-ctx-menu-i18n.ts — 右键菜单 i18n key 存在性门禁（右键菜单契约护栏）
 *
 * 背景（2026-09-01 复盘）：右键菜单的「声明 ↔ handler ↔ i18n」三件套里，
 *   - menu-defs.ts 的 label 用 tr("menu.xxx", "Fallback")
 *   - context-menu*-handlers.ts 的 toast 用 tr("ctx.xxx", "Fallback")
 * 两套命名空间靠人工对齐。tr() 缺失键时静默回退 Fallback（英文），不报错、
 * 不告警——所以「新增菜单项忘了把 key 写进 zh-CN.ts」只会让那一项永远显示英文，
 * 之前只能靠人工 review / e2e 发现。
 *
 * 本脚本把这个盲区补成 CI 硬门禁：扫描右侧文件里所有「字面量 tr("key", ...)」
 * 调用，逐一核对 key 是否存在于 zh-CN 基准语言包（单一事实源）。缺失即违规，
 * 阻断推送（与 check-menu-health 同口径：漏 i18n 会破坏菜单文案契约）。
 *
 * 为什么只查字面量 tr("...") 而忽略 tr(tpl.x, ...)：
 *   后者首参是变量（dialog 模板对象），不是 key 字符串，静态扫描无意义；
 *   右键菜单契约关心的就是手写 key。注释里的 tr("menu.xxx") 示例也一并 strip，避免误报。
 *
 * 复用：ROOT 取自 _lib/scan-files.ts；参数解析用 _lib/parse-args.ts；zh-CN key
 * 提取正则与 i18n-check.ts 同源。零依赖（仅 node:fs/path/url）。
 *
 * 设计意图：把右键菜单「声明 ↔ handler ↔ i18n」三件套的 key 对齐盲区做成 CI
 *           硬门禁，让「新增菜单项忘了写 zh-CN」在推送前被拦下而非静默回退英文。
 *
 * 用法：
 *   node scripts/check-ctx-menu-i18n.ts            # 文本报告（不阻断，打印缺失项）
 *   node scripts/check-ctx-menu-i18n.ts --json     # JSON 输出（pre-push-gate 消费）
 *   node scripts/check-ctx-menu-i18n.ts --strict   # 有缺失则 exit 1（CI 强阻断）
 *
 * 退出码：干净 → 0；--strict 且有缺失 → 1；非 strict 恒 0（靠 _summary.ok 判据）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';

// ── 被扫描的源文件（相对 ROOT）──
const SOURCE_FILES = [
  'frontend/src/core/menu-defs.ts',
  'frontend/src/core/context-menu-handlers.ts',
  'frontend/src/core/context-menu-file-handlers.ts',
  'frontend/src/core/context-menu-dir-handlers.ts',
  'frontend/src/core/context-menu-shared.ts',
];
const LOCALE_FILE = 'frontend/src/core/i18n/locales/zh-CN.ts';

// ── 参数（仅 CLI 入口解析；模块被 import 时不执行）──
function parseCliArgs() {
  const { json, strict, help, unknown } = parseArgs(process.argv.slice(2), {
    bools: ['json', 'strict'],
    strings: [],
    defaults: {},
  });
  if (help) {
    const src = fs.readFileSync(process.argv[1]!, 'utf-8');
    const s = src.indexOf('/**');
    const e = src.indexOf('*/', s);
    console.log(src.slice(s, e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (unknown && unknown.length) {
    console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
    process.exit(2);
  }
  return { json, strict };
}

// ── 注释剥离（保留字符串，避免误删含 // 或 /* 的字面量）──
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  let esc = false;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
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

// 只抓「首参为字符串字面量」的 tr("key") / tr('key')，key 必须形如 ns.entity
const TR_LITERAL_RE = /tr\(\s*(['"])([A-Za-z][\w.]*)\1/g;

function collectUsedKeys(): Map<string, string> {
  const map = new Map<string, string>(); // key -> 来源文件（rel）
  for (const rel of SOURCE_FILES) {
    const abs = path.resolve(ROOT, rel);
    if (!fs.existsSync(abs)) continue; // 文件若被移除不误阻断
    const src = stripComments(fs.readFileSync(abs, 'utf-8'));
    let m: RegExpExecArray | null;
    while ((m = TR_LITERAL_RE.exec(src)) !== null) {
      const key = m[2]!;
      if (!map.has(key)) map.set(key, rel);
    }
  }
  return map;
}

// zh-CN 基准语言包的全部 key（与 i18n-check.ts extractKeys 同源）
function collectZhCNKeys(): Set<string> {
  const abs = path.resolve(ROOT, LOCALE_FILE);
  const text = fs.readFileSync(abs, 'utf-8');
  const keys = new Set<string>();
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*(?!function\b|\()/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) keys.add(m[1]!);
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
  const used = collectUsedKeys();
  const baseKeys = collectZhCNKeys();
  const missing = findMissingKeys(used, baseKeys);

  const ok = missing.length === 0;
  const summary = {
    ok,
    total: used.size,
    violations: missing.length,
    missing,
  };

  if (json) {
    console.log(JSON.stringify({ _summary: summary, scope: SOURCE_FILES, locale: LOCALE_FILE }, null, 2));
    process.exit(ok || !strict ? 0 : 1);
  }

  // 文本模式
  console.log(`右键菜单 i18n key 门禁 — 扫描 ${used.size} 个 tr() key ↔ ${LOCALE_FILE}`);
  if (ok) {
    console.log(`✅ 全部 ${used.size} 个 key 均存在于 zh-CN 基准包（无静默回退）。`);
  } else {
    console.log(`⚠ ${missing.length} 个 key 在用但 zh-CN.ts 缺失（运行时静默回退英文）：`);
    for (const { key, file } of missing) {
      console.log(`  ${key}  ←  ${file}`);
    }
    console.log('  请在 frontend/src/core/i18n/locales/zh-CN.ts 补该 key，然后重跑本脚本。');
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
