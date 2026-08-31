#!/usr/bin/env node
/**
 * line-counter.mjs — 代码行数统计与文件健康度分析（文件级 + 函数级双粒度）。
 *
 * 定位：ADR-040（架构规模治理）/ ADR-141（大脚本拆分基线）配套的巡检工具——
 * 手动运行 + 子代理消费（--funcs --json），不挂 CI 门禁（情报型）。2026-09 孤儿审计
 * 确认保留：与 drift-scan / trace-analyze 同为「按需诊断」类，无 CI 挂载不等于死代码。
 *
 * 设计意图：
 *   1. 默认模式（文件级）：由 line-counter.py 迁移（2026-08-03），逻辑逐点保真
 *      （含原 package_lines 按文件计数行为），总览 Go/前端分布 + 大文件预警 (>700 行)。
 *   2. --funcs 模式（函数级，2026-08-26 新增）：精确识别单函数行数并三档分级，
 *      用于 ADR-040 红线日常巡检、重构前候选定位、PR 肥膘自动标注。
 *      前端 TS/JS + Go 双栈覆盖；括号匹配定边界 + 新顶层声明护栏截断；
 *      生成文件、测试文件、node_modules 自动豁免。
 *
 * 依赖：node:fs / node:path / node:url / scripts/_lib/scan-files.mjs（零外部依赖）。
 *
 * 用法：
 *   node scripts/line-counter.mjs                                    # 默认：文件级总览（不变）
 *   node scripts/line-counter.mjs --funcs                            # 新增：函数级三档统计（frontend/src + go/）
 *   node scripts/line-counter.mjs --funcs --scope frontend/src/utils # 新增：限定扫描目录
 *   node scripts/line-counter.mjs --funcs --threshold 80             # 新增：自定义黄档阈值（橙=2x / 红=3x）
 *   node scripts/line-counter.mjs --funcs --json                     # 新增：JSON（子代理/CI 消费）
 *
 * 退出码：0（无论有无命中；情报型工具，不阻断）。ERROR 级异常时 process.exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { walk, readText, getRoot, relPosix } from './_lib/scan-files.mjs';
import { parseArgs } from './_lib/parse-args.mjs';

const ROOT = getRoot();

// ─── 参数解析（共享层 _lib/parse-args.mjs）────────────────────────
// 位置参数由共享层收进 `_`（原 _positional 同样未被消费，此处省略）。
// --threshold 正整数校验保留（非法时告警回落默认 30，与原手写解析一致）。
const raw = parseArgs(process.argv.slice(2), {
  bools: ['funcs', 'json'],
  strings: ['scope', 'threshold'],
  defaults: { threshold: 30 }, // 默认 🟨 >30，🟧 = 2×threshold，🟥 = 3×threshold
});
if (raw.unknown && raw.unknown.length) {
  console.error(`❌ 未知参数: ${raw.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
if (raw.threshold !== null) {
  const n = parseInt(raw.threshold, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`[line-counter] --threshold 需正整数，收到 ${raw.threshold}，用默认 30`);
    raw.threshold = 30;
  } else {
    raw.threshold = n;
  }
}
const args = { funcs: raw.funcs, json: raw.json, scope: raw.scope, threshold: raw.threshold };

// ─── 生成/测试文件豁免（复用现有 isGeneratedFile，新增测试文件判定）──
const GENERATED_FILE_RE = /\.gen\.(mjs|js|ts|go)$/;
const GENERATED_MARKER_RE = /\/\/\s*=====\s*自动生成|\/\*\s*自动生成|<!--\s*自动生成/;
const TEST_FILE_RE = /\.(test|spec)\.[jt]s$/;
const TEST_DIR_NAME = '__tests__';

function isGeneratedFile(f) {
  if (GENERATED_FILE_RE.test(f)) return true;
  try {
    const head = readText(f).slice(0, 200);
    return GENERATED_MARKER_RE.test(head);
  } catch { return false; }
}

function isTestFile(f) {
  const name = path.basename(f);
  if (TEST_FILE_RE.test(name)) return true;       // TS: *.test.ts / *.spec.ts / *.test.js
  if (name.endsWith('_test.go')) return true;    // Go: *_test.go
  const parts = f.split(path.sep);
  return parts.includes(TEST_DIR_NAME) || parts.includes('node_modules');
}

// ─── TS/JS 函数声明识别（顶层 + 包级；类方法用缩进护栏）──
// 形态：
//   export async function foo(      -> 标准函数
//   function foo(                   -> 私有函数
//   export const foo =              -> 箭头函数（= 后 -> 或 {）
//   const foo =                     -> 私有箭头
//   export class Foo {              -> 类（类体内部方法后续用缩进+括号匹配）
//   class Foo {
//   export default <名>             -> 不处理（default 匿名实现直接看父声明）
//
// 匹配产物：{name, startLine(0-based), indent, kind:'func'|'arrow'|'class'|'type'|'method'}
// 注意：function 声明后面必跟 `NAME(`；class / interface / type / enum 声明后面跟 `{`，不是 `(`
//       所以分两个独立正则，避免一个正则里既要 `\(` 又要 `\{` 造成 class 声明全线漏扫（Bug 2026-08-26）。
const TS_FUNCTION_DECL_RE = /^(?<indent>[ \t]*)(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/;
const TS_CLASS_DECL_RE = /^(?<indent>[ \t]*)(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+?|implements\s+[^{]+?)?\s*\{/;
const TS_ARROW_DECL_RE = /^(?<indent>[ \t]*)(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+(?<name>[A-Za-z0-9_$]+)\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{/;
const TS_CLASS_METHOD_RE = /^(?<indent>[ \t]*)(?:(?:public|private|protected|static|readonly|async)\s+)*(?<name>[A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+?)?\s*\{/;
const TS_INTERFACE_TYPE_RE = /^(?<indent>[ \t]*)(?:export\s+)?(?:interface|type|enum)\s+(?<name>[A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+?|implements\s+[^{]+?)?\s*\{/;

// ─── Go 函数声明识别 ──
// 形态：
//   func foo(
//   func (r *Receiver) foo(
const GO_FUNC_RE = /^(?<indent>[ \t]*)func\s+(?:\((?<recv>[^)]*)\)\s+)?(?<name>[A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/;

// ─── 括号匹配：找到起始行之后，深度归零的结束行 ──
// 策略：
//   1. 先找声明行后（含本行）第一个未被 '//' / 字符串 / 反引号模板 注释掉的 '{'，记深度=1
//   2. 逐字符推进，深度==0 即返回（endLine 为 0-based 闭区间；行数 = endLine - startLine + 1）
//   3. 护栏：扫描过程中，如遇到「同级别或更少缩进」的新顶层声明（TS_FUNCTION_DECL_RE + TS_CLASS_DECL_RE + TS_ARROW_DECL_RE + TS_INTERFACE_TYPE_RE / GO_FUNC_RE），
//      则说明已经进入下一个函数，直接在那之前截断（避免 class/interface 尾括号被"吞"到下一个声明里）
//   4. 字符串/注释转义的简化处理：不追求 100% 精确（比如反引号内嵌变量模板），够用即可——
//      即使误判也是"少算几行"方向，不会导致"虚高假阳性"（那是红线方向更危险）

function findFunctionEnd(lines, startLine, isGo) {
  const n = lines.length;
  // 1) 找到第一个 { 的位置
  let braceLine = -1, braceCol = -1;
  let inSingle = false, inDouble = false, inBacktick = false, inLineComment = false;
  outer:
  for (let li = startLine; li < n; li++) {
    const line = lines[li];
    inLineComment = false;
    for (let ci = 0; ci < line.length; ci++) {
      const c = line[ci];
      const next = line[ci + 1];
      if (inLineComment) break;
      if (inSingle) {
        if (c === '\\') { ci++; continue; }
        if (c === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (c === '\\') { ci++; continue; }
        if (c === '"') inDouble = false;
        continue;
      }
      if (inBacktick) {
        if (c === '`') inBacktick = false;
        continue;
      }
      if (c === '/' && next === '/') { inLineComment = true; break; }
      if (c === '/' && next === '*') {
        ci++;
        // 扫到 */
        let found = false;
        for (let nj = ci + 1; nj < line.length - 1; nj++) {
          if (line[nj] === '*' && line[nj + 1] === '/') { ci = nj + 1; found = true; break; }
        }
        if (!found) {
          // 跨多行块注释：跳到下一个 */
          li++;
          for (; li < n; li++) {
            const nl = lines[li];
            const idx = nl.indexOf('*/');
            if (idx >= 0) { ci = idx + 1; break; }
          }
          if (li >= n) break outer;
        }
        continue;
      }
      if (c === "'" && !isGo) { inSingle = true; continue; }
      if (c === '"') { inDouble = true; continue; }
      if (c === '`' && !isGo) { inBacktick = true; continue; }
      if (c === '{') { braceLine = li; braceCol = ci; break outer; }
    }
  }
  if (braceLine < 0) return null; // 没有函数体（抽象/声明），跳过

  let depth = 1;
  inSingle = false; inDouble = false; inBacktick = false; inLineComment = false;
  // 从 { 的下一个字符继续
  for (let li = braceLine; li < n; li++) {
    const line = lines[li];
    let ci = (li === braceLine) ? braceCol + 1 : 0;
    inLineComment = false;
    for (; ci < line.length; ci++) {
      const c = line[ci];
      if (inLineComment) break;
      if (inSingle) { if (c === '\\') { ci++; continue; } if (c === "'") inSingle = false; continue; }
      if (inDouble) { if (c === '\\') { ci++; continue; } if (c === '"') inDouble = false; continue; }
      if (inBacktick) { if (c === '`') inBacktick = false; continue; }
      if (c === '/' && line[ci + 1] === '/') { inLineComment = true; break; }
      if (c === '/' && line[ci + 1] === '*') {
        ci++;
        let found = false;
        for (let nj = ci + 1; nj < line.length - 1; nj++) {
          if (line[nj] === '*' && line[nj + 1] === '/') { ci = nj + 1; found = true; break; }
        }
        if (!found) {
          li++;
          for (; li < n; li++) {
            const nl = lines[li];
            const idx = nl.indexOf('*/');
            if (idx >= 0) { ci = idx + 1; break; }
          }
          if (li >= n) return { endLine: n - 1, truncated: false };
        }
        continue;
      }
      if (c === "'" && !isGo) inSingle = true;
      else if (c === '"') inDouble = true;
      else if (c === '`' && !isGo) inBacktick = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return { endLine: li, truncated: false };
      }
    }

    // ── 护栏：下一行若出现「缩进 <= 当前声明行缩进」的新顶层声明，无条件截断 ──
    // 理由：Go 顶层 func 不能嵌套另一个顶层 func；TS 顶层 function/class/const/interface/type
    // 也不能出现在另一个顶层 function 的 body 里（嵌套只能在块级作用域，缩进更深）。
    // 因此即使当前 depth>1（说明当前函数体内有未闭合的字符串/注释/字面量，是括号匹配的
    // 保守性失败），遇到这种新声明也必须硬截断，否则会把后面 N 个函数都吞进前一个函数体内，
    // 造成"行数虚高假阳性"（红线方向，比漏算更危险）。
    if (li + 1 < n) {
      const nextLine = lines[li + 1];
      const hitTs = !isGo && (TS_FUNCTION_DECL_RE.test(nextLine) || TS_CLASS_DECL_RE.test(nextLine) || TS_ARROW_DECL_RE.test(nextLine) || TS_INTERFACE_TYPE_RE.test(nextLine));
      const hitGo = isGo && GO_FUNC_RE.test(nextLine);
      if (hitTs || hitGo) {
        // 用正则抓下一行的声明缩进，比当前函数声明行起始缩进 <= 才算跨块
        const nextM = nextLine.match(/^(?<sp>[ \t]*)\S/);
        const nextIndent = nextM ? nextM.groups.sp.length : Infinity;
        // 找当前声明行缩进（缓存下来更高效，但调用链改造大，省点：从 lines[startLine] 重取）
        const startM = lines[startLine].match(/^(?<sp>[ \t]*)\S/);
        const startIndent = startM ? startM.groups.sp.length : 0;
        if (nextIndent <= startIndent) {
          return { endLine: li, truncated: true };
        }
      }
    }
  }
  return { endLine: n - 1, truncated: true };
}

