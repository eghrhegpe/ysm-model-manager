#!/usr/bin/env node
/**
 * Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。
 * 由 scripts/link-checker.py 迁移（2026-08-03），逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'archive', '.git', 'vendor']);

function walkMd(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function extractLinks(filepath) {
  /** 提取 md 文件中的 Markdown 链接。 */
  const links = [];
  let text;
  try {
    text = fs.readFileSync(filepath, 'utf-8');
  } catch { return links; }

  // 匹配 [text](path) 和 [text](path "title")
  const re = /\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const linkText = m[1];
    const rawPath = m[2].split(/\s+/)[0]; // 去掉 title 部分
    links.push([linkText, rawPath, m.index]);
  }
  return links;
}

function resolvePath(filepath, rawPath) {
  /** 将 Markdown 相对路径解析为实际文件系统路径。 */
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return null; // 外部链接跳过
  if (rawPath.startsWith('#')) return null; // 锚点跳过
  let candidate;
  if (rawPath.startsWith('/')) {
    // 绝对路径从项目根开始
    candidate = path.join(ROOT, rawPath.replace(/^\/+/, ''));
  } else {
    // 相对路径从文件目录开始
    candidate = path.join(path.dirname(filepath), rawPath);
  }

  // 去掉 #anchor
  const base = path.basename(candidate);
  if (base.includes('#')) {
    candidate = path.join(path.dirname(candidate), base.split('#')[0]);
  }

  candidate = path.resolve(candidate);
  return candidate;
}

function checkLinks(files) {
  /** 检查文件列表中的所有内部链接。 */
  const broken = [];
  let okCount = 0;
  for (const fp of files) {
    for (const [text, rawPath, pos] of extractLinks(fp)) {
      const resolved = resolvePath(fp, rawPath);
      if (resolved === null) continue; // 外部链接
      if (fs.existsSync(resolved)) {
        okCount += 1;
      } else {
        const rel = path.relative(ROOT, fp);
        let type = 'file';
        try {
          if (fs.statSync(resolved).isDirectory()) type = 'dir';
        } catch { /* doesn't exist */ }
        broken.push({
          file: rel,
          position: pos,
          link_text: text,
          raw_path: rawPath,
          resolved_path: resolved,
          type,
        });
      }
    }
  }
  return [okCount, broken];
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

// 收集所有 md 文件（跳过 archive）
const files = [];
for (const f of walkMd(ROOT)) {
  const relParts = path.relative(ROOT, f).split(path.sep);
  if (relParts.some((s) => SKIP_DIRS.has(s))) continue;
  files.push(f);
}

const [ok, broken] = checkLinks(files);

if (jsonMode) {
  const out = {
    _summary: { files_scanned: files.length, links_ok: ok, links_broken: broken.length },
    broken_links: broken,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(`扫描 ${files.length} 个 md 文件\n有效链接: ${ok}, 断链: ${broken.length}\n\n`);
if (broken.length) {
  for (const b of broken) {
    process.stdout.write(`  [BROKEN] ${b.file}: 链接 \`${b.link_text}\` -> \`${b.raw_path}\`\n`);
  }
  process.stdout.write(`\n共 ${broken.length} 条断链\n`);
} else {
  process.stdout.write('全部链接有效\n');
}
