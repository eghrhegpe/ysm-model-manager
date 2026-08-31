#!/usr/bin/env node
/**
 * event-graph.mjs — Bus 事件契约守护者。
 * 从 bus.ts 的 BusEvents 接口提取权威事件清单，扫描 frontend/src/ 和 frontend/*.html，
 * 报告未声明事件 / 孤儿发射 / 鬼订阅 / **emit 缺参**（非 void 事件未传 payload）/
 * **void 多传** / **VOID_EVENTS 清单漂移**。
 *
 * 2026-08-29 加固（「未传参」审计）：
 *   - 调用点正则支持可选链（window.bus?.emit）——此前 `?.` 使整行失明，
 *     实证漂移：index.html 内联 emit("nav:change") 全项目无监听却长期漏检；
 *   - 新增 emit 实参检查：缺参（missing_payload）/void 多传（void_with_payload）
 *     在 --strict 下与未声明事件同为硬错误；
 *   - 新增 VOID_EVENTS 清单 vs BusEvents `: void` 标记双向漂移检测
 *     （运行时缺参告警靠这份清单，漂移 = 告警失明）。
 *
 * 用法：node scripts/event-graph.mjs [--check] [--json] [--strict] [--root <dir>]
 *   --root 仅供测试 fixture 覆盖仓库根（默认取真实仓库根）。
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts / _lib/parse-args.ts（零外部依赖）
 *
 * 退出码：默认 0；--strict 且存在硬错误（未声明事件/缺参/漂移）→ 1；用法错误 → 2。
 *
 * 设计意图：Bus 事件契约守护者——从 bus.ts 的 BusEvents 接口提取权威事件清单，
 * 报告未声明事件/孤儿发射/鬼订阅/emit 缺参/void 多传/VOID_EVENTS 清单漂移，
 * 防止事件契约漂移导致运行时告警失明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix } from './_lib/scan-files.ts';

import { parseArgs } from './_lib/parse-args.ts';

const ARGS = parseArgs(process.argv.slice(2), { bools: ['check', 'json', 'strict'], strings: ['root'] });
if (ARGS.help) {
  console.log('用法: node scripts/event-graph.mjs [--check] [--json] [--strict] [--root <dir>]');
  process.exit(0);
}
if (ARGS.unknown.length) {
  console.error(`❌ 未知参数: ${ARGS.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
const CHECK = ARGS.check;
const JSON_OUT = ARGS.json;
const STRICT = ARGS.strict;
/** 测试 fixture 根覆盖（不影响生产默认路径） */
const EFF_ROOT = ARGS.root ? path.resolve(ARGS.root) : getRoot();
const SRC_DIR = path.join(EFF_ROOT, 'frontend', 'src');
const FE_DIR = path.join(EFF_ROOT, 'frontend');
const HTML_FILES = fs.existsSync(FE_DIR)
  ? fs.readdirSync(FE_DIR).filter((f) => f.endsWith('.html')).map((f) => path.join(FE_DIR, f))
  : [];
const BUS_TS = path.join(SRC_DIR, 'bus.ts');
const OUT = path.join(EFF_ROOT, 'docs', 'event-graph.md');

/* ---------------- bus.ts 契约解析 ---------------- */

/**
 * 解析 BusEvents 接口 + VOID_EVENTS 清单。
 * 返回 { names:Set, voidDeclarations:Set, voidListed:string[] }。
 * 类型可能是跨行对象字面量（如 import:history-changed），按顶层分号切语句解析。
 */