// ─── 单文件函数提取 ──
function extractFunctions(file) {
  const isGo = file.endsWith('.go');
  let text;
  try { text = readText(file); } catch (e) {
    console.warn(`[line-counter] 跳过 ${relPosix(file)}: ${e.message}`);
    return [];
  }
  const lines = text.split('\n');
  const out = [];
  // 类上下文：进入 class 后缩进基线 = 类声明缩进 + 1（类内方法才抓）
  let classIndentBaseline = null; // null = 不在类体内；数字 = 进入类时的声明行缩进空格数

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    if (isGo) {
      const m = line.match(GO_FUNC_RE);
      if (!m) continue;
      const name = m.groups.recv
        ? `${m.groups.recv.trim().replace(/^[\*\(\s]+|\s+.*$/g, '').split(/\s+/)[0] || ''}.${m.groups.name}`
        : m.groups.name;
      const end = findFunctionEnd(lines, li, true);
      if (!end) continue;
      const count = end.endLine - li + 1;
      out.push({ name, startLine: li + 1, lines: count, truncated: end.truncated });
    } else {
      // TS/JS：先试顶层声明。独立分四类：function 声明 / class 声明 / 箭头 const / interface|type|enum
      const mFunc = line.match(TS_FUNCTION_DECL_RE);
      const mClass = line.match(TS_CLASS_DECL_RE);
      const mArrow = line.match(TS_ARROW_DECL_RE);
      const mIface = line.match(TS_INTERFACE_TYPE_RE);
      if (mFunc || mClass || mArrow || mIface) {
        const m = mFunc || mClass || mArrow || mIface;
        const name = m.groups.name;
        let kind = 'func';
        if (mFunc) kind = 'func';
        else if (mClass) kind = 'class';
        else if (mArrow) kind = 'arrow';
        else if (mIface) {
          // 从原始行文本粗判 interface|type|enum 标签
          const raw = line.trim().slice(0, 9).toLowerCase();
          kind = raw.startsWith('interface') ? 'interface' : (raw.startsWith('enum') ? 'enum' : 'type');
        }
        const indent = m.groups.indent.length;
        // class / interface / type / enum 也算"块状声明"，一起统计（用户要知道大类型定义）
        const end = findFunctionEnd(lines, li, false);
        if (!end) continue;
        const count = end.endLine - li + 1;
        out.push({ name, kind, startLine: li + 1, lines: count, truncated: end.truncated });
        // 进入 class：记录基线缩进（类内方法需更深缩进）
        if (kind === 'class') classIndentBaseline = indent;
        continue;
      }

      // 否则，类内方法判定
      if (classIndentBaseline !== null) {
        const mm = line.match(TS_CLASS_METHOD_RE);
        if (mm) {
          const indent = mm.groups.indent.length;
          if (indent > classIndentBaseline) {
            const name = mm.groups.name;
            if (/^(if|for|while|switch|catch)$/.test(name)) continue; // 控制流关键字误匹配
            const end = findFunctionEnd(lines, li, false);
            if (!end) continue;
            const count = end.endLine - li + 1;
            out.push({ name, kind: 'method', startLine: li + 1, lines: count, truncated: end.truncated });
            continue;
          } else if (indent === classIndentBaseline) {
            // 类体结束（同级再出现声明，通常是 class 的关闭 } 之后）
            classIndentBaseline = null;
          }
        }
      }
    }
  }
  return out;
}

