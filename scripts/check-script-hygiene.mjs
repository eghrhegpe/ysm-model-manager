#!/usr/bin/env node
/**
 * check-script-hygiene.mjs — scripts/ 工具脚本卫生检查（四口径，WARN 级不阻断）。
 *
 * 口径沉淀自 2026-08-04 全量审核，并扩展对齐两端 README 同款
 * 「脚本文件头规范（统一约定）」节（MikuMikuAR ↔ ysm-model-manager 共用）：
 *   1. 退出码失效：裸 `main();` 调用但 main 内靠 `return 1` 传失败（无 process.exit）
 *      → 退出码恒 0，CI/调用方误判成功（new-knowledge-card.mjs 曾中招）；
 *   2. 共享层内联：内联 `function walk(` / `function rg(` /
 *      `path.resolve(path.dirname(fileURLToPath(...)))` 样板
 *      → 违反 scripts/README.md「共享能力一律 import 自 _lib/，禁止内联样板」；
 *   3. --json 契约：检查类脚本（check-* / *-check / review / doctor / link-checker /
 *      type-consistency / event-audit / binding-check / adr-check / pre-push-gate）
 *      应支持 `--json` 或无条件输出 JSON → 子代理/CI 可稳定消费；
 *   4. 【本仓库扩展】文件头 5 字段：顶部 JSDoc 必须含
 *      文件名+描述 / 依赖声明 / 用法 / 退出码 /（推荐）设计意图，
 *      对齐两端统一文档约定，使规范可机检、可自执行。
 *
 * 设计意图：让 MikuMikuAR 与 ysm-model-manager 共用一套 .mjs 文档约定可被机检、
 *           可自执行，把统一的「文件头规范」从纸面落到 CI/子代理可消费的卡点。
 * 依赖：零依赖（node:fs / node:path / node:url）
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
  if (INLINE_WALK_RE.test(text)) out.push('内联 walk() 定义（应 import 共享层 _lib/，如 _lib/scan-files.mjs）');
  if (INLINE_RG_RE.test(text)) out.push('内联 rg() 定义（应 import 共享层 _lib/，如 _lib/ripgrep.mjs）');
  if (INLINE_BOILERPLATE_RE.test(text)) {
    out.push('内联 ROOT 样板 path.resolve(dirname(fileURLToPath(...)))（新脚本应 import 共享层 _lib/ 的 ROOT/getRoot）');
  }
  return out;
}

// ── 检查 3：--json 契约 ────────────────────────────────

const CHECK_TOOL_RE =
  /^(check-|adr-check|binding-check|event-audit|comment-checker|link-checker|type-consistency|review|doctor|pre-push-gate)|-check\.mjs$/;

function checkJsonContract(file, text) {
  if (!CHECK_TOOL_RE.test(file)) return [];
  const hasJsonFlag = /['"]--json['"]|\-\-json/.test(text);
  const hasJsonOutput = /JSON\.stringify\(/.test(text);
  if (!hasJsonFlag && !hasJsonOutput) {
    return ['检查类脚本无 --json flag 也无 JSON.stringify 输出 → 子代理/CI 无法稳定消费'];
  }
  return [];
}

// ── 检查 4：文件头 5 字段（统一文档约定）─────────────────

/** 提取文件顶部第一个 JSDoc 块（不含后续注释）。 */
function extractHeader(text) {
  const start = text.indexOf('/**');
  if (start < 0) return null;
  const end = text.indexOf('*/', start);
  if (end < 0) return null;
  return text.slice(start, end + 2);
}

function checkHeader(file, text) {
  const head = extractHeader(text);
  if (!head) return [`[文件头] ${file} 缺少 JSDoc 文件头`];
  const issues = [];
  if (!/\.mjs\s*[—-]/.test(head)) {
    issues.push(`[文件头] ${file} 缺「文件名 + 描述」(格式: * <name>.mjs — <描述>)`);
  }
  if (!/(零依赖|依赖[:：])/.test(head)) {
    issues.push(`[文件头] ${file} 缺「依赖声明」(零依赖 或 外部依赖)`);
  }
  if (!/用法/.test(head)) {
    issues.push(`[文件头] ${file} 缺「用法」块`);
  }
  if (!/退出码/.test(head)) {
    issues.push(`[文件头] ${file} 缺「退出码」说明`);
  }
  if (!/(设计意图|意图|适用场景)/.test(head)) {
    issues.push(`[文件头] ${file} 建议补充「设计意图」(为何存在/适用场景)`);
  }
  return issues;
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  const files = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && !f.endsWith('.test.mjs'))
    .sort();

  const warns = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
    const issues = [
      ...checkExitCode(text).map((m) => `${f}: ${m}`),
      ...checkSharedLayer(text).map((m) => `${f}: ${m}`),
      ...checkJsonContract(f, text).map((m) => `${f}: ${m}`),
      ...checkHeader(f, text),
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
