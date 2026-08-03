#!/usr/bin/env node
/**
 * 注释质量检查。检测 AI 废话注释、JSDoc 模板残留、TODO 无编号等。
 * 由 scripts/comment-checker.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rg(pattern, paths, globs = null) {
  const cmd = ['--no-heading', '-n', '--path-separator', '/', pattern];
  for (const g of (globs || [])) cmd.push('-g', g);
  const targets = Array.isArray(paths) ? paths : [paths];
  for (const p of targets) cmd.push(path.join(ROOT, p));
  try {
    const out = execFileSync('rg', cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (out.trim()) return out.trim().split('\n').filter((l) => l.trim());
  } catch { /* no match or error */ }
  return [];
}

function parseLine(line) {
  const parts = line.split(':');
  if (parts.length >= 3) {
    let ps, rest;
    if (parts[0].length === 1 && /[a-zA-Z]/.test(parts[0]) && parts[1].startsWith('/')) {
      ps = parts[0] + ':' + parts[1];
      rest = parts.slice(2).join(':');
    } else {
      ps = parts[0];
      rest = parts.slice(1).join(':');
    }
    const rp = rest.split(':');
    const first = rp[0];
    if (/^\d+$/.test(first)) {
      return [String(ps), parseInt(first, 10), rp.slice(1).join(':').trim() || ''];
    }
  }
  return [String(line), 0, ''];
}

function scanAiFluff() {
  /** 检测 AI 废话注释：用于/这是/检查.*是否 */
  const results = [];
  for (const src of ['go', 'frontend/js']) {
    for (const line of rg(/^\s*\/\/.*\u7528\u4e8e|^\s*\/\/.*\u8fd9\u662f|^\s*\/\/.*\u68c0\u67e5.*\u662f\u5426/.source, src, ['*.go', '*.js', '*.ts'])) {
      const [f, ln, txt] = parseLine(line);
      results.push({ file: f, line: ln, snippet: txt, type: 'AI_fluff' });
    }
  }
  return results;
}

function scanEmptyJsdoc() {
  /** 检测空 JSDoc：@param @returns 无实质描述 */
  const results = [];
  for (const line of rg(/@param\s+\{[^}]*\}\s+\w+\s*-?\s*$|@returns\s*\{[^}]*\}\s*$/.source, 'frontend/js', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseLine(line);
    results.push({ file: f, line: ln, snippet: txt, type: 'empty_jsdoc' });
  }
  return results;
}

function scanCommentedCode() {
  /** 检测注释掉的代码行 */
  const results = [];
  for (const line of rg(/^\s*\/\/\s+(var |let |const |function |if |for |return |import |export )/.source, 'frontend/js', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseLine(line);
    results.push({ file: f, line: ln, snippet: txt, type: 'commented_code' });
  }
  return results;
}

function scanTodoNoTicket() {
  /** 检测无编号的 TODO/FIXME/HACK */
  const results = [];
  for (const src of ['go', 'frontend/js']) {
    for (const line of rg('TODO|FIXME|HACK|XXX|TEMP', src, ['*.go', '*.js', '*.ts'])) {
      // 过滤有编号的
      if (line.includes('#') || line.includes('// nolint')) continue;
      // 过滤 /go/ embedded JSON 和 vendor
      if (line.includes('blocks_1_12.json') || line.includes('zh_cn.json')) continue;
      const [f, ln, txt] = parseLine(line);
      results.push({ file: f, line: ln, snippet: txt, type: 'todo_no_ticket' });
    }
  }
  return results;
}

function scanDebugLog() {
  /** 检测 console.log / console.debug（可能有调试残留） */
  const results = [];
  for (const line of rg('console\\.log|console\\.debug', 'frontend/js', ['*.js', '*.ts'])) {
    const [f, ln, txt] = parseLine(line);
    // 排除业务日志
    if (txt.includes('[YSM]') || txt.includes('[3dspec]') || txt.includes('[Toast]') || txt.includes('[sync]')) continue;
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

const results = runAll();
const total = Object.values(results).reduce((s, v) => s + v.length, 0);

if (jsonMode) {
  results._summary = { total };
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
