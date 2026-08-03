#!/usr/bin/env node
/**
 * gen-docs-index.mjs — 分区索引自动生成（adr / knowledge / releases）。
 *
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process）。
 * 只重写各文件 `<!-- GEN: xxx -->` 标记区，人工段落原样保留：
 *   - adr      → docs/architecture/adr/README.md 的 adr-registry（登记表）+ adr-stats（状态统计）
 *   - releases → docs/release-notes/README.md 的 releases-index（最近版本 + 版本全览）
 *   - knowledge→ 委托 gen-knowledge-index.mjs --check（不重写，避免双生成器打架）
 * 单一事实来源 = ADR 文件首部；状态映射与 gen-status-index.mjs 保持一致。
 *
 * 用法：
 *   node scripts/gen-docs-index.mjs                # 全分区写入
 *   node scripts/gen-docs-index.mjs --adr          # 只跑 adr
 *   node scripts/gen-docs-index.mjs --releases     # 只跑 releases
 *   node scripts/gen-docs-index.mjs --knowledge    # 只校验 knowledge 漂移
 *   node scripts/gen-docs-index.mjs --check        # 全分区只校验不写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = path.join(ROOT, 'docs', 'architecture', 'adr');
const ADR_REG_FILE = path.join(ADR_DIR, 'README.md');
const RELEASE_DIR = path.join(ROOT, 'docs', 'release-notes');
const RELEASE_FILE = path.join(RELEASE_DIR, 'README.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const want = (flag) => args.includes(`--${flag}`);
const ONLY = args.some((a) => a.startsWith('--') && ['--adr', '--releases', '--knowledge'].includes(a));
const RUN_ADR = !ONLY || want('adr');
const RUN_RELEASES = !ONLY || want('releases');
const RUN_KNOWLEDGE = !ONLY || want('knowledge');

// ── 共享工具 ────────────────────────────────────────────

const escCell = (x) => x.replace(/\|/g, '\\|');
const pad = (n) => String(n).padStart(3, '0');

function replaceGenRegion(text, name, content) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = `<!-- GEN: ${name} -->`;
  const close = `<!-- /GEN: ${name} -->`;
  const re = new RegExp(esc(open) + '[\\s\\S]*?' + esc(close));
  if (!re.test(text)) return null;
  return text.replace(re, () => `${open}\n${content}${close}`);
}

/** 写入或校验单个文件的一个 GEN 区。返回 {ok, changed}。 */
function applyRegion(file, name, content) {
  if (!fs.existsSync(file)) {
    console.error(`[FAIL] ${path.relative(ROOT, file)} 不存在`);
    return { ok: false, changed: false };
  }
  const current = fs.readFileSync(file, 'utf8');
  const next = replaceGenRegion(current, name, content);
  if (next === null) {
    console.error(`[FAIL] ${path.relative(ROOT, file)} 缺少 <!-- GEN: ${name} --> 标记，需一次性插入`);
    return { ok: false, changed: false };
  }
  if (next === current) return { ok: true, changed: false };
  if (CHECK) {
    console.error(`[FAIL] ${name} 区需要更新（${path.relative(ROOT, file)}）`);
    return { ok: false, changed: false };
  }
  fs.writeFileSync(file, next, 'utf8');
  return { ok: true, changed: true };
}

// ── ADR 解析与状态映射（与 gen-status-index.mjs 一致）──

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
      date: dateM ? dateM[1].trim() : '-',
    });
  }
  return list.sort((a, b) => a.num - b.num);
}

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

// ── adr 分区：登记表 + 状态统计 ────────────────────────

function buildAdrRegistry(list) {
  let out = '| 编号 | 标题 | 状态 | 日期 |\n';
  out += '|------|------|------|------|\n';
  for (const a of list) {
    out += `| ADR-${pad(a.num)} | ${escCell(a.title)} | ${mapStatus(a.statusRaw)} | ${escCell(a.date)} |\n`;
  }
  return out;
}

