#!/usr/bin/env node
/**
 * auto-import.mjs — TS/JS 缺失 import 检测（只读提示版，ADR-014 试水）。
 *
 * 零依赖（仅 node:fs / node:path），复用 _lib/scan-files.mjs 共享层。
 *
 * 原理（goimports 轻量版，正则级非 AST 级）：
 *   1. 扫描 frontend/src 下所有 .ts/.js，提取每个模块的导出符号表
 *      （export const/function/class + export type/interface/enum + export { a, b }）；
 *   2. 对目标文件做词法剥离（注释/字符串/模板字面量），收集代码中出现的标识符；
 *   3. 排除：关键词/全局内置、本文件定义（const/function/class/参数/解构）、
 *      已 import（含别名/命名空间/默认导入）、属性访问（obj.prop 的 prop）；
 *   4. 剩余标识符 ∩ 导出符号表 = 疑似缺失 import，输出建议（不写文件）。
 *
 * 设计取舍（试水版已知局限，供误报率评估）：
 *   - 正则级分析，非 TS AST：局部变量与外部符号无法 100% 区分，靠「导出表
 *     命中才建议」把误报面压到最小（导出符号名多为专名，如 PageStore/ALL_EXTS）；
 *   - 模板字符串整体剥离：`${foo}` 插值内的符号不检测（漏报可接受）；
 *   - 方法体参数（method(a) 的 a）不收集：参数名撞导出名的场景低频；
 *   - 绑定符号（DetectZipType 等）刻意不补：项目规范走 getApp()（ADR-012）。
 *
 * 用法：
 *   node scripts/auto-import.mjs                      # 检测全部 .ts
 *   node scripts/auto-import.mjs frontend/src/core/handler-other.ts   # 单文件
 *   node scripts/auto-import.mjs --include-js         # 连存量 .js 一起扫
 *   node scripts/auto-import.mjs --fix                # 自动写入缺失 import（歧义跳过）
 *   node scripts/auto-import.mjs --watch              # 监听变化自动重扫
 *   node scripts/auto-import.mjs --json               # JSON 输出（CI 用）
 *   node scripts/auto-import.mjs --strict             # 有缺失 → 退出码 1
 *
 * 退出码：默认 0（提示工具）；--strict 且存在缺失建议 → 1。
 * 设计意图：自动导入修复工具
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, walk, toPosix, readText, relPosix } from './_lib/scan-files.mjs';

// ── CLI ─────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const WATCH = ARGS.includes('--watch');
const INCLUDE_JS = ARGS.includes('--include-js');
const STRICT = ARGS.includes('--strict');
const FIX = ARGS.includes('--fix');
const JSON_OUT = ARGS.includes('--json');
const TARGETS = ARGS.filter((a) => !a.startsWith('--'));

// ── 白名单（关键词 + 浏览器/JS 全局内置）────────────

const KEYWORDS = new Set([
  // 控制流/声明
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'let', 'static', 'await', 'async', 'of', 'from', 'as', 'satisfies',
  // TS 专用
  'type', 'interface', 'implements', 'declare', 'readonly', 'keyof', 'infer', 'is',
  'namespace', 'module', 'require', 'get', 'set', 'public', 'private', 'protected',
  'abstract', 'any', 'unknown', 'never', 'string', 'number', 'boolean', 'symbol',
  'bigint', 'object', 'undefined', 'asserts', 'unique', 'out', 'override', 'accessor',
  'using', 'intrinsic',
]);

const GLOBALS = new Set([
  // 浏览器环境
  'window', 'document', 'console', 'navigator', 'localStorage', 'sessionStorage',
  'location', 'history', 'screen', 'fetch', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'queueMicrotask', 'structuredClone', 'performance', 'crypto', 'atob', 'btoa',
  'alert', 'confirm', 'prompt', 'getComputedStyle', 'getSelection', 'customElements',
  'self', 'globalThis', 'requestIdleCallback', 'cancelIdleCallback',
  // JS 内置
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Number',
  'String', 'Boolean', 'Array', 'Object', 'Function', 'Date', 'Math', 'JSON',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'EvalError', 'URIError', 'AggregateError', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'eval', 'NaN', 'Infinity', 'Reflect', 'Proxy', 'WeakRef', 'FinalizationRegistry',
  'Intl', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'URL',
  'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request',
  'Response', 'WebSocket', 'EventSource', 'atomics', 'structuredClone',
  // DOM/事件
  'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment',
  'ShadowRoot', 'Document', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent',
  'TouchEvent', 'WheelEvent', 'FocusEvent', 'InputEvent', 'DragEvent',
  'ClipboardEvent', 'PointerEvent', 'UIEvent', 'TransitionEvent', 'AnimationEvent',
  'MessageEvent', 'PopStateEvent', 'ErrorEvent', 'BeforeUnloadEvent',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLSpanElement',
  'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'HTMLCanvasElement',
  'HTMLAnchorElement', 'HTMLFormElement', 'HTMLLabelElement', 'HTMLUListElement',
  'HTMLLIElement', 'HTMLTableElement', 'HTMLTableRowElement', 'HTMLTableCellElement',
  'HTMLOptionElement', 'HTMLDialogElement', 'HTMLVideoElement', 'HTMLAudioElement',
  'HTMLIFrameElement', 'SVGElement', 'Path2D', 'CanvasRenderingContext2D',
  'OffscreenCanvas', 'Image', 'ImageData', 'DOMParser', 'XMLSerializer',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver',
  // TS lib 工具类型
  'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'Parameters', 'ReturnType', 'ConstructorParameters',
  'InstanceType', 'ThisType', 'Record', 'ArrayLike', 'ReadonlyArray', 'PromiseLike',
  'Iterable', 'Iterator', 'AsyncIterable', 'AsyncIterator', 'Generator',
]);

// ── 词法剥离 + 标识符收集 ───────────────────────────

/**
 * 剥离注释/字符串/模板字面量（原长度保留、内容置空格，行号不变），
 * 同时收集代码状态下的标识符 token。
 * @param {string} text 源码（已去 BOM/CRLF）
 * @returns {{ stripped: string, tokens: Array<{name:string,start:number,line:number}> }}
 */