// ─── 三档分级 ──
function tierOf(lines, yellow) {
  const orange = yellow * 2;
  const red = yellow * 3;
  if (lines > red) return { key: 'red',    label: '🟥', threshold: red };
  if (lines > orange) return { key: 'orange', label: '🟧', threshold: orange };
  if (lines > yellow) return { key: 'yellow', label: '🟨', threshold: yellow };
  return null;
}

// ─── --funcs 主入口 ──
function runFuncsMode(args) {
  const yellow = args.threshold;
  const orange = yellow * 2;
  const red = yellow * 3;

  // 收集目标文件
  const roots = [];
  if (args.scope) {
    const abs = path.isAbsolute(args.scope) ? args.scope : path.join(ROOT, args.scope);
    roots.push(abs);
  } else {
    roots.push(path.join(ROOT, 'frontend', 'src'), path.join(ROOT, 'go'));
  }

  const items = []; // { file, rel, name, kind?, startLine, lines, tier, truncated }
  const stats = { totalFiles: 0, totalFuncs: 0, red: 0, orange: 0, yellow: 0, skippedGenerated: 0, skippedTest: 0 };

  for (const root of roots) {
    if (!fs.existsSync(root)) { console.warn(`[line-counter] --funcs 目录不存在：${relPosix(root) || root}`); continue; }
    // 按根内实际文件扩展名自适配（不猜"这个目录是前端还是Go"）：
    // frontend/src/utils 不会有 .go，go/ysm 不会有 .ts/.js；两者通吃无歧义
    const exts = ['.ts', '.js', '.go'];
    const files = walk(root, { exts, skipTest: false }).filter((f) => {
      if (isTestFile(f)) { stats.skippedTest++; return false; }
      if (isGeneratedFile(f)) { stats.skippedGenerated++; return false; }
      return true;
    });
    stats.totalFiles += files.length;
    for (const f of files) {
      const funcs = extractFunctions(f);
      stats.totalFuncs += funcs.length;
      for (const fn of funcs) {
        const t = tierOf(fn.lines, yellow);
        if (!t) continue;
        if (t.key === 'red') stats.red++;
        else if (t.key === 'orange') stats.orange++;
        else stats.yellow++;
        items.push({
          file: relPosix(f),
          name: fn.name,
          kind: fn.kind || (f.endsWith('.go') ? 'func' : 'func'),
          startLine: fn.startLine,
          lines: fn.lines,
          tier: t.key,
          truncated: !!fn.truncated,
        });
      }
    }
  }

  // 排序：红→橙→黄，同档按行数降序
  const TIER_ORDER = { red: 0, orange: 1, yellow: 2 };
  items.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || (b.lines - a.lines));

  if (args.json) {
    const summary = {
      scannedFiles: stats.totalFiles,
      scannedFuncs: stats.totalFuncs,
      thresholds: { yellow, orange, red },
      counts: { red: stats.red, orange: stats.orange, yellow: stats.yellow, total: stats.red + stats.orange + stats.yellow },
      skipped: { generated: stats.skippedGenerated, test: stats.skippedTest },
    };
    const payload = { ok: true, mode: 'funcs', _summary: summary, items };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    console.log(`=== 函数级肥膘扫描（阈值 🟨>${yellow} / 🟧>${orange} / 🟥>${red}）===`);
    console.log(`扫描文件 ${stats.totalFiles} 个，函数 ${stats.totalFuncs} 个；豁免：生成=${stats.skippedGenerated}，测试=${stats.skippedTest}`);
    console.log(`命中：🟥 ${stats.red} · 🟧 ${stats.orange} · 🟨 ${stats.yellow} · 合计 ${stats.red + stats.orange + stats.yellow}`);
    if (items.length === 0) {
      console.log('（干净，无命中）');
      return;
    }
    console.log('');
    let curTier = null;
    for (const it of items) {
      if (curTier !== it.tier) {
        curTier = it.tier;
        const label = curTier === 'red' ? '🟥 RED' : (curTier === 'orange' ? '🟧 ORANGE' : '🟨 YELLOW');
        console.log(`── ${label} ──`);
      }
      const tag = it.truncated ? ' [护栏截断]' : '';
      const kindTag = it.kind && it.kind !== 'func' ? ` <${it.kind}>` : '';
      console.log(`  ${it.tier === 'red' ? '🟥' : it.tier === 'orange' ? '🟧' : '🟨'} ${it.file}:${it.startLine}  ${it.name}${kindTag}  ${it.lines} 行${tag}`);
    }
  }
}

