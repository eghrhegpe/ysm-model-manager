#!/usr/bin/env node
/**
 * 提取 Go/JS 函数与类型注释，输出函数映射表。
 * 由 scripts/funcmap.py 迁移（2026-08-03），逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, suffix, skipNodeModules = true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipNodeModules && entry.name === 'node_modules') continue;
      out.push(...walk(full, suffix, skipNodeModules));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out.sort();
}

function extractGoComments(filepath) {
  /** 提取 Go 文件的注释 → 函数/类型映射。 */
  const entries = [];
  let text;
  try {
    text = fs.readFileSync(filepath, 'utf-8').replace(/\r\n/g, '\n'); // 归一化行尾（CRLF 下 JS . 不匹配 \r）
  } catch { return entries; }

  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 收集连续的单行注释（// ...）
    let comments = [];
    while (i < lines.length && /^\s*\/\//.test(lines[i])) {
      // 跳过 === 分隔线
      if (lines[i].includes('====') || lines[i].includes('=====')) {
        comments = [];
        i += 1;
        continue;
      }
      const c = lines[i].trim();
      if (c !== '//') comments.push(c);
      i += 1;
    }

    // 检查注释后是否有函数/类型定义
    if (comments.length && i < lines.length) {
      const sig = lines[i].trim();
      const m = sig.match(/^(func\s+\([^)]*\)\s+\w+|func\s+\w+|type\s+\w+)/);
      if (m) {
        const name = m[1];
        // 取第一条注释作为摘要（lstrip("/ ") 等价：去掉前导 /、*、空格、tab）
        const summary = comments[0].replace(/^[\/\*\s\t]+/, '');
        entries.push([filepath, i + 1, name, summary]);
        comments = [];
        continue;
      }
    }

    if (!comments.length) {
      i += 1;
      continue;
    }

    // 检查多行 /* ... */ JSDoc 风格的注释
    if (/^\s*\/\*/.test(line)) {
      const jsdocLines = [];
      while (i < lines.length && !lines[i].includes('*/')) {
        jsdocLines.push(lines[i].trim());
        i += 1;
      }
      if (i < lines.length) {
        jsdocLines.push(lines[i].trim()); // */ 行
        i += 1;
      }

      // 取 @summary 或第一行描述
      let summary = '';
      for (const jl of jsdocLines) {
        const clean = jl.trim().replace(/^[\/\*\s\t]+/, '');
        if (clean.startsWith('@summary')) {
          summary = clean.replace('@summary', '').trim();
          break;
        }
      }
      if (!summary) {
        for (const jl of jsdocLines) {
          const clean = jl.trim().replace(/^[\/\*\s\t]+/, '');
          if (clean && !clean.startsWith('@')) {
            summary = clean.slice(0, 80);
            break;
          }
        }
      }

      // 检查后面是否有定义
      if (i < lines.length) {
        const sig = lines[i].trim();
        const m = sig.match(/^(func\s+\([^)]*\)\s+\w+|func\s+\w+|type\s+\w+)/);
        if (m) {
          const name = m[1];
          entries.push([filepath, i + 1, name, summary || '(no desc)']);
        }
      }
      continue;
    }

    i += 1;
  }

  return entries;
}

