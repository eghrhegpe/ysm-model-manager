#!/usr/bin/env node
/**
 * commit-with-check.ts — 验证 + 自动提交的 thin wrapper（ADR-086 配套，2026-08-17 重构；
 * ADR-151 临时索引白名单提交，2026-09-01）
 *
 * 设计意图：把 AI 的「确认性循环」（改代码→tsc→build→test→git add→commit→git log）
 * 压缩为「改代码→commit-with-check」单条命令——验证委托 pre-push-gate（单一源头），
 * 门禁全绿才 commit，杜绝绕过检查直接提交。
 *
 * 并发隔离（ADR-151，2026-09-01）：旧实现「先 git add 后裸 `git commit -m`」在共享
 * checkout 下会被并行会话的裸 commit 打包整个主 index（实证：go/conc 5 文件被并行
 * fix(hooks) 提交 b4d23b78 卷走）。本版本提交阶段改用 commit-temp-index.ts：
 *   GIT_INDEX_FILE 独立临时索引 + read-tree HEAD + add -- paths + commit，
 *   pre-commit 钩子继承临时索引 → gen 产物/gofmt 修复/智能 stage 测试全部落进本次提交，
 *   主 index 零接触。提交后双条件校验：越界文件 exit 1 / 并发插队 notice。
 *   新增 --files <paths> 白名单直取（不依赖先 git add，主 index 空也能提交）。
 *
 * 设计（thin wrapper）：
 *   1. 读白名单：--files 直取；否则读 git staged files（向后兼容旧用法）
 *   2. 检查全部委托给 pre-push-gate.ts（--files --dry-run / --docs --dry-run）
 *      ——检查清单单一源头 = pre-push-gate，不再平行维护第二套
 *   3. 门禁全绿后临时索引白名单提交（commit-temp-index.ts）
 *   4. 提交后自动显示 SHA + status（省 git log/git status 确认）
 *
 * 用法：
 *   node scripts/commit-with-check.ts -m "feat: xxx"                # 全量门禁 + 提交（读 staged）
 *   node scripts/commit-with-check.ts -m "feat: xxx" --files a.ts b.ts  # 白名单直取（无需先 add）
 *   node scripts/commit-with-check.ts -m "feat: xxx" --docs         # 仅文档域门禁 + 提交
 *   node scripts/commit-with-check.ts --check                       # 仅验证不提交
 *   node scripts/commit-with-check.ts -m "feat: xxx" --keep-index   # 提交后不清主 index
 *
 * 退出码：
 *   0 — 全绿且已提交（或 --check 模式全绿）
 *   1 — 门禁失败 / 越界文件 / 提交失败，未提交
 *   2 — 用法错误
 *
 * 依赖：_lib/scan-files / _lib/domain-classify / _lib/proc / _lib/commit-temp-index / _lib/gen-cmds
 */
import { ROOT } from './_lib/scan-files.ts';
import { groupByDomain, domainSummaryText } from './_lib/domain-classify.ts';
import { run } from './_lib/proc.ts';
import { commitWithTempIndex } from './_lib/commit-temp-index.ts';
import { GEN_CMDS } from './_lib/gen-cmds.ts';

// ── 参数解析 ──
const args = process.argv.slice(2);
let message = '';
let docsMode = false;
let checkOnly = false;
let keepIndex = false;
let files: string[] = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i]!; // noUncheckedIndexedAccess：循环内 i 恒 < length，非空断言安全
  if (a === '-m' || a === '--message') {
    message = args[++i] || '';
  } else if (a === '--docs') {
    docsMode = true;
  } else if (a === '--check') {
    checkOnly = true;
  } else if (a === '--keep-index') {
    keepIndex = true;
  } else if (a === '--files') {
    // 收集后续所有非 `-` 开头参数作为白名单路径（可跨空格；重复 --files 累加）
    while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
      files.push(args[++i]!);
    }
  } else if (a.startsWith('--files=')) {
    files.push(...a.slice('--files='.length).split(/[, ]+/).filter(Boolean));
  } else if (a === '--fast') {
    console.warn('⚠️  --fast 已移除：thin wrapper 统一走 pre-push-gate 全量门禁，不再支持跳过 vitest。');
  } else if (a === '-h' || a === '--help') {
    console.log(`用法: node scripts/commit-with-check.ts -m "<msg>" [--files <paths>...] [--docs|--check] [--keep-index]
  -m, --message    commit message（必填，除非 --check）
  --files <paths>  白名单路径直取（无需先 git add；不传则读主 index staged 清单）
  --docs           仅文档域检查（等价 pre-push-gate --docs --dry-run）
  --check          仅验证不提交
  --keep-index     提交后不清主 index（默认清理已提交路径的暂存态）
  --fast           已移除（thin wrapper 统一全量门禁）`);
    process.exit(0);
  }
}

