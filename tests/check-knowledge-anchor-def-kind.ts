#!/usr/bin/env node
/**
 * 契约测试：check-knowledge-drift.ts 机制锚「定义归属」增强（WARN 级）。
 *
 * 背景（2026-09）：invariant_anchors 的弱断言（子串包含）会把只 import / re-export /
 * 注释提及该符号的文件也判为命中——AI 照锚索引会摸错文件（实证：theme.md 曾把
 * normalizeTheme 钉在只有 re-export 的 app-modules.ts，真义在 theme-core.ts）。
 * 增强：纯标识符锚额外检查「定义形态 or 真实消费」，两者皆无（仅 import/export 列表/
 * 注释/字符串出现）→ WARN 提示锚疑似指引用处。保持 ERROR 逻辑不变。
 *
 * 验证四件事：
 *   1. 锚指向定义处（export function / Go func）→ 无 WARN
 *   2. 锚指向仅 import 的文件（无消费）→ WARN（ref-only）且带卡名 + 文件 + 符号
 *   3. 锚指向 re-export 转发文件且无消费 → WARN（theme.md 历史案例形态）
 *   4. 锚指向有真实消费（函数实参传参）的文件 → 无 WARN（consumed）
 *   5. 非纯标识符锚（含空格描述）→ 不触发本增强（机制出现语义合法）
 *   6. WARN 级不阻断 → 退出码 0
 *
 * 隔离策略：锚源文件放 ROOT/tmp/（.gitignore 已忽略该目录，历史教训 88daf2a2 防误入库），
 * 卡片目录经 --kc-dir 指向系统临时目录——锚 file 相对 ROOT 解析，两全其美。
 *
 * 用法：node tests/check-knowledge-anchor-def-kind.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, 'scripts');
const NODE = process.execPath;
const errors = [];

// 临时锚源文件放 ROOT/tmp/（git 忽略，不入库；用后即删）
const TMP_SRC_DIR = path.join(ROOT, 'tmp', 'anchor-def-contract');
fs.mkdirSync(TMP_SRC_DIR, { recursive: true });
// 卡片目录用系统临时目录 + --kc-dir（同 body-line-refs 范式）
const KC_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-anchor-def-contract-'));
const TMP_CARD = path.join(KC_TMP_DIR, 'zzz-anchor-def-tmp.md');
const CARD_STEM = 'zzz-anchor-def-tmp';

const ANCHOR_HINT = '疑似指向引用处而非定义处';

function run(script, ...args) {
  return spawnSync(NODE, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf-8',
    timeout: 60000,
  });
}

function ok(label, cond, detail = '') {
  if (cond) console.log(`   ✓ ${label}`);
  else errors.push(`[${label}] ${detail}`);
}

function writeSrc(name, content) {
  const full = path.join(TMP_SRC_DIR, name);
  fs.writeFileSync(full, content, 'utf8');
  return `tmp/anchor-def-contract/${name}`; // 相对 ROOT 的 POSIX 路径（锚 file 以此解析）
}

function writeCard(anchor) {
  const srcRel = anchor.split('|')[0];
  const fm = [
    '---',
    `kind: ${CARD_STEM}`,
    'name: 机制锚定义归属契约测试临时卡',
    'tier: architecture',
    'category: utils',
    'source_files:',
    `  - ${srcRel}`,
    'use_when:',
    '  - 临时测试',
    'invariant_anchors:',
    `  - ${anchor}`,
    '---',
    '',
    '# 机制锚定义归属契约测试临时卡',
    '',
    '契约测试用临时卡，测完即删。',
    '',
  ].join('\r\n');
  fs.writeFileSync(TMP_CARD, fm, 'utf8');
}

function runDrift() {
  const r = run('check-knowledge-drift.ts', '--json', '--kc-dir', KC_TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

function hasAnchorWarn(out) {
  return out.warns.some((w) => w.includes(CARD_STEM) && w.includes(ANCHOR_HINT));
}

console.log('=== 机制锚「定义归属」增强契约（WARN 级）===');

try {
  // 1. 锚指向定义处（export function）→ 无 WARN
  writeSrc('def1.ts', 'export function anchorDef1() { return 1; }\n');
  writeCard('tmp/anchor-def-contract/def1.ts|anchorDef1');
  let { status, out } = runDrift();
  ok('锚指 export function 定义处 → 无 WARN', !hasAnchorWarn(out), `不应 WARN: ${out.warns.join('; ').slice(0, 300)}`);
  ok('退出码 0（WARN 不阻断）', status === 0, `status=${status}`);

  // 2. 锚指向仅 import 无消费的文件 → WARN（ref-only）
  writeSrc('def2.ts', 'export function importOnlySym() {}\n');
  writeSrc('consumer2.ts', 'import { importOnlySym } from "./def2.ts";\n');
  writeCard('tmp/anchor-def-contract/consumer2.ts|importOnlySym');
  ({ status, out } = runDrift());
  const warn2 = out.warns.find((w) => w.includes(CARD_STEM) && w.includes(ANCHOR_HINT)) || '';
  ok(
    '锚指仅 import 文件 → WARN 且带卡名+符号+文件',
    warn2.includes(CARD_STEM) && warn2.includes('importOnlySym') && warn2.includes('consumer2.ts'),
    `期望 WARN 含三要素: ${out.warns.join('; ').slice(0, 400)}`
  );
  ok('退出码 0（WARN 不阻断）', status === 0, `status=${status}`);

  // 3. 锚指向 re-export 转发文件且无消费 → WARN（theme.md 历史案例形态）
  writeSrc('def3.ts', 'export function reExportTarget() {}\n');
  writeSrc('barrel3.ts', 'export { reExportTarget } from "./def3.ts";\n');
  writeCard('tmp/anchor-def-contract/barrel3.ts|reExportTarget');
  ({ status, out } = runDrift());
  ok(
    '锚指 re-export 无消费 → WARN',
    hasAnchorWarn(out) && out.warns.some((w) => w.includes('reExportTarget')),
    `期望 WARN 含 reExportTarget: ${out.warns.join('; ').slice(0, 400)}`
  );

  // 4. 锚指向有真实消费（函数实参传参）→ 无 WARN（consumed）
  writeSrc('def4.ts', 'export const opts4 = { a: 1 };\nexport function runner(x: unknown) { return x; }\n');
  writeSrc('user4.ts', 'import { opts4 } from "./def4.ts";\nrunner(opts4);\n');
  writeCard('tmp/anchor-def-contract/user4.ts|opts4');
  ({ status, out } = runDrift());
  ok(
    '锚指有真实消费文件 → 无 WARN',
    !hasAnchorWarn(out),
    `不应出现 ref-only WARN: ${out.warns.join('; ').slice(0, 400)}`
  );

  // 5. 纯标识符锚的 Go 定义（func）→ 无 WARN
  writeSrc('gofile.go', 'package anchor\n\nfunc AnchorGoFunc() {}\n');
  writeCard('tmp/anchor-def-contract/gofile.go|AnchorGoFunc');
  ({ status, out } = runDrift());
  ok('Go func 定义形态 → 无 WARN', !hasAnchorWarn(out), `Go 定义不应 WARN: ${out.warns.join('; ').slice(0, 400)}`);

  // 6. 非纯标识符锚（含空格描述）→ 不触发本增强（机制出现语义合法）
  writeSrc('note.ts', '// 说明：这里提到 buildFancySchema 相关机制\n');
  writeCard('tmp/anchor-def-contract/note.ts|buildFancySchema 相关');
  ({ status, out } = runDrift());
  ok(
    '非纯标识符锚 → 不触发 ref-only WARN',
    !hasAnchorWarn(out),
    `非纯标识符锚不应触发: ${out.warns.join('; ').slice(0, 400)}`
  );

  // 7. 真 ERROR 仍阻断：锚模式在文件中完全不存在 → ERROR（fail-closed 不回归）
  writeCard('tmp/anchor-def-contract/def1.ts|ghostSymbolXYZ');
  ({ status, out } = runDrift());
  ok(
    '锚符号不存在 → ERROR（fail-closed 保持）',
    out.errors.some((e) => e.includes('机制锚失效') && e.includes('ghostSymbolXYZ')),
    `期望 ERROR: ${out.errors.join('; ').slice(0, 400)}`
  );
  ok('ERROR → 退出码 1', status === 1, `status=${status}`);
} finally {
  fs.rmSync(TMP_SRC_DIR, { recursive: true, force: true });
  if (fs.existsSync(KC_TMP_DIR)) fs.rmSync(KC_TMP_DIR, { recursive: true, force: true });
}

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('OK: 机制锚定义归属增强契约全过');
