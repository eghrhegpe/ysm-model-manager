#!/usr/bin/env node
/**
 * gen-knowledge-index.mjs — 按分类生成知识卡索引 (docs/knowledge/index.md)。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 本文件由 gen-knowledge-index.mjs 自动生成，禁止手改。
 *
 * 用法：
 *   node scripts/gen-knowledge-index.mjs           # 写入
 *   node scripts/gen-knowledge-index.mjs --check    # 校验是否已同步（不写入）
 * 设计意图：知识索引生成器
 * 退出码：main(（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KC_DIR = path.join(ROOT, 'docs', 'knowledge');
const OUTPUT = path.join(KC_DIR, 'index.md');
const CHECK = process.argv.includes('--check');

// ── 共享 frontmatter 解析（与 _lib/frontmatter.mjs 一致）──

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

// ── 配置 ─────────────────────────────────────────────

const CATEGORY_LABELS = {
  core: '核心基础设施（事件总线、页面状态、Wails 桥接）',
  go: 'Go 后端包（安装、下载、回收站、YSM 解析等）',
  ui: '前端 UI 组件（tree、sidebar、preview、content）',
  feature: '业务功能（导入队列、同步、社区）',
  utils: '工具函数（display、fmt、dom、animation）',
  config: '配置与注册表（resource_types、AppConfig）',
};

const NON_CARDS = new Set(['index.md', 'routes.md', 'README.md', 'AGENTS.md']);

// ── 构建索引 ─────────────────────────────────────────

function buildIndex() {
  const files = fs.existsSync(KC_DIR)
    ? fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && !NON_CARDS.has(f)).sort()
    : [];

  const cards = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(KC_DIR, f), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    cards.push({
      file: f,
      kind: getScalar(fm, 'kind') || f.replace(/\.md$/, ''),
      name: getScalar(fm, 'name') || f.replace(/\.md$/, ''),
      category: getScalar(fm, 'category') || 'unknown',
      tier: getScalar(fm, 'tier') || 'architecture',
    });
  }

  const groups = {};
  for (const c of cards) {
    (groups[c.category] = groups[c.category] || []).push(c);
  }

  let out = '<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->\n\n';
  out += '# 知识卡索引\n\n';
  out += `> 总计: ${cards.length} 张知识卡\n\n`;

  for (const cat of Object.keys(groups).sort()) {
    const items = groups[cat];
    const label = CATEGORY_LABELS[cat] || '';
    out += `## ${cat}（${items.length} 张）\n\n`;
    if (label) out += `*${label}*\n\n`;
    out += '| 标识 | 名称 | tier |\n';
    out += '|------|------|------|\n';
    for (const c of items) {
      const marker = c.tier === 'architecture' ? '🏗' : '🍃';
      out += `| ${marker} ${c.kind} | ${c.name} | ${c.tier} |\n`;
    }
    out += '\n';
  }

  out += '---\n\n';
  out += '## 分类说明\n\n';
  out += '| 分类 | 用途 |\n';
  out += '|------|------|\n';
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    out += `| ${cat} | ${label} |\n`;
  }
  return out;
}

// ── 主流程 ───────────────────────────────────────────

function main() {
  const expected = buildIndex();
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;

  if (current === expected) {
    console.log('[OK] index.md 已是最新');
    return 0;
  }

  if (CHECK) {
    console.error('[FAIL] index.md 需要更新', { file: 'docs/knowledge/index.md' });
    return 1;
  }

  fs.writeFileSync(OUTPUT, expected, 'utf8');
  console.log(`[OK] 已生成 ${OUTPUT}`);
  return 0;
}

process.exit(main());
