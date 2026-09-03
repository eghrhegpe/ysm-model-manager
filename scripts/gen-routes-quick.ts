#!/usr/bin/env node
/**
 * gen-routes-quick.ts — AI 急速版路由表自动生成器（ADR-114 §急速表）。
 *
 * 从知识卡 frontmatter 的 quick_groups / quick_intents / quick_risk_lines / pitfalls
 * 字段生成 docs/knowledge/routes-quick.md，替代手工维护版。
 *
 * 输入（知识卡 frontmatter，全部可选；缺字段视为该卡不参与急速表）:
 *   quick_groups:     场景分组名（值即分组标题；与 quick_intents 循环配对）
 *   quick_intents:    用户意图关键词（每行一个，与 quick_groups 循环配对：
 *                     意图多于分组时并入最后分组，分组多于意图时多余分组不输出；
 *                     配对不均恒打 WARN，绝不静默丢弃——2026-08-31 审计修复）
 *   quick_risk_lines: 红线警告（按索引与 quick_intents 配对；缺省则该行红线填 -）
 *   pitfalls:         陷阱列表，格式 "「位置」描述 → 正确做法"（如无前缀则整段作陷阱描述）
 *
 * 输出分组:
 *   - 按 quick_groups 值分组，组内按 quick_intents 排序（稳定）
 *   - pitfalls 独立汇总到「高频陷阱速查」段
 *   - 关联 ADR 取自卡片的 adr: 字段；无则填 -
 *   - 仅处理 tier: architecture 且带 quick_groups 的卡
 *
 * 用法:
 *   node scripts/gen-routes-quick.ts            # 写入 docs/knowledge/routes-quick.md
 *   node scripts/gen-routes-quick.ts --check    # 只校验不写入，不同则 exit 1（CI 用）
 *   node scripts/gen-routes-quick.ts --json     # JSON 摘要（pre-push-gate runTools 契约，--check 可组合）
 *   node scripts/gen-routes-quick.ts --help     # 用法说明
 *
 * 零依赖（仅 node:fs / node:path）。
 * 退出码: 0 成功, 1 失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.ts';
import { parseFrontmatter, getScalar, getList } from './_lib/frontmatter.ts';
import { KNOW_DIR, KNOWLEDGE_NON_CARDS } from './_lib/knowledge-cards.ts';

const OUT_PATH = path.join(KNOW_DIR, 'routes-quick.md');
const BANNER =
  '<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->';
const END_MARK = '<!--  END_GENERATED_SECTION -->';

function fm(text: string, key: string) { return getScalar(parseFrontmatter(text), key); }
function fmList(text: string, key: string) { return getList(parseFrontmatter(text), key); }
function cell(s: string) { return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim(); }

/** 卡片 adr: 字段 → ADR-XXX 字符串；无则 -。 */
function adrLabel(text: string) {
  const adrs = fmList(text, 'adr').map((a) => String(a)).filter((a) => /ADR-\d+/i.test(a));
  return adrs.length ? adrs.join(', ') : '-';
}

/** 解析单条 pitfalls 记录: "「位置」描述 → 正确做法" → { trap, pos, fix }。 */
function parsePitfall(raw: string) {
  const s = String(raw).trim();
  const arrow = s.indexOf(' → ');
  const left = arrow === -1 ? s : s.slice(0, arrow);
  const right = arrow === -1 ? '-' : s.slice(arrow + 3).trim();
  const pos = (left.match(/「(.+?)」/) || [])[1]
    || (left.match(/`(.+?)`/) || [])[1];
  let trap = left
    .replace(/「[^」]+」/, '')
    .replace(/`[^`]+`/, '')
    .replace(/\s+→\s*$/, '')
    .trim();
  if (!trap) trap = pos || '-';
  return { trap, pos: pos ? `\`${pos}\`` : '-', fix: cell(right) };
}

