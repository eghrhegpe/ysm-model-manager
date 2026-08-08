#!/usr/bin/env node
/**
 * gen-docs-index.mjs — 分区索引自动生成（adr / knowledge / releases）。
 *
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process）。
 * 只重写各文件 `<!-- GEN: xxx -->` 标记区，人工段落原样保留：
 *   - adr      → docs/adr/README.md 的 adr-registry（登记表）+ adr-stats（状态统计）
 *   - adr      → docs/adr/index.md 的规范索引（状态分组 + 锚点跳转 + 相对链接，整文件重写）
 *   - guide    → docs/guide/index.md 的 guide-index（用户指南表格，从各篇 frontmatter 生成）
 *   - releases → docs/releases/index.md 的 releases-index（最近版本 + 版本全览）
 *   - knowledge→ 委托 gen-knowledge-index.mjs --check（不重写，避免双生成器打架）
 * 单一事实来源 = ADR 文件首部 / guide 各篇 frontmatter；状态映射以 ADR 首部状态行为准。
 *
 * 用法：
 *   node scripts/gen-docs-index.mjs                # 全分区写入
 *   node scripts/gen-docs-index.mjs --adr          # 只跑 adr
 *   node scripts/gen-docs-index.mjs --guide        # 只跑 guide
 *   node scripts/gen-docs-index.mjs --releases     # 只跑 releases
 *   node scripts/gen-docs-index.mjs --knowledge    # 只校验 knowledge 漂移
 *   node scripts/gen-docs-index.mjs --check        # 全分区只校验不写入
 * 设计意图：文档索引生成器（ADR 目录索引）
 * 退出码：main(（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText, writeText } from './_lib/scan-files.mjs';
import { spawnSync } from 'node:child_process';

const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const ADR_INDEX_FILE = path.join(ADR_DIR, 'index.md');
const RELEASE_DIR = path.join(ROOT, 'docs', 'releases');
const RELEASE_FILE = path.join(RELEASE_DIR, 'index.md');
const GUIDE_DIR = path.join(ROOT, 'docs', 'guide');
const GUIDE_FILE = path.join(GUIDE_DIR, 'index.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const want = (flag) => args.includes(`--${flag}`);
const ONLY = args.some((a) => a.startsWith('--') && ['--adr', '--releases', '--knowledge', '--guide'].includes(a));
const RUN_ADR = !ONLY || want('adr');
const RUN_RELEASES = !ONLY || want('releases');
const RUN_KNOWLEDGE = !ONLY || want('knowledge');
const RUN_GUIDE = !ONLY || want('guide');

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
  const current = readText(file); // 归一化 CRLF→LF：磁盘行尾不影响幂等判定
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
  writeText(file, next); // 保留原行尾风格（CRLF 文件不被改写成 LF）
  return { ok: true, changed: true };
}

/** 整文件重写（非 GEN 区，如 adr/index.md）：一致则 OK；--check 下不一致则 FAIL。返回 {ok, changed}。 */
function applyWholeFile(file, content, label) {
  const current = fs.existsSync(file) ? readText(file) : null; // 归一化比较，CRLF 下幂等不失效
  if (current === content) return { ok: true, changed: false };
  if (CHECK) {
    console.error(`[FAIL] ${label} 需要更新`);
    return { ok: false, changed: false };
  }
  writeText(file, content); // 保留原行尾风格（CRLF 文件不被改写成 LF）
  return { ok: true, changed: true };
}

