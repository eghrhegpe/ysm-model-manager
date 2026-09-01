#!/usr/bin/env node
/**
 * gen-vitepress-sidebar.ts — 生成 VitePress sidebar（按内容类型分组导航）。
 *
 * 设计意图：对标 MikuMikuAR docs/.vitepress/config.ts 的分组导航（用户指南置顶、
 * 内部文档折叠收纳），解决全量平铺导致「用户向内容被开发者文档淹没」的问题。
 * 输出：docs/.vitepress/sidebar.gen.mjs（自动生成，勿手改）。
 *
 * 分组：用户指南 / 发版记录 / 架构与规范 / 决策记录(ADR) / 知识卡 / 小说
 *   - guide：按 GUIDE_GROUPS 收纳分组（入门/核心/整理/设置/疑难），组内新手高频在前（_lib/guide-order.ts）
 *   - releases/adr：自动扫描目录，标题取页面 H1/frontmatter title（中文）
 *   - 架构与规范：docs 根散 md，ARCH_ORDER 语义排序（核心规范置顶，表外沉底）
 *   - 决策记录：按编号数字倒序（最新决策置顶）
 *   - 知识卡：按 category 聚合分组折叠（表外分类归「其他」并告警，不静默丢卡）
 *   - 小说：按子目录（卷/区域）分组折叠
 *
 * 用法：node scripts/gen-vitepress-sidebar.ts（构建前先跑，见 docs/package.json build script）
 * 退出码：0（无 process.exit 调用）
 * 依赖：node:fs / node:path / node:url / 本地模块
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './_lib/to-posix.ts';
import { parseFrontmatter, getScalar } from './_lib/frontmatter.ts';
import { GUIDE_GROUPS } from './_lib/guide-order.ts';
// [ADR-114 §被补充] 常量共享层
import { KNOWLEDGE_ORDER, KNOWLEDGE_NON_CARDS as NON_CARDS } from './_lib/knowledge-cards.ts';

const DOCS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs');
const OUT = join(DOCS, '.vitepress', 'sidebar.gen.mjs');
// 隐藏/构建目录不参与扫描：mdNames 只列 .md 文件，子目录不以 .md 结尾自动排除；
// 此处显式排除以点开头的隐藏文件（如 .doc-next-steps.md，诊断产物不应进导航，code_review P2-1/P2-2）
const HIDDEN_FILE_RE = /^\./;

/** 相对路径 → VitePress 链接（cleanUrls 去 .md；index.md → 目录） */
function linkify(rel: string) {
  let p = '/' + toPosix(rel).replace(/\.md$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -'index'.length);
  return p;
}

/**
 * 侧边栏显示标题（自动渲染，优先中文）：
 *   frontmatter `title` → frontmatter `name`（知识卡）→ 首个 H1 → 文件名。
 */
