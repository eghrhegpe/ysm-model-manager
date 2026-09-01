#!/usr/bin/env node
/**
 * auto-import-symbols.ts — auto-import 符号收集层（导出 / 本文件定义 / 已导入）。
 *
 * 设计意图：从 auto-import.ts 拆出的符号分析模块（2026-08-31 大脚本拆分基线 ADR）——
 * 在剥离后源码（tokenize 输出 stripped）上做正则级符号收集：导出符号表 / 本文件定义 /
 * 已导入符号，供 auto-import-detect.ts 消费。领域专属（非通用共享层，故不入 _lib/）。
 *
 * 依赖：零依赖（node:fs / node:path / node:url）
 *
 * 用法：被 auto-import-detect.ts 引用，非独立 CLI 入口。
 *   import { extractExports, extractDefined, extractImported } from './auto-import-symbols.ts';
 *
 * 退出码：非独立入口（无 CLI）。
 */
// ── 导出符号表 ───────────────────────────────────────

const EXPORT_NAMED_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const EXPORT_TYPE_RE = /export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

/** 拆分导出块内条目（含 `type X` 内联修饰符），返回 [{name, isType}]。 */
export function splitBlockEntries(raw: string) {
  const out: { name: string; isType: boolean }[] = [];
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (m) out.push({ name: m[2] || m[1], isType: part.trim().startsWith('type') });
  }
  return out;
}

/**
 * 提取文件的导出符号。
 * @param {string} text 剥离后源码
 * @returns {Array<{name:string,isType:boolean,line:number}>}
 */
export function extractExports(text: string) {
  const out: { name: string; isType: boolean; line: number }[] = [];
  for (const m of text.matchAll(EXPORT_NAMED_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ name: m[1], isType: false, line });
  }
  for (const m of text.matchAll(EXPORT_BLOCK_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    for (const e of splitBlockEntries(m[1])) out.push({ ...e, line });
  }
  for (const m of text.matchAll(EXPORT_TYPE_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ name: m[1], isType: true, line });
  }
  return out;
}

// ── 本文件定义 / 已导入 收集 ─────────────────────────

const DEFINED_VAR_RE = /\b(?:const|let|var)\s+(?:([A-Za-z_$][\w$]*)|(?:\{([^}]*)\}|\[([^\]]*)\]))/g;
const DEFINED_FN_RE = /\bfunction\s+([A-Za-z_$][\w$]*)/g;
const DEFINED_CLASS_RE = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const DEFINED_TYPE_RE = /\b(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

/** 从 openIdx 的左括号做括号配对，返回匹配的右括号下标；失败返回 -1。 */
export function matchParen(text: string, openIdx: number) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 顶层逗号拆分（忽略 {} [] () 嵌套）。 */
export function splitTopLevelCommas(s: string) {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('({['.includes(ch)) depth++;
    else if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 从单个参数段提取参数名（解构/rest/默认值兼容）。 */
export function paramNamesOfSegment(seg: string) {
  const s = seg.trim();
  if (!s) return [];
  const destructure = s.match(/^\{([^}]*)\}/) || s.match(/^\[([^\]]*)\]/);
  if (destructure) {
    // 解构参数 { a, b = 1 } / { a: rename }
    return splitTopLevelCommas(destructure[1])
      .map((x) => x.trim().match(/^[A-Za-z_$][\w$]*/)?.[0])
      .filter(Boolean);
  }
  const m = s.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/);
  return m ? [m[1]] : [];
}

/**
 * 收集函数形参名（括号配对式，支持嵌套类型注解/默认值）。
 * @param {string} stripped 剥离后源码
 * @param {RegExp} startRe 以 `\(` 结尾的左括号定位正则
 * @returns {Set<string>}
 */
export function collectParams(stripped: string, startRe: RegExp) {
  const names = new Set();
  for (const m of stripped.matchAll(startRe)) {
    const open = m.index + m[0].length - 1;
    if (stripped[open] !== '(') continue;
    const close = matchParen(stripped, open);
    if (close < 0) continue;
    for (const seg of splitTopLevelCommas(stripped.slice(open + 1, close))) {
      for (const n of paramNamesOfSegment(seg)) names.add(n);
    }
  }
  return names;
}

