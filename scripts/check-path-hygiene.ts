#!/usr/bin/env node
/**
 * check-path-hygiene.ts — ADR-146 路径卫生门禁。
 *
 * 把「目录级别名 + 反桶契约 + 跨边界冻结」固化为 CI 可执行规则。
 * 启用分两闸（ADR-146 D4）：
 *   闸一（配置闸，本脚本即落点）：别名已登记但 R0 按住不许用，直到闸二脚本改造完成。
 *   闸二（使用闸）：check-layering/check-circular/check-tpl-refs/auto-import* 改造成
 *     别名感知解析 + 单测绿 → 删除 R0 规则 → 启动增量迁移（D5）。
 *
 * 规则：
 *   R0 别名闸       任何含别名（`@/...` / `#root/...`）的 import → FAIL（临时，闸二删此规则）
 *   R1 聚合桶嫌疑   单文件 re-export 来源模块数 ≥ 3 → WARN（观察期；白名单 types-re-export.ts）
 *   R2 目录深度     相对 src/ 的目录层级 > 3 → WARN（观察期）
 *   R3 import 上跳  相对路径 `../` 上跳 > 3 且目标仍在 src 内（真·内部深 wander）→ WARN（观察期）
 *   R4 跨仓根冻结   越过 frontend/src 边界且非 bindings 的引用条数 > 冻结基线 → FAIL
 *   双写一致性      tsconfig.json paths 键集 必须 == vite.config.js alias find 键集 → FAIL
 *
 * R1 度量口径——按 re-export 来源模块数，不按行数/占比（ADR-146 §D3 校准）：
 *   types-re-export.ts 仅 13 行、来源数 1，行数阈值会漏报；本脚本按来源数判定，放过它。
 *
 * R4 冻结基线存于 docs/.path-hygiene-baseline.json：脚本首跑冻结当前实际值；
 *   仅减不增（`--update` 可收紧）；新增跨边界引用即 FAIL（防人工记忆失守）。
 *   口径：相对引用解析后 (a) 落于 src 外（越界）或 (b) == src/e2e/mock-data.ts（ADR 内定入基线）
 *   且非 bindings/**（bindings 由 wails 插件解析，不计入）。
 *
 * 用法：
 *   node scripts/check-path-hygiene.ts          # 违规退 1
 *   node scripts/check-path-hygiene.ts --json   # JSON（CI / pre-push-gate 消费）
 *   node scripts/check-path-hygiene.ts --update # 收紧 R4 冻结基线至当前值
 *
 * 退出码：0 通过（WARN 不阻断）/ 1 含 FAIL（R0 / R4 / 一致性）。
 * 依赖：node:fs / node:path / node:url / 本地模块 _lib/scan-files.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, toPosix } from './_lib/scan-files.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = resolve(REPO_ROOT, 'frontend', 'src');
const TSCONFIG = resolve(REPO_ROOT, 'frontend', 'tsconfig.json');
const VITE_CONFIG = resolve(REPO_ROOT, 'frontend', 'vite.config.js');
const BASELINE_FILE = resolve(REPO_ROOT, 'docs', '.path-hygiene-baseline.json');

const JSON_FLAG = process.argv.includes('--json');
const UPDATE_FLAG = process.argv.includes('--update');

// ---- 规则常量 ----
const R1_BARREL_WHITELIST = new Set(['src/utils/types-re-export.ts']); // 来源数=1 的 bindings 转发垫层
const R1_BARREL_THRESHOLD = 3; // re-export 来源模块数 ≥ 3 → 嫌疑
const R2_DEPTH_MAX = 3; // 目录层级 > 3 → WARN
const R3_UPLEVEL_MAX = 3; // `../` 上跳 > 3 且仍在 src 内 → WARN

// 别名说明符前缀（R0）：`@/` 斜杠紧随 @ 之后，可区别于 npm scope（`@scope/pkg` 不会误判）
const ALIAS_PREFIXES = ['@/', '#root/'];

// 解析前剥离注释，避免注释/反引号字符串里的 `from '...'` 被误判为真实 import
// （例：types-re-export.ts 文档注释含消费方示例，曾致 R4/R0 误报）。保留 `://` 协议头。
function stripComments(src: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return s;
}

// ---- 扫描所有前端源码（rel 模式，相对 SRC_ROOT）----
const files = walk(SRC_ROOT, { rel: true }) as Array<{ abs: string; rel: string }>;

// 预建 src 内文件绝对路径集合，供跨边界判定（是否仍落在 src 内）
const srcAbsSet = new Set(files.map((f) => resolve(f.abs)));

// ---- 收集结果 ----
interface Finding { rule: string; file: string; detail: string; }
const fails: Finding[] = [];
const warns: Finding[] = [];

// R0 / R1 / R3 / R4 计数
let r0Count = 0;
const r1Hits: string[] = [];
const r3Hits: string[] = [];
let r4Count = 0;

// 提取一个文件内全部模块说明符（from '...' / import('...') / import '...'）
const SPEC_RE = /(?:^|[^.\w$])(?:from|import)\s*(?:\(\s*)?(['"])([^'"]+)\1/g;
// 提取 re-export 的 from 说明符（export ... from '...' / export * from '...'）
const REXPORT_RE = /^\s*export\s+(?:type\s+)?(?:\*\s+from|[\s\S]*?\bfrom\s+)(['"])([^'"]+)\1/;

for (const { abs, rel } of files) {
  const code = stripComments(readFileSync(abs, 'utf-8'));
  const relPosix = toPosix(rel);
  const dirOfFile = dirname(abs);

  // ---- R0 别名闸 ----
  let m: RegExpExecArray | null;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(code)) !== null) {
    const spec = m[2];
    if (ALIAS_PREFIXES.some((p) => spec.startsWith(p))) {
      r0Count++;
      fails.push({ rule: 'R0', file: relPosix, detail: `含别名 import：${spec}` });
    }
  }

  // ---- R1 聚合桶嫌疑（按 re-export 来源模块数）----
  const reexportSources = new Set<string>();
  for (const line of code.split('\n')) {
    const rm = REXPORT_RE.exec(line);
    if (rm) reexportSources.add(rm[2]);
  }
  if (reexportSources.size >= R1_BARREL_THRESHOLD && !R1_BARREL_WHITELIST.has(relPosix)) {
    r1Hits.push(`${relPosix}（来源数 ${reexportSources.size}）`);
    warns.push({ rule: 'R1', file: relPosix, detail: `re-export 来源模块数 ${reexportSources.size} ≥ ${R1_BARREL_THRESHOLD}` });
  }

  // ---- R2 目录深度 ----
  const segs = relPosix.split('/');
  const dirDepth = segs.length - 1; // 减文件本身
  if (dirDepth > R2_DEPTH_MAX) {
    warns.push({ rule: 'R2', file: relPosix, detail: `目录层级 ${dirDepth} > ${R2_DEPTH_MAX}` });
  }

  // ---- R3 上跳 / R4 跨边界 ----
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(code)) !== null) {
    const spec = m[2];
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue; // 包导入跳过
    const upLevels = (spec.match(/\.\.\//g) || []).length;
    const targetAbs = resolve(dirOfFile, spec);
    const relFromSrc = toPosix(relative(SRC_ROOT, targetAbs));
    // bindings 物理位于 frontend/bindings（src 之外），其引用相对 src 以 `..` 开头，
    // 故不能按「相对 src 是否以 bindings/ 开头」判定；改为按路径段含 bindings 判定（稳健）。
    const isBindings = toPosix(targetAbs).split('/').includes('bindings');
    if (isBindings) continue; // bindings 由 wails 插件解析，R3/R4 均不计
    const escapesSrc = relFromSrc.startsWith('..'); // 落于 src 外（越界）
    const insideSrc = !escapesSrc;

    // R3：真·内部深 wander（上跳 > 3 且目标仍在 src 内）
    if (upLevels > R3_UPLEVEL_MAX && insideSrc) {
      r3Hits.push(`${relPosix} ← ${spec}`);
      warns.push({ rule: 'R3', file: relPosix, detail: `上跳 ${upLevels} 级且目标仍在 src 内` });
    }

    // R4：越界（落于 src 外）或 == src/e2e/mock-data.ts（ADR 内定入基线）
    const isMockData = toPosix(targetAbs).replace(/\.ts$/, '') === toPosix(resolve(SRC_ROOT, 'e2e/mock-data.ts'));
    if (escapesSrc || isMockData) {
      r4Count++;
    }
  }
}

// ---- 双写一致性：tsconfig.paths 键集 vs vite alias find 键集 ----
// vite 的 find 由 ALIAS_DIRS 动态拼出（模板字面量），无法靠 `find:` 正则还原，
// 故直接在 vite 源码解析 ALIAS_DIRS 数组重建 find 集合，与 tsconfig 键集比对。
function loadTsconfigPathsKeys(): Set<string> {
  const j = JSON.parse(readFileSync(TSCONFIG, 'utf-8'));
  const paths = (j.compilerOptions && j.compilerOptions.paths) || {};
  const keys = new Set<string>();
  for (const k of Object.keys(paths)) keys.add(k.replace(/\/\*$/, '')); // `@/x/*` → `@/x`
  return keys;
}
function loadViteAliasFinds(): Set<string> {
  const txt = readFileSync(VITE_CONFIG, 'utf-8');
  const keys = new Set<string>();
  const m = txt.match(/ALIAS_DIRS\s*=\s*\[([\s\S]*?)\]/);
  if (m) {
    for (const dm of m[1].matchAll(/["']([^"']+)["']/g)) keys.add(`@/${dm[1]}`);
  }
  if (/find:\s*["']#root["']/.test(txt)) keys.add('#root');
  return keys;
}
const tsKeys = loadTsconfigPathsKeys();
const viteKeys = loadViteAliasFinds();
const missingInVite = [...tsKeys].filter((k) => !viteKeys.has(k));
const missingInTs = [...viteKeys].filter((k) => !tsKeys.has(k));
const consistencyOk = missingInVite.length === 0 && missingInTs.length === 0;

// ---- R4 冻结基线 ----
let baseline = 14; // ADR-146 文档意图值（非 bindings 跨边界 14 条）
if (existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')).crossBoundaryNonBindings; } catch { /* 损坏则用默认 */ }
} else if (!JSON_FLAG || true) {
  // 首跑冻结：以当前实际值写入基线文件（只减不增的锚点）
  writeFileSync(BASELINE_FILE, JSON.stringify({ crossBoundaryNonBindings: r4Count }, null, 2) + '\n', 'utf-8');
  baseline = r4Count;
}
if (UPDATE_FLAG && r4Count < baseline) {
  baseline = r4Count;
  writeFileSync(BASELINE_FILE, JSON.stringify({ crossBoundaryNonBindings: r4Count }, null, 2) + '\n', 'utf-8');
}
const r4Ok = r4Count <= baseline;
if (!r4Ok) {
  fails.push({ rule: 'R4', file: '（仓库级）', detail: `跨边界非 bindings 引用 ${r4Count} > 冻结基线 ${baseline}（只减不增）` });
}

