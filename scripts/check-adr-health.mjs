#!/usr/bin/env node
/**
 * check-adr-health.mjs — ADR 状态机 / 登记表同步 / 技术债审计。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 三块检查：
 *   [状态机 status]   文件内 `- **状态**：` 值域合法性（四态归一化）
 *                     已采纳 / 部分采纳 / 已废弃 / 已取代（中英混写均识别）
 *                     非法值 → ERROR
 *   [登记同步 health] 文件状态 vs adr/README.md 登记表状态归一化比对
 *                     不一致 → ERROR
 *   [技术债 debt]     识别「违规未修复 / 不一致未修复 / 部分采纳·进行中」
 *                     输出债清单（ADR | 标题 | 债类型 | 严重度 P1/P2/P3）
 *
 * 用法：
 *   node scripts/check-adr-health.mjs              # 全量（默认）
 *   node scripts/check-adr-health.mjs --status     # 仅状态机
 *   node scripts/check-adr-health.mjs --health     # 仅登记同步
 *   node scripts/check-adr-health.mjs --debt       # 仅技术债
 *   node scripts/check-adr-health.mjs --json       # JSON（CI 用）
 *
 * 退出码：发现 ERROR → 1；否则 0（技术债为审计报告，不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(ROOT, 'docs/adr');
const REG_FILE = path.join(ADR_DIR, 'README.md');

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const ONLY = ['--status', '--health', '--debt'].find((f) => ARGS.has(f)) || null;

const errors = [];
const warns = [];
const debts = [];
const statusRows = [];

// ── 状态归一化 ────────────────────────────────────────

const STATE_ALIASES = {
  accepted: ['已采纳', '采纳', 'Accepted', 'accepted', '✅'],
  partial: ['部分采纳', '部分', 'Partially Accepted', 'partially', '🔄'],
  deprecated: ['已废弃', '废弃', 'Deprecated', 'deprecated', '🧊'],
  superseded: ['已取代', '取代', 'Superseded', 'superseded', '❌'],
};

function normalizeState(raw) {
  if (!raw) return { key: 'unknown', raw: '(未标注状态)' };
  // 精确优先：'Partially Accepted' 含子串 'Accepted'，必须先判 partial 防误抢
  if (/Partially Accepted|部分采纳|🔄/.test(raw)) return { key: 'partial', raw: raw.trim() };
  if (/Deprecated|已废弃|🧊/.test(raw)) return { key: 'deprecated', raw: raw.trim() };
  if (/Superseded|已取代/.test(raw)) return { key: 'superseded', raw: raw.trim() };
  if (/Accepted|已采纳|✅/.test(raw)) return { key: 'accepted', raw: raw.trim() };
  return { key: 'unknown', raw: raw.trim() };
}

const STATE_LABEL = { accepted: '✅ 已采纳', partial: '🔄 部分采纳', deprecated: '🧊 已废弃', superseded: '❌ 已取代', unknown: '❓ 未知' };

// ── 技术债提取 ────────────────────────────────────────

/** 从状态字符串提取债类型与严重度。 */
function extractDebt(adr, title, raw) {
  const debtType = [];
  if (/违规未修复/.test(raw)) debtType.push('违规未修复');
  if (/不一致未修复|不一致，未修复|不一致,未修复/.test(raw)) debtType.push('不一致未修复');
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

function checkStatus() {
  if (!fs.existsSync(ADR_DIR)) {
    errors.push('[状态机] docs/adr/ 目录不存在');
    return [];
  }
  const files = fs.readdirSync(ADR_DIR).filter((f) => /^ADR-\d{3}-.*\.md$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ADR_DIR, f), 'utf-8');
    const numM = text.match(/^# ADR-(\d{3})[：:]\s*(.+)$/m);
    if (!numM) continue;
    const num = parseInt(numM[1], 10);
    const title = numM[2].trim();
    const statusM = text.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)$/m);
    const raw = statusM ? statusM[1].trim() : '(未标注状态)';
    const { key } = normalizeState(raw);

    if (!statusM) warns.push(`[状态机] ${f} 缺少 '- **状态**：' 字段`);
    else if (key === 'unknown') errors.push(`[状态机] ${f} 状态值非法: 「${raw}」（应为 已采纳/部分采纳/已废弃/已取代 之一）`);

    extractDebt(num, title, raw);
    out.push({ file: f, num, title, raw, key });
  }
  return out;
}

// ── 检查 2：登记表同步 ────────────────────────────────

function checkRegistry(statusRowsMap) {
  let regText = '';
  try {
    regText = fs.readFileSync(REG_FILE, 'utf-8');
  } catch {
    errors.push('[登记同步] adr/README.md 登记表不存在');
    return;
  }
  const regMap = {};
  for (const m of regText.matchAll(/^\|\s*ADR-(\d{3})\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm)) {
    regMap[parseInt(m[1], 10)] = { title: m[2].trim(), raw: m[3].trim() };
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
    console.log('\n退出码 1（可接 CI 卡点）。');
    process.exit(1);
  }
  console.log('\n✅ ADR 状态机与登记表同步一致。');
}

main();
