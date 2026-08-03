#!/usr/bin/env node
/**
 * 代码红线审查。13 条规则 × 违规扫描（依赖 ripgrep）。
 * 由 scripts/review.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
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
    return out.trim().split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

function parseRgLine(line) {
  const parts = line.split(':');
  if (parts.length >= 3) {
    let filePart, rest;
    if (parts[0].length === 1 && /[a-zA-Z]/.test(parts[0]) && parts[1].startsWith('/')) {
      filePart = parts[0] + ':' + parts[1];
      rest = parts.slice(2).join(':');
    } else {
      filePart = parts[0];
      rest = parts.slice(1).join(':');
    }
    const restParts = rest.split(':');
    const first = restParts[0];
    if (/^\d+$/.test(first)) {
      return [filePart, parseInt(first, 10), restParts.slice(1).join(':') || ''];
    }
  }
  return [line, 0, ''];
}

function runChecks() {
  const results = [];

  const add = (ruleId, name, lines, fix = '') => {
    const violations = [];
    for (const l of lines) {
      const [file, lineno, text] = parseRgLine(l);
      violations.push({ file: String(file), line: lineno, snippet: text.trim().slice(0, 120) });
    }
    results.push({ rule_id: ruleId, name, fix, count: violations.length, violations });
  };

  add('R1', 'window.__ vars',
    rg('window\\.__', 'frontend/js', ['*.js']),
    'let + getter, PageStore');

  add('R2', 'repoRoot name',
    rg('repoRoot', ['.', 'frontend/js'], ['*.go', '*.js', '*.json']),
    'cfg.FilesRoot / filesRoot');

  add('R3', 'callback .file() API',
    rg('\\.file\\s*\\(', 'frontend/js', ['*.js']),
    'new Promise(...)');

  add('R4', 'display none/block',
    rg('display:\\s*(none|block)', 'frontend', ['*.js', '*.css']),
    'opacity/transform');

  add('R5', 'hardcoded colors',
    rg('#[0-9a-f]{6}\\b', 'frontend', ['*.js', '*.css'])
      .concat(rg('#[0-9a-f]{3}\\b', 'frontend', ['*.js', '*.css']))
      .concat(rg('rgba?\\(', 'frontend', ['*.js', '*.css']))
      .concat(rg('hsla?\\(', 'frontend', ['*.js', '*.css'])),
    'CSS vars');

  add('R6', 'JS in public/',
    rg('public/.*\\.js', ['.', 'frontend'], ['*.md', '*.html', '*.json']),
    'ESM import');

  add('R7', 'rtype magic strings',
    rg('"ysm"|"mmd-skin"|"vrchat-avatar"', 'frontend/js', ['*.js']),
    'RESOURCE_TYPES');

  add('R8', 'innerHTML concat',
    rg('innerHTML\\s*=', 'frontend/js', ['*.js']),
    'esc()');

  add('R9', 'manual sidebar',
    rg('sidebarItem|tb-btn.*title=', 'frontend', ['*.js']),
    'renderSidebar()');

  add('W1', 'backslash paths',
    rg('\\\\', 'frontend/js', ['*.js']).filter((l) => !l.includes('node_modules') && !l.includes('bus.js') && !l.includes('font-display')),
    '/ instead of \\');

  add('W2', 'window.go.main.App calls',
    rg('window\\.go\\.main\\.App', 'frontend/js', ['*.js']),
    'getApp()');

  add('W3', 'empty JSDoc',
    rg('@param\\s+\\{[^}]*\\}\\s+\\w+\\s*-?\\s*$|@returns\\s*\\{[^}]*\\}\\s*$', 'frontend/js', ['*.js']));

  add('W4', 'TODO no ticket',
    rg('TODO|FIXME|HACK|XXX', ['.', 'go'], ['*.go']).filter((l) => !l.includes('#') && !l.includes('nolint')));

  add('W5', 'async DOM race (callback sets innerHTML without stale guard)',
    rg('=>\\s*\\{[^}]*innerHTML\\s*=', 'frontend/js', ['*.js'])
      .concat(rg('\\.(then|finally)\\s*\\(.*innerHTML\\s*=', 'frontend/js', ['*.js']))
      .concat(rg('setTimeout\\s*\\(.*innerHTML\\s*=', 'frontend/js', ['*.js'])),
    'DOM writes in async callbacks need stale-request guards (fetchDone flag)');

  return results;
}

function outputText(results) {
  const out = ['========== Code Review =========='];
  for (const r of results) {
    if (r.count === 0) {
      out.push(`  [OK] [${r.rule_id}] ${r.name}`);
    } else {
      out.push(`  [WARN] [${r.rule_id}] ${r.name} (${r.count})`);
      for (const v of r.violations.slice(0, 10)) {
        out.push(`    ${v.file}:${v.line}  ${v.snippet.slice(0, 80)}`);
      }
      if (r.fix) out.push(`    -> ${r.fix}`);
    }
  }
  out.push(`${'='.repeat(10)} Review Complete ${'='.repeat(10)}`);
  process.stdout.write(out.join('\n') + '\n');
}

function outputJson(results) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const results = runChecks();
if (jsonMode) outputJson(results);
else outputText(results);
