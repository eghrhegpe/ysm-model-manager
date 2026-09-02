#!/usr/bin/env node
/**
 * commit-with-check.ts — 验证 + 自动提交（轻量级提交校验，2026-09-02 重构；
 * ADR-151 临时索引白名单提交，2026-09-01）
 *
 * 定位：commit 阶段的**轻量**校验，与重型 push 门禁（pre-push 钩子）职责分离。
 *   - 本工具只回答「本次变更文件本身有没有问题」——按文件裁剪的廉价检查：
 *     红线 / 文档漂移 / 变更域契约测试（详见 _lib/commit-check.ts）。
 *   - go build / vite build / go test / vitest / link-checker / 全量静态工具等重型验证
 *     **不在本工具范围**，留给 pre-push 钩子（避免与 push 双重付费、小提交纯增成本）。
 *
 * 把 AI 的「确认性循环」压缩为「改代码→commit-with-check」单条命令：轻量门禁全绿才
 * commit，杜绝绕过检查直接提交；重型门禁由 push 阶段的 pre-push 钩子兜底。
 *
 * 并发隔离（ADR-151，2026-09-01）：提交阶段用 commit-temp-index.ts：
 *   GIT_INDEX_FILE 独立临时索引 + read-tree HEAD + add -- paths + commit，
 *   pre-commit 钩子继承临时索引 → gen 产物/gofmt 修复/智能 stage 测试全部落进本次提交，
 *   主 index 零接触。提交后双条件校验：越界文件 exit 1 / 并发插队 notice。
 *   新增 --files <paths> 白名单直取（不依赖先 git add，主 index 空也能提交）。
 *
 * 设计意图：把 AI 的「改代码→确认性循环」压缩为单条命令——轻量门禁（红线 / 文档漂移 /
 *   变更域契约测试）全绿才提交，杜绝绕过检查直接提交；重型验证（gofmt / build / test /
 *   全量静态）交给 pre-push 钩子兜底，避免小提交重复付费。适用场景：并行会话密集提交时，
 *   AI 自行裁剪门禁、路径限定提交，并发隔离由 commit-temp-index 保障（ADR-151）。
 *
 * 用法：
 *   node scripts/commit-with-check.ts -m "feat: xxx"                # 轻量门禁 + 提交（读 staged）
 *   node scripts/commit-with-check.ts -m "feat: xxx" --files a.ts b.ts  # 白名单直取（无需先 add）
 *   node scripts/commit-with-check.ts -m "feat: xxx" --docs         # 仅文档域轻量门禁 + 提交
 *   node scripts/commit-with-check.ts --check                       # 仅验证不提交
 *   node scripts/commit-with-check.ts -m "feat: xxx" --keep-index   # 提交后不清主 index
 *
 * 退出码：
 *   0 — 全绿且已提交（或 --check 模式全绿）
 *   1 — 门禁失败 / 越界文件 / 提交失败，未提交
 *   2 — 用法错误
 *
 * 依赖：_lib/scan-files / _lib/domain-classify / _lib/proc / _lib/commit-check /
 *       _lib/commit-temp-index / _lib/gen-cmds
 */
