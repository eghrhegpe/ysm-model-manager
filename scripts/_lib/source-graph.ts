/**
 * source-graph.ts — 源码符号/依赖图提取共享库（适配自 MikuMikuAR）。
 *
 * 零依赖（仅 node:fs / node:path）。YSM 为 Go + JS/TS 双栈：
 *   - JS/TS：export 关键字提取导出符号（getExportedSymbols）
 *   - Go：首字母大写顶层声明视为导出（getGoExportedSymbols）
 *
 * 用法：
 *   import { getExportedSymbols, walkSourceFiles, scanSourceGraph }
 *     from './_lib/source-graph.ts';
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './to-posix.ts';
import { walk } from './scan-files.ts';

export const EXCLUDE_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'wailsjs', 'bindings', 'dist']);
export const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\.tsx?$/, /\.spec\.tsx?$/, /\.gen\.tsx?$/];
/** 前端源码扩展名（.ts/.tsx + 存量 .js/.jsx，ADR-014 混编期两者并存）。 */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function isSourceFile(name: string, extensions = SOURCE_EXTENSIONS) {
  return extensions.some((ext) => name.endsWith(ext))
    && !EXCLUDE_FILES.some((re) => re.test(name));
}

export function shouldTraverseDir(name: string) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.has(name);
}

export function walkSourceFiles(srcDir: string, dir: string = srcDir, base: string = '', extensions: string[] = SOURCE_EXTENSIONS) {
  return walk(dir, {
    exts: extensions,
    skipDir: (name) => !shouldTraverseDir(name),
    skipFile: (name) => EXCLUDE_FILES.some((re) => re.test(name)),
    rel: true,
    base,
  }).map((item) => ({ file: (item as { abs: string }).abs, rel: (item as { rel: string }).rel }));
}

function stripImportExtension(spec: string) {
  const extension = path.extname(spec).toLowerCase();
  return IMPORT_EXTENSIONS.includes(extension) ? spec.slice(0, -extension.length) : spec;
}

function resolveCandidates(basePath: string) {
  const normalized = stripImportExtension(basePath);
  return [
    ...SOURCE_EXTENSIONS.map((ext) => normalized + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(normalized, `index${ext}`)),
  ];
}

