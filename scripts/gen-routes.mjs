#!/usr/bin/env node
/**
 * gen-routes.mjs — AI 路由表生成器 (docs/knowledge/routes.md)。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 按 use_when 关键词建立「用户自然语言 → 知识卡」映射。
 *
 * 用法：
 *   node scripts/gen-routes.mjs           # 写入
 *   node scripts/gen-routes.mjs --check   # 校验是否已同步（不写入）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KC_DIR = path.join(ROOT, 'docs', 'knowledge');
const OUTPUT = path.join(KC_DIR, 'routes.md');
const CHECK = process.argv.includes('--check');

// ── 共享 frontmatter 解析 ────────────────────────────

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function getScalar(fm, key) {
  if (!fm) return undefined;
  const line = fm.match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1].trim();
  if (v === '' || v.startsWith('<')) return undefined;
  return v.replace(/\s*#.*/, '').trim();
}

function getList(fm, key) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/\s*#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/\s*#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

// ── 配置 ─────────────────────────────────────────────

const NON_CARDS = new Set(['index.md', 'routes.md', 'README.md', 'AGENTS.md']);

// ── 构建路由表 ───────────────────────────────────────

function buildRoutes() {
  const files = fs.existsSync(KC_DIR)
    ? fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && !NON_CARDS.has(f)).sort()
    : [];

  // 关键词 → [卡片]
  const keywordMap = {};

  for (const f of files) {
    const text = fs.readFileSync(path.join(KC_DIR, f), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;

    const tier = getScalar(fm, 'tier');
    if (tier === 'leaf') continue; // leaf 卡不进入路由

    const kind = getScalar(fm, 'kind') || f.replace(/\.md$/, '');
    const name = getScalar(fm, 'name') || kind;
    const keywords = getList(fm, 'use_when');

    for (const kw of keywords) {
      if (!keywordMap[kw]) keywordMap[kw] = [];
      keywordMap[kw].push({ kind, name });
    }
  }

  let out = '<!-- 本文件由 scripts/gen-routes.mjs 自动生成，禁止手改 -->\n\n';
  out += '# AI 路由表\n\n';
  out += '> 用途: AI 代理根据用户意图关键词定位对应知识卡\n\n';
  out += '## 使用方式\n\n';
  out += '用户提问时，从下表查找关键词 → 打开对应知识卡获取上下文。\n\n';
  out += '---\n\n';
  out += '| 关键词 | 知识卡 | 卡片名称 |\n';
  out += '|--------|--------|----------|\n';

  for (const kw of Object.keys(keywordMap).sort()) {
    for (const target of keywordMap[kw]) {
      out += `| ${kw} | [${target.kind}](${target.kind}.md) | ${target.name} |\n`;
    }
  }

  return out;
}

// ── 主流程 ───────────────────────────────────────────

function main() {
  const expected = buildRoutes();
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;

  if (current === expected) {
    console.log('[OK] routes.md 已是最新');
    return 0;
  }

  if (CHECK) {
    console.error('[FAIL] routes.md 需要更新');
    return 1;
  }

  fs.writeFileSync(OUTPUT, expected, 'utf8');
  console.log(`[OK] 已生成 ${OUTPUT}`);
  return 0;
}

process.exit(main());
