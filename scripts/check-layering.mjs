#!/usr/bin/env node
/**
 * check-layering.mjs — 前端分层依赖方向守护。
 *
 * 设计意图：把「三层解耦职责边界（逻辑层不碰 UI）」固化为 CI 可执行规则。
 * ysm 前端分层公理（自上而下，允许上层 import 下层，反向即违规）：
 *   views/ → features/ → services/ → utils/ → core/
 *   wasm/ / backend/ 为胶水与绑定产物，不参与分层判定（import 它们不违规）。
 * 骨架源自 MikuMikuAR scripts/check-layering.mjs（ADR-242 分层守护），适配本仓库目录。
 *
 * 规则：
 *   R1（零容忍）  utils/**    不得运行时 import  views/、features/、services/
 *   R2（零容忍）  services/** 不得运行时 import  views/、features/
 *   R3（防回退）  core/**     不得运行时 import  views/、features/（现有违反走基线）
 *   R4（防回退）  features/** 不得运行时 import  views/（现有违反走基线）
 *
 *   `import type` 不构成运行时耦合，一律豁免。
 *   基线文件 docs/.layering-baseline.json：仅允许减少，不允许增加（--update 收紧）。
 *
 * 用法：
 *   node scripts/check-layering.mjs            # R1/R2 违规或 R3/R4 超基线则退 1
 *   node scripts/check-layering.mjs --json     # JSON（CI / 子代理消费）
 *   node scripts/check-layering.mjs --update   # 更新 R3/R4 基线（含当前全部反向边）
 *
 * 退出码：0 通过 / 1 违规。
 * 依赖：node:fs / node:path / node:url / 本地模块
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './_lib/parse-args.ts';
import { walk, toPosix } from './_lib/scan-files.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = resolve(REPO_ROOT, 'frontend', 'src');
const BASELINE_FILE = resolve(REPO_ROOT, 'docs', '.layering-baseline.json');

// 分层（自上而下）：views → features → services → utils → core
// wasm / backend 不入层（胶水/绑定产物），layerOf 返回 null → 天然跳过
const LAYER_ORDER = ['views', 'features', 'services', 'utils', 'core'];

// R1/R2 零容忍：from 层不得 import to 层（当前已满足，防回退）
const ZERO_TOLERANCE = [
  { from: 'utils', to: ['views', 'features', 'services'] },
  { from: 'services', to: ['views', 'features'] },
];

// R3/R4 基线管理：from 层不得 import to 层（现状存在违反，防新增）
const TRACKED_RULES = [
  { from: 'core', to: ['views', 'features'] },
  { from: 'features', to: ['views'] },
];

/* ---------- 收集源文件（复用 _lib/scan-files 共享遍历层） ---------- */
const SCAN_OPTS = {
  exts: ['.ts', '.tsx'],
  skipDir: (n) => n.startsWith('.') || n === 'node_modules' || n === '__tests__' || n === 'test-utils',
  skipFile: /\.(d|test|spec)\.tsx?$/,
};

/** 文件所属层：'views' | 'features' | 'services' | 'utils' | 'core' | null */
function layerOf(srcRelPath) {
  const top = srcRelPath.split('/')[0];
  return LAYER_ORDER.includes(top) ? top : null;
}

/** 解析 import 目标，归一化为相对 src 的路径前缀（如 'views/foo'） */
function resolveTarget(spec, fromSrcRel) {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    const abs = resolve(dirname(resolve(SRC_ROOT, fromSrcRel)), spec);
    const rel = toPosix(relative(SRC_ROOT, abs));
    return rel.startsWith('..') ? null : rel;
  }
  return null; // 裸包名（@wailsio 等）不参与分层判定
}

/* ---------- 扫描 ---------- */
// 匹配 import / export-from 语句，捕获是否 type-only 与来源字符串。
// 用 gm + matchAll 对全文匹配（[^'"]*? 可跨行）：多行具名 import（import {\n a,\n} from 'x'）
// 的 from 在后续行时逐行 exec 会漏报（code_review 实证 frontend/src 存在多行 import）。
const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;

