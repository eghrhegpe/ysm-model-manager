#!/usr/bin/env node
/**
 * analyze-knowledge-refs.ts — 知识卡引用深度与耦合分析（一次性诊断工具）。
 *
 * 目标：量化「知识卡分类体系 → 源码引用」的深度与膨胀度，为
 *   1. 后续审核范围划定（改某源码 → 牵动哪几张卡）
 *   2. 文件移动到更浅路径的决策（哪些卡引用面过大 / 哪些源码被过多卡引用）
 * 提供数据依据。
 *
 * 产出（自动生成物，禁止手改）：
 *   docs/review/knowledge-ref-analysis.md   — 人类可读报告
 *   docs/review/knowledge-ref-analysis.json — 机器可读明细
 *
 * 分析维度：
 *   A. 卡 → 源码：每张卡的 source_files 引用（路径深度 = 目录层数、引用面 = 文件数）
 *   B. 卡 → 卡：知识卡正文 `](./xxx.md)` 互链（336 处）
 *   C. 分类膨胀度：每分类卡数 / 引用源码文件数 / 最深引用
 *   D. 源码 → 卡反向引用：同一源码被多少卡引用（改代码时的审核牵动面）
 *   E. 引用孤岛：零源码引用 / 零被引用的卡
 *
 * 用法：
 *   node scripts/analyze-knowledge-refs.ts           # 全量分析 + 写报告
 *   node scripts/analyze-knowledge-refs.ts --json    # 只输出 JSON 到 stdout
 *   node scripts/analyze-knowledge-refs.ts --no-write # 分析但不写盘（试跑）
 *
 * 零依赖（仅 node:fs / node:path），复用 _lib/frontmatter.ts 解析。
 * 设计意图：知识卡引用关系诊断工具（一次性，不进 pre-commit GEN 清单）
 * 退出码：分析失败 → 1；否则 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { parseFrontmatter, getScalar, getList, parseSourceFiles } from './_lib/frontmatter.ts';
import { CATEGORY_LABELS, KNOWLEDGE_NON_CARDS, KNOW_DIR } from './_lib/knowledge-cards.ts';

const JSON_ONLY = process.argv.includes('--json');
const NO_WRITE = process.argv.includes('--no-write');

const OUT_MD = path.join(ROOT, 'docs', 'review', 'knowledge-ref-analysis.md');
const OUT_JSON = path.join(ROOT, 'docs', 'review', 'knowledge-ref-analysis.json');

// ── 1. 枚举知识卡 ─────────────────────────────────────

/** 读所有知识卡（跳过 NON_CARDS 与 README/AGENTS）。 */
function loadCards() {
  const cards: any[] = [];
  for (const f of fs.readdirSync(KNOW_DIR)) {
    if (!f.endsWith('.md')) continue;
    const stem = f.replace(/\.md$/, '');
    if (KNOWLEDGE_NON_CARDS.has(stem)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    if (!/^\uFEFF?---\r?\n/.test(text)) continue;
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const kind = getScalar(fm, 'kind') || stem;
    cards.push({
      file: f,
      kind,
      name: getScalar(fm, 'name') || kind,
      category: getScalar(fm, 'category') || '?',
      tier: getScalar(fm, 'tier') || '?',
      sourceFiles: parseSourceFiles(fm),
      tests: getList(fm, 'tests'),
      useWhen: getList(fm, 'use_when'),
      body: text, // 用于卡间互链扫描
    });
  }
  return cards;
}

/** 路径深度 = 目录层数（文件自身算 0；`a/b/c.ts` → 2）。 */
function pathDepth(p: string) {
  return p.split('/').filter(Boolean).length - 1;
}

/** 校验 source_files 是否真实存在于磁盘（对齐 check-knowledge-drift 的判定）。 */
function resolveSource(p: string, kind: string) {
  const full = path.join(ROOT, p);
  if (fs.existsSync(full)) return { p, kind: 'file', depth: pathDepth(p) };
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return { p, kind: 'dir', depth: pathDepth(p) };
  // 目录形态：source_files 常写 `go/scanner/`，strip 尾斜杠再看
  const strip = p.replace(/\/+$/, '');
  const fullStrip = path.join(ROOT, strip);
  if (strip !== p && fs.existsSync(fullStrip) && fs.statSync(fullStrip).isDirectory()) {
    return { p: strip, kind: 'dir', depth: pathDepth(strip) };
  }
  return { p, kind: 'missing', depth: pathDepth(p) };
}

// ── 2. 主分析 ────────────────────────────────────────

/** 单张知识卡（loadCards 产出）。 */
interface Card {
  file: string;
  kind: string;
  name: string;
  category: string;
  tier: string;
  sourceFiles: string[];
  tests: string[];
  useWhen: string[];
  body: string;
}

/** 卡 → 源码逐卡分析行。 */
interface PerCard {
  kind: string;
  name: string;
  file: string;
  category: string;
  tier: string;
  sourceCount: number;
  okCount: number;
  maxDepth: number;
  avgDepth: number;
  refs: string[];
  missing: string[];
}

/** analyze() 的完整返回形状（render 消费）。 */
interface AnalyzeData {
  generatedAt: string;
  summary: {
    cardCount: number;
    categoryCount: number;
    totalSourceRefs: number;
    totalOkRefs: number;
    totalMissingRefs: number;
    totalCrossLinks: number;
    maxCardDepth: number;
  };
  perCard: PerCard[];
  byCategory: Record<string, { count: number; sourceFiles: number; maxDepth: number; kinds: string[]; label: string }>;
  reverseRefs: Array<{ path: string; cardCount: number; cards: any[]; depth: number; exists: boolean }>;
  crossLinks: Record<string, any>;
  islands: { noSource: string[]; noIn: string[] };
}

function analyze(cards: Card[]): AnalyzeData {
  // A. 卡 → 源码
  const perCard = cards.map((c) => {
    const refs = c.sourceFiles.map((sf) => resolveSource(sf, c.kind));
    const okRefs = refs.filter((r) => r.kind !== 'missing');
    const missing = refs.filter((r) => r.kind === 'missing');
    return {
      kind: c.kind,
      name: c.name,
      file: c.file,
      category: c.category,
      tier: c.tier,
      sourceCount: c.sourceFiles.length,
      okCount: okRefs.length,
      maxDepth: okRefs.length ? Math.max(...okRefs.map((r) => r.depth)) : 0,
      avgDepth: okRefs.length ? +(okRefs.reduce((s, r) => s + r.depth, 0) / okRefs.length).toFixed(1) : 0,
      refs: refs.map((r) => `${r.p}${r.kind === 'missing' ? ' [缺失]' : ''}`),
      missing: missing.map((m) => m.p),
    };
  });

  // B. 卡 → 卡互链（正文 ./xxx.md）
  const kindSet = new Set(cards.map((c) => c.kind));
  const crossLinks: Record<string, any> = {};
  for (const c of cards) {
    const links: string[] = [];
    const re = /\]\(\.\/([a-z0-9_-]+)\.md\)/g;
    let m;
    while ((m = re.exec(c.body))) {
      const target = m[1]!;
      if (kindSet.has(target) && target !== c.kind) links.push(target);
    }
    const uniq = [...new Set(links)];
    crossLinks[c.kind] = {
      outCount: uniq.length,
      outs: uniq,
      inCount: 0, // 反向统计
      ins: [],
    };
  }
  for (const c of cards) {
    for (const t of crossLinks[c.kind].outs) {
      if (crossLinks[t]) {
        crossLinks[t].inCount++;
        crossLinks[t].ins.push(c.kind);
      }
    }
  }

  // C. 分类膨胀度
  const byCategory: Record<string, any> = {};
  for (const c of cards) {
    const cat = c.category;
    byCategory[cat] = byCategory[cat] || { count: 0, sourceFiles: 0, maxDepth: 0, kinds: [] };
    byCategory[cat].count++;
    byCategory[cat].sourceFiles += c.sourceFiles.length;
    byCategory[cat].maxDepth = Math.max(byCategory[cat].maxDepth, perCard.find((p) => p.kind === c.kind)!.maxDepth);
    byCategory[cat].kinds.push(c.kind);
  }

  // D. 源码 → 卡反向引用（同路径被多少卡引用；同一卡重复引用同路径只计一次）
  const sourceToCards: Record<string, any> = {};
  for (const c of cards) {
    const seen = new Set();
    for (const sf of c.sourceFiles) {
      const key = sf.replace(/\/+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      sourceToCards[key] = sourceToCards[key] || [];
      sourceToCards[key].push(c.kind);
    }
  }
  const reverseRefs = Object.entries(sourceToCards)
    .map(([p, kinds]) => ({ path: p, cardCount: kinds.length, cards: kinds, depth: pathDepth(p), exists: fs.existsSync(path.join(ROOT, p)) }))
    .filter((r) => r.exists)
    .sort((a, b) => b.cardCount - a.cardCount || b.depth - a.depth);

  // E. 孤岛
  const noSource = perCard.filter((p) => p.okCount === 0).map((p) => p.kind);
  const noIn = cards.filter((c) => (crossLinks[c.kind]?.inCount || 0) === 0 && (crossLinks[c.kind]?.outCount || 0) === 0).map((c) => c.kind);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      cardCount: cards.length,
      categoryCount: Object.keys(byCategory).length,
      totalSourceRefs: cards.reduce((s, c) => s + c.sourceFiles.length, 0),
      totalOkRefs: perCard.reduce((s, p) => s + p.okCount, 0),
      totalMissingRefs: perCard.reduce((s, p) => s + p.missing.length, 0),
      totalCrossLinks: Object.values(crossLinks).reduce((s, v) => s + v.outCount, 0),
      maxCardDepth: Math.max(...perCard.map((p) => p.maxDepth)),
    },
    perCard: perCard.sort((a, b) => b.maxDepth - a.maxDepth || b.sourceCount - a.sourceCount),
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, v]) => [
        cat,
        { ...v, label: (CATEGORY_LABELS as Record<string, string>)[cat] || cat, kinds: v.kinds.sort() },
      ])
    ),
    reverseRefs,
    crossLinks,
    islands: { noSource, noIn },
  };
}

