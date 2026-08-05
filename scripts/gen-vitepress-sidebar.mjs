#!/usr/bin/env node
/**
 * 生成 VitePress sidebar（扫描 docs/ 全部 md，按目录树自动组织导航）。
 * 输出：docs/.vitepress/sidebar.gen.mjs（自动生成，勿手改）。
 * 排除：.vitepress / node_modules / dist / archive（冻结区）/ index.md（home 页）。
 * 用法：node scripts/gen-vitepress-sidebar.mjs（构建前先跑，见 docs/package.json build script）
 * 设计意图：gen-vitepress-sidebar 工具脚本
 * 依赖：node:fs / node:path / node:url
 * 退出码：0（无 process.exit 调用）
 * gen-vitepress-sidebar.mjs — gen-vitepress-sidebar 工具脚本
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './_lib/to-posix.mjs';

const DOCS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs');
const OUT = join(DOCS, '.vitepress', 'sidebar.gen.mjs');
const EXCLUDE = new Set(['.vitepress', 'node_modules', 'dist', 'archive', '_sass']);

/** 相对路径 → VitePress 链接（cleanUrls 去 .md；index.md → 目录） */
function linkify(rel) {
  let p = '/' + toPosix(rel).replace(/\.md$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -'index'.length);
  return p;
}

/**
 * 侧边栏显示标题（自动渲染，优先中文）：
 *   frontmatter `title` → frontmatter `name`（知识卡）→ 首个 H1 → 文件名。
 * 这样新增/改名页面无需手改侧边栏；带中文标题的页面自动显示中文行。
 * 目录名（knowledge/adr/...）保持原样作为分区标题，不在这里改写。
 */
function readTitle(rel) {
  let raw = '';
  try {
    raw = readFileSync(join(DOCS, rel), 'utf8');
  } catch {
    return null;
  }
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const block = fm[1];
    const titleM = block.match(/^\s*title:\s*(.+?)\s*$/m);
    if (titleM) return stripQuotes(titleM[1]);
    const nameM = block.match(/^\s*name:\s*(.+?)\s*$/m);
    if (nameM) return stripQuotes(nameM[1]);
  }
  const h1 = raw.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1];
  return null;
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, '').trim();
}

function walk(dir) {
  const names = readdirSync(dir).sort((a, b) => {
    const aDir = statSync(join(dir, a)).isDirectory();
    const bDir = statSync(join(dir, b)).isDirectory();
    if (aDir !== bDir) return aDir ? 1 : -1; // 文件在前，目录在后
    return a.localeCompare(b, 'zh-CN');
  });
  const children = [];
  for (const name of names) {
    if (EXCLUDE.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    const rel = relative(DOCS, full);
    if (st.isDirectory()) {
      const subs = walk(full);
      if (subs.length) children.push({ text: name, collapsed: true, items: subs });
    } else if (name.endsWith('.md') && name !== 'index.md') {
      const base = name.replace(/\.md$/, '');
      const text = readTitle(rel) || base;
      children.push({ text, link: linkify(rel) });
    }
  }
  return children;
}

const tree = walk(DOCS);
const out =
  '// ===== 自动生成：scripts/gen-vitepress-sidebar.mjs（勿手改）=====\n' +
  '// 扫描 docs/ 全部 md，按目录树生成 VitePress sidebar\n' +
  'export const autoSidebar = ' +
  JSON.stringify(tree, null, 2) +
  ';\n';
writeFileSync(OUT, out, 'utf8');
console.log(`[OK] 已生成 docs/.vitepress/sidebar.gen.mjs（${tree.length} 个顶层项）`);
