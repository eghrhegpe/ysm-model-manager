/**
 * source-graph.mjs — 源码符号/依赖图提取共享库（适配自 MikuMikuAR）。
 *
 * 零依赖（仅 node:fs / node:path）。YSM 为 Go + JS/TS 双栈：
 *   - JS/TS：export 关键字提取导出符号（getExportedSymbols）
 *   - Go：首字母大写顶层声明视为导出（getGoExportedSymbols）
 *
 * 用法：
 *   import { getExportedSymbols, walkSourceFiles, scanSourceGraph }
 *     from './_lib/source-graph.mjs';
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './to-posix.mjs';
import { walk } from './scan-files.mjs';

export const EXCLUDE_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'wailsjs', 'bindings', 'dist']);
export const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\.tsx?$/, /\.spec\.tsx?$/, /\.gen\.tsx?$/];
/** 前端源码扩展名（.ts/.tsx + 存量 .js/.jsx，ADR-014 混编期两者并存）。 */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function isSourceFile(name, extensions = SOURCE_EXTENSIONS) {
  return extensions.some((ext) => name.endsWith(ext))
    && !EXCLUDE_FILES.some((re) => re.test(name));
}

export function shouldTraverseDir(name) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.has(name);
}

export function walkSourceFiles(srcDir, dir = srcDir, base = '', extensions = SOURCE_EXTENSIONS) {
  return walk(dir, {
    exts: extensions,
    skipDir: (name) => !shouldTraverseDir(name),
    skipFile: (name) => EXCLUDE_FILES.some((re) => re.test(name)),
    rel: true,
    base,
  }).map(({ abs, rel }) => ({ file: abs, rel }));
}

function stripImportExtension(spec) {
  const extension = path.extname(spec).toLowerCase();
  return IMPORT_EXTENSIONS.includes(extension) ? spec.slice(0, -extension.length) : spec;
}

function resolveCandidates(basePath) {
  const normalized = stripImportExtension(basePath);
  return [
    ...SOURCE_EXTENSIONS.map((ext) => normalized + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(normalized, `index${ext}`)),
  ];
}

export function resolveSourceImport(spec, importerFile, srcDir) {
  let basePath;
  if (spec.startsWith('@/')) {
    basePath = path.join(srcDir, spec.slice(2));
  } else if (spec.startsWith('.')) {
    basePath = path.resolve(path.dirname(importerFile), spec);
  } else {
    return null;
  }

  const found = resolveCandidates(basePath).find((candidate) => fs.existsSync(candidate));
  return found ? toPosix(path.relative(srcDir, found)) : null;
}

export function parseSourceImports(filePath, srcDir) {
  const text = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const specs = new Set();

  // 正则 A: import / export ... from '...'（跨行，支持 import type / export {}/*/as ns）
  const reFrom = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  // 正则 B: import '...'（纯 side-effect，无 from）
  const reSide = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*import\s+['"]([^'"]+)['"]/gm;
  // 正则 C: await import('...') — 任意位置（不要求行首）
  const reDyna = /await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

  for (const re of [reFrom, reSide, reDyna]) {
    let match;
    while ((match = re.exec(text))) {
      const spec = match[1];
      if (!specs.has(spec)) {
        specs.add(spec);
        const resolved = resolveSourceImport(spec, filePath, srcDir);
        if (resolved) {
          imports.push({ path: resolved, isTypeOnly: false });
        }
      }
    }
  }

  return imports;
}

export function scanSourceGraph(srcDir, { scope = null, localOnly = false } = {}) {
  // 始终扫描全部文件构建全量图
  const files = walkSourceFiles(srcDir);
  const graph = new Map(files.map(({ rel }) => [rel, new Set()]));

  for (const { file, rel } of files) {
    for (const imported of parseSourceImports(file, srcDir)) {
      graph.get(rel).add(imported.path);
    }
  }

  // scope 过滤
  if (!scope) return { files, graph };

  const scopeSet = new Set(files.filter(({ rel }) => rel.startsWith(`${scope}/`)).map((f) => f.rel));

  if (localOnly) {
    // localOnly: 只保留 scope 内节点，不展开依赖
    const localGraph = new Map();
    for (const rel of scopeSet) {
      if (graph.has(rel)) {
        localGraph.set(rel, new Set([...graph.get(rel)].filter((d) => scopeSet.has(d))));
      }
    }
    return { files: [...scopeSet].sort().map((rel) => ({ file: path.join(srcDir, rel), rel })), graph: localGraph };
  }

  // 默认 scope 模式：递归展开所有可达依赖
  const visited = new Set();
  const reachable = new Set();
  function walk(node) {
    if (visited.has(node)) return;
    visited.add(node);
    reachable.add(node);
    const deps = graph.get(node);
    if (deps) for (const dep of deps) walk(dep);
  }
  for (const rel of scopeSet) walk(rel);

  const scopedGraph = new Map();
  for (const rel of reachable) {
    if (graph.has(rel)) {
      scopedGraph.set(rel, new Set([...graph.get(rel)].filter((d) => reachable.has(d))));
    }
  }
  const scopedFiles = [...reachable].sort().map((rel) => ({ file: path.join(srcDir, rel), rel }));

  return { files: scopedFiles, graph: scopedGraph };
}