export function resolveSourceImport(spec: string, importerFile: string, srcDir: string) {
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

/** 单条导入边。 */
export interface ImportEdge {
  path: string;
  isTypeOnly: boolean;
}

export function parseSourceImports(filePath: string, srcDir: string): ImportEdge[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const imports: ImportEdge[] = [];
  const specs = new Map<string, boolean>(); // spec -> isTypeOnly

  // 正则 A: import / export ... from '...'（跨行，支持 import type / export {}/*/as ns）
  // 边界：关键字与 from 之间禁止引号与分号——旧写法用 `[\s\S]*?` 会越过语句末尾，
  // 把 `import './a';` 一路吞到后面某条语句（实测连字符串里的 `from './zzz'` 都被解析成依赖）。
  // 捕获组 1 = `import type` 的 type 标记；捕获组 2 = 模块说明符。
  const reFrom = /(?:^|\n)[ \t]*(?:\/\/[^\n]*\n)*[ \t]*(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  // 正则 B: import '...'（纯 side-effect，无 from）
  const reSide = /(?:^|\n)[ \t]*(?:\/\/[^\n]*\n)*[ \t]*import\s+['"]([^'"]+)['"]/gm;
  // 正则 C: await import('...') — 任意位置（不要求行首）
  const reDyna = /await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

  /** 记录 spec：type-only 一旦为真不被后续普通导入降级。 */
  const put = (spec: string, isTypeOnly: boolean) => {
    if (!spec) return;
    if (specs.has(spec)) {
      if (isTypeOnly) specs.set(spec, true);
      return;
    }
    specs.set(spec, isTypeOnly);
  };

  let match;
  while ((match = reFrom.exec(text))) put(match[2]!, Boolean(match[1]!));
  while ((match = reSide.exec(text))) put(match[1]!, false);
  while ((match = reDyna.exec(text))) put(match[1]!, false);

  for (const [spec, isTypeOnly] of specs) {
    const resolved = resolveSourceImport(spec, filePath, srcDir);
    if (resolved) imports.push({ path: resolved, isTypeOnly });
  }

  return imports;
}

export interface SourceGraphResult {
  files: Array<{ file: string; rel: string }>;
  graph: Map<string, Set<string>>;
}

export function scanSourceGraph(srcDir: string, { scope = null, localOnly = false }: { scope?: string | null; localOnly?: boolean } = {}): SourceGraphResult {
  // 始终扫描全部文件构建全量图
  const files = walkSourceFiles(srcDir);
  const graph = new Map<string, Set<string>>(files.map(({ rel }) => [rel, new Set<string>()]));

  for (const { file, rel } of files) {
    for (const imported of parseSourceImports(file, srcDir)) {
      graph.get(rel)?.add(imported.path);
    }
  }

  // scope 过滤
  if (!scope) return { files, graph };

  const scopeSet = new Set(files.filter(({ rel }) => rel.startsWith(`${scope}/`)).map((f) => f.rel));

  if (localOnly) {
    // localOnly: 只保留 scope 内节点，不展开依赖
    const localGraph = new Map<string, Set<string>>();
    for (const rel of scopeSet) {
      const edges = graph.get(rel);
      if (edges) {
        localGraph.set(rel, new Set([...edges].filter((d) => scopeSet.has(d))));
      }
    }
    return { files: [...scopeSet].sort().map((rel) => ({ file: path.join(srcDir, rel), rel })), graph: localGraph };
  }

  // 默认 scope 模式：递归展开所有可达依赖
  const visited = new Set<string>();
  const reachable = new Set<string>();
  function walk(node: string) {
    if (visited.has(node)) return;
    visited.add(node);
    reachable.add(node);
    const deps = graph.get(node);
    if (deps) for (const dep of deps) walk(dep);
  }
  for (const rel of scopeSet) walk(rel);

  const scopedGraph = new Map<string, Set<string>>();
  for (const rel of reachable) {
    const edges = graph.get(rel);
    if (edges) {
      scopedGraph.set(rel, new Set([...edges].filter((d) => reachable.has(d))));
    }
  }
  const scopedFiles = [...reachable].sort().map((rel) => ({ file: path.join(srcDir, rel), rel }));

  return { files: scopedFiles, graph: scopedGraph };
}

// ── 导出符号提取 ──

/**
 * 提取 JS/TS 文件中的 export 符号列表（仅对外可见的导出）。
 * 实现见 tsDecls(text, exportedOnly=true)。
 */
export function getExportedSymbols(filePath: string, textOverride: string | null | undefined) {
  const text = textOverride ?? fs.readFileSync(filePath, 'utf8');
  return [...tsDecls(text, true)].sort();
}

/**
 * 提取 Go 文件中的导出符号（首字母大写顶层声明）：
 * func / type / const / var，含 `func (r *X) Method` 方法（记为 `X.Method`）。
 * 实现见 goDecls(text, exportedOnly=true)。
 */
export function getGoExportedSymbols(filePath: string, textOverride: string | null | undefined) {
  const text = textOverride ?? fs.readFileSync(filePath, 'utf8');
  return [...goDecls(text, true)].sort();
}

/** 按扩展名分发：.go → Go 提取；其余 → JS/TS 提取。 */
export function getExportedSymbolsAny(filePath: string, textOverride: string | null | undefined) {
  if (filePath.toLowerCase().endsWith('.go')) return getGoExportedSymbols(filePath, textOverride);
  return getExportedSymbols(filePath, textOverride);
}

// ── 声明提取统一内核 ──
// goDecls / tsDecls 各带 exportedOnly 开关，使「导出符号」与「顶层声明（导出+私有）」
// 两套口径共用同一份正则，杜绝分叉。
// 此前两套实现各自内联、逐步分叉，实测差异（2026-08-31 审核）：
//   - goTopFuncs 注释承诺 func/type/const/var/分组块 五类，实际只提取 func（漏 4 类），
//     导致 audit-split / rollback-impact 追踪迁移去向时把搬走的 type/const 误判为「已删除」；
//   - 两者都用 `\bfunc` 词界锚定，注释里的 `// func Ghost(`、`/* func Phantom(` 被当真符号；
//   - goTopFuncs / tsTopDecls 返回未排序（两组正则结果拼接序），api-break 报告顺序不稳定。
// 迁移追踪口径不变：一个符号被删除当且仅当它不在任一目标文件的顶层声明里。

/**
 * Go 声明提取：func（含方法，记为 Type.Method）/ type / const / var（含分组块）。
 * @param {string} text 源码全文
 * @param {boolean} exportedOnly true = 仅首字母大写的导出符号；false = 导出+私有全量
 * @returns {Set<string>}
 */
function goDecls(text: string, exportedOnly: boolean) {
  const out = new Set();
  const isExp = (n: string) => !!n && /^[A-Z]/.test(n);
  const add = (n: string) => { if (n && (!exportedOnly || isExp(n))) out.add(n); };
  let m;

  // 剥离块注释（等长空格替换，保持行数与列位不变，行号语义不受影响）。
  // 必需：块注释内可独立成行写 `func Phantom(`，行首锚定挡不住它。
  // 不剥行注释：行首锚定已能排除 `// func Ghost(`，而剥离会把字符串里的 `//`
  // （如 URL 常量）误当注释、破坏源码结构——故只处理块注释。
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m0: string) => m0.replace(/[^\n]/g, ' '));

  // func Name(...) / func (r *T) Name(...)
  // 行首锚定（容忍缩进）：注释里的 `// func Ghost(` 天然被排除。
  // 方法记为 `Type.Method`（裸方法名不是包级导出标识符，且不同 receiver 的同名方法会被 Set 吞掉）；
  // 泛型接收者 `r *Foo[T]` 末尾无裸标识符，提取失败时回退裸方法名而非丢弃。
  const reFunc = /^[ \t]*func\s+(?:\(([^)]*)\)\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  while ((m = reFunc.exec(src))) {
    const name = m[2]!;
    if (exportedOnly && !isExp(name)) continue;
    if (m[1]) {
      const tm = m[1].match(/([A-Za-z0-9_]+)(?:\s*\[[^\]]*\])?\s*$/);
      const t = tm ? tm[1] : '';
      // 未导出类型上的导出方法包外不可达，导出口径下不计
      if (exportedOnly && t && !isExp(t)) continue;
      add(t ? `${t}.${name}` : name);
    } else {
      add(name);
    }
  }

  // type Name ... / const Name = ... / var Name = ...（单行形式）
  const reDecl = /^[ \t]*(?:type|const|var)\s+([A-Za-z0-9_]+)/gm;
  while ((m = reDecl.exec(src))) add(m[1]!);

  // 分组声明 `const ( A = ... )`、`var (...)`、`type (...)`。
  // 块结束不依赖 `\n)`（缩进闭合会失配、成员内嵌 `\n)` 会越界）——
  // 逐行扫描到首个 trim 后以 `)` 开头的行（容忍尾部注释）。
  // 成员可带一个类型说明符（`LinkCopy LinkType = "copy"`，go/types/types.go 实证）；
  // 量词不嵌套（单层 `(?:...)?`），规避旧写法 `(?:\s+[...]+)*` 的灾难性回溯。
  const reGroupHead = /^[ \t]*(?:const|var|type)\s*\(/gm;
  const reGroupBody = /^[ \t]*([A-Za-z0-9_]+)(?:[ \t]+[A-Za-z0-9_[\].*]+)?[ \t]*(?:=|[{]|$|,)/gm;
  let gm;
  while ((gm = reGroupHead.exec(src))) {
    let blockEnd = -1;
    const lines = src.slice(gm.index).split('\n');
    for (let li = 1; li < lines.length; li++) {
      if (/^[ \t]*\)/.test(lines[li]!)) { blockEnd = gm.index + lines.slice(0, li).join('\n').length + 1; break; }
    }
    const block = blockEnd > gm.index ? src.slice(gm.index, blockEnd) : '';
    let bm;
    while ((bm = reGroupBody.exec(block))) add(bm[1]!);
  }

  return out;
}