function readBusContract() {
  const text = fs.readFileSync(BUS_TS, 'utf-8');
  const ifaceAt = text.indexOf('interface BusEvents');
  if (ifaceAt === -1) { console.error('❌ bus.ts 中未找到 interface BusEvents'); process.exit(1); }
  const braceOpen = text.indexOf('{', ifaceAt);
  let depth = 0, end = -1;
  for (let i = braceOpen; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = text.slice(braceOpen + 1, end);
  const names = new Set();
  const voidDeclarations = new Set();
  let cur = '', d = 0;
  const flush = () => {
    const st = cur; cur = '';
    const m = st.match(/\s*"([^"]+)"\s*:\s*([\s\S]*)/);
    if (!m) return;
    names.add(m[1]);
    if (/^void\b/.test(m[2].trim())) voidDeclarations.add(m[1]);
  };
  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') d++;
    else if (ch === '}' || ch === ']' || ch === ')') { if (d === 0) break; d--; }
    if (ch === ';' && d === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  // VOID_EVENTS 字面量清单（运行时 isVoidEvent 的权威来源，必须与 : void 标记同步）
  const listAt = text.indexOf('VOID_EVENTS');
  const listBody = listAt === -1 ? '' : text.slice(listAt, text.indexOf(']', listAt) + 1);
  const voidListed = [...listBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return { names, voidDeclarations, voidListed };
}

/* ---------------- 源码扫描 ---------------- */

function stripNoise(text) {
  // 块注释替换为等宽空白（保留换行数），否则后续所有行号整体漂移
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, ' ');
}

function collectSrcFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(ent.name) && !ent.name.endsWith('.test.ts') && !ent.name.endsWith('.spec.ts')) {
        files.push(p);
      }
    }
  };
  walk(SRC_DIR);
  return files;
}

/**
 * 方法调用点发现（唯一入口）：接收者任意、允许可选链；
 * 实参段由 extractArgs 平衡括号提取——天然支持跨行调用与字符串内逗号。
 * 历史：曾用三个行级正则做发现，CALL_TAIL_RE 允许行尾 `(` 而 CALL_PARENT_RE 不允许，
 * 导致 `bus.on(` 换行写事件名的跨行订阅恒漏检（实证：sync:download:missing 被误报孤儿发射）。
 */
const CALL_HEAD_RE = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][\w$]*)\s*\??\.\s*(emit|on|once|off)\s*\(/g;

/**
 * / 前的最近非空白字符是否允许开启正则字面量（排除除法场景的经典 lexer 启发式）。
 * 实证必要性：回调体 .replace(/"/g, "&quot;") 的裸引号曾被误当字符串边界，
 * 括号配对失衡致整条调用点丢失（init-pages.ts 的 package:selected）。
 */
const REGEX_PRECEDING_RE = /[({[,;:!&|?+\-*%~^=]$/;

/** src[i]==='/' 时按正则字面量跳过：字符类内 / 不闭合、吃尾部 flags；越界/跨行返回 null（降级当普通字符） */
function skipRegex(src, i) {
  let inClass = false;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') { while (i + 1 < src.length && /[a-z]/i.test(src[i + 1])) i++; return i; }
    if (c === '\n') return null;
  }
  return null;
}

/** 从左括号下一字符起提取平衡实参段；字符串与正则字面量内容不参与配对。返回段数组或 null */
function extractArgs(src, openParen) {
  let d = 0, i = openParen + 1;
  const n = src.length;
  let cur = '', lastSig = '('; // lastSig：最近非空白字符（正则/除法判定用）
  const parts = [];
  const note = (c) => { if (!/\s/.test(c)) lastSig = c; };
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { cur += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        cur += src[i]; i++;
      }
      cur += q; i++;
      lastSig = q;
      continue;
    }
    if (c === '/' && REGEX_PRECEDING_RE.test(lastSig)) {
      const end = skipRegex(src, i);
      if (end !== null) { cur += src.slice(i, end + 1); i = end + 1; lastSig = '/'; continue; }
    }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') {
      if (d === 0 && c === ')') { parts.push(cur); return parts; }
      d--;
    }
    if (c === ',' && d === 0) { parts.push(cur); cur = ''; lastSig = ','; i++; continue; }
    cur += c; note(c); i++;
  }
  return null; // 括号不平衡（跨模板拼接等），交由编译期兜底
}

