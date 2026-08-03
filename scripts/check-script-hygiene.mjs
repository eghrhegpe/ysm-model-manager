#!/usr/bin/env node
/**
 * check-script-hygiene.mjs — scripts/ 工具脚本卫生检查（三项口径，WARN 级不阻断）。
 *
 * 口径沉淀自 2026-08-04 全量审核（AGENTS.md 陷阱 #12 的推广检查）：
 *   1. 退出码失效：裸 `main();` 调用但 main 内靠 `return 1` 传失败（无 process.exit）
 *      → 退出码恒 0，CI/调用方误判成功（new-knowledge-card.mjs 曾中招）；
 *   2. 共享层内联：内联 `function walk(` / `function rg(` /
 *      `path.resolve(path.dirname(fileURLToPath(...)))` 样板
 *      → 违反 scripts/README.md「共享层强制接入约定」（新脚本必须 import _lib/）；
 *   3. --json 契约：检查类脚本（check-* / adr-check / binding-check / event-audit /
 *      comment-checker / link-checker / type-consistency / review / doctor /
 *      pre-push-gate）应支持 `--json` 或无条件输出 JSON → 子代理/CI 可稳定消费。
 *
 * 用法：
 *   node scripts/check-script-hygiene.mjs           # 文本报告
 *   node scripts/check-script-hygiene.mjs --json    # JSON（CI 用）
 *   node scripts/check-script-hygiene.mjs --strict  # 有 WARN → 退出码 1
 *
 * 退出码：默认 0（提示工具）；--strict 且存在 WARN → 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

// ── 检查 1：退出码失效 ─────────────────────────────────

/** 裸 main(); 调用但 main 内靠 return 传失败、无 process.exit 兜底 → 退出码恒 0。 */
function checkExitCode(text) {
  const hasBareMain = /^main\(\);\s*$/m.test(text);
  if (!hasBareMain) return [];
  const hasProcessExit = /process\.exit\(/.test(text);
  // 只从 `function main(` 位置向后判定 return 失败码——避免误把
  // main 之前的内部函数（如排序比较器 return 1）算作 main 的失败返回。
  const mainIdx = text.indexOf('function main(');
  const tail = mainIdx >= 0 ? text.slice(mainIdx) : text;
  const mainReturnsFailure = /\breturn\s+[1-9]\d*\s*;/.test(tail);
  if (!hasProcessExit && mainReturnsFailure) {
    return ['裸 main(); 调用且 main 内 return 失败码、无 process.exit 兜底 → 退出码恒 0，建议 process.exit(main())'];
  }
  return [];
}

// ── 检查 2：共享层内联 ─────────────────────────────────

const INLINE_WALK_RE = /^function walk\(|^const walk\s*=/m;
const INLINE_RG_RE = /^function rg\(|^const rg\s*=|execFileSync\([^)]*['"]rg['"]/m;
const INLINE_BOILERPLATE_RE = /path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/;

function checkSharedLayer(text) {
  const out = [];
  if (INLINE_WALK_RE.test(text)) out.push('内联 walk() 定义（应 import _lib/scan-files.mjs）');
  if (INLINE_RG_RE.test(text)) out.push('内联 rg() 定义（应 import _lib/ripgrep.mjs）');
  if (INLINE_BOILERPLATE_RE.test(text)) {
    out.push('内联 ROOT 样板 path.resolve(dirname(fileURLToPath(...)))（新脚本应 import _lib/scan-files.mjs 的 ROOT/getRoot）');
  }
  return out;
}

// ── 检查 3：--json 契约 ────────────────────────────────

const CHECK_TOOL_RE = /^(check-|adr-check|binding-check|event-audit|comment-checker|link-checker|type-consistency|review|doctor|pre-push-gate)/;

function checkJsonContract(file, text) {
  if (!CHECK_TOOL_RE.test(file)) return [];
  const hasJsonFlag = /['"]--json['"]|\-\-json/.test(text);
  const hasJsonOutput = /JSON\.stringify\(/.test(text);
  if (!hasJsonFlag && !hasJsonOutput) {
    return ['检查类脚本无 --json flag 也无 JSON.stringify 输出 → 子代理/CI 无法稳定消费'];
  }
  return [];
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  const files = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();

  const warns = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
    const issues = [
      ...checkExitCode(text).map((m) => `${f}: ${m}`),
      ...checkSharedLayer(text).map((m) => `${f}: ${m}`),
      ...checkJsonContract(f, text).map((m) => `${f}: ${m}`),
    ];
    warns.push(...issues);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { scripts: files.length, warns: warns.length }, warns }, null, 2));
    if (STRICT && warns.length) process.exit(1);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 脚本卫生检查 (check-script-hygiene)');
  console.log('══════════════════════════════════════');
  console.log(`扫描 ${files.length} 个脚本，WARN ${warns.length} 条`);
  console.log('──────────────────────────────────────');
  for (const w of warns) console.log(`⚠ ${w}`);
  if (!warns.length) console.log('✅ 未发现脚本卫生问题。');
  else console.log('\n（WARN 不阻断；加 --strict 后退出码 1）');
  if (STRICT && warns.length) process.exit(1);
}

main();