function extractJsComments(filepath) {
  /** 提取 JS 文件的 JSDoc → 函数映射。 */
  const entries = [];
  let text;
  try {
    text = fs.readFileSync(filepath, 'utf-8').replace(/\r\n/g, '\n'); // 归一化行尾（CRLF 下 JS . 不匹配 \r）
  } catch { return entries; }

  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 收集 JSDoc 块
    if (/^\s*\/\*\*/.test(line)) {
      const jsdocLines = [];
      while (i < lines.length && !lines[i].includes('*/')) {
        jsdocLines.push(lines[i].trim());
        i += 1;
      }
      if (i < lines.length) {
        jsdocLines.push(lines[i].trim());
        i += 1;
      }

      // 提取 @description 或第一行
      let summary = '';
      for (const jl of jsdocLines) {
        const clean = jl.trim().replace(/^[\/\*\s\t]+/, '');
        if (clean.startsWith('@description')) {
          summary = clean.replace('@description', '').trim();
          break;
        }
      }
      if (!summary) {
        for (const jl of jsdocLines) {
          const clean = jl.trim().replace(/^[\/\*\s\t]+/, '');
          if (clean && !clean.startsWith('@')) {
            summary = clean.slice(0, 80);
            break;
          }
        }
      }

      // 跳过空行
      while (i < lines.length && !lines[i].trim()) i += 1;

      // 检查后面是否有函数定义
      if (i < lines.length) {
        const sig = lines[i].trim();
        const m = sig.match(/^(export\s+)?(async\s+)?(function\s+\w+|const\s+\w+)/);
        if (m) {
          const name = m[0];
          entries.push([filepath, i + 1, name, summary || '(no desc)']);
        }
      }
      continue;
    }

    // 单行 // 注释 + 函数
    const m = line.match(/^\s*\/\/\s*(.+)$/);
    if (m) {
      const summary = m[1].trim();
      // 看下一行是否是函数定义
      if (i + 1 < lines.length) {
        const sig = lines[i + 1].trim();
        const m2 = sig.match(/^(export\s+)?(async\s+)?(function\s+\w+|const\s+\w+)/);
        if (m2) {
          const name = m2[0];
          entries.push([filepath, i + 2, name, summary]);
        }
      }
    }

    i += 1;
  }

  return entries;
}

// 参数解析
const args = process.argv.slice(2);
const outputIdx = args.indexOf('-o') >= 0 ? args.indexOf('-o') : args.indexOf('--output');
let outputFile = null;
const positionals = [];
if (outputIdx >= 0) {
  outputFile = args[outputIdx + 1];
  args.splice(outputIdx, 2);
}
const goIdx = args.indexOf('--go');
const jsIdx = args.indexOf('--js');
let goPaths = null;
let jsPaths = null;
if (goIdx >= 0) {
  const rest = args.slice(goIdx + 1).filter((a) => a !== '--js');
  goPaths = rest.length ? rest : null;
}
if (jsIdx >= 0) {
  const rest = args.slice(jsIdx + 1);
  jsPaths = rest.length ? rest : null;
}
positionals.push(...args.filter((a) => !a.startsWith('--')));

const allEntries = [];

// 扫描 Go
const goScanPaths = goPaths || ['go', '.'];
for (const p of goScanPaths) {
  const fp = path.join(ROOT, p);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile() && fp.endsWith('.go')) {
    allEntries.push(...extractGoComments(fp));
  } else if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    for (const f of walk(fp, '.go')) {
      allEntries.push(...extractGoComments(f));
    }
  }
}

// 扫描 JS
const jsScanPaths = jsPaths || ['frontend/js'];
for (const p of jsScanPaths) {
  const fp = path.join(ROOT, p);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile() && fp.endsWith('.js')) {
    allEntries.push(...extractJsComments(fp));
  } else if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    for (const f of walk(fp, '.js')) {
      allEntries.push(...extractJsComments(f));
    }
  }
}

// 按文件路径排序输出（码点序，等价 Python str 比较）
allEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

const lines = ['# 函数映射表', '', '| 文件 | 行 | 签名 | 注释 |', '|------|----|------|------|'];
for (const [fp, lineno, name, summary] of allEntries) {
  const rel = path.relative(ROOT, fp);
  lines.push(`| ${rel} | ${lineno} | \`${name}\` | ${summary} |`);
}

const output = lines.join('\n');

if (outputFile) {
  fs.writeFileSync(path.join(ROOT, outputFile), output, 'utf-8');
  console.log(`已输出 ${allEntries.length} 条记录到 ${outputFile}`);
} else {
  process.stdout.write(output + '\n');
}
