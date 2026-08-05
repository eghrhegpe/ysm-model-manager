#!/usr/bin/env node
/**
 * check-doc-drift.mjs — 文档三一致检查器（ADR / 知识卡 / 架构树）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 三个维度：
 *   [ADR 维度]    docs/adr/ 文件 vs adr/README.md 登记表
 *                 撞号 / 漏登 / 幽灵文件 / 编号跳号（ERROR 阻断）
 *   [知识卡维度]  docs/knowledge/ 卡 frontmatter / source_files / 索引断链
 *                 必填字段缺失 / 占位符 / 引用不存在（ERROR 阻断）
 *   [架构树维度]  docs/archive/architecture.md 反引号代码路径引用
 *                 指向磁盘不存在的文件（ERROR 阻断）
 *                 实际源码树（frontend/src/ + go/ + internal/）中未在
 *                 architecture.md 登记的子模块（INFO 基线管理，--fix 刷新）
 *                 AGENTS.md §4.2 前端目录树 vs 磁盘实况（缺失 → WARN）
 *
 * 用法：
 *   node scripts/check-doc-drift.mjs            # 文本报告
 *   node scripts/check-doc-drift.mjs --json     # JSON（CI 用）
 *   node scripts/check-doc-drift.mjs --fix      # 刷新 INFO 基线（架构树未登记模块）
 *
 * 退出码：发现 ERROR → 1；否则 0（INFO/WARN 不阻断）。
 * 设计意图：文档漂移检查器（代码现实 vs 架构文档声称）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const ADR_DIR = path.join(ROOT, 'docs/adr');
const KC_DIR = path.join(ROOT, 'docs/knowledge');
const ARCH_DOCS = ['docs/archive/architecture.md', 'docs/archive/3D/3D-RENDERING-PLAN.md', 'docs/archive/3D/3d-rendering-report.md'];
const BASELINE_FILE = path.join(ROOT, 'scripts/baseline/doc-drift-baseline.json');

const JSON_OUT = process.argv.includes('--json');
const FIX_MODE = process.argv.includes('--fix');

const errors = [];
const warns = [];
const infos = [];

// ── 工具函数 ──────────────────────────────────────────

function readText(rel) {
  const p = path.join(ROOT, rel);
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function getScalar(fm, key) {
  if (!fm) return undefined;
  const line = fm.match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1].trim();
  if (v === '' || v.startsWith('<')) return undefined;
  return v.replace(/\s*#.*/, '').trim();
}

// ── 维度 1：ADR 登记一致（复用 adr-check 核心）───────

function checkAdr() {
  if (!fs.existsSync(ADR_DIR)) {
    errors.push('[ADR] docs/adr/ 目录不存在');
    return;
  }
  const files = fs.readdirSync(ADR_DIR).filter((f) => /^ADR-\d{3}-.*\.md$/.test(f)).sort();
  if (!files.length) {
    errors.push('[ADR] adr/ 目录下没有 ADR 文件');
    return;
  }

  const fileMeta = {};
  for (const f of files) {
    const text = fs.readFileSync(path.join(ADR_DIR, f), 'utf-8');
    const titleM = text.match(/^# ADR-(\d{3})[：:]\s*(.+)$/m);
    if (!titleM) {
      errors.push(`[ADR] ${f} 缺少 '# ADR-NNN：' 标题`);
      continue;
    }
    const num = parseInt(titleM[1], 10);
    if (fileMeta[num]) {
      errors.push(`[ADR] 编号 ADR-${String(num).padStart(3, '0')} 撞号：${fileMeta[num].file} 与 ${f}`);
    }
    fileMeta[num] = { file: f, num };
  }

  const regText = readText('docs/adr/README.md');
  if (regText === null) {
    errors.push('[ADR] adr/README.md 登记表不存在');
    return;
  }
  const regNums = new Set();
  for (const m of regText.matchAll(/^\|\s*ADR-(\d{3})\s*\|/gm)) regNums.add(parseInt(m[1], 10));

  for (const num of Object.keys(fileMeta).map(Number).sort((a, b) => a - b)) {
    if (!regNums.has(num)) errors.push(`[ADR] ADR-${String(num).padStart(3, '0')} (${fileMeta[num].file}) 未在登记表占号`);
  }
  for (const num of [...regNums].sort((a, b) => a - b)) {
    if (!fileMeta[num]) errors.push(`[ADR] 登记表有 ADR-${String(num).padStart(3, '0')}，但磁盘无对应文件`);
  }
  return { files: files.length, registered: regNums.size };
}

// ── 维度 2：知识卡一致（复用 check-knowledge-drift 核心）──

function checkKnowledge() {
  if (!fs.existsSync(KC_DIR)) return 0;
  const files = fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && !/^(readme|agents)\.md$/i.test(f));
  let count = 0;
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf-8');
    if (!/^---\r?\n/.test(text)) continue;
    count++;
    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`[知识卡] ${cf} 缺少 YAML frontmatter`);
      continue;
    }
    for (const key of ['kind', 'name', 'category', 'tier']) {
      const v = getScalar(fm, key);
      if (v === undefined || v === '') errors.push(`[知识卡] ${cf} 缺少必填字段 ${key}`);
    }
    const placeholderM = fm.match(/<[a-z_]+>/);
    if (placeholderM) errors.push(`[知识卡] ${cf} 含未填充占位符 <...>`);

    // source_files 存在性
    const srcM = fm.match(/^source_files\s*:\s*(.+)$/m);
    if (srcM) {
      const list = srcM[1].match(/\[([^\]]*)\]/);
      if (list) {
        for (const s of list[1].split(',')) {
          const v = s.trim().replace(/^['"]|['"]$/g, '');
          if (v && !fs.existsSync(path.join(ROOT, v))) errors.push(`[知识卡] ${cf} 的 source_files 引用不存在: ${v}`);
        }
      }
    }
  }
  // 索引断链
  for (const idx of ['index.md', 'routes.md']) {
    const idxText = readText(`docs/knowledge/${idx}`);
    if (!idxText) continue;
    for (const m of idxText.matchAll(/\]\(\.\/([a-zA-Z0-9_-]+\.md)\)/g)) {
      if (!fs.existsSync(path.join(KC_DIR, m[1]))) errors.push(`[知识卡] 索引 ${idx} 链接指向不存在的卡: ${m[1]}`);
    }
  }
  return count;
}

