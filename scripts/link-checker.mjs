#!/usr/bin/env node
/**
 * Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。
 * 由 scripts/link-checker.py 迁移（2026-08-03），逻辑逐点保真。
 * link-checker.mjs — 文档链接检查器
 * 设计意图：文档链接检查器
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/link-checker.mjs                 # 默认行为
 *   node scripts/link-checker.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（成功）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const SKIP_DIRS = new Set(['node_modules', 'archive', '.git', 'vendor', 'upstream', 'build', 'dist']);
const SKIP_FILES = new Set(['.doc-next-steps.md']); // 自动生成产物，引用路径可能过期，不应计入断链

function walkMd(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
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

  // 在原文上匹配，position 即原文偏移（供 gen-doc-next-steps 的 file#line 直跳）；
  // fenced 代码块（```...```）内的链接跳过（示例链接如 adr 占位章节路径不判断链），
  // 而非先剥离再匹配——剥离会让 position 与原文错位、行号系统性偏移（code_review P2-1）
  const re = /\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (insideFence(text, m.index)) continue; // 位于 fenced 代码块内 → 跳过
    const linkText = m[1];
    const rawPath = m[2].split(/\s+/)[0]; // 去掉 title 部分
    links.push([linkText, rawPath, m.index]);
  }
  return links;
}

/** 判断给定字符偏移是否位于 fenced 代码块（```...```）内：统计到 pos 为止的 ``` 围栏数，奇数即在块内。 */
function insideFence(text, pos) {
  const upTo = text.slice(0, pos);
  const fences = (upTo.match(/^```/gm) || []).length;
  return fences % 2 === 1;
}

function resolvePath(filepath, rawPath) {
  /** 将 Markdown 相对路径解析为实际文件系统路径。 */
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return null; // 外部链接跳过
  if (rawPath.startsWith('file://')) return null; // 源码引用(file://...)非文档链接，跳过
  if (rawPath.startsWith('#')) return null; // 锚点跳过
  if (/[<>]/.test(rawPath)) return null; // 占位符链接（如 <page>-<n>.png）非真实链接，跳过
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
const strict = args.includes('--strict'); // 门禁模式：断链即 exit 1，可接 CI 卡点

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
  // 门禁模式：断链即 exit 1（--json --strict 下同样生效，doctor.mjs 352 用 rc 判定）
  process.exit(strict && broken.length ? 1 : 0);
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

// 门禁模式：存在断链则非零退出（可接 CI 卡点）；--strict 未启用时仅信息展示
process.exit(strict && broken.length ? 1 : 0);