import { ROOT } from './_lib/scan-files.ts';
import { groupByDomain, domainSummaryText } from './_lib/domain-classify.ts';
import { run } from './_lib/proc.ts';
import { runCommitChecks } from './_lib/commit-check.ts';
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
    console.warn('⚠️  --fast 已移除：轻量提交校验只跑按文件裁剪的检查，不跑重型门禁（go build/vite build 等留待 pre-push）。');
  } else if (a === '-h' || a === '--help') {
    console.log(`用法: node scripts/commit-with-check.ts -m "<msg>" [--files <paths>...] [--docs|--check] [--keep-index]
  -m, --message    commit message（必填，除非 --check）
  --files <paths>  白名单路径直取（无需先 git add；不传则读主 index staged 清单）
  --docs           仅文档域轻量检查（红线/文档漂移/文档契约测试）
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
// 提交/校验双作用域（code_review P2 修复，2026-09-02）：commitWithTempIndex 按 paths
// 从工作区取内容入库，若把「未暂存 docs」也塞进提交白名单，无关的 WIP 改动会被静默
// 卷进提交（0a0fa360 回归）。故：
//   paths       = 提交范围：--files 白名单 / staged docs（--docs）/ staged 全部
//   checkPaths  = 校验范围：--docs 下含未暂存 docs（gen 预刷新产物/草稿，仅校验不入提交）
let paths: string[];
let checkPaths: string[];
if (files.length > 0) {
  paths = files;
  checkPaths = files;
} else if (docsMode) {
  // docs 模式无 --files：提交范围 = staged docs；校验范围 = staged ∪ 工作树 docs
  const stagedDocs = git(['diff', '--cached', '--name-only', '--', 'docs/'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const unstagedDocs = git(['diff', '--name-only', '--', 'docs/'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  paths = stagedDocs;
  checkPaths = [...new Set([...stagedDocs, ...unstagedDocs])];
} else {
  const stagedRaw = git(['diff', '--cached', '--name-only']);
  paths = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];
  checkPaths = paths;
}

if (paths.length === 0 && checkPaths.length === 0) {
  console.error('⚠️  无提交目标。先 git add 再跑，或传 --files <paths> 直取白名单。');
  process.exit(1);
}
if (paths.length === 0 && !checkOnly) {
  // docs 模式仅检测到未暂存 docs：只提交已暂存文件，未暂存 WIP 需显式 git add 或 --files
  //（0a0fa360 回归修复：此前会把未暂存 docs 静默卷进提交）
  console.error('⚠️  仅检测到未暂存的 docs 改动。先 git add docs/ 再跑，或传 --files <paths> 白名单直取（--check 可只校验不提交）。');
  process.exit(1);
}

const byDomain = groupByDomain(paths);
const domainSummary = domainSummaryText(byDomain);

console.log('========== commit-with-check（轻量级提交校验）==========');
console.log(`变更域: ${domainSummary}`);
console.log('门禁: 轻量清单（红线 / 文档漂移 / 变更域契约测试；重型构建留给 pre-push）');
console.log('');

(async () => {
// gen 预刷新（仅文档相关变更）：避免 gen 产物过期 fail-closed
if (docsMode || byDomain.docs?.length || byDomain.adr?.length) {
  let genOk = 0, genFail = 0;
  for (const cmd of GEN_CMDS) {
    const r = run(process.execPath, [`scripts/${cmd}`], {
      cwd: ROOT, stdio: 'ignore', timeout: 30_000,
    });
    if (r.ok) genOk++;
    else genFail++;
  }
  console.log(`[gen] 已预刷新 ${genOk}/${GEN_CMDS.length} 个 gen 脚本${genFail ? `（${genFail} 个失败，不阻断）` : '（全绿）'}`);
}

// 轻量校验：独立清单，不复用 pre-push-gate（避免重型构建/全量静态工具双重付费）
// 校验范围用 checkPaths（--docs 下含未暂存 docs 的校验裁剪）；提交白名单仍是 paths。
const t0 = Date.now();
const check = await runCommitChecks(checkPaths);
const gateMs = Date.now() - t0;

for (const it of check.results) {
  const mark = it.ok ? '✅' : '❌';
  const t = `${(it.time / 1000).toFixed(1)}s`;
  console.log(`${mark} ${it.label}  (${t})${it.note ? '  ' + it.note : ''}`);
}
console.log(`门禁耗时: ${(gateMs / 1000).toFixed(1)}s`);

if (!check.ok) {
  console.log('');
  console.log('结论: FAIL ❌ 轻量门禁未通过，未提交');
  process.exit(1);
}

if (checkOnly) {
  console.log('');
  console.log('结论: PASS ✅ 轻量门禁全绿（仅验证，未提交）');
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
// a) 越界文件（不在 paths ∪ 生成物/测试白名单）→ 自动回退 HEAD 后 exit 1 打印清单
if (commitResult.outOfScope.length > 0) {
  console.error('❌ 提交包含越界文件（不在白名单 paths ∪ 生成物/测试清单），请核查：');
  for (const f of commitResult.outOfScope) console.error(`    ${f}`);
  // 自动回退已提交的 HEAD（--soft 保留工作区改动），AI 不会忽略提示直接 push
  // 注：git() 仅返回 stdout 字符串、吞掉错误，无法判 exitCode；
  //     故回退段直接用 run() 取 ok 标志（ADR-155 重写时遗留的 .exitCode 类型 bug）
  const rollback = run('git', ['-c', 'core.quotepath=false', 'reset', '--soft', 'HEAD~1'], { cwd: ROOT });
  if (!rollback.ok) {
    console.error('❌ 自动回退失败：git reset --soft HEAD~1 未成功执行。');
    console.error('提示：手动执行 git reset --soft HEAD~1 后重新用 --files 白名单提交。');
  } else {
    console.error('已自动回退 HEAD~1（工作区改动保留），请重新用 --files 白名单提交。');
  }
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

console.log('════════════════════════════════════════');
console.log('  ✅ 轻量门禁全绿 + 已提交，可直接执行：git push');
console.log('  （重型门禁 go build/vite build 等由 pre-push 钩子兜底）');
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
})();