function walkFiles(dir, patterns, skip = () => false) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, list, skip));
    } else if (entry.isFile()) {
      if (skip(full)) continue;
      const rel = relPosix(full);
      // F3（code_review）：glob 展开修正——`.replace(/\*/g, '.*')` 未转义 `.`（会匹配 foo.xgo），
      // 且与 `rel.endsWith` 完全冗余；仅保留后缀匹配即可
      if (list.some((p) => rel.endsWith(p.replace('*', '')))) {
        out.push(full);
      }
    }
  }
  return out;
}

function pyLineCount(text) {
  // Python 等价行计数：换行数 + (非空且不以换行结尾 ? 1 : 0)
  const nl = (text.match(/\n/g) || []).length;
  return nl + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
}

function countLines(paths) {
  /** 统计匹配的文件总行数。 */
  let total = 0;
  for (const p of paths) {
    for (const f of p) {
      // F4（code_review）：statSync/readFileSync 加 try/catch——单文件权限/瞬时失败
      // 不应让整脚本崩溃（此前裸抛，一个坏文件毁掉全量统计）
      try {
        const st = fs.statSync(f);
        if (st.size > 0) {
          total += pyLineCount(readText(f));
        }
      } catch (e) {
        console.warn(`[line-counter] 跳过 ${relPosix(f)}: ${e.message}`);
      }
    }
  }
  return total;
}