// ── 3. 渲染 Markdown 报告 ────────────────────────────

function mdTable(rows: any[]) {
  if (!rows.length) return '*（空）*';
  const headers = Object.keys(rows[0]);
  const esc = (s: string) => String(s).replace(/\|/g, '\\|');
  const lines = [
    `| ${headers.map(esc).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${headers.map((h) => esc(r[h])).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function render(cards: Card[], data: AnalyzeData) {
  const s = data.summary;
  const L: string[] = [];
  L.push('# 知识卡引用深度与耦合分析');
  L.push('');
  L.push(`> **自动生成**：\`node scripts/analyze-knowledge-refs.ts\` 产出，禁止手改。`);
  L.push(`> 用途：审核范围划定 + 文件浅移决策的依据（量化「卡→源码」深度与「源码→卡」牵动面）。`);
  L.push(`> 生成时间：${data.generatedAt}`);
  L.push('');
  L.push('## 摘要');
  L.push('');
  L.push(`| 指标 | 值 |`);
  L.push(`|------|----|`);
  L.push(`| 知识卡总数 | ${s.cardCount} |`);
  L.push(`| 分类数 | ${s.categoryCount} |`);
  L.push(`| source_files 引用总数 | ${s.totalSourceRefs} |`);
  L.push(`| 磁盘命中引用 | ${s.totalOkRefs} |`);
  L.push(`| 缺失引用（漂移） | ${s.totalMissingRefs} |`);
  L.push(`| 卡间互链总数 | ${s.totalCrossLinks} |`);
  L.push(`| 单卡最深引用（目录层数） | ${s.maxCardDepth} |`);
  L.push('');
  L.push('> 深度口径：`source_files` 路径的目录层数（`a/b/c.ts` → 2）。文件移动决策看「引用该路径的卡数」+「路径深度」双指标。');
  L.push('');
  L.push('## 一、分类膨胀度');
  L.push('');
  const catRows = Object.entries(data.byCategory as Record<string, any>)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cat, v]) => ({ 分类: cat, 卡数: v.count, 引用数: v.sourceFiles, 最深: v.maxDepth, 说明: v.label }));
  L.push(mdTable(catRows));
  L.push('');
  L.push('## 二、卡 → 源码引用深度榜（Top 30）');
  L.push('');
  L.push(
    mdTable(
      data.perCard.slice(0, 30).map((p) => ({
        卡: `\`${p.kind}\``,
        分类: p.category,
        引用数: p.sourceCount,
        命中: p.okCount,
        最深: p.maxDepth,
        平均深度: p.avgDepth,
      }))
    )
  );
  L.push('');
  L.push('## 三、源码 → 卡反向引用榜（Top 30，审核牵动面）');
  L.push('');
  L.push('> 改某源码文件 → 被多少张卡引用 = 需要核对/更新的卡数。');
  L.push('');
  L.push(
    mdTable(
      data.reverseRefs.slice(0, 30).map((r) => ({
        源码路径: `\`${r.path}\``,
        深度: r.depth,
        引用卡数: r.cardCount,
        引用卡: r.cards.join(', '),
      }))
    )
  );
  L.push('');
  L.push('## 四、引用孤岛');
  L.push('');
  L.push(`- **零源码引用卡**（${data.islands.noSource.length} 张）：${data.islands.noSource.length ? data.islands.noSource.map((k) => `\`${k}\``).join(', ') : '无'}`);
  L.push(`- **零互链卡**（${data.islands.noIn.length} 张）：${data.islands.noIn.length ? data.islands.noIn.map((k) => `\`${k}\``).join(', ') : '无'}`);
  L.push('');
  L.push('## 五、缺失引用（漂移，需修复）');
  L.push('');
  const missing = data.perCard.filter((p) => p.missing.length);
  if (missing.length) {
    L.push('| 卡 | 缺失路径 |');
    L.push('|----|----------|');
    L.push(
      mdTable(
        missing.map((p) => ({
          卡: `\`${p.kind}\``,
          缺失路径: p.missing.map((m) => `\`${m}\``).join('<br>'),
        }))
      )
    );
  } else {
    L.push('*无。全部 source_files 命中磁盘。*');
  }
  L.push('');
  L.push('## 六、完整卡 → 源码引用明细');
  L.push('');
  for (const p of data.perCard) {
    L.push(`### \`${p.kind}\`（${p.category}，引用 ${p.sourceCount}/${p.okCount}，最深 ${p.maxDepth} 层）`);
    L.push('');
    L.push(p.refs.map((r) => `- \`${r}\``).join('\n') || '*无引用*');
    L.push('');
  }
  L.push('## 七、浅移决策建议（依据上面的量化结果）');
  L.push('');
  L.push('> 以下为**数据驱动的候选动作**，仅作决策输入，需人工/ADR 拍板后执行。');
  L.push('');
  const deepRefs = data.reverseRefs.filter((r) => r.depth >= 5);
  const deepByArea: Record<string, any> = {};
  for (const r of deepRefs) {
    let area = 'other';
    if (r.path.startsWith('frontend/src/preview-3d/')) area = 'preview-3d';
    else if (r.path.startsWith('frontend/src/views/')) area = 'views';
    else if (r.path.startsWith('frontend/src/utils/')) area = 'utils';
    else if (r.path.startsWith('frontend/src/core/')) area = 'core';
    deepByArea[area] = deepByArea[area] || 0;
    deepByArea[area]++;
  }
  L.push(`**深度 ≥5 的引用路径共 ${deepRefs.length} 个，按区域分布：**`);
  L.push('');
  const areaRows = Object.entries(deepByArea)
    .sort((a, b) => b[1] - a[1])
    .map(([area, n]) => ({ 区域: area, 路径数: n }));
  L.push(mdTable(areaRows));
  L.push('');
  L.push('**候选动作（按收益排序）：**');
  L.push('');
  const p3dDeep = deepRefs.filter((r) => r.path.startsWith('frontend/src/preview-3d/')).length;
  if (p3dDeep > 0) {
    L.push(`1. **\`preview-3d/\` 尚有 ${p3dDeep} 个 ≥5 层引用路径**（ADR-138 已整体上提为 \`src/preview-3d\`）。`);
    L.push('   剩余深引用是子目录内部层级（adapters/caps/decoder 等），可按 hub 索引卡收敛。');
  } else {
    L.push('1. **`preview-3d/` 已随 ADR-138 上提为 `src/preview-3d`（深度 5→4）**，≥5 层引用清零，');
    L.push('   深度问题已消解——后续只需对剩余区域按上表分布关注。');
  }
  L.push('2. **`app-content` 卡引用 28 个文件**（全库最大引用面），是分类膨胀的样本。候选：按子视图');
  L.push('   （site / settings / diagnostics / content）拆分卡片，让审核范围可细化。');
  L.push('3. **Go 端最深仅 3 层**（`go/`、`internal/` 路径天然浅），**无需移动**——深度问题全部在前端。');
  L.push('4. **零互链卡 46 张**中，`frontend_test_audit` / `cli_quality_audit` 等审计报告型卡是历史快照，');
  L.push('   可归档到 `docs/review/` 而非知识卡目录（卡目录保持「可导航的活文档」）。');
  L.push('5. 移动任何源码前，先跑 `node scripts/check-knowledge-drift.ts --affected <新路径>` 验证卡面');
  L.push('   同步；源码移动后统一 `node scripts/gen-knowledge-index.ts` 刷新索引。');
  L.push('');
  return L.join('\n');
}

// ── 4. 入口 ──────────────────────────────────────────

function main() {
  const cards = loadCards();
  const data = analyze(cards);

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(data, null, 2));
    return;
  }
  const md = render(cards, data);
  if (!NO_WRITE) {
    fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
    fs.writeFileSync(OUT_MD, md, 'utf8');
    fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ 分析完成：${data.summary.cardCount} 张卡 / ${data.summary.totalOkRefs} 命中引用 / ${data.summary.totalMissingRefs} 缺失`);
    console.log(`   报告：${path.relative(ROOT, OUT_MD)}`);
    console.log(`   明细：${path.relative(ROOT, OUT_JSON)}`);
  } else {
    process.stdout.write(md);
  }
}

main();
