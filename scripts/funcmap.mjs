#!/usr/bin/env node
/**
 * funcmap.mjs — 函数/符号映射表生成器
 *
 * 参考 MikuMikuAR docs/function-map.md 风格：
 *   1. 提取 Go / JS / TS 的【导出符号】（非仅注释锚定）；
 *   2. 按模块分组（顶层目录），输出「总览 + 分组表」；
 *   3. 列格式：| 符号 | 文件:行 | 说明 |，说明取导出符号紧邻 JSDoc/注释首句。
 *
 * 用法：
 *   node scripts/funcmap.mjs                 # 写入 docs/funcmap.md
 *   node scripts/funcmap.mjs -o docs/funcmap.md
 *   node scripts/funcmap.mjs -o funcmap.md   # 等同 docs/funcmap.md（路径重定向）
 *
 * 输出：docs/funcmap.md（自动生成，docs/_config.yml 已排除出站点发布）。
 * 零依赖（仅 node:fs / node:path + scripts/_lib/scan-files.mjs）。
 * 设计意图：funcmap 工具脚本
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix, readText, walk } from './_lib/scan-files.mjs';

const ROOT = getRoot();

// ── 通用工具 ──

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 递归收集目录下指定扩展名文件（含根级 .go）。 */
function walkExt(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walkExt(p, exts, out);
    else if (exts.some((e) => d.name.endsWith(e)) && !d.name.endsWith('_test.go')) out.push(p);
  }
  return out;
}

// ── 导出符号提取 ──

/** JS/TS：提取全部导出符号（export 声明 + export {} 聚合）。 */
function getJsExportedSymbols(text) {
  const syms = [];
  const seen = new Set();
  const push = (s) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      syms.push(s);
    }
  };
  let m;

  // export { a, b as c, type D } 块（可多行）
  const reBlock = /export\s*(?:type\s+)?\{\s*([\s\S]*?)\}/g;
  while ((m = reBlock.exec(text))) {
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        const cleaned = s.replace(/^(?:type|interface|class|const|let|var|function|enum)\s+/, '').trim();
        const asMatch = cleaned.match(/^(.+?)\s+as\s+(.+)$/);
        push(asMatch ? asMatch[2].trim() : cleaned);
      });
  }

  // export default function/class/const/... Name
  const reDefaultDecl = /export\s+default\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reDefaultDecl.exec(text))) push(m[1]);

  // export function/const/... Name
  const reDecl = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reDecl.exec(text))) push(m[1]);

  // export default <Identifier>（排除关键字）
  const reDefaultId = /export\s+default\s+(?!(?:function|class|const|let|var|interface|type|enum)\b)([A-Za-z_$][\w$]*)/g;
  while ((m = reDefaultId.exec(text))) push(m[1]);

  return syms;
}

/** Go：提取全部导出符号（首字母大写）。方法记为 Type.Method。 */
function getGoExportedSymbols(text) {
  // 先剥离注释，降低误匹配
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
  const syms = [];
  const seen = new Set();
  const push = (s) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      syms.push(s);
    }
  };
  let m;

  const reFn = /^func\s+(?:\(([^)]*)\)\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((m = reFn.exec(stripped))) {
    const recv = m[1];
    const name = m[2];
    if (!/^[A-Z]/.test(name)) continue; // 仅导出符号
    if (recv) {
      const tm = recv.match(/\*\s*([A-Za-z_][\w]*)/) || recv.match(/([A-Za-z_][\w]*)/);
      const t = tm ? tm[1] : '';
      push(`${t}.${name}`);
    } else {
      push(name);
    }
  }

  const reType = /^type\s+([A-Za-z_$][\w$]*)\s+/gm;
  while ((m = reType.exec(stripped))) push(m[1]);

  return syms;
}

function getExportedSymbols(filePath, lang) {
  const text = readText(filePath);
  return lang === 'go' ? getGoExportedSymbols(text) : getJsExportedSymbols(text);
}

// ── 定义行定位 + 说明提取 ──

function findLine(filePath, sym, lang) {
  const lines = readText(filePath).split('\n');
  if (lang === 'go') {
    const dot = sym.indexOf('.');
    const methodName = dot >= 0 ? sym.slice(dot + 1) : sym;
    const re = new RegExp(`^(?:func\\s+(?:\\([^)]*\\)\\s+)?|type\\s+)${escapeRe(methodName)}\\b`);
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  } else {
    const re = new RegExp(
      '^(?:export\\s+(?:default\\s+)?(?:async\\s+)?)?' +
        '(?:function|const|let|class|interface|type|enum)\\s+' +
        escapeRe(sym) +
        '\\b'
    );
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  }
  return null;
}

