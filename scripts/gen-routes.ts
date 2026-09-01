#!/usr/bin/env node
/**
 * gen-routes.ts — AI 知识库路由表自动生成器（适配自 MikuMikuAR，ADR-114 §被补充）。
 *
 * 从知识卡 frontmatter 的 `use_when` 字段生成「意图 → 首选卡 → 关联阅读」路由表，
 * 替代手工维护的 AGENTS.md 路由指南。
 *
 * 背景：AGENTS.md 手维护路由指南，新增子系统易遗漏。
 * 知识卡 `use_when` 字段覆盖率 100%，是天然的路由数据源：
 *   - 首选卡 = 卡片本身（use_when 关键词 → 本卡）
 *   - 关联阅读 = 共享 ADR 的关联卡（与 graph 同一数据源，全自动推导）
 *
 * YSM 适配说明：
 *   - YSM 知识卡 frontmatter 使用 `kind` + `name` + `use_when` + `category` + `tier`
 *   - 仅 architecture 卡有 use_when，leaf 卡不参与路由（工具函数/桩不需 AI 路由）
 *   - 共享 ADR 关联阅读在 YSM 暂不产出（多数卡暂无 adr: 字段，见 gen-knowledge-adr.ts）
 *   - 未来补全 adr: 后本脚本自动激活关联推荐
 *
 * 用法：
 *   node scripts/gen-routes.ts            # 写入 docs/knowledge/routes.md
 *   node scripts/gen-routes.ts --check    # 只校验不写入（CI）
 *   node scripts/gen-routes.ts --json     # JSON 摘要（pre-push-gate runTools 契约，--check 可组合）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：路由表生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.ts';
import { parseFrontmatter, getScalar, getList } from './_lib/frontmatter.ts';
// [ADR-114 §被补充] 常量共享层
import { KNOWLEDGE_NON_CARDS as NON_CARDS, KNOW_DIR } from './_lib/knowledge-cards.ts';

const OUT_PATH = path.join(KNOW_DIR, 'routes.md');

const BANNER =
  '<!-- 本文件由 scripts/gen-routes.ts 自动生成，请勿手改。重跑：node scripts/gen-routes.ts -->';

/** 提取 frontmatter 单字段（收口共享 getScalar：剥 # 注释、<...> 占位符返回 undefined）。 */
function fm(text: string, key: string) {
  return getScalar(parseFrontmatter(text), key);
}

/** 提取 frontmatter 列表字段（收口共享 getList，兼容单行与块列表）。 */
function fmList(text: string, key: string) {
  return getList(parseFrontmatter(text), key);
}