function render(cards: Array<{ file: string; name: string; groups: string[]; intents: string[]; risks: string[]; adr: string; pitfalls: string[] }>) {
  const rows: Array<{ group: string; intent: string; risk: string; adr: string; card: any }> = [];
  // 意图 ↔ 分组循环配对（2026-08-31 审计修复）：
  // 旧实现 Math.min(groups, intents) 仅按索引配对，go-scanner 1 组 5 意图只出 1 行、
  // preview_core 1 组 4 意图只出 1 行——其余意图静默丢弃、零警告（routes-quick 覆盖空转）。
  // 新语义：意图多于分组 → 多余意图并入最后分组（保意图不丢）；分组多于意图 → 多余分组不输出。
  // 两种不均都打 WARN，让 AI/人工立即看到配对异常。
  for (const c of cards) {
    const gLen = c.groups.length;
    const iLen = c.intents.length;
    // 降噪（2026-09-03）：单分组多意图（占全库 90/97 张）属正常形态，不再鸣笛；
    // 仅「分组≥2 且意图>分组」（疑似漏写分组名）或「分组>意图」（悬空分组）才 WARN，
    // 让真正的配对异常可见。输出逻辑不变，生成物字节级一致 → CI/doctor 零漂移。
    if (gLen >= 2 && iLen > gLen) {
      console.warn(`⚠️  ${c.file}: ${iLen} 条意图 > ${gLen} 个分组，疑似漏写分组名，多余 ${iLen - gLen} 条并入最后分组「${c.groups[gLen - 1]}」`);
    } else if (gLen > iLen) {
      const extra = c.groups.slice(iLen);
      console.warn(`⚠️  ${c.file}: ${gLen} 个分组 > ${iLen} 条意图，多余分组不输出（悬空分组）: ${extra.join('、')}`);
    }
    for (let i = 0; i < iLen; i++) {
      rows.push({
        group: c.groups[Math.min(i, gLen - 1)]!,
        intent: c.intents[i]!,
        risk: c.risks.length > i ? c.risks[i]! : '-',
        adr: c.adr,
        card: c,
      });
    }
  }
  const pitfalls = cards.flatMap((c) => c.pitfalls.map((p) => parsePitfall(p)));

  // 按 group 值分组（保留首次出现顺序），组内按 intent 排序
  const groupOrder: string[] = [];
  const groupMap = new Map();
  for (const r of rows) {
    if (!groupMap.has(r.group)) { groupOrder.push(r.group); groupMap.set(r.group, []); }
    groupMap.get(r.group).push(r);
  }
  for (const g of groupOrder) {
    groupMap.get(g).sort((a: any, b: any) => a.intent.localeCompare(b.intent, 'zh-CN'));
  }

  const out: string[] = [];
  out.push(BANNER, '', '# AI 急速版路由表（高频场景）', '');
  out.push('> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。');
  out.push('> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`。');
  out.push('');

  for (const g of groupOrder) {
    const rs = groupMap.get(g);
    out.push(`## 🎯 ${g}`, '', '| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |', '|----------|--------|----------|----------|');
    for (const r of rs) {
      const primary = `[${cell(r.card.name)}](./${r.card.file})`;
      const risk = r.risk === '-' ? '-' : cell(r.risk);
      out.push(`| ${cell(r.intent)} | ${primary} | ${risk} | ${cell(r.adr)} |`);
    }
    out.push('');
  }

  if (pitfalls.length) {
    out.push('## 🚨 高频陷阱速查', '', '| 陷阱 | 位置 | 正确做法 |', '|------|------|----------|');
    for (const p of pitfalls) out.push(`| ${cell(p.trap)} | ${cell(p.pos)} | ${p.fix} |`);
    out.push('');
  }

  out.push('---', END_MARK);
  return out.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2), { bools: ['check', 'json'], strings: [], defaults: {} });
  const JSON_OUT = args.json;
  if (args.help) {
    const src = fs.readFileSync(process.argv[1]!, 'utf-8');
    const s = src.indexOf('/**'), e = src.indexOf('*/', s);
    console.log(src.slice(s, e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }
  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  const cards: Array<{ file: string; name: string; groups: string[]; intents: string[]; risks: string[]; adr: string; pitfalls: string[] }> = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (KNOWLEDGE_NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    if (!parseFrontmatter(text)) continue;
    if (fm(text, 'tier') !== 'architecture') continue;
    const groups = fmList(text, 'quick_groups');
    if (!groups.length) continue;
    cards.push({
      file: f,
      name: fm(text, 'name') || f.replace(/\.md$/, ''),
      groups,
      intents: fmList(text, 'quick_intents'),
      risks: fmList(text, 'quick_risk_lines'),
      adr: adrLabel(text),
      pitfalls: fmList(text, 'pitfalls'),
    });
  }
  cards.sort((a, b) => a.file.localeCompare(b.file));

  const output = render(cards);
  const total = cards.reduce((s, c) => s + c.intents.length, 0);
  const pitCount = cards.reduce((s, c) => s + c.pitfalls.length, 0);
  console.error(`📄 ${cards.length} 张卡带 quick_groups，${total} 条高频意图，${pitCount} 条陷阱`);

  const summary = (ok: boolean, check: boolean, generated: boolean) =>
    JSON.stringify({ ok, check, generated, count: total, intents: total, pitfalls: pitCount, cards: cards.map((c) => c.file) });

  if (args.check) {
    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
    const synced = existing === output;
    if (JSON_OUT) {
      console.log(summary(synced, true, false));
    } else if (synced) {
      console.log(`✅ ${OUT_PATH} 已同步`);
    } else {
      console.error(`❌ ${OUT_PATH} 未同步，请运行: node scripts/gen-routes-quick.ts`);
    }
    process.exit(synced ? 0 : 1);
  }

  const tmp = OUT_PATH + '.tmp';
  fs.writeFileSync(tmp, output);
  fs.renameSync(tmp, OUT_PATH);
  if (JSON_OUT) {
    console.log(summary(true, false, true));
  } else {
    console.log(`✅ 已写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  }
}

main();