if (!checkOnly && !message) {
  console.error('用法: node scripts/commit-with-check.ts -m "<msg>" [--files <paths>...] [--docs|--check]');
  process.exit(2);
}

// ── 辅助函数 ──
// Q0 修复（子代理锐评）：加 -c core.quotepath=false，解非 ASCII 文件名八进制转义
// 否则 git diff --cached --name-only 输出转义串 → classify 判 'other' → 零检查静默放行+自动提交
function git(args: string[]) {
  const r = run('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT });
  return r.ok ? r.out.trim() : '';
}

// ── 1. 白名单路径：--files 直取；否则读主 index staged 清单（向后兼容旧用法）──
let paths: string[];
if (files.length > 0) {
  paths = files;
} else {
  const stagedRaw = git(['diff', '--cached', '--name-only']);
  paths = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];
}

if (paths.length === 0) {
  console.error('⚠️  无提交目标。先 git add 再跑，或传 --files <paths> 直取白名单。');
  process.exit(1);
}

const byDomain = groupByDomain(paths);
const domainSummary = domainSummaryText(byDomain);

console.log('========== commit-with-check（thin wrapper → pre-push-gate）==========');
console.log(`变更域: ${domainSummary}`);
console.log(`门禁: ${docsMode ? 'pre-push-gate --docs --dry-run' : 'pre-push-gate --files <paths> --dry-run'}`);
console.log('');

// ── 2. 委托 pre-push-gate（唯一检查清单源头）──
// P1 修复：传 paths 作 --files 参数，真按域裁剪（替代 --all 全量）
// P2 修复（子代理锐评）：门禁前先跑 gen 刷新索引，解 gen 鸡生蛋
// （门禁跑 gen-docs-index --check，若索引旧则 fail-closed 阻断；而 pre-commit 的 gen 修复在门禁之后才跑——永远轮不到修）
// Q2 修复（子代理再洗礼）+ ADR-151 项 6：gen 清单收敛到 _lib/gen-cmds.ts 单一事实源
// （原 commit-with-check 内联 11 个、pre-commit 内联 15 个，漂移 4 个；现统一取全集 15 个）
if (docsMode || byDomain.docs?.length || byDomain.adr?.length) {
  let genOk = 0, genFail = 0;
  for (const cmd of GEN_CMDS) {
    const r = run(process.execPath, [`scripts/${cmd}`], {
      cwd: ROOT, stdio: 'ignore', timeout: 30_000,
    });
    if (r.ok) genOk++;
    else genFail++;
  }
  console.log(`[gen] 已预刷新 ${genOk}/${GEN_CMDS.length} 个 gen 脚本${genFail ? `（${genFail} 个失败，不阻断，门禁会再检）` : '（全绿）'}`);
}
// Q1 修复（子代理再洗礼）：传 --no-banner 抑制门禁横幅，由本脚本在 commit 成功后自己打印
// （commit-with-check 恒走 dry-run，横幅在自动 commit 前出现会诱导 AI push 旧 HEAD）
const gateArgs = docsMode
  ? ['--docs', '--dry-run', '--no-banner']
  : ['--files', paths.join('\n'), '--dry-run', '--no-banner'];
let gateRc = 0;
const gate = run(process.execPath, ['scripts/pre-push-gate.ts', ...gateArgs], {
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

// ── 3. 全绿后临时索引白名单提交（ADR-151 并发隔离）──
// 只提交 paths ∪ pre-commit 钩子 stage 的生成物/测试；主 index 零接触。
const commitResult = commitWithTempIndex({ paths, message, keepIndex });

if (!commitResult.ok) {
  console.error(`❌ git commit 失败（临时索引白名单提交）: ${commitResult.error}`);
  process.exit(1);
}

// ── 4. 提交后双条件校验 ──
// a) 越界文件（不在 paths ∪ 生成物/测试白名单）→ exit 1 打印清单
if (commitResult.outOfScope.length > 0) {
  console.error('❌ 提交包含越界文件（不在白名单 paths ∪ 生成物/测试清单），请核查：');
  for (const f of commitResult.outOfScope) console.error(`    ${f}`);
  console.error('提示：非预期夹带时 git reset --soft HEAD~1 后重新用 --files 白名单提交。');
  process.exit(1);
}
// b) 并发插队（HEAD^ != HEAD_BEFORE）→ 仅 notice 不失败（用户拍板：插队良性，天然 rebase 语义）
if (commitResult.interleaved) {
  console.log('ℹ️  并发提交已插队：本次提交基于插队后的最新 HEAD（HEAD^ != HEAD_BEFORE）。');
}

// ── 5. 提交后自动显示 SHA + status ──
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
    files: paths.length,
    sha: !checkOnly ? git(['rev-parse', '--short', 'HEAD']) : null,
    outOfScope: commitResult.outOfScope,
    interleaved: commitResult.interleaved,
  },
}));

process.exit(0);
