#!/usr/bin/env node
/**
 * commit-with-check.mjs — 验证 + 自动提交的 thin wrapper（ADR-086 配套，2026-08-17 重构）
 *
 * 设计意图：把 AI 的「确认性循环」（改代码→tsc→build→test→git add→commit→git log）
 * 压缩为「改代码→commit-with-check」单条命令——验证委托 pre-push-gate（单一源头），
 * 门禁全绿才 commit，杜绝绕过检查直接提交。
 *
 * 设计（thin wrapper）：
 *   1. 读 git staged files，仅作变更域摘要展示
 *   2. 检查全部委托给 pre-push-gate.mjs（--all --dry-run / --docs --dry-run）
 *      ——检查清单单一源头 = pre-push-gate，不再平行维护第二套
 *   3. 门禁全绿后自动 git commit（message 用数组参数传递，杜绝 shell 注入）
 *   4. 提交后自动显示 SHA + status（省 git log/git status 确认）
 *
 * 用法：
 *   node scripts/commit-with-check.mjs -m "feat: xxx"          # 全量门禁 + 提交
 *   node scripts/commit-with-check.mjs -m "feat: xxx" --docs   # 仅文档域门禁 + 提交
 *   node scripts/commit-with-check.mjs --check                 # 仅验证不提交
 *   node scripts/commit-with-check.mjs --check --docs          # 仅文档域验证
 *
 * 退出码：
 *   0 — 全绿且已提交（或 --check 模式全绿）
 *   1 — 门禁失败，未提交
 *   2 — 用法错误
 *
 * 依赖：_lib/scan-files / _lib/domain-classify / _lib/proc
 */
import { ROOT } from './_lib/scan-files.mjs';
import { groupByDomain, domainSummaryText } from './_lib/domain-classify.mjs';
import { run } from './_lib/proc.mjs';

// ── 参数解析 ──
const args = process.argv.slice(2);
let message = '';
let docsMode = false;
let checkOnly = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-m' || a === '--message') {
    message = args[++i] || '';
  } else if (a === '--docs') {
    docsMode = true;
  } else if (a === '--check') {
    checkOnly = true;
  } else if (a === '--fast') {
    console.warn('⚠️  --fast 已移除：thin wrapper 统一走 pre-push-gate 全量门禁，不再支持跳过 vitest。');
  } else if (a === '-h' || a === '--help') {
    console.log(`用法: node scripts/commit-with-check.mjs -m "<msg>" [--docs|--check]
  -m, --message   commit message（必填，除非 --check）
  --docs          仅文档域检查（等价 pre-push-gate --docs --dry-run）
  --check         仅验证不提交
  --fast          已移除（thin wrapper 统一全量门禁）`);
    process.exit(0);
  }
}

if (!checkOnly && !message) {
  console.error('用法: node scripts/commit-with-check.mjs -m "<msg>" [--docs|--check]');
  process.exit(2);
}