function buildAdrStats(list) {
  const groups = { accepted: [], partial: [], unfixed: [], deprecated: [], replaced: [] };
  for (const a of list) {
    const st = mapStatus(a.statusRaw);
    if (st.startsWith('🔄')) groups.partial.push(a);
    else if (st.startsWith('🧊')) groups.deprecated.push(a);
    else if (st.startsWith('❌')) groups.replaced.push(a);
    else if (st.startsWith('⚠️')) groups.unfixed.push(a);
    else groups.accepted.push(a);
  }
  const fmt = (arr) => (arr.length ? `（${arr.map((a) => `ADR-${pad(a.num)}`).join(' / ')}）` : '');
  let out = '';
  out += `- ✅ 已采纳：${groups.accepted.length} 篇${fmt(groups.accepted)}\n`;
  out += `- 🔄 部分采纳：${groups.partial.length} 篇${fmt(groups.partial)}\n`;
  out += `- ⚠️ 已采纳但遗留未修复：${groups.unfixed.length} 篇${fmt(groups.unfixed)}\n`;
  out += `- 🧊 已废弃：${groups.deprecated.length} 篇${fmt(groups.deprecated)}\n`;
  out += `- ❌ 已取代：${groups.replaced.length} 篇${fmt(groups.replaced)}\n`;
  return out;
}

// ── releases 分区：最近版本 + 版本全览 ─────────────────

function parseVersions() {
  const vers = [];
  if (!fs.existsSync(RELEASE_DIR)) return vers;
  for (const f of fs.readdirSync(RELEASE_DIR)) {
    const m = /^v(\d+)\.(\d+)\.(\d+)\.md$/.exec(f);
    if (!m) continue; // 排除 vX.Y.Z-compare.md 等
    vers.push({ major: +m[1], minor: +m[2], patch: +m[3], file: f, label: `v${m[1]}.${m[2]}.${m[3]}` });
  }
  const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  vers.sort(cmp);
  return vers;
}

function buildReleasesIndex() {
  const vers = parseVersions();
  if (!vers.length) {
    return '| 版本 | 说明 |\n|------|------|\n| _暂无发版说明_ | |\n';
  }

  // 最近版本（倒序前 8）
  let out = '## 最近版本\n\n';
  out += '| 版本 | 说明 |\n';
  out += '|------|------|\n';
  const recent = vers.slice(-8).reverse();
  for (const v of recent) {
    out += `| [${v.label}](${v.file}) | — |\n`;
  }

  // 版本全览（按大版本 = major.minor 分组，如 v1.0 / v1.9）
  const byMajor = new Map();
  for (const v of vers) {
    const key = `${v.major}.${v.minor}`;
    if (!byMajor.has(key)) byMajor.set(key, []);
    byMajor.get(key).push(v);
  }
  out += '\n## 版本全览（按大版本）\n\n';
  out += '| 大版本 | 发布记录 |\n';
  out += '|--------|----------|\n';
  const majors = [...byMajor.keys()].sort((a, b) => {
    const [am, aM] = a.split('.').map(Number);
    const [bm, bM] = b.split('.').map(Number);
    return am - bm || aM - bM;
  });
  for (const maj of majors) {
    const group = byMajor.get(maj);
    const first = group[0];
    const last = group[group.length - 1];
    const range = first === last ? first.label : `${first.label} ~ ${last.label}`;
    out += `| v${maj} | ${range} |\n`;
  }
  return out;
}

// ── knowledge 分区：委托校验 ───────────────────────────

function checkKnowledge() {
  const gen = path.join('scripts', 'gen-knowledge-index.mjs');
  const res = spawnSync(process.execPath, [gen, '--check'], { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');
  return res.status === 0;
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  let failed = false;

  if (RUN_ADR) {
    if (!fs.existsSync(ADR_DIR)) {
      console.error('[FAIL] docs/architecture/adr/ 目录不存在');
      failed = true;
    } else {
      const list = parseAdrs();
      const r1 = applyRegion(ADR_REG_FILE, 'adr-registry', buildAdrRegistry(list));
      const r2 = applyRegion(ADR_REG_FILE, 'adr-stats', buildAdrStats(list));
      if ((r1.changed || r2.changed) && r1.ok && r2.ok) {
        console.log(`[OK] 已更新 adr/README.md（${path.relative(ROOT, ADR_REG_FILE)}）`);
      }
      if (!r1.ok || !r2.ok) failed = true;
    }
  }

  if (RUN_RELEASES) {
    const r = applyRegion(RELEASE_FILE, 'releases-index', buildReleasesIndex());
    if (r.changed && r.ok) console.log(`[OK] 已更新 ${path.relative(ROOT, RELEASE_FILE)} 的 releases-index 区`);
    if (!r.ok) failed = true;
  }

  if (RUN_KNOWLEDGE) {
    if (!checkKnowledge()) {
      console.error('[FAIL] knowledge/index.md 过期，请运行 node scripts/gen-knowledge-index.mjs');
      failed = true;
    }
  }

  if (!failed && !CHECK) console.log('[OK] gen-docs-index 全分区完成');
  return failed ? 1 : 0;
}

process.exit(main());