function tokenize(text) {
  const chars = [...text];
  const stripped = [...chars]; // 逐字符置空格，保留长度与换行
  const tokens = [];
  let i = 0;
  const n = chars.length;

  // 正则字面量识别：`/` 前一个非空白字符属于这些时，视为正则开头
  const REGEX_PRECEDERS = new Set(['(', '=', ':', ',', '!', '&', '|', '?', '{', ';', '[']);

  const backChar = (idx) => {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(chars[j])) j--;
    return j >= 0 ? chars[j] : '';
  };

  while (i < n) {
    const c = chars[i];
    // 行注释
    if (c === '/' && chars[i + 1] === '/') {
      while (i < n && chars[i] !== '\n') {
        stripped[i] = ' ';
        i++;
      }
      continue;
    }
    // 块注释
    if (c === '/' && chars[i + 1] === '*') {
      stripped[i] = ' ';
      stripped[i + 1] = ' ';
      i += 2;
      while (i < n && !(chars[i] === '*' && chars[i + 1] === '/')) {
        stripped[i] = ' ';
        i++;
      }
      if (i < n) {
        stripped[i] = ' ';
        stripped[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    // 字符串字面量
    if (c === "'" || c === '"') {
      const q = c;
      stripped[i] = ' ';
      i++;
      while (i < n) {
        if (chars[i] === '\\') {
          stripped[i] = ' ';
          if (i + 1 < n) stripped[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (chars[i] === q) {
          stripped[i] = ' ';
          i++;
          break;
        }
        stripped[i] = ' ';
        i++;
      }
      continue;
    }
    // 模板字面量（整体剥离，插值 ${} 不分析——已知局限）
    if (c === '`') {
      stripped[i] = ' ';
      i++;
      while (i < n) {
        if (chars[i] === '\\') {
          stripped[i] = ' ';
          if (i + 1 < n) stripped[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (chars[i] === '`') {
          stripped[i] = ' ';
          i++;
          break;
        }
        stripped[i] = ' ';
        i++;
      }
      continue;
    }
    // 正则字面量（启发式：前导符为 = ( : , ! & | ? { ; [ 时可能）
    if (c === '/' && chars[i + 1] !== '/' && chars[i + 1] !== '*') {
      const prev = backChar(i);
      if (REGEX_PRECEDERS.has(prev)) {
        stripped[i] = ' ';
        i++;
        let closed = false;
        while (i < n) {
          if (chars[i] === '\\') {
            stripped[i] = ' ';
            if (i + 1 < n) stripped[i + 1] = ' ';
            i += 2;
            continue;
          }
          if (chars[i] === '/') {
            stripped[i] = ' ';
            i++;
            // 吞 flags
            while (i < n && /[a-z]/i.test(chars[i])) {
              stripped[i] = ' ';
              i++;
            }
            closed = true;
            break;
          }
          stripped[i] = ' ';
          i++;
        }
        if (!closed) break; // 判定失败，退回普通字符
        continue;
      }
      i++;
      continue;
    }
    // 标识符
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(chars[i])) i++;
      const name = text.slice(start, i);
      const line = text.slice(0, start).split('\n').length;
      tokens.push({ name, start, line });
      continue;
    }
    i++;
  }
  return { stripped: stripped.join(''), tokens };
}

// ── 导出符号表 ───────────────────────────────────────

const EXPORT_NAMED_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const EXPORT_TYPE_RE = /export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

/** 拆分导出块内条目（含 `type X` 内联修饰符），返回 [{name, isType}]。 */
function splitBlockEntries(raw) {
  const out = [];
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
function extractExports(text) {
  const out = [];
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
function matchParen(text, openIdx) {
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
function splitTopLevelCommas(s) {
  const out = [];
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
function paramNamesOfSegment(seg) {
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
function collectParams(stripped, startRe) {
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

// 对象/类方法定义：`{ | } | , | ; | 换行` 后跟（可选 async）名字(，且配对右括号后是 `{` 或 `:`。
const METHOD_START_RE = /(?:\{|\}|,|;|\n)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;

/** 收集对象字面量/类体中的方法定义名（`foo(): void {` 形式）。 */
function collectMethods(stripped) {
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
function extractDefined(stripped) {
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
  const FN_START = /\bfunction\s+(?:[A-Za-z_$][\w$]*\s*)?\(/g;
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
function extractImported(stripped) {
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

// ── 相对导入路径 ─────────────────────────────────────

/** 从 fromFile 到 toFile 的相对导入说明符（正斜杠，补扩展名，./ 开头）。 */
function relativeImportSpec(fromFile, toFile) {
  let rel = toPosix(path.relative(path.dirname(fromFile), toFile));
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

// ── 检测主流程 ───────────────────────────────────────

/**
 * 检测单个文件的缺失 import。
 * @param {string} file 绝对路径
 * @param {Map<string, Array<{file:string,isType:boolean}>>} symbolMap 全局导出表
 * @returns {Array<{symbol:string,line:number,typeOnly:boolean,candidates:string[]}>}
 */
function checkFile(file, symbolMap) {
  const text = readText(file);
  const { stripped, tokens } = tokenize(text);
  const defined = extractDefined(stripped);
  const imported = extractImported(stripped);
  const selfExports = new Set(extractExports(stripped).map((e) => e.name));

  // re-export 语句 `export { a, b } from "./x"`：花括号内符号是转发名非引用。
  const reExportRanges = [];
  for (const m of stripped.matchAll(/export\s+(?:type\s+)?\{[^}]*\}\s*from/g)) {
    const brace = stripped.indexOf('{', m.index);
    const close = stripped.indexOf('}', brace);
    if (close > brace) reExportRanges.push([brace, close]);
  }

  const seen = new Set(); // 去重（同一符号只报一次，行号取首次出现）
  const out = [];

  for (const t of tokens) {
    const { name, start, line } = t;
    if (KEYWORDS.has(name) || GLOBALS.has(name)) continue;
    if (defined.has(name) || imported.has(name) || selfExports.has(name)) continue;
    // re-export 花括号区间内的符号：跳过
    if (reExportRanges.some(([a, b]) => start > a && start < b)) continue;
    // 属性访问 obj.prop 的 prop：前一个非空白字符是 `.`（用 stripped，注释已剥为空）
    let j = start - 1;
    while (j >= 0 && /\s/.test(stripped[j])) j--;
    if (j >= 0 && stripped[j] === '.') continue;
    // 对象字面量 key `{ bus: 1 }` / 接口字段 `{ esc: string; fillSearch: ... }`：key 非引用。
    // 前一个非空白（stripped，注释/空白已归一）是 `{`/`,`/`;` 且后一个非空白是 `:` 才判定为 key；
    // `{ bus }` 简写属性与 `[bus, fmt]` 数组元素不满足 `:` 条件，仍按引用处理。
    if (j >= 0 && (stripped[j] === '{' || stripped[j] === ',' || stripped[j] === ';')) {
      let k = start + name.length;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ':') continue;
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

/** 构建全局导出符号表：name → [{file, isType}]。 */
function buildSymbolMap(files) {
  const map = new Map();
  for (const f of files) {
    const stripped = tokenize(readText(f)).stripped;
    for (const e of extractExports(stripped)) {
      if (!map.has(e.name)) map.set(e.name, []);
      map.get(e.name).push({ file: f, isType: e.isType });
    }
  }
  return map;
}

/** 收集扫描目标文件（默认 .ts；--include-js 加 .js；也可显式指定路径）。 */
function collectFiles() {
  const all = walk(SRC_DIR);
  if (TARGETS.length > 0) {
    return TARGETS.map((t) => path.resolve(t)).filter((p) => fs.existsSync(p));
  }
  return all.filter((p) => (INCLUDE_JS ? true : p.endsWith('.ts')));
}

/** 跑一轮完整检测，返回 { files, suggestions, totals }。 */
function run() {
  const targets = collectFiles();
  // 符号表始终基于全量 walk（单文件模式也要跨模块解析）
  const symbolMap = buildSymbolMap(walk(SRC_DIR));
  const suggestions = [];
  for (const f of targets) {
    const found = checkFile(f, symbolMap);
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
  return { files: targets, suggestions, totals: { totalMissing, typeOnly, ambiguous } };
}

// ── --fix 自动写入 ───────────────────────────────────

/**
 * 将缺失 import 建议写入文件（幂等：写入后重跑不再报告）。
 * 规则：
 *   - 歧义符号（多候选模块）跳过，不猜测来源；
 *   - 同一模块的多个符号聚合为一行（值/类型分开）；
 *   - 插入位置：文件头部注释块之后、第一个 import（或代码）之前。
 * @param {Array<{file:string,missing:Array}>} suggestions run() 输出
 * @returns {{ fixed: number, skipped: number }}
 */
function applyFixes(suggestions) {
  let fixed = 0;
  let skipped = 0;
  for (const s of suggestions) {
    // 按模块路径聚合（值/类型分组）
    const groups = new Map(); // path -> { values:Set, types:Set }
    let fileSkipped = 0;
    for (const m of s.missing) {
      if (m.candidates.length > 1) {
        fileSkipped++;
        continue;
      }
      const p = m.candidates[0];
      if (!groups.has(p)) groups.set(p, { values: new Set(), types: new Set() });
      const g = groups.get(p);
      (m.typeOnly ? g.types : g.values).add(m.symbol);
    }
    if (groups.size === 0) {
      skipped += fileSkipped;
      continue;
    }
    // 生成 import 行（符号按字典序）
    const newLines = [];
    for (const [p, g] of groups) {
      if (g.values.size) newLines.push(`import { ${[...g.values].sort().join(', ')} } from "${p}"`);
      if (g.types.size) newLines.push(`import type { ${[...g.types].sort().join(', ')} } from "${p}"`);
    }
    // 定位插入点：跳过文件头注释块（// 或 /* 开头的行）与空行
    const raw = fs.readFileSync(s.file, 'utf-8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'; // 保留原行尾风格（CRLF 文件不被改写为 LF）
    const text = readText(s.file);
    const fileLines = text.split('\n');
    let insertAt = 0;
    while (insertAt < fileLines.length) {
      const t = fileLines[insertAt].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
        insertAt++;
        continue;
      }
      break;
    }
    // 插入：import 块后保留一个空行分隔（若插入点前一行为空则避免双重空行，
    // 移除的是 tail 末尾的空行，而非首个 import 行）
    const tail = [...newLines, ''];
    if (insertAt > 0 && fileLines[insertAt - 1].trim() === '') {
      tail.pop();
    }
    fileLines.splice(insertAt, 0, ...tail);
    fs.writeFileSync(s.file, fileLines.join(eol));
    fixed += newLines.length;
    skipped += fileSkipped;
  }
  return { fixed, skipped };
}

// ── 输出 ─────────────────────────────────────────────

function fmtText({ files, suggestions, totals }) {
  const lines = [
    `扫描 ${files.length} 个文件（${relPosix(SRC_DIR)}），缺失 import 建议 ${totals.totalMissing} 条`
    + `（类型 ${totals.typeOnly}，歧义 ${totals.ambiguous}）。`,
    '',
  ];
  for (const s of suggestions) {
    lines.push(`== ${relPosix(s.file)} ==`);
    for (const m of s.missing) {
      const kind = m.typeOnly ? ' [type]' : '';
      const tag = m.candidates.length > 1 ? ` ⚠️ 歧义(${m.candidates.length})` : '';
      const head = m.candidates.length === 1
        ? `import ${m.typeOnly ? 'type ' : ''}{ ${m.symbol} } from "${m.candidates[0]}"`
        : `import ${m.typeOnly ? 'type ' : ''}{ ${m.symbol} } from "<候选之一>"`;
      lines.push(`  L${m.line}  ${m.symbol.padEnd(18)}→ ${head}${kind}${tag}`);
      if (m.candidates.length > 1) {
        for (const c of m.candidates) lines.push(`            候选: ${c}`);
      }
    }
    lines.push('');
  }
  if (totals.totalMissing === 0) {
    lines.push('✅ 未发现缺失 import。');
  } else {
    lines.push('（只读提示，未修改任何文件；加 --fix 可自动写入）');
  }
  return lines.join('\n');
}

function fmtJson({ files, suggestions, totals }) {
  return JSON.stringify(
    {
      _summary: { scanned: files.length, missing: totals.totalMissing },
      scanned: files.length,
      totals,
      files: suggestions.map((s) => ({
        file: relPosix(s.file),
        missing: s.missing.map((m) => ({
          symbol: m.symbol,
          line: m.line,
          typeOnly: m.typeOnly,
          candidates: m.candidates,
        })),
      })),
    },
    null,
    2
  );
}

function main() {
  const result = run();
  if (FIX && result.totals.totalMissing > 0) {
    const { fixed, skipped } = applyFixes(result.suggestions);
    // 写回后重跑一轮，输出修复后状态（幂等自检：第二次应无新增）
    const after = run();
    process.stdout.write(`--fix：写入 ${fixed} 行 import（歧义跳过 ${skipped}），修复后剩余 ${after.totals.totalMissing} 条建议。\n`);
    process.stdout.write((JSON_OUT ? fmtJson(after) : fmtText(after)) + '\n');
    if (STRICT && after.totals.totalMissing > 0) process.exit(1);
    return;
  }
  process.stdout.write((JSON_OUT ? fmtJson(result) : fmtText(result)) + '\n');
  if (STRICT && result.totals.totalMissing > 0) process.exit(1);
}

// ── --watch 模式 ─────────────────────────────────────

if (WATCH) {
  console.log(`[auto-import] 监听 ${relPosix(SRC_DIR)} 变化（Ctrl+C 退出）...`);
  let timer = null;
  const rerun = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('\n--- 重扫 ---');
      main();
    }, 300);
  };
  fs.watch(SRC_DIR, { recursive: true }, rerun);
  main();
} else {
  main();
}
