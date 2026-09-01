#!/usr/bin/env node
/**
 * check-script-hygiene.ts — scripts/ 工具脚本卫生检查（四口径，WARN 级不阻断）。
 *
 * 口径沉淀自 2026-08-04 全量审核，并扩展对齐两端 README 同款
 * 「脚本文件头规范（统一约定）」节（MikuMikuAR ↔ ysm-model-manager 共用）：
 *   1. 退出码失效：裸 `main();` 调用但 main 内靠 `return 1` 传失败（无 process.exit）
 *      → 退出码恒 0，CI/调用方误判成功（new-knowledge-card.ts 曾中招）；
 *   2. 共享层内联：内联 `function rg(` /
 *      `path.resolve(path.dirname(fileURLToPath(...)))` 样板 /
 *      内联 `function parseArgs(`
 *      → 违反 scripts/README.md「共享能力一律 import 自 _lib/，禁止内联样板」；
 *      带显式扩展名过滤/跳过集合的领域专用 walker（如 .md/.go 收集器）视为合法内联，不告警。
 *   3. --json 契约：检查类脚本（check-* / *-check / review / doctor / link-checker /
 *      type-consistency / event-audit / binding-check / adr-check / pre-push-gate）
 *      应支持 `--json` 或无条件输出 JSON → 子代理/CI 可稳定消费；
 *   4. 【本仓库扩展】文件头 5 字段：顶部 JSDoc 必须含
 *      文件名+描述 / 依赖声明 / 用法 / 退出码 /（推荐）设计意图，
 *      对齐两端统一文档约定，使规范可机检、可自执行；
 *   5. 【2026-08-30 新增】positional 脚本须走 parse-args：手写 argv 解析且消费位置参数的
 *      脚本无未知 flag 白名单拦截（`--jso` 拼错静默当默认行为，audit-split 曾中招）；
 *      import 了 parseArgs 却不消费 `args.unknown` 同样告警。
 *   6. 【2026-08-31 新增】孤儿脚本：未被流水线挂载（git 钩子 / pre-push-gate / Taskfile /
 *      Actions / package.json）、无 scripts/ 内脚本调用、文档无记录的脚本——化石风险，
 *      建议归档或补登记。判定内核来自 _lib/orphan-classify.ts（WARN 不阻断）。
 *
 * 设计意图：让 MikuMikuAR 与 ysm-model-manager 共用一套 .mjs 文档约定可被机检、
 *           可自执行，把统一的「文件头规范」从纸面落到 CI/子代理可消费的卡点。
 * 依赖：零依赖（node:fs / node:path / node:url）
 *
 * 用法：
 *   node scripts/check-script-hygiene.ts           # 文本报告
 *   node scripts/check-script-hygiene.ts --json    # JSON（CI 用）
 *   node scripts/check-script-hygiene.ts --strict  # 有 WARN → 退出码 1
 *
 * 退出码：默认 0（提示工具）；--strict 且存在 WARN → 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { collectScripts } from './_lib/collect-scripts.ts';
import { findOrphans } from './_lib/orphan-classify.ts';

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
const INLINE_BOILERPLATE_RE = /path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\)\)|const __dirname = path\.dirname\(fileURLToPath\(import\.meta\.url\)\);\r?\nconst ROOT = path\.resolve\(__dirname, '\.\.'\)/;
const INLINE_PARSEARGS_RE = /^function parseArgs\(|^const parseArgs\s*=/m;

// 领域收集器特征：带显式扩展名过滤 / 跳过集合 / 回调的专用 walk 视为合法内联，不告警。
const DOMAIN_WALK_RE =
  /endsWith\(\s*['"]\.(md|go|tsx|jsx|ts)['"]|EXCLUDE|SKIP_DIRS|symbolExclude|onFile|ts\|tsx|js\|jsx/;

/** 取 walk 定义后的函数体窗口（到下一个顶层声明或 1200 字符）。 */
function extractWalkWindow(text) {
  const m = text.match(INLINE_WALK_RE);
  if (!m) return null;
  const rest = text.slice(m.index);
  const next = rest.slice(1).search(/\n(function |const |let |export |import )/);
  const end = next >= 0 ? next + 1 : Math.min(rest.length, 1200);
  return rest.slice(0, end);
}

/** 仅当 walk 为通用样板时告警；领域专用收集器放行。 */
function isDomainWalk(text) {
  const win = extractWalkWindow(text);
  return !!win && DOMAIN_WALK_RE.test(win);
}

function checkSharedLayer(text) {
  const out: string[] = [];
  if (INLINE_WALK_RE.test(text) && !isDomainWalk(text)) {
    out.push('内联 walk() 定义（应 import 共享层 _lib/，如 _lib/scan-files.ts）');
  }
  if (INLINE_RG_RE.test(text)) out.push('内联 rg() 定义（应 import 共享层 _lib/，如 _lib/ripgrep.ts）');
  if (INLINE_PARSEARGS_RE.test(text)) {
    out.push('内联 parseArgs() 定义（应 import 共享层 _lib/，如 _lib/parse-args.ts）');
  }
  if (INLINE_BOILERPLATE_RE.test(text)) {
    out.push('内联 ROOT 样板 path.resolve(dirname(fileURLToPath(...)))（新脚本应 import 共享层 _lib/ 的 ROOT/getRoot）');
  }
  return out;
}