/**
 * TS/JS 声明提取：function/class/interface/type/enum + const/let/var（含解构）
 * + `export { a, b as c }` 重新导出 + `export default Name`。
 * @param {string} text 源码全文
 * @param {boolean} exportedOnly true = 仅 export 的符号；false = 导出+私有全量
 * @returns {Set<string>}
 */
function tsDecls(text: string, exportedOnly: boolean) {
  const out = new Set();
  const add = (n: string) => { if (n) out.add(n); };
  const E = exportedOnly ? 'export\\s+' : '(?:export\\s+)?';
  let m;

  // function / class / interface / type / enum
  // 覆盖 `export default class Widget`、`export default async function f`、
  // `export declare function f`（`async`/`declare`/`default` 均为可选前缀）
  const reDecl = new RegExp(
    `^${E}(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum)\\s+([A-Za-z0-9_$]+)`,
    'gm',
  );
  while ((m = reDecl.exec(text))) add(m[1]!);

  // const / let / var 赋值。`const enum E` 的符号名是 enum 之后的标识符——
  // 旧实现会把关键字 `enum` 本身当符号名（实测 `export const enum E` → `enum`）。
  const reVal = new RegExp(
    `^${E}(?:declare\\s+)?(?:const|let|var)\\s+(?:enum\\s+)?([A-Za-z0-9_$]+)`,
    'gm',
  );
  while ((m = reVal.exec(text))) add(m[1]!);

  // 解构声明 `export const { a, b } = obj`（含默认值 `{ a = 1 }`）
  const reDestr = new RegExp(`^${E}(?:const|let|var)\\s*\\{([^}]+)\\}`, 'gm');
  while ((m = reDestr.exec(text))) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s*[:=]\s*/)[0]!.trim();
      if (/^[A-Za-z0-9_$]+$/.test(name)) add(name);
    }
  }

  // `export { a, b as c }` / `export type { T }`（取 as 之后的对外名）
  const reRe = /^export\s*(?:type\s*)?\{([^}]+)\}/gm;
  while ((m = reRe.exec(text))) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Za-z0-9_$]+$/.test(name)) add(name);
    }
  }

  // `export default Name;`（容忍行尾分号：这是最常见写法，`\s*$` 会被 `;` 挡掉）
  const reDefaultId = /^export\s+default\s+([A-Za-z0-9_$]+)\s*;?\s*$/gm;
  while ((m = reDefaultId.exec(text))) add(m[1]!);

  return out;
}

/** Go 顶层声明：导出+私有全量（不按首字母过滤）。 */
export function goTopFuncs(text: string) {
  return [...goDecls(text, false)].sort();
}

/** TS/JS 顶层声明：导出+私有全量。 */
export function tsTopDecls(text: string) {
  return [...tsDecls(text, false)].sort();
}

/** 按扩展名分发顶层声明提取：.go → goTopFuncs；其余 → tsTopDecls。 */
export function topDeclsAny(path: string, text: string) {
  return path.toLowerCase().endsWith('.go') ? goTopFuncs(text) : tsTopDecls(text);
}

/** 方法符号 Type.Method 的裸方法名（调用方文本匹配用）。 */
export function searchName(sym: string) {
  return sym.includes('.') ? sym.split('.').pop()! : sym;
}

/** 行数口径：换行数 +（非空且不以换行结尾 ? 1 : 0），与 line-counter 一致。 */
export function countLines(text: string | null) {
  if (text === null || typeof text !== 'string') return null;
  const nl = (text.match(/\n/g) || []).length;
  return nl + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
}