/** 单元格转义。 */
function cell(s: string) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** 提取 frontmatter 里的 ADR 引用编号（adr: 列表 → [138, 148]）。 */
function adrNumbers(text: string) {
  return fmList(text, 'adr')
    .map((a) => (String(a).match(/ADR-(\d+)/i) || [])[1])
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** 提取 `## 概览` 段落作为摘要（同 gen-knowledge-index 的 extractSummary，精简版）。 */
function extractSummary(text: string) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const m = body.match(/^##\s+概览\s*\n([\s\S]*?)(?=^##\s+|$)/m);
  if (!m) return '';
  const summary = m[1].replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  if (summary.length <= 120) return summary;
  return Array.from(summary).slice(0, 120).join('') + '…';
}

function renderRoutes(cards: Array<{ file: string; name: string; useWhen: string[]; adrs: number[]; summary: string }>, kwToCards: Map<string, any[]>) {
  const out: string[] = [];
  out.push(BANNER);
  out.push('');
  out.push('# AI 知识库路由表');
  out.push('');
  out.push(
    '本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/` 或 `go/`。'
  );
  out.push('');
  out.push('> 由 `scripts/gen-routes.ts` 自动生成：首选卡按卡片 `use_when` 关键词命中，摘要提供快速上下文。');
  out.push('> 更新后重新生成：`node scripts/gen-routes.ts`。');
  out.push('');
  out.push('> ⚠️ **歧义标注**：行内出现「⚠️歧义（另见…）」表示该意图关键词被多张卡共享——AI 需按上下文择层，仍不确定则参考本表生成时的 WARN 冲突清单消歧。');
  out.push('');
  out.push('## 路由规则');
  out.push('');
  out.push('| 用户意图或关键词 | 首选知识卡 | 摘要 |');
  out.push('|---|---|---|');
  for (const c of cards) {
    const keywords = c.useWhen.join('、');
    let primary = `[${cell(c.name)}](./${c.file})`;
    // 歧义词行内标注（2026-08-31 审计）：同词被 ≥2 卡共享时列出其他候选卡，
    // 避免 AI 按表直选错层（如「3D 预览」→ 5 卡、「网页版」→ 3 卡）。
    const ambiguous = c.useWhen.filter((kw) => (kwToCards.get(kw) || []).length > 1);
    if (ambiguous.length) {
      const cands = [...new Set(
        ambiguous.flatMap((kw) => (kwToCards.get(kw) || []).map((x) => x.file).filter((f) => f !== c.file))
      )].slice(0, 3);
      const more = ambiguous.flatMap((kw) => (kwToCards.get(kw) || []).map((x) => x.file)).filter((f) => f !== c.file).length > cands.length ? '等' : '';
      primary += ` ⚠️歧义（另见 ${cands.join('、')}${more}）`;
    }
    const summary = c.summary ? cell(c.summary) : '—';
    out.push(`| ${cell(keywords)} | ${primary} | ${summary} |`);
  }
  out.push('');
  out.push('## 标准执行模板');
  out.push('');
  out.push('```text');
  out.push('先按 docs/knowledge/routes.md 判断首选知识卡。');
  out.push('读取 docs/knowledge/AGENTS.md 和首选卡片，再按 source_files 阅读源码。');
  out.push('grep docs/adr/ 查找相关决策和状态。');
  out.push('以源码为最终事实来源；如果卡片过时，先报告漂移，再决定是否同步更新。');
  out.push('修改后运行最小相关测试和 node scripts/doctor.ts --docs。');
  out.push('```');
  out.push('');
  out.push('## 维护规则');
  out.push('');
  out.push('- 本文件自动生成，**请勿手改**；重跑 `node scripts/gen-routes.ts` 重新生成。');
  out.push('- 新增/修改知识卡：更新 frontmatter 的 `use_when`（意图关键词）后重跑即可自动入列。');
  out.push('- `use_when` 为空或不含关键词的卡不会出现在路由表（但仍可经索引/关联图抵达）。');
  out.push('- 表外分类（`category` 非 core/go/ui/feature/utils/config）的卡仍按 use_when 参与路由。');
  out.push('');
  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check', 'json'],
    strings: [],
    defaults: {},
  });
  const JSON_OUT = args.json;
  if (args.help) {
    const _src = fs.readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (args.unknown && args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }
  const isCheck = args.check;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 收集 architecture 卡 + use_when + adr + 摘要
  const cards: Array<{ file: string; name: string; useWhen: string[]; adrs: number[]; summary: string }> = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    if (!parseFrontmatter(text)) continue;
    const tier = fm(text, 'tier');
    if (tier !== 'architecture') continue;
    cards.push({
      file: f,
      name: fm(text, 'name') || f.replace(/\.md$/, ''),
      useWhen: fmList(text, 'use_when'),
      adrs: adrNumbers(text),
      summary: extractSummary(text),
    });
  }
  // 只保留有 use_when 关键词的卡
  const routable = cards.filter((c) => c.useWhen.length > 0);

  // 2. 按文件名排序（稳定输出）
  routable.sort((a, b) => a.file.localeCompare(b.file));

  // 3. use_when 关键词冲突检测：同一关键词被 ≥2 张卡使用时，AI 路由有歧义，告警提示消歧
  const kwToCards = new Map();
  for (const c of routable) {
    for (const kw of c.useWhen) {
      if (!kwToCards.has(kw)) kwToCards.set(kw, []);
      kwToCards.get(kw).push(c);
    }
  }
  const conflicts = [...kwToCards.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (conflicts.length) {
    console.warn(`⚠️  ${conflicts.length} 个 use_when 关键词被多张卡共用（路由有歧义，建议人工消歧）:`);
    for (const [kw, list] of conflicts.slice(0, 15)) {
      console.warn(`   - 「${kw}」→ ${list.map((c: any) => c.file).join(', ')}`);
    }
    if (conflicts.length > 15) console.warn(`   … 其余 ${conflicts.length - 15} 个省略`);
  } else {
    console.log('✅ use_when 关键词无冲突');
  }

  const output = renderRoutes(routable, kwToCards);
  console.error(`📄 ${routable.length} 张 architecture 卡可路由（${cards.length - routable.length} 张无 use_when 关键词）`);

  const summary = (ok: boolean, check: boolean, generated: boolean) =>
    JSON.stringify({ ok, check, generated, count: routable.length, conflicts: conflicts.length, cards: routable.map((c) => c.file) });

  if (isCheck) {
    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
    const synced = existing === output;
    if (JSON_OUT) {
      console.log(summary(synced, true, false));
    } else if (synced) {
      console.log(`✅ ${OUT_PATH} 已同步`);
    } else {
      console.error(`❌ ${OUT_PATH} 未同步，请运行：node scripts/gen-routes.ts`);
    }
    process.exit(synced ? 0 : 1);
  }

  fs.writeFileSync(OUT_PATH, output);
  if (JSON_OUT) {
    console.log(summary(true, false, true));
  } else {
    console.log(`✅ 已写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  }
}

main();