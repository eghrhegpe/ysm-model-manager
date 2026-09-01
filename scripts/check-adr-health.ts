#!/usr/bin/env node
/**
 * check-adr-health.ts — ADR 状态机 / 登记表同步 / 技术债审计。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 三块检查：
 *   [状态机 status]   文件内 `- **状态**：` 值域合法性（四态归一化）
 *                     已采纳 / 部分采纳 / 已废弃 / 已取代（中英混写均识别）
 *                     非法值 → ERROR
 *   [登记同步 health] 文件状态 vs adr/index.md 登记表状态归一化比对
 *                     不一致 → ERROR
 *   [技术债 debt]     识别「违规未修复 / 不一致未修复 / 部分采纳·进行中」
 *                     输出债清单（ADR | 标题 | 债类型 | 严重度 P1/P2/P3）
 *
 * 用法：
 *   node scripts/check-adr-health.ts              # 全量（默认）
 *   node scripts/check-adr-health.ts --status     # 仅状态机
 *   node scripts/check-adr-health.ts --health     # 仅登记同步
 *   node scripts/check-adr-health.ts --debt       # 仅技术债
 *   node scripts/check-adr-health.ts --json       # JSON（CI 用）
 *
 * 退出码：发现 ERROR → 1；否则 0（技术债为审计报告，不阻断）。
 * 设计意图：ADR 健康综合检查（状态/债务/格式/关联/连续性）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { parseAdrHeader } from './_lib/frontmatter.ts';
import { normalizeState, STATE_LABEL } from './_lib/adr-status-categories.ts';

const ADR_DIR = path.join(ROOT, 'docs/adr');
const REG_FILE = path.join(ADR_DIR, 'index.md'); // 登记表已并入 index

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const ONLY = ['--status', '--health', '--debt'].find((f) => ARGS.has(f)) || null;

const errors: any[] = [];
const warns: any[] = [];
const debts: any[] = [];
const statusRows: any[] = [];

// ── 技术债提取 ────────────────────────────────────────

/** 从状态字符串提取债类型与严重度。 */
function extractDebt(adr: number, title: string, raw: string) {
  const debtType: string[] = [];
  // 兼容「违规未修复」与 AGENTS.md 措辞「违规或未修复」（含「或」，code_review P2-2）
  if (/违规未修复|违规或未修复/.test(raw)) debtType.push('违规未修复');
  if (/不一致未修复|不一致，未修复|不一致,未修复|不一致或未修复/.test(raw)) debtType.push('不一致未修复');
  if (/部分采纳/.test(raw)) {
    if (/进行中|未完成|P2\/P3|P3/.test(raw)) debtType.push('部分采纳·进行中');
    else debtType.push('部分采纳');
  }
  if (/待办|TODO|未落地/.test(raw)) debtType.push('待办');

  for (const t of debtType) {
    let severity = 'P3';
    if (t === '违规未修复' || t === '不一致未修复') severity = 'P2';
    if (t === '待办') severity = 'P1';
    debts.push({ adr: `ADR-${String(adr).padStart(3, '0')}`, title, type: t, severity });
  }
}

// ── 检查 1：状态机 ────────────────────────────────────

// [ADR-114 §被补充] 状态解析统一走共享库 parseAdrHeader（_lib/frontmatter.ts）
// + normalizeState（_lib/adr-status-categories.ts），不再各写一套正则口径。

function checkStatus() {
  if (!fs.existsSync(ADR_DIR)) {
    errors.push('[状态机] docs/adr/ 目录不存在');
    return [];
  }
  const files = fs.readdirSync(ADR_DIR).filter((f) => /^ADR-\d{3}-.*\.md$/.test(f)).sort();
  const out: any[] = [];
  for (const f of files) {
    const hdr = parseAdrHeader(path.join(ADR_DIR, f)) as any;
    if (hdr.error) {
      // P2-4 修复（code_review）：缺标题/缺状态 ADR 不再静默跳过——该 ADR 完全不进 health 判定=假绿。
      // 口径与 check-doc-drift 一致。
      errors.push(`[状态机] ${f} 首部解析失败（${hdr.error}）`);
      continue;
    }
    const { num, title, status: raw } = hdr;
    const { key } = normalizeState(raw);
    const statusMissing = !raw || raw === '(未标注状态)';

    if (statusMissing) warns.push(`[状态机] ${f} 缺少 '- **状态**：' 字段`);
    else if (key === 'unknown') errors.push(`[状态机] ${f} 状态值非法: 「${raw}」（应为 已采纳/部分采纳/已废弃/已取代 之一）`);

    extractDebt(num, title, raw);
    out.push({ file: f, num, title, raw, key });
  }
  return out;
}