// ── ADR 解析与状态映射（状态值域以 adr-check.mjs 为准）──

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
    if (!titleM) {
      // 与 adr-check.mjs 的 TITLE_MISSING 一致：无标题 ADR 不应静默跳过，生成器落一条提示
      console.error(`[WARN] ${f} 缺少 '# ADR-NNN：' 标题（将被登记表忽略，adr-check 会阻断）`);
      continue;
    }
    list.push({
      num: parseInt(titleM[1], 10),
      file: f,
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
    // 契约（ADR_USAGE_RULES：「违规或未修复，自动从文件首部识别」）：裸「违规/不一致/未修复」→ ⚠️；
    // 但「违规已修复 / 不一致已修复」不属遗留未修复 → ✅（code_review P2 双向一致）
    if ((/违规|不一致|未修复/.test(s)) && !/已修复/.test(s)) return `⚠️ 已采纳${tail}`;
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

// ── adr 分区：规范索引页（docs/adr/index.md，整文件重写）────

/** 状态 → 规范索引分组名（锚点 = 分组标题，Jekyll 可渲染）。 */
const INDEX_GROUPS = [
  { key: 'partial', title: '🔄 部分采纳', anchor: '部分采纳' },
  { key: 'unfixed', title: '⚠️ 已采纳但遗留未修复', anchor: '已采纳但遗留未修复' },
  { key: 'accepted', title: '✅ 已采纳', anchor: '已采纳' },
  { key: 'deprecated', title: '🧊 已废弃', anchor: '已废弃' },
  { key: 'replaced', title: '❌ 已取代', anchor: '已取代' },
];

/**
 * 使用规则（硬约束）——原 docs/adr/README.md 手写段，合并至 index 后由生成器承载。
 * 改规则 = 改本常量后重跑 gen-docs-index.mjs（index 保持「全生成、禁手改」）。
 */
const ADR_USAGE_RULES = [
  '1. **编号**：取本表最大编号 +1（三位，如 `ADR-014`），禁止 `ADR-000N` 式前缀，禁止跳号复用。',
  '2. **占号**：写文件**前**先在本表登记占号（并提交登记），再创建文件——多会话并行时以登记顺序为准，撞号者必须让位改号。',
  '3. **命名**：文件名 `ADR-NNN-kebab-case.md`（如 `ADR-013-governance-convergence.md`）。',
  '4. **必填字段**：状态 / 日期 / 决策人 / 相关；正文结构：背景（Context）→ 决策（Decision）→ 后果（Consequences）→ 数据溯源。',
  '5. **状态值**：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代` / `⚠️ 已采纳（违规或未修复，自动从文件首部识别）`。状态变更只改文件首部，本页由 `gen-docs-index.mjs` 自动重写。',
  '6. **新 ADR 落地后**：本页自动重写（改文件首部即可），无需手动同步；历史 `PROJECT_STATUS.md` 已冻结于 `docs/archive/`，不再维护。',
];

function groupAdrs(list) {
  const groups = { accepted: [], partial: [], unfixed: [], deprecated: [], replaced: [] };
  for (const a of list) {
    const st = mapStatus(a.statusRaw);
    if (st.startsWith('🔄')) groups.partial.push(a);
    else if (st.startsWith('🧊')) groups.deprecated.push(a);
    else if (st.startsWith('❌')) groups.replaced.push(a);
    else if (st.startsWith('⚠️')) groups.unfixed.push(a);
    else groups.accepted.push(a);
  }
  return groups;
}

function buildAdrIndex(list) {
  const groups = groupAdrs(list);
  const total = list.length;

  let out = '---\n';
  out += 'layout: page\n';
  out += 'title: 决策记录（ADR）\n';
  out += 'permalink: /adr/\n';
  out += '---\n\n';
  out += '<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，禁止手改。重跑：node scripts/gen-docs-index.mjs -->\n\n';
  out += '# 决策记录（ADR）\n\n';
  out += `> 架构决策日志，共 **${total}** 篇。决策真相源 = 各 ADR 文件首部「状态」行；本页为登记表 + 规范索引（单文件承载全部）。\n\n`;
  out += '> 所有 ADR 存放于本目录。**写新 ADR 前必读本节**——防撞号靠登记，不靠自觉。\n\n';

  // 状态分布总览（统计；登记表为全量明细，不另设重复的分组表）
  out += '## 按状态分布\n\n';
  out += '| 状态 | 数量 |\n';
  out += '|------|------|\n';
  for (const g of INDEX_GROUPS) {
    out += `| ${g.title} | ${groups[g.key].length} |\n`;
  }
  out += '\n';

  // 登记表（全量明细 + 占号/对账契约：行格式 `| ADR-NNN | 标题 | 状态 | 日期 |`，adr-check/new-adr 机器消费）
  out += '## 登记表\n\n';
  out += buildAdrRegistry(list);
  out += '\n';

  // 使用规则（硬约束，作者向操作规程）
  out += '## 使用规则（硬约束）\n\n';
  for (const r of ADR_USAGE_RULES) out += `${r}\n`;
  out += '\n';

  // 尾部维护说明
  out += '---\n\n';
  out += '*登记表由 `gen-docs-index.mjs` 自动重写；一致性校验已接入：`node scripts/check-adr-health.mjs`（状态值域 + 登记同步 + 技术债）+ `node scripts/check-doc-drift.mjs`（编号连续性/漏登/幽灵）。*\n';
  return out;
}

// ── releases 分区：最近版本 + 版本全览 ─────────────────

// ── guide 分区：用户指南表格（docs/guide/index.md，GEN 区）──

/** 非功能指南页（不进表格）。 */
const GUIDE_SKIP = new Set(['index.md', '用户指南.md', '项目意义.md']);
/** 语义顺序（与 guide/index.md 现有表格一致）；未列出的按字母序追加。 */
const GUIDE_ORDER = [
  'install.md', 'first-setup.md', 'repository.md', 'import-model.md',
  '3d-preview.md', 'pack-sync.md', 'resource-packs.md', 'creators.md',
  'workshop.md', 'oldest-models.md', 'recycle-bin.md', 'diagnostics.md',
  'themes.md', 'settings.md', 'update.md', 'faq.md',
];

function parseGuidePages() {
  if (!fs.existsSync(GUIDE_DIR)) return [];
  const pages = [];
  for (const f of fs.readdirSync(GUIDE_DIR)) {
    if (!f.endsWith('.md') || GUIDE_SKIP.has(f)) continue;
    const text = fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const get = (key) => {
      if (!fm) return '';
      const m = fm[1].match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
      // 剥 YAML 外层引号（frontmatter 标题常带 "..."），避免索引表显示引号残留
      return m ? m[1].trim().replace(/\s*#.*$/, '').trim().replace(/^["']|["']$/g, '').trim() : '';
    };
    pages.push({ file: f, title: get('title') || f.replace(/\.md$/, ''), desc: get('description') || '' });
  }
  pages.sort((a, b) => {
    const ia = GUIDE_ORDER.indexOf(a.file);
    const ib = GUIDE_ORDER.indexOf(b.file);
    if (ia === -1 && ib === -1) return a.file.localeCompare(b.file);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return pages;
}

function buildGuideIndex() {
  const pages = parseGuidePages();
  let out = `> 按功能讲解入口路径与操作步骤，共 **${pages.length}** 篇。新功能持续建档；索引由 gen-docs-index.mjs 自动生成，断链由 link-checker 兜底。\n\n`;
  out += '| 指南页 | 说明 |\n';
  out += '|--------|------|\n';
  for (const p of pages) {
    out += `| [${escCell(p.title)}](./${p.file}) | ${escCell(p.desc)} |\n`;
  }
  return out;
}

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
      console.error('[FAIL] docs/adr/ 目录不存在');
      failed = true;
    } else {
      const list = parseAdrs();
      // 登记表/规则已并入 index.md（整文件重写）；README.md 为固定指针页，不再由本生成器管理
      const r3 = applyWholeFile(ADR_INDEX_FILE, buildAdrIndex(list), 'docs/adr/index.md');
      if (r3.changed && r3.ok) console.log(`[OK] 已更新 docs/adr/index.md（规范索引 + 登记表 + 使用规则）`);
      if (!r3.ok) failed = true;
    }
  }

  if (RUN_RELEASES) {
    const r = applyRegion(RELEASE_FILE, 'releases-index', buildReleasesIndex());
    if (r.changed && r.ok) console.log(`[OK] 已更新 ${path.relative(ROOT, RELEASE_FILE)} 的 releases-index 区`);
    if (!r.ok) failed = true;
  }

  if (RUN_GUIDE) {
    const r = applyRegion(GUIDE_FILE, 'guide-index', buildGuideIndex());
    if (r.changed && r.ok) console.log(`[OK] 已更新 docs/guide/index.md 的 guide-index 区`);
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