// ── 检查 3：--json 契约 ────────────────────────────────

const CHECK_TOOL_RE =
  /^(check-|adr-check|binding-check|event-audit|comment-checker|link-checker|type-consistency|review|doctor|pre-push-gate)|-check\.(mjs|ts)$/;

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
  const issues: string[] = [];
  if (!/\.(mjs|ts)\s*[—-]/.test(head)) {
    issues.push(`[文件头] ${file} 缺「文件名 + 描述」(格式: * <name>.mjs|.ts — <描述>)`);
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

// ── 检查 5：positional 脚本须走 parse-args ──────────────

const HANDWRITTEN_ARGV_RE = /process\.argv\.slice\(2\)|process\.argv\.includes\(|process\.argv\[2\]/;
/** 位置参数消费特征：手写「跳过 -- 开头取裸参」find，或直接取 argv[2]/argv[0] 当值。 */
const HANDWRITTEN_POSITIONAL_RE =
  /\.find\(\s*\(?\w+\)?\s*=>\s*!\w+\.startsWith\('--'\)|process\.argv\[2\]/;
// 仅匹配真实 import 语句（行首锚定 + `import {…} from`），避免误把建议文案里的
// 字符串 `...from './_lib/parse-args.ts'`（如 check-lib-adoption.ts 的 advice 字段）
// 当成脚本真的 import 了 parseArgs 而误报「未消费 unknown」（2026-08-31 审计修复）。
const PARSEARGS_IMPORT_RE = /^[ \t]*import\s+\{[^}]*\}\s+from\s+['"]\.\/_lib\/parse-args\.(mjs|ts)['"];?/m;

function checkArgvContract(text) {
  const usesParseArgs = PARSEARGS_IMPORT_RE.test(text);
  if (!usesParseArgs) {
    if (HANDWRITTEN_ARGV_RE.test(text) && HANDWRITTEN_POSITIONAL_RE.test(text)) {
      return ['手写 argv 解析且消费 positional 参数 → 应迁 _lib/parse-args.ts（unknown 白名单拦截，防 --jso 拼错静默放行）'];
    }
    return [];
  }
  // import 了 parseArgs 但没消费 unknown → 拼错 flag 仍静默通过，白名单形同虚设
  // 两种合法消费形态都认：属性访问 `args.unknown.length`（含别名如 raw.unknown）与
  // 解构 `const { unknown } = parseArgs(...)`——i18n-check.ts 曾因解构形式被误报。
  const consumesUnknown =
    /\.unknown\b/.test(text) ||           // 属性访问（args.unknown / raw.unknown）
    /\{\s*[^}]*\bunknown\b[^}]*\}\s*=\s*parseArgs\s*\(/.test(text) || // 解构取值
    /\bunknown\s*&&\s*unknown\.length/.test(text) ||                  // 直接消费
    /\bunknown\s*\.length/.test(text);                                // 别名消费
  if (!consumesUnknown) {
    return ['import parseArgs 但未消费 args.unknown 白名单（应 unknown.length 时退非 0）'];
  }
  return [];
}

// ── 检查 6：孤儿脚本 ─────────────────────────────────
// 判定内核来自 _lib/orphan-classify.ts（四态：mounted / called / documented / orphan）。
// 跨脚本关系判定（谁挂载/谁调用/谁文档记录），不在 per-file 循环内做；WARN 不阻断。
// 2026-08-31 全量审计后真孤儿归零，常态为零告警；一旦有新脚本无人引用即在此浮出。

function checkOrphans() {
  const orphans = findOrphans();
  return orphans.map((o) => `${o.script}: 孤儿脚本——${o.reason}（建议归档或补登记）`);
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  // skipHooks：git 钩子协议参数（prepare-commit-msg 的 $1/$2、pre-push stdin 等）由
  // git 约定固定、非 CLI 用户输入，不适用 parse-args positional 口径（2026-08 审核）。
  // _ 前缀共享层（_lib 等）按设计允许内联样板，同样排除。
  const files = collectScripts({ skipHooks: true });

  const warns: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
    const issues = [
      ...checkExitCode(text).map((m) => `${f}: ${m}`),
      ...checkSharedLayer(text).map((m) => `${f}: ${m}`),
      ...checkJsonContract(f, text).map((m) => `${f}: ${m}`),
      ...checkArgvContract(text).map((m) => `${f}: ${m}`),
      ...checkHeader(f, text),
    ];
    warns.push(...issues);
  }
  // 检查 6：孤儿脚本（全局跨脚本判定，独立于 per-file 循环）
  warns.push(...checkOrphans());

  if (JSON_OUT) {
    // _summary.ok 对齐 --json 契约（pre-push-gate runTools 优先读 s.ok）：
    // 默认模式 WARN 不阻断 → ok=true（提示工具）；--strict 模式有 WARN 即不通过。
    const ok = STRICT ? warns.length === 0 : true;
    console.log(JSON.stringify({ _summary: { scripts: files.length, warns: warns.length, ok }, warns }, null, 2));
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