function scanFiles(files, includeHtml, contract, arityIssues) {
  const eventMap = new Map();
  function add(event, method, file, line) {
    if (!eventMap.has(event)) eventMap.set(event, { emit: [], on: [], once: [], off: [] });
    eventMap.get(event)[method].push({ file, line });
  }
  /** 顶层非空段计数 */
  const argcOf = (args) => args.map((s) => s.trim()).filter(Boolean).length;
  function scanFile(filePath, rel) {
    const text = stripNoise(fs.readFileSync(filePath, 'utf-8'));
    let m;
    const headRe = new RegExp(CALL_HEAD_RE.source, 'g');
    while ((m = headRe.exec(text)) !== null) {
      const receiver = m[1], method = m[2];
      const openParen = m.index + m[0].length - 1;
      const args = extractArgs(text, openParen);
      if (!args) continue; // 括号不平衡（跨模板拼接等），交由编译期兜底
      const nameM = (args[0] ?? '').trim().match(/^["'`]([^"'`]*)["'`]$/);
      if (!nameM) continue; // 非字面量事件名不记录（与旧版单行正则行为一致）
      const line = text.slice(0, m.index).split('\n').length;
      add(nameM[1], method, rel, line);
      // emit 实参契约（仅 bus 接收者；自定义 emitter 不误伤）
      if (receiver === 'bus' && method === 'emit') {
        const event = nameM[1];
        if (!contract.names.has(event)) continue; // 未声明事件归 undeclared 管
        const isVoid = contract.voidDeclarations.has(event);
        const argc = argcOf(args); // argc 含事件名实参：typed 合法 ≥2；void 合法 ==1
        if (!isVoid && argc < 2) arityIssues.push({ type: 'missing_payload', event, file: rel, line });
        else if (isVoid && argc > 1) arityIssues.push({ type: 'void_with_payload', event, file: rel, line });
      }
    }
  }
  for (const f of files) scanFile(f, relPosix(f));
  if (includeHtml) for (const f of HTML_FILES) scanFile(f, relPosix(f));
  return { eventMap };
}

function checkContract(eventMap, contract, arityIssues) {
  const undeclared = [], orphans = [], ghosts = [];
  for (const [ev, d] of eventMap) {
    if (!contract.names.has(ev) && !undeclared.includes(ev)) undeclared.push(ev);
    if (d.emit.length > 0 && d.on.length === 0 && d.once.length === 0 && !orphans.includes(ev)) orphans.push(ev);
    if ((d.on.length > 0 || d.once.length > 0) && d.emit.length === 0 && !ghosts.includes(ev)) ghosts.push(ev);
  }
  // VOID_EVENTS 清单双向漂移（漏登记 → 运行时缺参告警失明；误登记 → 对非 void 放行缺参）
  const voidDrift = [];
  for (const ev of contract.voidDeclarations)
    if (!contract.voidListed.includes(ev)) voidDrift.push({ event: ev, detail: 'BusEvents 标记 void 但未登记进 VOID_EVENTS' });
  for (const ev of contract.voidListed)
    if (!contract.voidDeclarations.has(ev)) voidDrift.push({ event: ev, detail: 'VOID_EVENTS 登记了非 void 事件' });
  return { undeclared, orphans, ghosts, arityIssues, voidDrift };
}

/* ---------------- 报告渲染 ---------------- */

function renderMarkdown(eventMap, anomalies) {
  const out = [];
  out.push('# Bus 事件契约报告');
  out.push('');
  out.push('> **自动生成** — 由 `scripts/event-graph.mjs` 生成。');
  out.push('> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方（含 html 内联、可选链调用）。');
  out.push('');
  const hasHard = anomalies.undeclared.length || anomalies.arityIssues.length || anomalies.voidDrift.length;
  const hasSoft = anomalies.orphans.length || anomalies.ghosts.length;
  if (hasHard || hasSoft) {
    out.push('## ⚠️ 异常摘要');
    out.push('');
    if (anomalies.undeclared.length) {
      out.push('### 未声明事件（不在 BusEvents 中，可能是 typo 或漏声明）');
      out.push('');
      for (const ev of anomalies.undeclared) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — emit×${d.emit.length} on×${d.on.length}`); }
      out.push('');
    }
    if (anomalies.arityIssues.length) {
      out.push('### emit 实参违约（硬错误）');
      out.push('');
      for (const a of anomalies.arityIssues) out.push(`- \`${a.event}\` ${a.type} — \`${a.file}:${a.line}\``);
      out.push('');
    }
    if (anomalies.voidDrift.length) {
      out.push('### VOID_EVENTS 清单漂移（硬错误）');
      out.push('');
      for (const v of anomalies.voidDrift) out.push(`- \`${v.event}\` — ${v.detail}`);
      out.push('');
    }
    if (anomalies.orphans.length) {
      out.push('### 孤儿发射（emit 了但无 on/once 订阅方）');
      out.push('');
      for (const ev of anomalies.orphans) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — emit×${d.emit.length}`); }
      out.push('');
    }
    if (anomalies.ghosts.length) {
      out.push('### 鬼订阅（有 on/once 但从未被 emit）');
      out.push('');
      for (const ev of anomalies.ghosts) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — on×${d.on.length}`); }
      out.push('');
    }
  } else {
    out.push('## ✅ 无异常');
    out.push('');
    out.push("所有调用均在 BusEvents 契约内，无孤儿发射 / 鬼订阅 / 未声明事件 / 缺参。");
    out.push('');
  }
  const events = [...eventMap.keys()].sort();
  out.push('## 事件总览');
  out.push('');
  out.push('| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |');
  out.push('|------|--------|--------|-----------|--------|------|');
  for (const ev of events) {
    const d = eventMap.get(ev);
    let status = "✅";
    if (anomalies.undeclared.includes(ev)) status = "⚠️ 未声明";
    else if (anomalies.arityIssues.some((a) => a.event === ev)) status = "⛔ 实参违约";
    else if (d.emit.length > 0 && d.on.length === 0 && d.once.length === 0) status = "🔇 孤儿发射";
    else if (d.emit.length === 0 && (d.on.length > 0 || d.once.length > 0)) status = "👻 鬼订阅";
    out.push(`| \`${ev}\` | ${d.emit.length} | ${d.on.length} | ${d.once.length} | ${d.off.length} | ${status} |`);
  }
  out.push('');
  out.push('## 调用详情');
  out.push('');
  for (const ev of events) {
    const d = eventMap.get(ev);
    out.push(`### \`${ev}\``);
    out.push('');
    if (d.emit.length) { out.push("**发射方：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.emit) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.on.length) { out.push("**订阅方（on）：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.on) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.once.length) { out.push("**一次性订阅（once）：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.once) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.off.length) { out.push("**退订方：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.off) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
  }
  return out.join('\n');
}