/** 取导出符号紧邻上方 JSDoc/注释首句摘要（无则留空串）。 */
function extractDocSummary(filePath, sym, lang) {
  const lines = readText(filePath).split('\n');
  let defIdx = -1;

  if (lang === 'go') {
    const dot = sym.indexOf('.');
    const methodName = dot >= 0 ? sym.slice(dot + 1) : sym;
    const re = new RegExp(`^(?:func\\s+(?:\\([^)]*\\)\\s+)?|type\\s+)${escapeRe(methodName)}\\b`);
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) { defIdx = i; break; }
    if (defIdx <= 0) return '';
    let i = defIdx - 1;
    const docs = [];
    while (i >= 0 && /^\s*\/\//.test(lines[i])) {
      const c = lines[i].trim().replace(/^\/\/\s?/, '');
      if (c) docs.unshift(c);
      i--;
    }
    if (!docs.length) return '';
    const joined = docs.join(' ');
    return (joined.split(/(?<=[。.])\s/)[0] || joined).slice(0, 90).trim();
  }

  // JS/TS
  const defRe = new RegExp(
    '^(?:export\\s+(?:default\\s+)?(?:async\\s+)?)?' +
      '(?:function|const|let|class|interface|type|enum)\\s+' +
      escapeRe(sym) +
      '\\b'
  );
  for (let i = 0; i < lines.length; i++) if (defRe.test(lines[i])) { defIdx = i; break; }
  if (defIdx <= 0) return '';

  let i = defIdx - 1;
  while (i >= 0 && /^\s*(?:\/\/.*)?$/.test(lines[i])) i--;
  if (i < 0) return '';

  const docLines = [];
  if (/\*\/\s*$/.test(lines[i])) {
    while (i >= 0) {
      const raw = lines[i];
      const cleaned = raw.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim();
      if (cleaned.startsWith('@')) { i--; continue; }
      if (cleaned) docLines.unshift(cleaned);
      if (/^\s*\/\*\*/.test(raw) || /^\s*\/\*/.test(raw)) break;
      i--;
    }
  } else if (/^\s*\/\*\*/.test(lines[i]) || /^\s*\/\*/.test(lines[i])) {
    const cleaned = lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim();
    if (!cleaned.startsWith('@') && cleaned) docLines.push(cleaned);
  }
  if (!docLines.length) return '';
  const joined = docLines.join(' ');
  return (joined.split(/(?<=[。.])\s/)[0] || joined).slice(0, 90).trim();
}

// ── 模块分组 ──

/** 由相对仓库根的路径推导模块 key。 */
function moduleOf(rel) {
  if (rel.startsWith('frontend/src/')) {
    const rest = rel.slice('frontend/src/'.length);
    const parts = rest.split('/');
    return parts.length > 1 ? `frontend/${parts[0]}` : 'frontend';
  }
  if (rel.startsWith('go/')) return `go/${rel.slice(3).split('/')[0]}`;
  if (rel.startsWith('internal/')) return `internal/${rel.slice('internal/'.length).split('/')[0]}`;
  if (/\.go$/.test(rel) && rel.indexOf('/') === -1) return '.';
  return rel.split('/')[0] || '.';
}

const GROUP_LABELS = {
  '.': 'Go 根入口',
  frontend: '前端·根 (app-modules/bus)',
  'frontend/core': '前端·核心',
  'frontend/components': '前端·组件',
  'frontend/features': '前端·特性',
  'frontend/services': '前端·服务',
  'frontend/utils': '前端·工具',
  'frontend/dialogs': '前端·对话框',
  'frontend/css': '前端·样式',
  'frontend/wails': '前端·Wails 桥接',
  'frontend/wasm': '前端·WASM',
  'go/avatar': 'Go·头像',
  'go/dedup': 'Go·去重',
  'go/download': 'Go·下载',
  'go/errors': 'Go·错误',
  'go/fsutil': 'Go·文件系统',
  'go/geometry': 'Go·几何',
  'go/importer': 'Go·导入',
  'go/installer': 'Go·安装',
  'go/litematic': 'Go·Litematic',
  'go/logs': 'Go·日志',
  'go/packs': 'Go·包管理',
  'go/paths': 'Go·路径',
  'go/recycle': 'Go·回收站',
  'go/sync': 'Go·同步',
  'go/tags': 'Go·标签',
  'go/threejs': 'Go·Three.js',
  'go/types': 'Go·类型',
  'go/updater': 'Go·更新器',
  'go/version': 'Go·版本',
  'go/watcher': 'Go·监听',
  'go/ysm': 'Go·YSM 核心',
  'internal/app': 'Go(internal)·应用入口',
  'internal/embedded': 'Go(internal)·嵌入资产',
};

function groupPriority(key) {
  if (key === '.') return 0;
  if (key.startsWith('go/')) return 1;
  if (key.startsWith('internal/')) return 2;
  if (key.startsWith('frontend')) return 3;
  return 4;
}

// ── 渲染 ──

