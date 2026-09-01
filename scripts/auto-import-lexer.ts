#!/usr/bin/env node
/**
 * auto-import-lexer.ts — auto-import 词法层（白名单 + 标识符收集）。
 *
 * 设计意图：从 auto-import.ts 拆出的词法模块（2026-08-31 大脚本拆分基线 ADR）——
 * 剥离注释/字符串/模板字面量/正则字面量，收集代码状态下的标识符 token。
 * 领域专属（非通用共享层，故不入 _lib/），供 auto-import-detect.ts 消费。
 *
 * 依赖：零依赖（node:fs / node:path / node:url）
 *
 * 用法：被 auto-import-detect.ts 引用，非独立 CLI 入口。
 *   import { tokenize, KEYWORDS, GLOBALS } from './auto-import-lexer.ts';
 *
 * 退出码：非独立入口（无 CLI）。
 */
// ── 白名单（关键词 + 浏览器/JS 全局内置）────────────

export const KEYWORDS = new Set([
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

export const GLOBALS = new Set([
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
export function tokenize(text: string) {
  // 用 split('') 而非 [...text]：前者按 UTF-16 code unit 拆分，与下方 text.slice()/
  // split('\n') 的行号计算坐标一致；后者按 code point（emoji 占 1 元素）拆分，
  // 会导致含 emoji 的文件（如 toast 文案 📦）token 名/行号整体错位（误报缺失 import）。
  const chars = text.split('');
  const stripped = [...chars]; // 逐字符置空格，保留长度与换行
  const tokens: { name: string; start: number; line: number }[] = [];
  let i = 0;
  const n = chars.length;

  // 正则字面量识别：`/` 前一个非空白字符属于这些时，视为正则开头
  const REGEX_PRECEDERS = new Set(['(', '=', ':', ',', '!', '&', '|', '?', '{', ';', '[']);

  const backChar = (idx: number) => {
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
        // 先探测闭合：从 i+1 起找未被转义的 `/`（处理 \\ 转义与字符类 [...] 内的 `/`），
        // 确认能闭合才剥离，否则退回普通字符继续外层扫描（避免误判时 break 终止整个扫描）。
        // 2026-08-17 修复：字符类 `/[\\/:*?"<>|]/` 内的 `/` 不是闭合符——漏处理会让
        // 后续字符串剥离状态错乱（如 web-fs.ts 的 "toast:show" 被误判为裸标识符）。
        let probe = i + 1;
        let probeClosed = false;
        let inClass = false;
        while (probe < n) {
          if (chars[probe] === '\\') {
            probe += 2;
            continue;
          }
          if (!inClass && chars[probe] === '[') {
            inClass = true;
            probe++;
            continue;
          }
          if (inClass && chars[probe] === ']') {
            inClass = false;
            probe++;
            continue;
          }
          if (!inClass && chars[probe] === '/') {
            probeClosed = true;
            break;
          }
          probe++;
        }
        if (!probeClosed) {
          i++; // 判定失败，退回普通字符，外层循环继续
          continue;
        }
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
          if (!inClass && chars[i] === '[') {
            // 2026-08-17 修复：与 probe 阶段同口径——字符类 [...] 内的 `/` 不是闭合符，
            // 否则 `/[\\/:*?"<>|]/` 提前闭合污染后续字符串剥离（web-fs.ts "toast:show" 误判）
            inClass = true;
            stripped[i] = ' ';
            i++;
            continue;
          }
          if (inClass && chars[i] === ']') {
            inClass = false;
            stripped[i] = ' ';
            i++;
            continue;
          }
          if (!inClass && chars[i] === '/') {
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