function renderJSON(eventMap, anomalies) {
  const events = [...eventMap.keys()].sort();
  const data = {};
  for (const ev of events) {
    const d = eventMap.get(ev);
    data[ev] = {
      emit: d.emit.map((e) => `${e.file}:${e.line}`),
      on: d.on.map((e) => `${e.file}:${e.line}`),
      once: d.once.map((e) => `${e.file}:${e.line}`),
      off: d.off.map((e) => `${e.file}:${e.line}`),
    };
  }
  return JSON.stringify({
    _summary: {
      events: events.length,
      undeclared: anomalies.undeclared,
      orphans: anomalies.orphans,
      ghosts: anomalies.ghosts,
      arityIssues: anomalies.arityIssues,
      voidDrift: anomalies.voidDrift,
    },
    events: data,
  }, null, 2);
}

function printAnomalyReport(anomalies) {
  if (!anomalies.undeclared.length && !anomalies.orphans.length && !anomalies.ghosts.length
    && !anomalies.arityIssues.length && !anomalies.voidDrift.length) {
    console.warn("[event-graph] ✅ 无异常");
    return;
  }
  console.warn('');
  console.warn('═'.repeat(37));
  console.warn(' Bus 事件契约检查报告');
  console.warn('═'.repeat(37));
  if (anomalies.undeclared.length) {
    console.warn('⚠️  未声明事件（需审查是否 typo 或漏声明）：');
    for (const ev of anomalies.undeclared) console.warn(`   ${ev}`);
  }
  if (anomalies.arityIssues.length) {
    console.warn('⛔ emit 实参违约：');
    for (const a of anomalies.arityIssues) console.warn(`   ${a.type} ${a.event} @ ${a.file}:${a.line}`);
  }
  if (anomalies.voidDrift.length) {
    console.warn('⛔ VOID_EVENTS 清单漂移：');
    for (const v of anomalies.voidDrift) console.warn(`   ${v.event} — ${v.detail}`);
  }
  if (anomalies.orphans.length) {
    console.warn('🔇 孤儿发射（emit 无 on/once）：');
    for (const ev of anomalies.orphans) console.warn(`   ${ev}`);
  }
  if (anomalies.ghosts.length) {
    console.warn('👻 鬼订阅（on/once 无 emit）：');
    for (const ev of anomalies.ghosts) console.warn(`   ${ev}`);
  }
  console.warn('─'.repeat(37));
  console.warn("说明：未声明/实参违约/清单漂移是硬错误；孤儿/鬼订阅可能是有意设计，仅作记录。");
}