function readTitle(rel: string) {
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

function stripQuotes(s: string) {
  return s.replace(/^["']|["']$/g, '').trim();
}

/** 列出 relDir 下顶层 .md（不含子目录、不含隐藏文件、不含 index/README 白名单），按文件名排序。 */
function mdNames(relDir: string) {
  const abs = join(DOCS, relDir);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md') && !HIDDEN_FILE_RE.test(f) && statSync(join(abs, f)).isFile())
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 扫描目录生成 items：标题取页面 H1/frontmatter title，回退文件名。 */
function scanItems(relDir: string, exclude: string[] = []) {
  return mdNames(relDir)
    .filter((f) => !exclude.includes(f))
    .map((f) => {
      const rel = join(relDir, f).replace(/\\/g, '/');
      const text = readTitle(rel) || f.replace(/\.md$/, '');
      return { text, link: linkify(rel) };
    });
}

// ---------- 1. 用户指南（guide/，按 GUIDE_GROUPS 收纳分组，组内语义序） ----------
// 复用 _lib/guide-order.ts（与 gen-docs-index 同一事实来源）：分组收纳 + 新手高频在前；
// 表外页面（如旧总览、项目意义）归「其他」并告警，不静默丢页。
function guideItemsBuilder() {
  const mdFiles = new Set(mdNames('guide').filter((f) => !['index.md'].includes(f)));
  const items: Array<{ text: string; collapsed: boolean; items: Array<{ text: string; link: string }> }> = [];
  const assigned = new Set();
  for (const g of GUIDE_GROUPS) {
    const children = g.items
      .filter((f) => mdFiles.has(f))
      .map((f) => {
        assigned.add(f);
        const rel = join('guide', f).replace(/\\/g, '/');
        return { text: readTitle(rel) || f.replace(/\.md$/, ''), link: linkify(rel) };
      });
    if (children.length) items.push({ text: g.key, collapsed: true, items: children });
  }
  const rest = [...mdFiles].filter((f) => !assigned.has(f)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (rest.length) {
    console.warn(`[sidebar] 用户指南存在表外页面，已归「其他」组（${rest.length} 篇：${rest.join(', ')}）`);
    items.push({
      text: '其他',
      collapsed: true,
      items: rest.map((f) => {
        const rel = join('guide', f).replace(/\\/g, '/');
        return { text: readTitle(rel) || f.replace(/\.md$/, ''), link: linkify(rel) };
      }),
    });
  }
  return items;
}

// ---------- 2. 发版记录（releases/，折叠） ----------
const releasesItems = scanItems('releases', ['index.md']);

// ---------- 3. 架构与规范（docs 根散 md + app/，语义排序） ----------
// 核心规范置顶，参考资料沉底；表外文件按字母序兜底（新增根 md 仍自动入列）。
const ARCH_ORDER = [
  'architecture.md',
  'Design.md',
  'governance-rules.md',
  'funcmap.md',
  'project-map.md',
  'maintenance.md',
  'pitfalls.md',
  'review-report.md',
];
const archWeight = (name: string) => {
  const i = ARCH_ORDER.indexOf(name);
  return i === -1 ? ARCH_ORDER.length : i;
};
const archItems: any[] = mdNames('.')
  .filter((f) => f !== 'index.md' && !['AGENTS.md'].includes(f))
  .sort((a, b) => archWeight(a) - archWeight(b) || a.localeCompare(b, 'zh-CN'))
  .map((f) => ({ text: readTitle(f) || f.replace(/\.md$/, ''), link: linkify(f) }));
// app/ 目录并入架构与规范（网页版规划占位）
const appItems = scanItems('app', ['index.md']);
if (appItems.length) archItems.push({ text: '网页版', collapsed: true, items: appItems });

// ---------- 4. 决策记录（adr/，编号数字倒序，折叠） ----------
const adrItems = mdNames('adr')
  .filter((f) => !['index.md', 'README.md'].includes(f))
  .map((f) => ({ f, num: Number((f.match(/^ADR-(\d+)/) || [])[1] || 0) }))
  .sort((a, b) => b.num - a.num)
  .map(({ f }) => {
    const rel = join('adr', f).replace(/\\/g, '/');
    return { text: readTitle(rel) || f.replace(/\.md$/, ''), link: linkify(rel) };
  });

// ---------- 5. 知识卡（knowledge/，按 category 聚合，折叠） ----------
// 从卡片 frontmatter 聚合分类（groupBy），表外分类归「其他」并告警，绝不静默丢卡。
// [ADR-114 §被补充] KNOWLEDGE_ORDER / NON_CARDS 已从 _lib/knowledge-cards.ts 引入，
// 不再本地复制（5 处漂移已消解）。
function knowledgeItemsBuilder() {
  const groups = new Map();
  const cards = mdNames('knowledge').filter((f) => !NON_CARDS.has(f));
  for (const f of cards) {
    const rel = join('knowledge', f).replace(/\\/g, '/');
    let cat = '其他';
    try {
      const fm = parseFrontmatter(readFileSync(join(DOCS, rel), 'utf8'));
      const raw = getScalar(fm, 'category');
      if (raw && /^[a-z]+$/.test(raw.trim())) cat = raw.trim();
    } catch { /* 归「其他」 */ }
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ text: readTitle(rel) || f.replace(/\.md$/, ''), link: linkify(rel) });
  }
  const order = [...KNOWLEDGE_ORDER, ...[...groups.keys()].filter((k) => !KNOWLEDGE_ORDER.includes(k))];
  const items: any[] = [];
  for (const cat of order) {
    if (!groups.has(cat)) continue;
    if (cat === '其他') console.warn(`[sidebar] 知识卡存在表外分类，已归「其他」组（${groups.get(cat).length} 张）`);
    items.push({ text: cat, collapsed: true, items: groups.get(cat) });
  }
  return items;
}

// ---------- 6. 小说（novel/，按子目录分组，折叠） ----------
function novelItemsBuilder() {
  const abs = join(DOCS, 'novel');
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return [];
  const dirs = readdirSync(abs)
    .filter((n) => statSync(join(abs, n)).isDirectory() && !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const groups: any[] = [];
  for (const d of dirs) {
    const relDir = join('novel', d).replace(/\\/g, '/');
    const items = scanItems(relDir, ['README.md']);
    if (items.length) {
      groups.push({ text: d, collapsed: true, items });
    } else {
      // 一级目录无顶层 md 但含二级子目录（如 appendix/Go后端、appendix/安全横切）：
      // 递归一层按二级子目录分组，避免内容漏扫（code_review P2-3）
      const sub = join(abs, d);
      const subDirs = readdirSync(sub)
        .filter((n) => statSync(join(sub, n)).isDirectory() && !n.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
      for (const sd of subDirs) {
        const sdItems = scanItems(join(relDir, sd), ['README.md']);
        if (sdItems.length) groups.push({ text: `${d}/${sd}`, collapsed: true, items: sdItems });
      }
    }
  }
  // novel 根目录散 md（如有）
  const rootNovel = scanItems('novel', ['index.md', 'README.md', 'AGENTS.md']);
  if (rootNovel.length) groups.unshift({ text: '总览', collapsed: true, items: rootNovel });
  return groups;
}

// ---------- 6.5 审计系列（audit/，按编号排序，折叠） ----------
// 08-06 初版总报告 + r1-r14 细分审计 + framework。当前事实源为 r1-r14，总报告为历史基线。
const auditItems = (() => {
  const abs = join(DOCS, 'audit');
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return [];
  const files = readdirSync(abs)
    .filter((f) => f.endsWith('.md') && !['README.md', 'index.md'].includes(f))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return files.map((f) => {
    const rel = join('audit', f).replace(/\\/g, '/');
    return { text: readTitle(rel) || f.replace(/\.md$/, ''), link: linkify(rel) };
  });
})();

// ---------- 组装 ----------
// 全部分组统一 collapsed: true（侧边栏只导航，浏览交给分组主站页 /xxx/）；
// 唯一例外：用户指南置顶展开，让新手一眼看到功能分类（子分组仍折叠保持整洁）。
const sidebar = [
  { text: '用户指南', link: '/guide/', collapsed: false, items: guideItemsBuilder() },
  { text: '发版记录', link: '/releases/', collapsed: true, items: releasesItems },
  { text: '架构与规范', link: '/architecture', collapsed: true, items: archItems },
  { text: '决策记录 (ADR)', link: '/adr/', collapsed: true, items: adrItems },
  { text: '审计', link: '/audit/', collapsed: true, items: auditItems },
  { text: '知识卡', link: '/knowledge/', collapsed: true, items: knowledgeItemsBuilder() },
  { text: '小说', link: '/novel/', collapsed: true, items: novelItemsBuilder() },
];

const out =
  '// ===== 自动生成：scripts/gen-vitepress-sidebar.ts（勿手改）=====\n' +
  '// 按内容类型分组导航：用户指南 / 发版记录 / 架构与规范 / 决策记录 / 知识卡 / 小说\n' +
  'export const autoSidebar = ' +
  JSON.stringify(sidebar, null, 2) +
  ';\n';
writeFileSync(OUT, out, 'utf8');
console.log(`[OK] 已生成 docs/.vitepress/sidebar.gen.mjs（${sidebar.length} 个分组）`);