// ---- 一致性 FAIL ----
if (!consistencyOk) {
  fails.push({
    rule: 'CONSISTENCY',
    file: 'frontend/{tsconfig.json,vite.config.js}',
    detail: `别名键集不一致：tsconfig有vite缺=[${missingInVite.join(',')}] / vite有tsconfig缺=[${missingInTs.join(',')}]`,
  });
}

// ---- 汇总 ----
const failCount = fails.length;
const warnCount = warns.length;
const ok = failCount === 0;

const summary = {
  ok,
  fail: failCount,
  warn: warnCount,
  r0_alias: { count: r0Count, gate: '临时（闸二删除）' },
  r1_barrel: { hits: r1Hits.length, samples: r1Hits.slice(0, 5) },
  r2_depth: { warns: warns.filter((w) => w.rule === 'R2').length },
  r3_uplevel: { hits: r3Hits.length, samples: r3Hits.slice(0, 5) },
  r4_cross_boundary: { count: r4Count, baseline, ok: r4Ok },
  consistency: { ok: consistencyOk, tsKeys: [...tsKeys].sort(), viteKeys: [...viteKeys].sort() },
};

if (JSON_FLAG) {
  process.stdout.write(JSON.stringify({ _summary: summary, fails, warns }, null, 2) + '\n');
} else {
  process.stdout.write(`check-path-hygiene: ${ok ? 'PASS' : 'FAIL'} (fail=${failCount} warn=${warnCount})\n`);
  if (r0Count) process.stdout.write(`  R0 别名闸: ${r0Count} 条含别名 import（闸二前禁止）\n`);
  if (r1Hits.length) process.stdout.write(`  R1 聚合桶嫌疑: ${r1Hits.join('; ')}\n`);
  if (r3Hits.length) process.stdout.write(`  R3 内部深 wander: ${r3Hits.slice(0, 5).join('; ')}\n`);
  process.stdout.write(`  R4 跨边界冻结: ${r4Count}/${baseline} ${r4Ok ? 'OK' : 'EXCEED'}\n`);
  if (!consistencyOk) process.stdout.write(`  一致性: tsconfig缺=[${missingInTs}] vite缺=[${missingInVite}]\n`);
}

process.exit(ok ? 0 : 1);