// ── 导出符号提取 ──

/**
 * 提取 JS/TS 文件中的 export 符号列表。
 * 覆盖：export function/const/let/class/interface/type/enum/default、export { a, b }。
 */
export function getExportedSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const syms = new Set();

  // export async function / function / const / let / class / interface / type / enum
  const re1 = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re1.exec(text))) syms.add(m[1]);

  // export { a, b, c } / export { a as b }
  const re2 = /^export\s*\{([^}]+)\}/gm;
  while ((m = re2.exec(text))) {
    m[1].split(',').forEach((s) => {
      const name = s.trim().split(/\s+as\s+/).pop().trim();
      if (name && /^[A-Za-z0-9_]+$/.test(name)) syms.add(name);
    });
  }

  // export default function/class Name
  const re3 = /^export\s+default\s+(?:function|class)\s+([A-Za-z0-9_]+)/gm;
  while ((m = re3.exec(text))) syms.add(m[1]);

  // export default Name (inline)
  // P2-1：支持行尾分号（`export default bus;` 是最常见写法，`\s*$` 会被 `;` 挡掉）
  const re4 = /^export\s+default\s+([A-Za-z0-9_]+)\s*;?\s*$/gm;
  while ((m = re4.exec(text))) syms.add(m[1]);

  return [...syms].sort();
}

/**
 * 提取 Go 文件中的导出符号（首字母大写顶层声明）：
 * func / type / const / var，含 `func (r *X) Method` 方法（方法名即导出点）。
 */
export function getGoExportedSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const syms = new Set();
  const isExport = (name) => name && /^[A-Z]/.test(name);

  // func Name(...) / func (r *T) Name(...)
  // P2-2：方法与 funcmap 口径一致记录为 `Type.Method`（裸方法名不是包级导出标识符，
  // 且不同 receiver 的同名方法会被 Set 去重吞掉；接收者类型取末尾标识符）。
  // P3（复核）：容忍泛型接收者 `r *Foo[T]`（类型参数后无裸标识符结尾，提取失败时
  // 回退记录裸方法名而非丢弃）
  const reFunc = /\bfunc\s+(?:\(([^)]*)\)\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = reFunc.exec(text))) {
    const name = m[2];
    if (!isExport(name)) continue;
    if (m[1]) {
      const tm = m[1].match(/([A-Za-z0-9_]+)(?:\s*\[[^\]]*\])?\s*$/);
      const t = tm ? tm[1] : '';
      syms.add(t ? `${t}.${name}` : name); // 提取不到接收者类型时回退裸方法名
    } else {
      syms.add(name);
    }
  }

  // type Name ...
  const reType = /^type\s+([A-Za-z0-9_]+)\s+/gm;
  while ((m = reType.exec(text))) if (isExport(m[1])) syms.add(m[1]);

  // const Name = / var Name =
  const reVal = /^(?:const|var)\s+([A-Za-z0-9_]+)\s*=/gm;
  while ((m = reVal.exec(text))) if (isExport(m[1])) syms.add(m[1]);

  // 分组声明 `const ( A = ... / B = ... )`、`var (...)`、`type (...)`（P2-3：此前全部漏提取）
  // 逐行扫描分组块内的大写开头标识符。
  // P2（复核）：成员可带类型说明符（`LinkCopy LinkType = "copy"`，go/types/types.go 实证），
  // 标识符与 `=`/行尾之间容忍一个类型 token 序列。
  const reGroupHead = /^(?:const|var|type)\s*\(/gm;
  const reGroupBody = /^\s*([A-Za-z0-9_]+)(?:\s+[A-Za-z0-9_\[\]\.\*]+)*\s*(?:=|$|,)/gm;
  let gm;
  while ((gm = reGroupHead.exec(text))) {
    // P3（复核）：块结束不依赖 `\n)`（缩进闭合会失配、嵌入 `\n)` 会越界）——
    // 逐行扫描到首个 trim 后为 `)` 的行（容忍尾部注释）
    let blockEnd = -1;
    const lines = text.slice(gm.index).split('\n');
    for (let li = 1; li < lines.length; li++) {
      if (/^\s*\)/.test(lines[li])) { blockEnd = gm.index + lines.slice(0, li).join('\n').length + 1; break; }
    }
    const block = blockEnd > gm.index ? text.slice(gm.index, blockEnd) : '';
    let bm;
    while ((bm = reGroupBody.exec(block))) if (isExport(bm[1])) syms.add(bm[1]);
  }

  return [...syms].sort();
}

/** 按扩展名分发：.go → Go 提取；其余 → JS/TS 提取。 */
export function getExportedSymbolsAny(filePath) {
  if (filePath.toLowerCase().endsWith('.go')) return getGoExportedSymbols(filePath);
  return getExportedSymbols(filePath);
}