/**
 * 剥离注释与模板字面量（空格等长替换，保持行结构/行号）。
 * 多行匹配启用后 [^'"]*? 可跨行，模板字面量/注释内的 import 形状文本
 * 若不被剥离会误判为真实 import → 幽灵违规（code_review P3）。
 */
function stripNoise(text) {
  return text
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * 提取文本中所有 import/export-from 语句（支持多行）。
 * 返回 [{ spec, typeOnly, line }]（line 为 1-based 起始行）。
 * 导出供契约测试复用（tests/test_check_layering.mjs）。
 */
export function matchImports(text) {
  const clean = stripNoise(text);
  const out = [];
  for (const m of clean.matchAll(IMPORT_RE)) {
    // `import type … from`（整句 type-only），或具名项全部带 `type` 前缀
    const typeOnly =
      Boolean(m[1]) || /^\s*\{\s*(?:type\s+\w+(?:\s+as\s+\w+)?\s*,?\s*)+\}\s*$/.test(m[2]);
    out.push({ spec: m[3], typeOnly, line: clean.slice(0, m.index).split('\n').length });
  }
  for (const b of clean.matchAll(BARE_IMPORT_RE)) {
    out.push({ spec: b[1], typeOnly: false, line: clean.slice(0, b.index).split('\n').length }); // 副作用导入，必为运行时
  }
  return out;
}

/* ---------- 主流程 ---------- */
function main() {
  const parsed = parseArgs(process.argv.slice(2), { bools: ['json', 'update'] });
  // ADR-043 陷阱 #12：未知 flag 显式拒绝，不静默落入默认值（此前 --foo 类误用被忽略）
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(', ')}（支持 --json / --update）`);
    process.exit(1);
  }
  const { json, update } = parsed;
  // ADR-043 fail-closed：SRC_ROOT 缺失 = 扫描不完整，必须显式失败而非空结果假绿
  if (!existsSync(SRC_ROOT)) {
    console.error(`❌ frontend/src 目录不存在（${SRC_ROOT}），扫描不完整，拒绝放行`);
    process.exit(1);
  }
  const violations = [];

  for (const abs of walk(SRC_ROOT, SCAN_OPTS)) {
    const srcRel = toPosix(relative(SRC_ROOT, abs));
    const fromLayer = layerOf(srcRel);
    if (!fromLayer || fromLayer === 'views') continue; // views 是顶层，向下依赖合法

    const text = readFileSync(abs, 'utf8');
    for (const { spec, typeOnly, line } of matchImports(text)) {
      const target = resolveTarget(spec, srcRel);
      if (!target) continue;
      const toLayer = layerOf(target);
      if (!toLayer) continue;
      if (typeOnly) continue; // type-only 豁免

      let rule = null;
      for (let i = 0; i < ZERO_TOLERANCE.length; i++) {
        if (fromLayer === ZERO_TOLERANCE[i].from && ZERO_TOLERANCE[i].to.includes(toLayer)) {
          rule = `R${i + 1}`;
          break;
        }
      }
      if (!rule) {
        for (let i = 0; i < TRACKED_RULES.length; i++) {
          if (fromLayer === TRACKED_RULES[i].from && TRACKED_RULES[i].to.includes(toLayer)) {
            rule = i === 0 ? 'R3' : 'R4';
            break;
          }
        }
      }
      if (!rule) continue;

      violations.push({ rule, from: srcRel, line, to: target, fromLayer, toLayer });
    }
  }

  /* ---------- 基线比对 ---------- */
  const key = (v) => `${v.from}:${v.to}`;
  const rZero = violations.filter((v) => v.rule === 'R1' || v.rule === 'R2');
  const tracked = violations.filter((v) => v.rule === 'R3' || v.rule === 'R4');

  const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null;

  if (update) {
    // P1 守卫（2026-08-17）：基线只许减少（注释已声明，实现此前未拦截）——
    // 新增反向边拒绝写入，除非显式 --force（门禁锐评 P1-3）。
    const force = process.argv.includes('--force');
    const knownPrev = new Set(baseline?.entries ?? []);
    const added = tracked.filter((v) => !knownPrev.has(key(v))).map(key);
    if (added.length > 0 && !force) {
      console.log(`[基线守卫] 新增 ${added.length} 条反向边违规，拒绝更新基线（只许减少）——确认后加 --force 覆盖`);
      console.log(`✖ 基线未更新（存在守卫拦截）`);
      process.exit(1);
    }
    const newEntries = [...new Set(tracked.map(key))].sort();
    // 仅当 entries 内容发生实质性变化时才重写文件：避免 generatedAt 日期在
    // 反向边无增减时被无谓改写 → 触发 git 跟踪 churn（守护契约不受日期影响）。
    const prevSorted = Array.isArray(baseline?.entries) ? [...baseline.entries].sort() : [];
    const unchanged =
      prevSorted.length === newEntries.length &&
      prevSorted.every((e, i) => e === newEntries[i]);
    if (unchanged) {
      console.log(`[layering] 基线无变化（${newEntries.length} 条反向边），跳过写入`);
      process.exit(0);
    }
    const data = {
      _comment: '前端分层反向边基线（R3 core→上层 / R4 features→views）。仅允许减少，不允许增加。更新: node scripts/check-layering.mjs --update',
      generatedAt: new Date().toISOString().slice(0, 10),
      entries: newEntries,
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n');
    console.log(`[layering] 基线已更新: ${relative(REPO_ROOT, BASELINE_FILE)}（${newEntries.length} 条反向边）${force && added.length ? `（--force 覆盖 ${added.length} 条新增）` : ''}`);
    process.exit(0);
  }

  const known = new Set(baseline?.entries ?? []);
  const regressions = tracked.filter((v) => !known.has(key(v)));
  const fixed = [...known].filter((k) => !tracked.some((v) => key(v) === k));

  if (json) {
    console.log(JSON.stringify({
      _summary: {
        zero_tolerance: rZero.length,
        tracked: tracked.length,
        regressions: regressions.length,
        fixed: fixed.length,
      },
      zero_tolerance_violations: rZero,
      regressions,
      fixed,
      baseline: known.size,
      debt: [...tracked.map(key)].sort(), // 当前基线内分层债务（待清理）
    }, null, 2));
    process.exit(rZero.length || regressions.length ? 1 : 0);
  }

  /* ---------- 报告 ---------- */
  console.log('=== 前端分层依赖方向检查 ===');
  console.log('分层: views → features → services → utils → core\n');

  if (rZero.length) {
    console.error(`❌ R1/R2 违规（零容忍：utils/services 向上依赖）${rZero.length} 条：`);
    for (const v of rZero) console.error(`   [${v.rule}] ${v.from}:${v.line} → ${v.to}`);
  } else {
    console.log('✅ R1/R2 utils/services → 上层：0 条');
  }

  const trackedEdges = new Set(tracked.map(key));
  console.log(`\nR3/R4 反向边: ${trackedEdges.size} 条唯一边 / ${tracked.length} 处 import（基线 ${known.size} 条）`);
  if (regressions.length) {
    console.error(`❌ 新增 ${regressions.length} 条反向边（超出基线）：`);
    for (const v of regressions) console.error(`   [${v.rule}] ${v.from}:${v.line} → ${v.to}`);
  }
  if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 条：${fixed.slice(0, 5).join(', ')}${fixed.length > 5 ? ' …' : ''}`);
    console.log('   运行 `node scripts/check-layering.mjs --update` 收紧基线');
  }
  if (trackedEdges.size) {
    console.log(`\n📋 分层债务（基线内待清理，不阻断）：`);
    for (const e of [...trackedEdges].sort()) console.log(`   ${e}`);
  }

  const failed = rZero.length > 0 || regressions.length > 0;
  console.log(failed ? '\n❌ 分层检查未通过' : '\n✅ 分层检查通过');
  process.exit(failed ? 1 : 0);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