// ── 维度 3：架构树一致（新增）────────────────────────

const CODE_PATH_RE = /`((?:frontend|go|internal|scripts)\/[a-zA-Z0-9_./-]+)`/g;

/** 提取架构文档中的代码路径引用并验证存在性。已知过期引用记录在基线 staleRefs 中。 */
function checkArchRefs() {
  let baseline = { staleRefs: [] };
  if (fs.existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')); } catch { baseline = { staleRefs: [] }; }
  }
  const staleRefs = new Set(baseline.staleRefs || []);
  for (const doc of ARCH_DOCS) {
    const text = readText(doc);
    if (text === null) {
      infos.push(`[架构树] ${doc} 不存在，跳过`);
      continue;
    }
    for (const m of text.matchAll(CODE_PATH_RE)) {
      const ref = m[1];
      if (staleRefs.has(ref)) continue;
      if (!fs.existsSync(path.join(ROOT, ref))) {
        errors.push(`[架构树] ${doc} 引用不存在的路径: ${ref}`);
      }
    }
  }
}

/** AGENTS.md §4.2 前端目录树 vs 磁盘实况（缺失 → WARN，可能是规划中目录）。 */
function checkAgentsTree() {
  const text = readText('AGENTS.md');
  if (text === null) return;
  const blockM = text.match(/### 4\.2 前端[\s\S]*?```\s*\n([\s\S]*?)```/);
  if (!blockM) {
    infos.push('[架构树] AGENTS.md 未找到 §4.2 前端树代码块，跳过');
    return;
  }
  const lines = blockM[1].split(/\r?\n/);
  const rootIdx = lines.findIndex((l) => l.includes('frontend/src/'));
  if (rootIdx < 0) return;
  for (const line of lines.slice(rootIdx + 1)) {
    const segM = line.match(/^\s{2}([^\s—]+)/);
    if (!segM) continue;
    const seg = segM[1];
    if (!fs.existsSync(path.join(ROOT, 'frontend/src', seg))) {
      warns.push(`[架构树] AGENTS.md §4.2 描述 frontend/src/${seg} 但磁盘不存在（疑似规划中目录或已删除）`);
    }
  }
}

/** 收集实际源码树一层子模块（frontend/src/ + go/ + internal/）。 */
function collectSourceModules() {
  const out = [];
  const roots = [
    ['frontend/src', (d) => /^[a-z][a-z0-9-]*$/.test(d) && d !== 'css'],
    ['go', (d) => /^[a-z][a-z0-9-]*$/.test(d)],
    ['internal', (d) => /^[a-z][a-z0-9-]*$/.test(d)],
  ];
  for (const [rel, filter] of roots) {
    const dir = path.join(ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      if (!fs.statSync(path.join(dir, d)).isDirectory() || !filter(d)) continue;
      out.push(`${rel}/${d}`);
    }
  }
  return out.sort();
}

/** 架构文档未登记模块 → INFO；--fix 刷新基线。 */
function checkArchCoverage() {
  const modules = collectSourceModules();
  const archText = ARCH_DOCS.map((d) => readText(d) || '').join('\n');
  const unregistered = modules.filter((m) => !archText.includes(m));

  let baseline = { unregistered: [] };
  if (fs.existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')); } catch { baseline = { unregistered: [] }; }
  }
  const known = new Set(baseline.unregistered || []);

  if (FIX_MODE) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ generated: new Date().toISOString(), unregistered }, null, 2) + '\n');
    infos.push(`[架构树] --fix 已刷新基线（${unregistered.length} 个未登记模块）`);
    return;
  }

  for (const m of unregistered) {
    if (!known.has(m)) infos.push(`[架构树] 源码模块 ${m} 未在架构文档登记（INFO，--fix 纳入基线）`);
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  const adr = checkAdr();
  const kc = checkKnowledge();
  checkArchRefs();
  checkArchCoverage();
  checkAgentsTree();

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { errors: errors.length, warns: warns.length, infos: infos.length, adrFiles: adr?.files, adrRegistered: adr?.registered, knowledgeCards: kc }, errors, warns, infos, summary: { adrFiles: adr?.files, adrRegistered: adr?.registered, knowledgeCards: kc } }, null, 2));
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 文档三一致检查 (check-doc-drift)');
  console.log('══════════════════════════════════════');
  console.log(`ADR 维度     : ${adr ? `${adr.files} 文件 / 登记 ${adr.registered}` : 'FAILED'}`);
  console.log(`知识卡维度   : ${kc ?? 0} 卡`);
  console.log(`ERROR       : ${errors.length}`);
  console.log(`WARN        : ${warns.length}`);
  console.log(`INFO        : ${infos.length}`);
  console.log('──────────────────────────────────────');

  if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
  if (infos.length) for (const i of infos) console.log(`ℹ ${i}`);
  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`);
    console.log('\n退出码 1（可接 CI 卡点）。');
    process.exit(1);
  }
  console.log('✅ 三一致通过：ADR 登记、知识卡、架构树均无 ERROR 级漂移。');
}

main();
