#!/usr/bin/env node
/**
 * check-knowledge-drift.mjs — 知识卡漂移检查器（适配搬运自 MikuMikuAR）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 检查项（适配 YSM 规模，去掉了 ADR/符号覆盖率/状态索引等不相关项）：
 *   [ERROR] 知识卡 source_files 指向磁盘不存在的文件
 *   [ERROR] 知识卡 frontmatter 必填字段缺失（kind/name/category）
 *   [ERROR] 知识卡 category / tier 值域违规
 *   [ERROR] 知识卡 kind 非 snake_case 或含未填充占位符 <...>
 *   [WARN]  H1 标题与 name 不一致
 *   [WARN]  AGENTS.md 含手写事实索引（├──/└── 目录树）
 *   [ERROR] 索引文件（index.md / routes.md）链接指向不存在的卡
 *
 * 用法：
 *   node scripts/check-knowledge-drift.mjs            # 文本报告
 *   node scripts/check-knowledge-drift.mjs --json     # JSON（CI 用）
 *
 * 退出码：发现 ERROR → 1；否则 0（WARN 不阻断）。
 * 设计意图：知识卡漂移检查（与代码现实比对）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const KC_DIR = path.join(ROOT, 'docs', 'knowledge');

const JSON_OUT = process.argv.includes('--json');
const errors = [];
const warns = [];

// ── 枚举 ──────────────────────────────────────────────
const CATEGORY_ENUM = new Set(['core', 'go', 'ui', 'feature', 'utils', 'config']);
const TIER_ENUM = new Set(['architecture', 'leaf']);
const REQUIRED_FIELDS = ['kind', 'name', 'category', 'tier'];
const KIND_RE = /^[a-z][a-z0-9_]*$/;
const PLACEHOLDER_RE = /^<.*>$/;

// ── 共享 frontmatter 解析（复制 MikuMikuAR _lib/frontmatter.mjs 核心逻辑）──

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

function getList(fm, key) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/\s*#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/\s*#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

function parseSourceFiles(fm) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let seen = false;
  for (const line of lines) {
    const head = line.match(/^source_files\s*:\s*(.*)$/);
    if (head) {
      seen = true;
      const inline = head[1].match(/\[([^\]]*)\]/);
      if (inline) {
        inline[1].split(',').forEach((s) => {
          const v = s.trim().replace(/^['"]|['"]$/g, '');
          if (v) out.push(v);
        });
        return out;
      }
      continue;
    }
    if (seen && /^\S/.test(line)) break;
    if (seen) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        const v = item[1].replace(/^['"]|['"]$/g, '').trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}

// ── 检查 1：知识卡 frontmatter 治理 ──────────────────

/** 解析所有 frontmatter 标量字段（key → value，用于占位符检查）。 */
function parseFrontmatterFields(fm) {
  const map = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}

function checkKnowledgeMeta() {
  if (!fs.existsSync(KC_DIR)) return { count: 0 };
  const files = fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'agents.md');
  let count = 0;
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    if (!/^---\r?\n/.test(text)) continue;
    count++;
    const fm = parseFrontmatter(text);
    if (!fm) { errors.push(`知识卡 ${cf} 缺少 YAML frontmatter`); continue; }

    // 必填字段
    for (const key of REQUIRED_FIELDS) {
      const v = getScalar(fm, key);
      if (v === undefined || v === '') {
        errors.push(`知识卡 ${cf} 缺少必填字段 ${key}`);
      }
    }

    // 模板占位符
    const fmFields = parseFrontmatterFields(fm);
    for (const [k, v] of Object.entries(fmFields)) {
      if (v !== '' && PLACEHOLDER_RE.test(v)) {
        errors.push(`知识卡 ${cf} 的 ${k} 含未填充占位符: ${v}`);
      }
    }

    // kind 格式
    const kind = getScalar(fm, 'kind');
    if (kind && !KIND_RE.test(kind)) {
      errors.push(`知识卡 ${cf} 的 kind 非法: ${kind}（应为 snake_case）`);
    }

    // category 值域
    const category = getScalar(fm, 'category');
    if (category && !CATEGORY_ENUM.has(category)) {
      errors.push(`知识卡 ${cf} 的 category 非法: ${category}（应为 ${[...CATEGORY_ENUM].join('|')} 之一）`);
    }

    // tier 值域
    const tier = getScalar(fm, 'tier');
    if (tier && !TIER_ENUM.has(tier)) {
      errors.push(`知识卡 ${cf} 的 tier 非法: ${tier}（应为 ${[...TIER_ENUM].join('|')} 之一）`);
    }

    // H1 vs name 一致性（WARN）
    const name = getScalar(fm, 'name');
    const h1Match = text.match(/^#\s+(.+)$/m);
    if (h1Match && name && h1Match[1].trim() !== name) {
      warns.push(`知识卡 ${cf} 的 H1 标题「${h1Match[1].trim()}」与 name「${name}」不一致`);
    }
  }
  return { count };
}

// ── 检查 2：source_files 存在性 ──────────────────────