/* ---------------- 主流程 ---------------- */

function main() {
  if (!fs.existsSync(BUS_TS)) { console.error('❌ frontend/src/bus.ts 不存在'); process.exit(1); }
  if (!fs.existsSync(SRC_DIR)) { console.error('❌ frontend/src 不存在'); process.exit(1); }
  const contract = readBusContract();
  console.warn(`[event-graph] BusEvents 权威清单：${contract.names.size} 个事件`);
  const files = collectSrcFiles();
  console.warn(`[event-graph] 扫描源码文件：${files.length} 个`);
  const arityIssues = [];
  const { eventMap } = scanFiles(files, true, contract, arityIssues);
  console.warn(`[event-graph] 扫描到事件：${eventMap.size} 个`);
  const anomalies = checkContract(eventMap, contract, arityIssues);
  console.warn(`[event-graph] 异常：未声明 ${anomalies.undeclared.length}，实参违约 ${anomalies.arityIssues.length}，清单漂移 ${anomalies.voidDrift.length}，孤儿发射 ${anomalies.orphans.length}，鬼订阅 ${anomalies.ghosts.length}`);
  const hardFailures = anomalies.undeclared.length + anomalies.arityIssues.length + anomalies.voidDrift.length;
  // JSON 先行：机器消费方（doctor/CI/测试）无论成败都拿得到结构化报告
  if (JSON_OUT) {
    console.log(renderJSON(eventMap, anomalies));
    if (STRICT && hardFailures > 0) process.exit(1);
    return;
  }
  if (STRICT && hardFailures > 0) {
    console.error('');
    console.error('❌ --strict 下发现硬错误，阻断退出：');
    for (const ev of anomalies.undeclared) console.error(`  未声明事件 ${ev}`);
    for (const a of anomalies.arityIssues) console.error(`  ${a.type} ${a.event} @ ${a.file}:${a.line}`);
    for (const v of anomalies.voidDrift) console.error(`  清单漂移 ${v.event} — ${v.detail}`);
    process.exit(1);
  }
  if (CHECK) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';
    const md = renderMarkdown(eventMap, anomalies);
    if (existing !== md) {
      console.error('❌ docs/event-graph.md 过期，运行 `node scripts/event-graph.mjs` 刷新。');
      printAnomalyReport(anomalies);
      process.exit(1);
    }
    console.log('✅ docs/event-graph.md 最新。');
    printAnomalyReport(anomalies);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, renderMarkdown(eventMap, anomalies), 'utf-8');
  console.log(`📥 已写入 ${OUT}（${eventMap.size} 个事件）`);
  printAnomalyReport(anomalies);
}
main();
