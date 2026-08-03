#!/usr/bin/env node
/**
 * gen-status-index.mjs — 扫 ADR 首部自动生成 PROJECT_STATUS.md 的「当前进行中 / 近期 ADR」区。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 单一事实来源 = ADR 文件首部（标题/状态/日期）；状态映射与 gen-docs-index.mjs 保持一致。
 * 只重写 `<!-- GEN: active-adr -->` 标记区，其余段落原样保留。
 *
 * 用法：
 *   node scripts/gen-status-index.mjs            # 写入
 *   node scripts/gen-status-index.mjs --check     # 校验是否已同步（不写入）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const STATUS_FILE = path.join(ROOT, 'docs', 'architecture', 'PROJECT_STATUS.md');
const GEN_NAME = 'active-adr';
const CHECK = process.argv.includes('--check');

// ── ADR 解析（与 adr-check.mjs 同款正则）────────────────

function parseAdrs() {
  const files = fs
    .readdirSync(ADR_DIR)
    .filter((f) => /^ADR-\d{3}-.*\.md$/.test(f))
    .sort();
  const list = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ADR_DIR, f), 'utf8');
    const titleM = text.match(/^# ADR-(\d{3})[：:]\s*(.+)$/m);
    const statusM = text.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)$/m);
    const dateM = text.match(/^-\s*\*\*日期\*\*[：:]\s*(.+)$/m);
    if (!titleM) continue;
    list.push({
      num: parseInt(titleM[1], 10),
      title: titleM[2].trim(),
      statusRaw: statusM ? statusM[1].trim() : '',
      date: dateM ? dateM[1].trim() : '',
    });
  }
  return list.sort((a, b) => a.num - b.num);
}

// ── 状态映射（与 gen-docs-index.mjs 一致）────────────────
// 文件首部 → 登记表/status 表统一形态：emoji 前缀 + 保留中文细化（去英文括号注释）。

function mapStatus(raw) {
  const s = raw.trim();
  const tail = (() => {
    const m = s.match(/（([^）]*)）$/);
    if (!m) return '';
    const inner = m[1]
      .split(/[，,]/)
      .map((x) => x.trim())
      .filter((x) => x && !/^[A-Za-z\s]+$/.test(x));
    return inner.length ? `（${inner.join('，')}）` : '';
  })();
  if (/已废弃/.test(s)) return `🧊 已废弃${tail}`;
  if (/已取代/.test(s)) return `❌ 已取代${tail}`;
  if (/部分采纳/.test(s)) return `🔄 部分采纳${tail}`;
  if (/已采纳/.test(s)) {
    if (/违规|不一致|未修复/.test(s)) return `⚠️ 已采纳${tail}`;
    return `✅ 已采纳${tail}`;
  }
  return s;
}

const pad = (n) => String(n).padStart(3, '0');
const escCell = (x) => x.replace(/\|/g, '\\|');

// ── 生成区内容 ─────────────────────────────────────────

function buildSection(list) {
  const done = list.filter((a) => a.statusRaw && /已采纳/.test(a.statusRaw) && !/违规|不一致|未修复/.test(a.statusRaw));
  const pending = list.filter((a) => !done.includes(a));
  // 非「✅ 已采纳」全列 + 最近 2 个已采纳（保「近期」语义），编号倒序
  const rows = [...pending, ...done.slice(-2).reverse()].sort((a, b) => b.num - a.num);

  let out = '| ADR | 主题 | 状态 |\n';
  out += '|-----|------|------|\n';
  for (const a of rows) {
    out += `| ADR-${pad(a.num)} | ${escCell(a.title)} | ${mapStatus(a.statusRaw)} |\n`;
  }

  const inProgress = list.filter((a) => /部分采纳/.test(a.statusRaw)).length;
  const unfixed = list.filter((a) => /违规|不一致|未修复/.test(a.statusRaw)).length;
  const nums = list.map((a) => a.num);
  const gaps = [];
  if (nums.length > 1) {
    for (let i = Math.min(...nums); i <= Math.max(...nums); i++) {
      if (!nums.includes(i)) gaps.push(i);
    }
  }
  out += '\n';
  out += `> 统计：🔄 进行中 ${inProgress} · ⚠️ 遗留未修复 ${unfixed} · ADR 总数 ${list.length}`;
  if (gaps.length) out += `（编号空缺：${gaps.map((n) => `ADR-${pad(n)}`).join(' / ')}）`;
  out += '\n';
  return out;
}

// ── GEN 标记区替换工具 ─────────────────────────────────

function replaceGenRegion(text, name, content) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = `<!-- GEN: ${name} -->`;
  const close = `<!-- /GEN: ${name} -->`;
  const re = new RegExp(esc(open) + '[\\s\\S]*?' + esc(close));
  if (!re.test(text)) return null;
  return text.replace(re, () => `${open}\n${content}${close}`);
}

// ── 主流程 ─────────────────────────────────────────────

function main() {
  if (!fs.existsSync(ADR_DIR)) {
    console.error('[FAIL] docs/adr/ 目录不存在');
    return 1;
  }
  const list = parseAdrs();
  if (!list.length) {
    console.error('[FAIL] adr/ 目录下没有 ADR 文件');
    return 1;
  }
  if (!fs.existsSync(STATUS_FILE)) {
    console.error('[FAIL] PROJECT_STATUS.md 不存在');
    return 1;
  }
  const current = fs.readFileSync(STATUS_FILE, 'utf8');
  const content = buildSection(list);
  const next = replaceGenRegion(current, GEN_NAME, content);
  if (next === null) {
    console.error(`[FAIL] ${STATUS_FILE} 缺少 <!-- GEN: ${GEN_NAME} --> 标记，需一次性插入`);
    return 1;
  }
  if (next === current) {
    console.log('[OK] active-adr 区已是最新');
    return 0;
  }
  if (CHECK) {
    console.error('[FAIL] active-adr 区需要更新', { file: 'docs/architecture/PROJECT_STATUS.md' });
    return 1;
  }
  fs.writeFileSync(STATUS_FILE, next, 'utf8');
  console.log(`[OK] 已更新 PROJECT_STATUS.md 的 ${GEN_NAME} 区`);
  return 0;
}

process.exit(main());