function checkKnowledgeSources() {
  if (!fs.existsSync(KC_DIR)) return;
  const files = fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'agents.md');
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const sources = parseSourceFiles(fm);
    for (const src of sources) {
      if (!fs.existsSync(path.join(ROOT, src))) {
        errors.push(`知识卡 ${cf} 的 source_files 引用不存在: ${src}`);
      }
    }
  }
}

// ── 检查 3：索引断链（routes.md / index.md 中 ./xxx.md 链接）──

const INDEX_FILES = ['index.md', 'routes.md'];
const LINK_RE = /\]\(\.\/([a-zA-Z0-9_-]+\.md)\)/g;

function checkIndexLinks() {
  for (const idx of INDEX_FILES) {
    const file = path.join(KC_DIR, idx);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(LINK_RE)) {
      const target = m[1];
      if (!fs.existsSync(path.join(KC_DIR, target))) {
        errors.push(`索引 ${idx} 链接指向不存在的卡: ${target}`);
      }
    }
  }
}

// ── 检查 4：AGENTS.md 手写事实索引（WARN）──

function checkAgentsNoHandcraftedIndex() {
  const targets = ['AGENTS.md'];
  for (const rel of targets) {
    const text = fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '';
    if (!text) continue;
    let treeHits = 0;
    for (const line of text.split('\n')) {
      if (/^[│├└]\s*[├└]──\s/.test(line) || /^\s*├──\s/.test(line) || /^\s*└──\s/.test(line)) {
        treeHits++;
      }
    }
    if (treeHits > 0) {
      warns.push(`${rel} 含手写目录树特征（${treeHits} 行 ├──/└──），应改为指针指向知识卡系统`);
    }
  }
}

// ── 检查 5：代码→卡片覆盖盲区（WARN，不阻断）──
// 适配自 MikuMikuAR check-doc-drift.mjs checkKnowledgeCoverage（INFO 级）。
// 从「代码现实」出发：扫描源码目录下每个文件，确认至少 1 张知识卡的
// source_files 引用了它（目录条目按前缀匹配，文件条目按精确匹配）。
// 未覆盖 = 代码有模块、知识库无卡片 → WARN 提醒补登，不阻断 CI。

const SOURCE_ROOTS = ['frontend/src', 'go'];
const WALK_EXCLUDE_RE = /(node_modules|\/dist\/|\/bindings\/|\/test\/|\.test\.|\.spec\.)/;

function walkSources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (WALK_EXCLUDE_RE.test(p)) continue;
    if (e.isDirectory()) walkSources(p, out);
    else if (e.isFile() && /\.(ts|js|go)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 某卡 source_files 条目是否覆盖源文件 rel：文件精确匹配 / 目录前缀匹配。 */
function covers(rel, entry) {
  const e = entry.replace(/\/+$/, '');
  return rel === e || rel.startsWith(e + '/');
}

function checkKnowledgeCoverage() {
  if (!fs.existsSync(KC_DIR)) return;
  // 收集所有卡的 source_files（去尾斜杠）
  const referenced = new Set();
  for (const cf of fs.readdirSync(KC_DIR)) {
    if (!cf.endsWith('.md') || /^(readme|agents)\.md$/i.test(cf)) continue;
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    for (const src of parseSourceFiles(fm)) {
      if (/\.(ts|js|go)$/.test(src) || src.endsWith('/')) referenced.add(src.replace(/\/+$/, ''));
    }
  }
  // 扫描源码文件，未覆盖的按顶层目录分组
  const byDir = new Map();
  let total = 0;
  for (const root of SOURCE_ROOTS) {
    for (const f of walkSources(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      const hit = [...referenced].some((entry) => covers(rel, entry));
      if (hit) continue;
      total++;
      const top = rel.split('/').slice(0, 2).join('/');
      byDir.set(top, (byDir.get(top) || 0) + 1);
    }
  }
  if (total === 0) return;
  const topSummary = [...byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([d, n]) => `${d}×${n}`)
    .join('  ');
  warns.push(`代码→卡片覆盖盲区：${total} 个源码文件未被任何知识卡引用（TOP: ${topSummary}）。非阻断提醒，建议补登知识卡。`);
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  checkKnowledgeMeta();
  checkKnowledgeSources();
  checkIndexLinks();
  checkAgentsNoHandcraftedIndex();
  checkKnowledgeCoverage();

  const result = { _summary: { errors: errors.length, warns: warns.length }, errors, warns };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 知识卡漂移检查 (check-knowledge-drift)');
  console.log('══════════════════════════════════════');
  console.log(`ERROR  : ${errors.length}`);
  console.log(`WARN   : ${warns.length}`);
  console.log('──────────────────────────────────────');

  if (warns.length) {
    for (const w of warns) console.log(`⚠ ${w}`);
  }

  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`);
    console.log(`\n退出码 1（可接 CI 卡点）。`);
    process.exit(1);
  } else {
    console.log('✅ 未检测到 ERROR 级漂移。');
  }
}

main();