// 注意：GENERATED_FILE_RE / GENERATED_MARKER_RE / isGeneratedFile 已在文件前半段
// 与 --funcs 模式共享定义（单一声明源，消除双端漂移）。

function oversizedFiles(paths, threshold = 700) {
  /** 找出超过 threshold 行的文件（生成文件豁免）。 */
  const result = [];
  for (const p of paths) {
    for (const f of p) {
      const name = path.basename(f);
      const parts = f.split(path.sep);
      if (name.endsWith('.min.js') || parts.includes('node_modules')) continue;
      if (isGeneratedFile(f)) continue; // 生成文件豁免（sidebar.gen.mjs 等 JSON 数据）
      try {
        const lines = pyLineCount(readText(f));
        if (lines > threshold) result.push([lines, f, lines > 1000]);
      } catch { /* ignore */ }
    }
  }
  return result.sort((a, b) => b[0] - a[0]);
}

function packageLines(base, pattern) {
  /** 统计每个子目录的文件数（保持原 py 行为：count files）。 */
  const stats = [];
  if (!fs.existsSync(base)) return stats;
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (d.isDirectory()) {
      const full = path.join(base, d.name);
      const files = walkFiles(full, pattern);
      const lines = files.filter((f) => fs.statSync(f).size > 0).length;
      if (lines > 0) stats.push([d.name, lines]);
    }
  }
  return stats;
}

