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
import { ROOT, readText, writeText } from './_lib/scan-files.mjs';
import { parseFrontmatter, getScalar, getList } from './_lib/frontmatter.mjs';
import { parseArgs } from './_lib/parse-args.mjs';

const KC_DIR = path.join(ROOT, 'docs', 'knowledge');
const OUTPUT = path.join(KC_DIR, 'index.md');
const { check: CHECK } = parseArgs(process.argv.slice(2), { bools: ['check'] });

// ── 配置 ─────────────────────────────────────────────

const CATEGORY_LABELS = {
  core: '核心基础设施（事件总线、页面状态、Wails 桥接）',
  go: 'Go 后端包（安装、下载、回收站、YSM 解析等）',
  ui: '前端 UI 组件（tree、sidebar、preview、content）',
  feature: '业务功能（导入队列、同步、社区）',
  utils: '工具函数（display、fmt、dom、animation）',
  config: '配置与注册表（resource_types、AppConfig）',
};

const NON_CARDS = new Set(['index.md', 'README.md', 'AGENTS.md']);

/**
 * 使用说明（原 docs/knowledge/README.md 操作手册，并入 index 后由生成器承载）。
 * 改说明 = 改本常量后重跑 gen-knowledge-index.mjs（index 保持「全生成、禁手改」）。
 */
const KNOWLEDGE_USAGE = [
  '### 快速开始',
  '',
  '```bash',
  '# 新建知识卡',
  'node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]',
  '',
  '# 漂移检查',
  'node scripts/check-knowledge-drift.mjs',
  '',
  '# 重新生成索引',
  'node scripts/gen-knowledge-index.mjs',
  '```',
  '',
  '### 文件结构',
  '',
  '| 文件 | 说明 |',
  '|------|------|',
  '| `AGENTS.md` | 分区路由指南（必读） |',
  '| `index.md` | 分类索引（自动生成） |',
  '| `<kind>.md` | 知识卡（kind 为 snake_case） |',
  '',
  '### 约束',
  '',
  '- `source_files` **必须**真实存在于磁盘',
  '- `kind` = 文件名，snake_case',
  '- 生成物（`index.md`）**禁止手改**',
  '- H1 标题 = `name` 字段',
];

// ── 工具函数 ─────────────────────────────────────────

/** 提取卡片 `## 概览` 段落内容作为摘要。 */
function extractSummary(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // 匹配 ## 概览 到下一个 ## 标题之间的内容
  const m = body.match(/^##\s+概览\s*\n([\s\S]*?)(?=^##\s+|$)/m);
  if (!m) return '';
  const summary = m[1].replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  return summary.length > 120 ? summary.slice(0, 120) + '…' : summary;
}

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
      keywords: getList(fm, 'use_when'),
      summary: extractSummary(text),
    });
  }

  const groups = {};
  for (const c of cards) {
    (groups[c.category] = groups[c.category] || []).push(c);
  }

  let out = '<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->\n\n';
  out += '# 知识卡索引\n\n';
  out += `> 总计: ${cards.length} 张知识卡\n\n`;
  out += '> 用途: AI 代理根据分类 + 关键词定位知识卡，摘要提供快速上下文。\n\n';

  for (const cat of Object.keys(groups).sort()) {
    const items = groups[cat];
    const label = CATEGORY_LABELS[cat] || '';
    out += `## ${cat}（${items.length} 张）\n\n`;
    if (label) out += `*${label}*\n\n`;
    out += '| 标识 | 名称 | tier | 关键词 |\n';
    out += '|------|------|------|--------|\n';
    for (const c of items) {
      const marker = c.tier === 'architecture' ? '🏗' : '🍃';
      const kw = c.keywords.length ? c.keywords.join(', ') : '—';
      out += `| ${marker} ${c.kind} | ${c.name} | ${c.tier} | ${kw} |\n`;
    }
    out += '\n';

    // 摘要区块
    const withSummary = items.filter((c) => c.summary);
    if (withSummary.length) {
      out += '### 摘要\n\n';
      for (const c of withSummary) {
        out += `- **${c.kind}**（${c.name}）：${c.summary}\n`;
      }
      out += '\n';
    }
  }

  out += '---\n\n';
  out += '## 使用说明\n\n';
  for (const line of KNOWLEDGE_USAGE) out += line + '\n';
  out += '\n';

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
  const current = fs.existsSync(OUTPUT) ? readText(OUTPUT) : null; // 归一化比较，CRLF 下幂等不失效

  if (current === expected) {
    console.log('[OK] index.md 已是最新');
    return 0;
  }

  if (CHECK) {
    console.error('[FAIL] index.md 需要更新', { file: 'docs/knowledge/index.md' });
    return 1;
  }

  writeText(OUTPUT, expected); // 保留原行尾风格（CRLF 文件不被改写成 LF）
  console.log(`[OK] 已生成 ${OUTPUT}`);
  return 0;
}

process.exit(main());