// ── 辅助函数 ──
// Q0 修复（子代理锐评）：加 -c core.quotepath=false，解非 ASCII 文件名八进制转义
// 否则 git diff --cached --name-only 输出转义串 → classify 判 'other' → 零检查静默放行+自动提交
function git(args) {
  const r = run('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT });
  return r.ok ? r.out.trim() : '';
}

function gitArray(args, opts = {}) {
  const r = run('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, ...opts });
  return r.ok ? 0 : (r.rc > 0 ? r.rc : 1);
}

// ── 1. 读 staged files，展示变更域（检查本身委托 pre-push-gate）──
const stagedRaw = git(['diff', '--cached', '--name-only']);
const stagedFiles = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];

if (stagedFiles.length === 0) {
  console.error('⚠️  无 staged files。先 git add 再跑本脚本。');
  process.exit(1);
}

const byDomain = groupByDomain(stagedFiles);
const domainSummary = domainSummaryText(byDomain);

console.log('========== commit-with-check（thin wrapper → pre-push-gate）==========');
console.log(`变更域: ${domainSummary}`);
// P1 修复（子代理锐评）：真按域裁剪——传 staged files 给 --files，让 planFromFiles 算域
console.log(`门禁: ${docsMode ? 'pre-push-gate --docs --dry-run' : 'pre-push-gate --files <staged> --dry-run'}`);
console.log('');

// ── 2. 委托 pre-push-gate（唯一检查清单源头）──
// P1 修复：传 staged files 作 --files 参数，真按域裁剪（替代 --all 全量）
// P2 修复（子代理锐评）：门禁前先跑 gen 刷新索引，解 gen 鸡生蛋
// （门禁跑 gen-docs-index --check，若索引旧则 fail-closed 阻断；而 pre-commit 的 gen 修复在门禁之后才跑——永远轮不到修）
// Q2 修复（子代理再洗礼）：补全 pre-commit 跑的全 11 个 gen，不只 gen-docs-index
// （残余 10 个 gen 产物若过期，门禁静态工具如 funcmap --check 会挂，而修复在 pre-commit 之后才跑——同一鸡生蛋）
// 用 byDomain 判断是否有 docs/adr 域改动（plan 变量在 pre-push-gate 内部，commit-with-check 够不到）
if (docsMode || byDomain.docs?.length || byDomain.adr?.length) {
  const GEN_CMDS = [
    'gen-docs-index.mjs',
    'funcmap.mjs',
    'event-graph.mjs',
    'gen-knowledge-index.mjs',
    'build-novel-index.mjs',
    'gen-project-map.mjs',
    'gen-vitepress-sidebar.mjs',
    'gen-knowledge-h1.mjs',
    'gen-knowledge-symbols.mjs',
    'gen-knowledge-adr.mjs',
    'gen-knowledge-tests.mjs',
    'generate-locale-json.mjs',
  ];
  let genOk = 0, genFail = 0;
  for (const cmd of GEN_CMDS) {
    const r = run(process.execPath, [`scripts/${cmd}`], {
      cwd: ROOT, stdio: 'ignore', timeout: 30_000,
    });
    if (r.ok) genOk++;
    else genFail++;
  }
  console.log(`[gen] 已预刷新 ${genOk}/${GEN_CMDS.length} 个 gen 腚本${genFail ? `（${genFail} 个失败，不阻断，门禁会再检）` : '（全绿）'}`);
}
// Q1 修复（子代理再洗礼）：传 --no-banner 抑制门禁横幅，由本脚本在 commit 成功后自己打印
// （commit-with-check 恒走 dry-run，横幅在自动 commit 前出现会诱导 AI push 旧 HEAD）
const gateArgs = docsMode
  ? ['--docs', '--dry-run', '--no-banner']
  : ['--files', stagedFiles.join('\n'), '--dry-run', '--no-banner'];
let gateRc = 0;
const gate = run(process.execPath, ['scripts/pre-push-gate.mjs', ...gateArgs], {
  cwd: ROOT,
  stdio: 'inherit',
  timeout: 600_000,
});
if (!gate.ok) gateRc = gate.rc > 0 ? gate.rc : 1;

if (gateRc !== 0) {
  console.log('');
  console.log('结论: FAIL ❌ 门禁未通过，未提交');
  process.exit(1);
}

if (checkOnly) {
  console.log('');
  console.log('结论: PASS ✅ 门禁全绿（仅验证，未提交）');
  process.exit(0);
}

// ── 3. 全绿后自动 git commit（数组参数，杜绝命令注入）──
// commit 会触发 pre-commit 钩子（go-coverage-hint/coverage-suggest-hint/check-biome 串行，
// 单包 go test 上限即 20s），30s 默认超时会掐断并可能残留 index.lock；
// 显式 10 分钟超时与下方 pre-push-gate 门禁一致（code review 004563ce P2）。
const commitRc = gitArray(['commit', '-m', message], { timeout: 600_000 });
if (commitRc !== 0) {
  console.error('❌ git commit 失败（可能是 pre-commit 钩子拦截，或 message 格式问题）');
  process.exit(1);
}

// ── 4. 提交后自动显示 SHA + status ──
const sha = git(['rev-parse', '--short', 'HEAD']);
const subject = git(['log', '-1', '--format=%s']);
console.log(`✅ 已提交: ${sha} ${subject}`);
console.log('');

// Q1 修复：横幅在 commit 成功后打印（此时 HEAD 已更新，AI 看到「可直接 push」时 commit 已执行）
console.log('════════════════════════════════════════');
console.log('  ✅ 门禁全绿 + 已提交，可直接执行：git push');
console.log('  （门禁已验，无需再手动跑 doctor --docs / tsc / build 确认）');
console.log('════════════════════════════════════════');
console.log('');

const status = git(['status', '--short']);
if (status) {
  console.log('剩余未暂存改动:');
  console.log(status);
} else {
  console.log('工作区干净，无剩余改动。');
}

// --json 契约（检查类脚本）：末尾无条件输出结构化摘要，供 CI/子代理稳定消费
console.log(JSON.stringify({
  _summary: {
    ok: true,
    mode: docsMode ? 'docs' : 'files',
    checkOnly: !!checkOnly,
    committed: !checkOnly,
    files: stagedFiles.length,
    sha: !checkOnly ? git(['rev-parse', '--short', 'HEAD']) : null,
  },
}));

process.exit(0);