function main() {
  // ── --funcs 模式：函数级三档分级 ──
  if (args.funcs) {
    try {
      runFuncsMode(args);
    } catch (e) {
      if (args.json) {
        process.stdout.write(JSON.stringify({ ok: false, mode: 'funcs', error: e && e.message, stack: e && e.stack }, null, 2) + '\n');
      } else {
        console.error(`[line-counter] --funcs 执行失败: ${e && e.message}`);
        if (e && e.stack) console.error(e.stack);
      }
      process.exit(1);
    }
    return;
  }

  // ── 默认模式：文件级总览 ──
  const goDirs = [path.join(ROOT, 'go'), path.join(ROOT, 'internal'), path.join(ROOT, 'cmd')];
  const jsDir = path.join(ROOT, 'frontend', 'src');
  const cssDir = path.join(ROOT, 'frontend', 'css');

  // === 项目总览 ===
  console.log('=== 项目代码统计 ===');
  let goLines = countLines(goDirs.map((d) => walkFiles(d, '*.go')));
  // 根目录 Go（F1/F7：动态扫描，不再硬编码 app.go/main.go/resource_bindings.go——
  // 列表已迁走 app.go/resource_bindings.go，且漏掉 embed.go/cli_export.go）。
  // 浅层扫描（code_review P2）：只取 ROOT 顶层 .go——walkFiles(ROOT) 会递归整个仓库
  // （node_modules/.git/dist 等海量目录，性能回归 + 不可读目录崩溃面）
  for (const n of fs.readdirSync(ROOT).filter((n) => n.endsWith('.go'))) {
    const f = path.join(ROOT, n);
    // P3（code_review）：与 countLines 同款 try/catch——单文件读取失败不再毁整脚本
    try {
      goLines += pyLineCount(readText(f));
    } catch (e) {
      console.warn(`[line-counter] 跳过 ${relPosix(f)}: ${e.message}`);
    }
  }
  console.log(`Go:         ${goLines} 行`);

  const jsLines = countLines([walkFiles(jsDir, ['*.js', '*.ts'])]);
  console.log(`Frontend JS/TS: ${jsLines} 行`);

  const cssLines = countLines([walkFiles(cssDir, '*.css')]);
  console.log(`Frontend CSS: ${cssLines} 行`);

  const htmlLines = countLines([walkFiles(path.join(ROOT, 'frontend'), '*.html')]);
  console.log(`Frontend HTML: ${htmlLines} 行`);

  console.log('---');
  console.log(`总计:       ${goLines + jsLines + cssLines + htmlLines} 行`);

  // === Go 包分布 ===
  console.log('\n=== Go 包行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'go'), '*.go')) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 前端组件分布 ===
  console.log('\n=== 前端组件行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'frontend', 'src', 'views'), ['*.js', '*.ts'])) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 功能模块分布 ===
  console.log('\n=== 功能模块行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'frontend', 'src', 'features'), ['*.js', '*.ts'])) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 大文件预警 ===
  console.log('\n=== 大文件预警 (>700行) ===');
  const oversized = oversizedFiles(goDirs.map((d) => walkFiles(d, '*.go'))).concat(oversizedFiles([walkFiles(jsDir, ['*.js', '*.ts'])]));
  for (const [lines, fpath, isRed] of oversized) {
    const tag = isRed ? 'RED' : 'YELLOW';
    const rel = path.relative(ROOT, fpath);
    console.log(`  [${tag}] ${rel}: ${lines} 行`);
  }
}

main();