function renderMarkdown(groups, sortedKeys) {
  const lines = [];

  lines.push('# 函数映射表');
  lines.push('');
  lines.push('> AI 找代码用。改功能前先 grep 此表定位文件:行。');
  lines.push('> **自动生成** — 由 `scripts/funcmap.mjs` 生成（提取 Go/JS/TS 导出符号，参考 MikuMikuAR docs/function-map.md 风格）。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 模块 | 文件数 | 导出符号数 |');
  lines.push('|------|--------|-----------|');

  let totalFiles = 0;
  let totalSyms = 0;
  for (const key of sortedKeys) {
    const g = groups.get(key);
    const fileCount = g.files.length;
    const symCount = g.files.reduce((s, f) => s + f.syms.length, 0);
    totalFiles += fileCount;
    totalSyms += symCount;
    const label = GROUP_LABELS[key] || key;
    lines.push(`| ${label} | ${fileCount} | ${symCount} |`);
  }
  lines.push(`| **合计** | **${totalFiles}** | **${totalSyms}** |`);
  lines.push('');

  for (const key of sortedKeys) {
    const g = groups.get(key);
    const label = GROUP_LABELS[key] || key;
    lines.push(`## ${label}`);
    lines.push('');
    lines.push('| 符号 | 文件:行 | 说明 |');
    lines.push('|------|--------|------|');

    const sortedFiles = [...g.files].sort((a, b) => a.rel.localeCompare(b.rel));
    for (const file of sortedFiles) {
      const displayPath = file.rel.replace(/\.(ts|js|go)$/, '');
      for (const sym of file.syms) {
        const locLine = findLine(file.file, sym, file.lang);
        const loc = locLine ? `${displayPath}:${locLine}` : displayPath;
        const doc = extractDocSummary(file.file, sym, file.lang);
        const escaped = doc ? doc.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        lines.push(`| \`${sym}()\` | \`${loc}\` | ${escaped || '—'} |`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> 说明列由 funcmap 自动提取导出符号紧邻 JSDoc/注释的首句摘要（无注释则留 —）。');
  lines.push('> Go 方法记为 `Type.Method`；符号列统一以 `()` 结尾（与 MikuMikuAR 约定一致）。');

  return lines.join('\n');
}

// ── 主流程 ──

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('-o') >= 0 ? args.indexOf('-o') : args.indexOf('--output');
  let outputFile = 'docs/funcmap.md';
  if (outIdx >= 0) {
    const v = args[outIdx + 1];
    // 兼容历史命令 `-o funcmap.md` → 重定向到 docs/funcmap.md
    outputFile = path.basename(v) === 'funcmap.md' && path.dirname(v) === '.' ? 'docs/funcmap.md' : v;
  }

  const groups = new Map();

  // 1. 前端（frontend/src，复用 scan-files.walk 跳过 css/node_modules/隐藏/测试）
  const feFiles = walk(undefined, { skipTest: true });
  for (const f of feFiles) {
    const syms = getExportedSymbols(f, 'js');
    if (!syms.length) continue;
    const rel = relPosix(f);
    const key = moduleOf(rel);
    if (!groups.has(key)) groups.set(key, { files: [] });
    groups.get(key).files.push({ rel, file: f, syms, lang: 'js' });
  }

  // 2. Go：go/ + internal/ + 根级 .go
  const goFiles = [
    ...walkExt(path.join(ROOT, 'go'), ['.go']),
    ...walkExt(path.join(ROOT, 'internal'), ['.go']),
    ...['main.go', 'embed.go', 'cli_export.go']
      .map((n) => path.join(ROOT, n))
      .filter((p) => fs.existsSync(p)),
  ];
  for (const f of goFiles) {
    const syms = getExportedSymbols(f, 'go');
    if (!syms.length) continue;
    const rel = relPosix(f);
    const key = moduleOf(rel);
    if (!groups.has(key)) groups.set(key, { files: [] });
    groups.get(key).files.push({ rel, file: f, syms, lang: 'go' });
  }

  const sortedKeys = [...groups.keys()].sort(
    (a, b) => groupPriority(a) - groupPriority(b) || a.localeCompare(b)
  );

  const totalSyms = sortedKeys.reduce(
    (s, k) => s + groups.get(k).files.reduce((x, f) => x + f.syms.length, 0),
    0
  );
  const totalFiles = sortedKeys.reduce((s, k) => s + groups.get(k).files.length, 0);
  console.error(`📦 扫描到 ${totalFiles} 个含导出符号的文件，共 ${totalSyms} 个符号，分 ${sortedKeys.length} 个模块`);

  const output = renderMarkdown(groups, sortedKeys);
  fs.writeFileSync(path.join(ROOT, outputFile), output, 'utf-8');
  console.log(`✅ 已写入 ${outputFile}（${totalSyms} 符号 / ${totalFiles} 文件）`);
}

main();
