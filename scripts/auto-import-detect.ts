#!/usr/bin/env node
/**
 * auto-import-detect.ts — auto-import 检测主流程（相对导入 + 单文件检测 + 符号表 + 一轮 run）。
 *
 * 设计意图：从 auto-import.ts 拆出的检测层（2026-08-31 大脚本拆分基线 ADR）——
 * 聚合 lexer + symbols 两层的词法/符号能力，对单文件跑缺失 import 检测、构建全局导出表、
 * 组织一轮完整扫描。领域专属（非通用共享层，故不入 _lib/）。
 *
 * 依赖：node:fs / node:path + _lib/scan-files.ts（SRC_DIR/walk/readText/relPosix/toPosix）
 *   + auto-import-lexer.ts + auto-import-symbols.ts
 *
 * 用法：被 auto-import.ts 主入口引用，非独立 CLI 入口。
 *   import { checkFile, buildSymbolMap, collectFiles, run } from './auto-import-detect.ts';
 *
 * 退出码：非独立入口（无 CLI）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, walk, toPosix, readText, relPosix } from './_lib/scan-files.ts';
import { tokenize, KEYWORDS, GLOBALS } from './auto-import-lexer.ts';
import { extractExports, extractDefined, extractImported } from './auto-import-symbols.ts';

// ── 相对导入路径 ─────────────────────────────────────

/** 从 fromFile 到 toFile 的相对导入说明符（正斜杠，补扩展名，./ 开头）。 */
export function relativeImportSpec(fromFile: string, toFile: string) {
  let rel = toPosix(path.relative(path.dirname(fromFile), toFile));
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

// ── 检测主流程 ───────────────────────────────────────

/**
 * 检测单个文件的缺失 import。
 * @param {string} file 绝对路径
 * @param {Map<string, Array<{file:string,isType:boolean}>>} symbolMap 全局导出表
 * @param {Map<string, {stripped:string, tokens:Array<{name:string,start:number,line:number}>}>} [cache]
 *   跨调用共享的 tokenize 缓存（run() 里 buildSymbolMap 与 checkFile 复用同一份词法结果，
 *   避免同一文件被 tokenize 两遍——全量扫描下这是检测总耗时的双倍来源）。
 * @returns {Array<{symbol:string,line:number,typeOnly:boolean,candidates:string[]}>}
 */
export function checkFile(file: string, symbolMap: Map<string, Array<{ file: string; isType: boolean }>>, cache?: Map<string, { stripped: string; tokens: Array<{ name: string; start: number; line: number }>; text: string }>) {
  const entry = cache?.get(file) ?? (() => { const text = readText(file); const { stripped, tokens } = tokenize(text); return { stripped, tokens, text }; })();
  if (cache && !cache.has(file)) cache.set(file, entry);
  const { stripped, tokens, text } = entry;
  const defined = extractDefined(stripped);
  const imported = extractImported(stripped);
  const selfExports = new Set(extractExports(stripped).map((e) => e.name));

  // re-export 语句 `export { a, b } from "./x"`：花括号内符号是转发名非引用。
  const reExportRanges: [number, number][] = [];
  for (const m of stripped.matchAll(/export\s+(?:type\s+)?\{[^}]*\}\s*from/g)) {
    const brace = stripped.indexOf('{', m.index);
    const close = stripped.indexOf('}', brace);
    if (close > brace) reExportRanges.push([brace, close]);
  }

  const seen = new Set(); // 去重（同一符号只报一次，行号取首次出现）
  const out: any[] = [];

  for (const t of tokens) {
    const { name, start, line } = t;
    if (KEYWORDS.has(name) || GLOBALS.has(name)) continue;
    if (defined.has(name) || imported.has(name) || selfExports.has(name)) continue;
    // re-export 花括号区间内的符号：跳过
    if (reExportRanges.some(([a, b]) => start > a && start < b)) continue;
    // 属性访问 obj.prop 的 prop：前一个非空白字符是 `.`（用 stripped，注释已剥为空）
    let j = start - 1;
    while (j >= 0 && /\s/.test(stripped[j]!)) j--;
    if (j >= 0 && stripped[j] === '.') continue;
    // 对象字面量 key `{ bus: 1 }` / 接口字段 `{ esc: string; fillSearch: ... }`：key 非引用。
    // 前一个非空白（stripped，注释/空白已归一）是 `{`/`,`/`;` 且后一个非空白是 `:` 才判定为 key；
    // `{ bus }` 简写属性与 `[bus, fmt]` 数组元素不满足 `:` 条件，仍按引用处理。
    if (j >= 0 && (stripped[j] === '{' || stripped[j] === ',' || stripped[j] === ';')) {
      let k = start + name.length;
      while (k < text.length && /\s/.test(text[k]!)) k++;
      if (text[k] === ':') continue;
    }
    // 类字段 / 接口可选属性定义（mock 对象 `render = vi.fn()`、接口 `render?: Type`）：
    // 前一个非空白是换行/`;`/`}`，后一个非空白是 `=`（字段赋值）或 `?`（可选属性标记）
    // → 定义而非引用。METHOD_START_RE 只收可选方法 `name?(`，收不到 `name?: ` 字段形态
    // （2026-08-17 修复：3d 适配器/测试的 mock render 字段被误报为缺失 import）。
    if (j >= 0 && (stripped[j] === '\n' || stripped[j] === ';' || stripped[j] === '}')) {
      let k = start + name.length;
      while (k < text.length && /\s/.test(text[k]!)) k++;
      if (text[k] === '=' || text[k] === '?') continue;
    }
    if (seen.has(name)) continue;

    const cands = symbolMap.get(name);
    if (!cands || cands.length === 0) continue;
    // 排除候选就是当前文件自身（理论上 selfExports 已挡，双保险）
    const real = cands.filter((c) => c.file !== file);
    if (real.length === 0) continue;

    seen.add(name);
    out.push({
      symbol: name,
      line,
      typeOnly: real.every((c) => c.isType),
      candidates: real.map((c) => relativeImportSpec(file, c.file)),
    });
  }
  return out;
}