// 对象/类方法定义：`{ | } | , | ; | 换行` 后跟（可选修饰符 + 可选 async）名字(，且配对右括号后是 `{` 或 `:`。
// 修饰符（private/public/protected/readonly/static/abstract）可多词组合、顺序任意；此前仅跳 async，
// 漏识别 `private notify()` 等带修饰符方法（ADR-014 正则级盲点），致其被误判为缺失 import 去匹配
// 全局导出表（如 download-queue-store 的 notify）——详见 05fe24b7 引入的 cap 私有 notify 误报。
// `\??` 支持接口可选方法（showModelGroup?(i: number): void;）——名字后跟 `?` 再 `(`，
// 否则可选方法名被误判为缺失 import（2026-08-17 修复）。
const METHOD_START_RE = /(?:\{|\}|,|;|\n)\s*(?:(?:public|private|protected|readonly|static|abstract|async)\s+)*([A-Za-z_$][\w$]*)\??\s*\(/g;

/** 收集对象字面量/类体中的方法定义名（`foo(): void {` 形式）及其形参名。 */
export function collectMethods(stripped: string) {
  const names = new Set();
  for (const m of stripped.matchAll(METHOD_START_RE)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(stripped, open);
    if (close < 0) continue;
    let k = close + 1;
    while (k < stripped.length && /\s/.test(stripped[k])) k++;
    // 方法定义：右括号后跟 `{`（方法体）或 `:`（返回类型注解）或 `=>`（箭头）
    if (stripped[k] === '{' || stripped[k] === ':' || (stripped[k] === '=' && stripped[k + 1] === '>')) {
      names.add(m[1]);
      // P2 修复（审核）：同时收集方法形参（如 Proxy handler 的 `get(t, prop)` 的 t），
      // 否则参数名撞导出符号表时被误报为缺失 import
      for (const seg of splitTopLevelCommas(stripped.slice(open + 1, close))) {
        for (const n of paramNamesOfSegment(seg)) names.add(n);
      }
    }
  }
  return names;
}

/**
 * 收集本文件定义的标识符：const/let/var（含解构）、function/class 名、
 * type/interface/enum 名、函数/箭头/catch/constructor 形参名、对象/类方法名。
 * @param {string} stripped 剥离后源码
 * @returns {Set<string>}
 */
export function extractDefined(stripped: string) {
  const out = new Set();
  for (const m of stripped.matchAll(DEFINED_VAR_RE)) {
    if (m[1]) out.add(m[1]);
    for (const grp of [m[2], m[3]]) {
      if (grp) for (const s of grp.matchAll(/[A-Za-z_$][\w$]*/g)) out.add(s[0]);
    }
  }
  for (const re of [DEFINED_FN_RE, DEFINED_CLASS_RE, DEFINED_TYPE_RE]) {
    for (const m of stripped.matchAll(re)) out.add(m[1]);
  }
  // FN_START 支持泛型函数签名（closeDlg<T>(…)：名字后跟 <...> 再 `(`，
  // 否则泛型函数形参名（如 delay = 120）漏收集 → 被误判为缺失 import（2026-08-17 修复）
  const FN_START = /\bfunction\s+(?:[A-Za-z_$][\w$]*\s*(?:<[^>]*>\s*)?)?\(/g;
  const ARROW_START = /\(/g; // 箭头参数：配对后紧跟 =>
  const CATCH_START = /\bcatch\s*\(/g;
  const CTOR_START = /\bconstructor\s*\(/g;
  for (const name of collectParams(stripped, FN_START)) out.add(name);
  for (const name of collectParams(stripped, CATCH_START)) out.add(name);
  for (const name of collectParams(stripped, CTOR_START)) out.add(name);
  // 箭头函数参数：任意 `(` 配对后紧跟 `=>`
  for (const m of stripped.matchAll(ARROW_START)) {
    const close = matchParen(stripped, m.index);
    if (close < 0) continue;
    let k = close + 1;
    while (k < stripped.length && /\s/.test(stripped[k])) k++;
    // 支持带返回类型注解的箭头函数 `(t: string): string[] => ...`：
    // 参数 `)` 后先遇到 `:`（返回类型），须跳过类型到顶层 `=>` 才判为箭头函数。
    if (stripped[k] === ':') {
      let depth = 0;
      for (let j = k + 1; j < stripped.length; j++) {
        const cc = stripped[j];
        if (cc === '(') depth++;
        else if (cc === ')') depth--;
        else if (depth === 0 && cc === '=' && stripped[j + 1] === '>') {
          k = j;
          break;
        } else if (depth === 0 && (cc === '{' || cc === ';' || cc === '\n')) {
          break; // 非箭头函数（对象类型/其他语境），放弃
        }
      }
    }
    if (stripped[k] === '=' && stripped[k + 1] === '>') {
      for (const seg of splitTopLevelCommas(stripped.slice(m.index + 1, close))) {
        for (const n of paramNamesOfSegment(seg)) out.add(n);
      }
    }
  }
  for (const name of collectMethods(stripped)) out.add(name);
  return out;
}

// 注意：在剥离后的文本上匹配，字符串路径已被剥成空格，
// 因此不能要求结尾 `['"]...['"]`，识别到 from 关键字即止。
const IMPORT_RE = /import\s+(?:(?:type\s+)?([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?/g;
const IMPORT_NS_RE = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*/g;

/**
 * 收集文件已导入的符号（命名导入原名+别名、默认导入名、命名空间名）。
 * @param {string} stripped 剥离后源码
 * @returns {Set<string>}
 */
export function extractImported(stripped: string) {
  const out = new Set();
  for (const m of stripped.matchAll(IMPORT_RE)) {
    if (m[1]) out.add(m[1]);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const mm = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (mm) {
          out.add(mm[1]);
          if (mm[2]) out.add(mm[2]);
        }
      }
    }
  }
  for (const m of stripped.matchAll(IMPORT_NS_RE)) out.add(m[1]);
  return out;
}
