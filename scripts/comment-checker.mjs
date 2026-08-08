#!/usr/bin/env node
/**
 * comment-checker.mjs — 注释质量检查（AI 废话 / 空 JSDoc / TODO 无编号 / 调试残留）。
 *
 * 由 scripts/comment-checker.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 *
 * 零依赖（仅 node:fs / node:path / node:url + 共享层 _lib/ripgrep、_lib/rg-line）。
 *
 * 用法：
 *   node scripts/comment-checker.mjs              # 文本报告
 *   node scripts/comment-checker.mjs --json       # JSON（CI / 子代理消费，每类截断 50 条）
 *   node scripts/comment-checker.mjs --full       # 全量 JSON（不截断）
 *
 * 退出码：默认 0（提示工具）。
 * 设计意图：注释质量检查（AI 废话/JSDoc 残留/TODO 编号）
 */
import fs from 'node:fs';
import { rgSafe as rg } from './_lib/ripgrep.mjs';
import { parseRgLine } from './_lib/rg-line.mjs';

function scanAiFluff() {
  /** 检测 AI 废话注释：用于/这是/检查.*是否 */
  const results = [];
  for (const src of ['go', 'frontend/src']) {
    for (const line of rg(/^\s*\/\/.*\u7528\u4e8e|^\s*\/\/.*\u8fd9\u662f|^\s*\/\/.*\u68c0\u67e5.*\u662f\u5426/.source, src, ['*.go', '*.js', '*.ts'])) {
      const [f, ln, txt] = parseRgLine(line);
      // 白名单：带 [doc:adr-XXX] / [ADR-XXX] 文档引用的合法注释不视为废话
      if (/\[doc:adr-|\[ADR-\d|ADR-\d{2,3}/i.test(txt)) continue;
      results.push({ file: f, line: ln, snippet: txt, type: 'AI_fluff' });
    }
  }
  return results;
}

function scanEmptyJsdoc() {
  /** 检测空 JSDoc：@param @returns 无实质描述 */
  const results = [];
  for (const line of rg(/@param\s+\{[^}]*\}\s+\w+\s*-?\s*$|@returns\s*\{[^}]*\}\s*$/.source, 'frontend/src', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseRgLine(line);
    results.push({ file: f, line: ln, snippet: txt, type: 'empty_jsdoc' });
  }
  return results;
}

function scanCommentedCode() {
  /** 检测注释掉的代码行；跳过 JSDoc 示例（// 后 ≥2 空格）与 why/prose 注释 */
  const results = [];
  const fileCache = new Map();
  const readLine = (f, ln) => {
    if (!fileCache.has(f)) {
      try { fileCache.set(f, fs.readFileSync(f, 'utf8').split('\n')); }
      catch { fileCache.set(f, []); }
    }
    return fileCache.get(f)[ln - 1] ?? '';
  };
  for (const line of rg(/^\s*\/\/\s+(var |let |const |function |if |for |return |import |export )/.source, 'frontend/src', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseRgLine(line);
    const raw = readLine(f, ln);
    // 跳过 JSDoc 代码样例：// 后跟 ≥2 空格（缩进示例，如 utils 用法示例）
    const slashIdx = raw.indexOf('//');
    if (slashIdx >= 0 && /^\s{2,}/.test(raw.slice(slashIdx + 2))) continue;
    // 跳过 why/prose 注释：关键字后无代码特征（= ; ( { from =>），如循环依赖说明
    const kw = (txt.match(/^(var|let|const|function|if|for|return|import|export)\b/) || [])[0] || '';
    const rest = txt.slice(kw.length).trim();
    if (!/[=;({]|from\b|=>/.test(rest)) continue;
    results.push({ file: f, line: ln, snippet: txt, type: 'commented_code' });
  }
  return results;
}

function scanTodoNoTicket() {
  /** 检测无编号的 TODO/FIXME/HACK */
  const results = [];
  for (const src of ['go', 'frontend/src']) {
    for (const line of rg('TODO|FIXME|HACK|XXX|TEMP', src, ['*.go', '*.js', '*.ts'])) {
      // 过滤有编号的
      if (line.includes('#') || line.includes('// nolint')) continue;
      // 过滤 /go/ embedded JSON 和 vendor
      if (line.includes('blocks_1_12.json') || line.includes('zh_cn.json')) continue;
      const [f, ln, txt] = parseRgLine(line);
      // 超长行跳过：数据文件（如 wasm base64）含 XXX 子串会被误命中，注释不可能 >500 字符
      if (txt.length > 500) continue;
      results.push({ file: f, line: ln, snippet: txt, type: 'todo_no_ticket' });
    }
  }
  return results;
}

function scanDebugLog() {
  /** 检测 console.log / console.debug（可能有调试残留） */
  const results = [];
  for (const line of rg('console\\.log|console\\.debug', 'frontend/src', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseRgLine(line);
    // 排除业务日志：精确匹配 [YSM]/[3dspec]/[Toast]/[sync] 标签，
    // 而非子串 includes（避免误放行含标签的普通文本，code_review P3）
    if (/\[(YSM|3dspec|Toast|sync)\]/.test(txt)) continue;
    // 排除调试基础设施本身的定义行：debug.ts / devLog 工具
    // （devLog = import.meta.env.DEV ? console.log : () => {}，定义行 snippet 为 `? console.log`；
    //  锚定实际定义而非文本子串——devLog 调用点不含 console.log 文本，code_review P3）
    if (/debug\.ts$/.test(f) || /^\?\s*console\.log$/.test(txt)) continue;
    results.push({ file: f, line: ln, snippet: txt, type: 'debug_log' });
  }
  return results;
}

function runAll() {
  return {
    AI_fluff: scanAiFluff(),
    empty_jsdoc: scanEmptyJsdoc(),
    commented_code: scanCommentedCode(),
    todo_no_ticket: scanTodoNoTicket(),
    debug_log: scanDebugLog(),
  };
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const FULL = args.includes('--full'); // 全量输出（默认 JSON 模式每类截断 50 条防超大输出）

const results = runAll();
const total = Object.values(results).reduce((s, v) => s + v.length, 0);

if (jsonMode) {
  // _summary 含分类计数 + 截断标记（子代理消费：先看计数，需明细再 --full）
  const counts = {};
  let truncated = false;
  const LIMIT = 50;
  for (const [cat, items] of Object.entries(results)) {
    counts[cat] = items.length;
    if (!FULL && items.length > LIMIT) {
      results[cat] = items.slice(0, LIMIT);
      truncated = true;
    }
  }
  results._summary = { total, ...counts, truncated };
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} else {
  console.log('========== Comment Checker ==========\n');
  const names = {
    AI_fluff: 'AI 废话注释', empty_jsdoc: '空 JSDoc 模板',
    commented_code: '注释掉的代码', todo_no_ticket: 'TODO 无编号',
    debug_log: '调试日志',
  };
  for (const [cat, items] of Object.entries(results)) {
    const name = names[cat] ?? cat;
    console.log(`--- ${name} (${items.length} 处) ---`);
    for (const it of items.slice(0, 8)) {
      console.log(`  ${it.file}:${it.line}  ${it.snippet.slice(0, 80)}`);
    }
    if (items.length > 8) console.log(`  ... 还有 ${items.length - 8} 处`);
    console.log();
  }
  console.log(`总计: ${total} 处`);
}
