#!/usr/bin/env node
/**
 * check-knowledge-drift.mjs — 知识卡漂移检查器（适配搬运自 MikuMikuAR）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 检查项（适配 YSM 规模，去掉了 ADR/符号覆盖率/状态索引等不相关项）：
 *   [ERROR] 知识卡 source_files 指向磁盘不存在的文件
 *   [ERROR] 知识卡 source_files 路径格式非法（反斜杠 / 绝对路径 / .. 逃逸，必须仓库相对 POSIX）
 *   [WARN]  知识卡 source_files 指向生成物（bindings/dist/node_modules）→ 非源码事实源
 *   [WARN]  知识卡 source_files 指向测试文件 → 实现应放 source_files，测试放 tests:
 *   [ERROR] 知识卡 frontmatter 必填字段缺失（kind/name/category）
 *   [ERROR] 知识卡 category / tier 值域违规
 *   [ERROR] 知识卡 kind 非 kebab-case/snake_case（小写，允许 - 与 _）或含未填充占位符 <...>
 *   [WARN]  H1 标题与 name 不一致
 *   [WARN]  AGENTS.md 含手写事实索引（├──/└── 目录树）
 *   [ERROR] 索引文件（index.md）链接指向不存在的卡
 *
 * 用法：
 *   node scripts/check-knowledge-drift.mjs                  # 文本报告（被动：卡间/卡→源码引用漂移）
 *   node scripts/check-knowledge-drift.mjs --json           # JSON（CI 用，doctor --docs 调用）
 *   node scripts/check-knowledge-drift.mjs --affected <f>…  # 主动：源码变更即列出受影响知识卡（治未病）
 *     # 常与 git 联动：git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.mjs --affected {}
 *
 * 退出码：发现 ERROR → 1；否则 0（WARN 不阻断；--affected 恒为 0）。
 * 设计意图：知识卡漂移检查（与代码现实比对）+ 源码变更主动防御。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { toPosix } from './_lib/to-posix.mjs';
import { parseFrontmatter, getScalar, getList, parseSourceFiles } from './_lib/frontmatter.mjs';

const KC_DIR = path.join(ROOT, 'docs', 'knowledge');

const JSON_OUT = process.argv.includes('--json');
const AFFECTED_MODE = process.argv.includes('--affected');
const _aIdx = process.argv.indexOf('--affected');
const AFFECTED_PATHS = _aIdx >= 0 ? process.argv.slice(_aIdx + 1) : [];
// --quiet：--affected 仅输出受影响卡 stem（每行一个），供钩子机读消费
const QUIET = process.argv.includes('--quiet');
const errors = [];
const warns = [];

// ── 枚举 ──────────────────────────────────────────────
const CATEGORY_ENUM = new Set(['core', 'go', 'ui', 'feature', 'utils', 'config']);
const TIER_ENUM = new Set(['architecture', 'leaf']);
const REQUIRED_FIELDS = ['kind', 'name', 'category', 'tier'];
const KIND_RE = /^[a-z][a-z0-9_-]*$/;
const PLACEHOLDER_RE = /^<.*>$/;

// 源码事实源黑名单：生成物（构建产物，非稳定事实源）/ 测试文件（应在 tests: 字段）
const GEN_RE = /(^|\/)bindings(\/|$)|(^|\/)dist(\/|$)|(^|\/)node_modules(\/|$)/;
const TEST_RE = /\.(test|spec)\.(ts|js)$|_test\.go$|(^|\/)test(\/|$)/;
const ROOT_ESCAPE_RE = /\\|^[A-Za-z]:|^\/|^~|\.\.\//; // 反斜杠 / 绝对路径 / .. 逃逸

// ── 共享 frontmatter 解析统一走 _lib/frontmatter.mjs（见顶部 import）──

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
      errors.push(`知识卡 ${cf} 的 kind 非法: ${kind}（应为小写 kebab-case 或 snake_case，允许 - 与 _）`);
    }

    // kind 与文件名同源（单一不变量：文件名是命名事实源）
    const stem = cf.replace(/\.md$/, '');
    if (kind && kind !== stem) {
      errors.push(`知识卡 ${cf} 的 kind「${kind}」与文件名「${stem}」不一致（kind 应等于文件名 kebab 形式）`);
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

// ── 检查 2：source_files 存在性 + 路径格式 + 语义漂移 ──

function checkKnowledgeSources() {
  if (!fs.existsSync(KC_DIR)) return;
  const files = fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'agents.md');
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    // 抽出 + 归一（反斜杠 → 正斜杠），供存在性 / 格式 / 语义三检共用
    const sources = parseSourceFiles(fm).map((s) => ({ raw: s, norm: toPosix(s) }));
    for (const { raw, norm } of sources) {
      // [ERROR] 路径格式：反斜杠 / 绝对路径 / .. 逃逸 → 不可移植，CI 其他平台 404
      if (ROOT_ESCAPE_RE.test(raw)) {
        errors.push(`知识卡 ${cf} 的 source_files 路径格式非法: ${raw}（禁止反斜杠/绝对路径/..，必须仓库相对 POSIX 路径）`);
        continue;
      }
      // [ERROR] 文件不存在（硬 404，源码删除/移动/重命名即触发）
      if (!fs.existsSync(path.join(ROOT, norm))) {
        errors.push(`知识卡 ${cf} 的 source_files 引用不存在: ${norm}`);
        continue;
      }
      // [WARN] 指向生成物（bindings/dist/node_modules）→ 非源码事实源，重构后静默失真
      if (GEN_RE.test(norm)) {
        warns.push(`知识卡 ${cf} 的 source_files 指向生成物: ${norm}（应引用源码实现，而非构建产物）`);
      }
      // [WARN] 指向测试文件 → 卡片事实源应是实现，测试应放 tests: 字段
      if (TEST_RE.test(norm)) {
        warns.push(`知识卡 ${cf} 的 source_files 指向测试文件: ${norm}（实现放 source_files，测试放 tests:）`);
      }
    }
  }
}

// ── 检查 2.5：机制锚核对（ADR-044 策略 C）──
// 存在性对账无法发现「机制描述错误」（sync.Once→registryMu、sort.Strings→json.Decoder、
// GetVersion→GetAppVersion 等重构后知识卡正文失效）。知识卡 frontmatter 可声明
// `invariant_anchors:`（list），每项 `文件相对路径|应含模式`（| 分隔，模式为字面子串或
// `re:` 前缀正则）。锚不命中 → ERROR（机制描述漂移即红，纳入 ADR-043 fail-closed 契约）。
function checkKnowledgeAnchors() {
  if (!fs.existsSync(KC_DIR)) return;
  const files = fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'agents.md');
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const anchors = getList(fm, 'invariant_anchors');
    for (const raw of anchors) {
      const sep = raw.lastIndexOf('|');
      if (sep < 0) {
        errors.push(`知识卡 ${cf} 的 invariant_anchors 格式非法: ${raw}（应为「文件相对路径|应含模式」）`);
        continue;
      }
      const file = toPosix(raw.slice(0, sep).trim());
      const pat = raw.slice(sep + 1).trim();
      if (!file || !pat) {
        errors.push(`知识卡 ${cf} 的 invariant_anchors 格式非法: ${raw}（文件或模式为空）`);
        continue;
      }
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) {
        errors.push(`知识卡 ${cf} 的机制锚文件不存在: ${file}`);
        continue;
      }
      const content = fs.readFileSync(full, 'utf8');
      let hit = false;
      if (pat.startsWith('re:')) {
        try {
          hit = new RegExp(pat.slice(3)).test(content);
        } catch (e) {
          errors.push(`知识卡 ${cf} 的机制锚正则非法: ${pat}（${e.message}）`);
          continue;
        }
      } else {
        hit = content.includes(pat);
      }
      if (!hit) {
        errors.push(`知识卡 ${cf} 的机制锚失效: 声称 ${file} 含「${pat}」，实际不存在（机制描述漂移——重构触及锚即红，请同步知识卡正文）`);
      }
    }
  }
}

// ── 检查 3：索引断链（index.md 中 ./xxx.md 链接）──

const INDEX_FILES = ['index.md'];
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
// 排除：node_modules / dist / bindings / test 目录 / .test. / _test.（Go *_test.go） / .spec.
// 同时匹配 / 与 \（Windows 下 path.join 产反斜杠路径，仅正斜杠会漏排除——code_review P3）
const WALK_EXCLUDE_RE = /(node_modules|[\\/]dist[\\/]|[\\/]bindings[\\/]|[\\/]test[\\/]|\.test\.|_test\.|\.spec\.)/;

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
      const rel = toPosix(path.relative(ROOT, f));
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

// ── 主动防御：源码变更即标记受影响知识卡 ──────────────
// 给定变更文件清单（仓库相对 POSIX 路径），输出引用了它们的知识卡。
// 与 git 联动：git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.mjs --affected {}
// 匹配规则复用 covers()：文件精确命中 / 目录前缀命中（source_files 可整目录引用）。

function runAffected(changed) {
  if (changed.length === 0) {
    console.log('用法: node scripts/check-knowledge-drift.mjs --affected <变更文件...>');
    console.log('  常与 git 联动: git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.mjs --affected {}');
    console.log('  机读模式:      node scripts/check-knowledge-drift.mjs --affected --quiet <变更文件...>  （仅输出卡 stem）');
    process.exit(0);
    return;
  }
  if (!fs.existsSync(KC_DIR)) process.exit(0);
  // 建立 卡片 → source_files 索引
  const index = [];
  for (const cf of fs.readdirSync(KC_DIR).filter((f) => f.endsWith('.md') && !/^(readme|agents)\.md$/i.test(f))) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const sources = parseSourceFiles(fm).map((s) => toPosix(s));
    if (sources.length) index.push({ card: cf.replace(/\.md$/, ''), sources });
  }
  const hits = new Map();
  for (const ch of changed.map((c) => toPosix(c))) {
    for (const { card, sources } of index) {
      if (sources.some((entry) => covers(ch, entry))) {
        if (!hits.has(card)) hits.set(card, new Set());
        hits.get(card).add(ch);
      }
    }
  }
  if (hits.size === 0) {
    if (!QUIET) console.log(`✅ 变更的 ${changed.length} 个文件未被任何知识卡 source_files 引用，无需复核。`);
    process.exit(0);
    return;
  }
  if (QUIET) {
    // 机读模式：仅输出卡 stem，每行一个（供 prepare-commit-msg 钩子消费）
    for (const card of [...hits.keys()].sort()) console.log(card);
    process.exit(0);
    return;
  }
  console.log(`⚠ 以下 ${hits.size} 张知识卡引用了本次变更的文件，建议复核:`);
  for (const [card, files] of [...hits.entries()].sort()) {
    console.log(`  - ${card}  ←  ${[...files].join(', ')}`);
  }
  process.exit(0);
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  if (AFFECTED_MODE) {
    runAffected(AFFECTED_PATHS);
    return;
  }
  // ADR-043 fail-closed：KC_DIR 缺失 = 扫描不完整，必须显式失败而非空结果假绿
  //（此前各 check 函数对缺失目录静默 return，errors 恒 0 → --check 假绿）
  if (!fs.existsSync(KC_DIR)) {
    errors.push('docs/knowledge/ 目录不存在，扫描不完整');
  }
  checkKnowledgeMeta();
  checkKnowledgeSources();
  checkKnowledgeAnchors();
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