// ── 检查 2：登记表同步 ────────────────────────────────

function checkRegistry(statusRowsMap: Record<string, any>) {
  let regText = '';
  try {
    regText = fs.readFileSync(REG_FILE, 'utf-8');
  } catch {
    errors.push('[登记同步] adr/index.md 登记表不存在');
    return;
  }
  const regMap: Record<string, any> = {};
  for (const m of regText.matchAll(/^\|\s*ADR-(\d{3})\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm)) {
    regMap[parseInt(m[1]!, 10)] = { title: m[2]!.trim(), raw: m[3]!.trim() };
  }
  for (const [num, reg] of Object.entries(regMap)) {
    const file = statusRowsMap[num];
    if (!file) continue; // 幽灵由 adr-check 管
    const { key: fileKey } = normalizeState(file.raw);
    const { key: regKey } = normalizeState(reg.raw);
    if (fileKey === 'unknown') continue; // 文件状态非法已由状态机报
    if (fileKey !== regKey) {
      errors.push(`[登记同步] ADR-${num} 状态不一致：文件「${STATE_LABEL[fileKey]}」vs 登记表「${STATE_LABEL[regKey]}」`);
    }
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  const rows = checkStatus();
  const statusRowsMap = Object.fromEntries(rows.map((r) => [r.num, r]));

  if (!ONLY || ONLY === '--health') checkRegistry(statusRowsMap);

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { errors: errors.length, warns: warns.length, debts: debts.length }, errors, warns, debts, statusRows: rows.map((r) => ({ adr: `ADR-${String(r.num).padStart(3, '0')}`, status: r.raw, state: r.key })) }, null, 2));
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' ADR 健康审计 (check-adr-health)');
  console.log('══════════════════════════════════════');
  console.log(`ERROR   : ${errors.length}`);
  console.log(`WARN    : ${warns.length}`);
  console.log(`技术债   : ${debts.length} 笔`);
  console.log('──────────────────────────────────────');

  if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);

  if (!ONLY || ONLY === '--status') {
    console.log('\n【状态机】');
    for (const r of rows) {
      console.log(`  ${STATE_LABEL[r.key]}  ADR-${String(r.num).padStart(3, '0')} ${r.title}  (${r.raw})`);
    }
  }

  if (!ONLY || ONLY === '--debt') {
    console.log('\n【技术债清单】');
    if (!debts.length) {
      console.log('  ✅ 无技术债');
    } else {
      console.log('  ADR        | 严重度 | 债类型          | 标题');
      console.log('  -----------|--------|-----------------|------');
      for (const d of debts.sort((a, b) => a.adr.localeCompare(b.adr))) {
        console.log(`  ${d.adr}  | ${d.severity.padEnd(6)} | ${d.type.padEnd(15)} | ${d.title}`);
      }
      const p1 = debts.filter((d) => d.severity === 'P1').length;
      const p2 = debts.filter((d) => d.severity === 'P2').length;
      const p3 = debts.filter((d) => d.severity === 'P3').length;
      console.log(`  （P1=${p1} P2=${p2} P3=${p3}）`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.log(`\n❌ ${e}`);
    console.log('→ 修复: 调整 ADR 文件状态标记与登记表一致，或运行 node scripts/new-adr.ts 更新登记表');
    console.log('\n退出码 1（可接 CI 卡点）。');
    process.exit(1);
  }
  console.log('\n✅ ADR 状态机与登记表同步一致。');
}

main();