/** 构建全局导出符号表：name → [{file, isType}]。
 * @param {string[]} files 绝对路径列表
 * @param {Map<string, {stripped:string, tokens:Array<{name:string,start:number,line:number}>, text:string}>} [cache]
 *   共享 tokenize 缓存（run() 传入，与 checkFile 复用同一份词法结果）。
 */
export function buildSymbolMap(files: string[], cache?: Map<string, { stripped: string; tokens: Array<{ name: string; start: number; line: number }>; text: string }>) {
  const map = new Map();
  for (const f of files) {
    const entry = cache?.get(f) ?? (() => { const text = readText(f); const { stripped, tokens } = tokenize(text); return { stripped, tokens, text }; })();
    if (cache && !cache.has(f)) cache.set(f, entry);
    const stripped = entry.stripped;
    for (const e of extractExports(stripped)) {
      if (!map.has(e.name)) map.set(e.name, []);
      map.get(e.name).push({ file: f, isType: e.isType });
    }
  }
  return map;
}

/** 收集扫描目标文件（默认 .ts；--include-js 加 .js；也可显式指定路径）。
 * @param {{srcDir:string, targets:string[], includeJs:boolean}} opts
 * @returns {string[]} 绝对路径数组
 */
export function collectFiles({ srcDir = SRC_DIR, targets = [], includeJs = false }: { srcDir?: string; targets?: string[]; includeJs?: boolean } = {}) {
  const all = walk(srcDir);
  if (targets.length > 0) {
    return targets.map((t) => path.resolve(t)).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  }
  return all.filter((p) => (includeJs ? true : (p as string).endsWith('.ts'))) as string[];
}

/**
 * 跑一轮完整检测，返回 { files, suggestions, totals }。
 * @param {{srcDir:string, targets:string[], includeJs:boolean}} opts
 */
export function run({ srcDir = SRC_DIR, targets = [], includeJs = false }: { srcDir?: string; targets?: string[]; includeJs?: boolean } = {}) {
  const all = walk(srcDir) as string[];
  const files = targets.length > 0
    ? targets.map((t) => path.resolve(t)).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    : all.filter((p) => includeJs || (p as string).endsWith('.ts'));
  // tokenize 单次缓存：buildSymbolMap 与 checkFile 复用同一份词法结果，
  // 避免同一文件被 readText+tokenize 两遍（全量 400+ 文件时接近双倍耗时）。
  const cache = new Map<string, { stripped: string; tokens: Array<{ name: string; start: number; line: number }>; text: string }>();
  // 符号表始终基于全量 walk（单文件模式也要跨模块解析）
  const symbolMap = buildSymbolMap(all, cache);
  const suggestions: Array<{ file: string; missing: any[] }> = [];
  for (const f of files) {
    const found = checkFile(f, symbolMap, cache);
    if (found.length) suggestions.push({ file: f, missing: found });
  }
  const totalMissing = suggestions.reduce((n, s) => n + s.missing.length, 0);
  const typeOnly = suggestions.reduce(
    (n, s) => n + s.missing.filter((m) => m.typeOnly).length,
    0
  );
  const ambiguous = suggestions.reduce(
    (n, s) => n + s.missing.filter((m) => m.candidates.length > 1).length,
    0
  );
  return { files, suggestions, totals: { totalMissing, typeOnly, ambiguous } };
}
