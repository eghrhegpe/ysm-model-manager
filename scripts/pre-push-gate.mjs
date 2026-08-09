#!/usr/bin/env node
/**
 * pre-push-gate.mjs — 本地质量门禁核心（.githooks/pre-push 的调度器）。
 *
 * 设计目标：CI 红之前，本地先红。按变更域（Go / 前端 / 数据 / 文档）只跑相关检查；
 * 可自动修复的（gofmt）amend 进提交；需人工的（构建失败、断链、契约失败）阻断推送。
 *
 * 用法（由 .githooks/pre-push 调用）：
 *   node scripts/pre-push-gate.mjs <remote-name> <remote-url>
 *     标准输入：每行 `<local ref> <local oid> <remote ref> <remote oid>`
 *   node scripts/pre-push-gate.mjs --dry-run <remote-name> <remote-url>
 *     只检查不修改（跳过 gofmt 修复/amend，失败不阻断），供调试与 CI 复用
 *
 * 已知坑（2026-08-03 确认，2026-08-07 更新）：
 *   - link-checker.mjs / type-consistency.mjs 正常路径退出码恒 0，
 *     必须用 --json 解析 _summary 判定，不得依赖退出码；
 *     type-consistency 数据损坏/缺失的 fatal 路径现在 exit 1（+哨兵 _summary.issues=9999，code_review P3）。
 *   - Windows 下 npx 是 npx.cmd，node spawn 需 shell:true。
 * 设计意图：pre-push-gate 工具脚本
 * 依赖：node:child_process / node:fs / node:path / node:url
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, toPosix } from './_lib/scan-files.mjs';
import { run as procRun } from './_lib/proc.mjs';


const B = { OK: '[OK]', FAIL: '[FAIL]', FIX: '[FIX]', SKIP: '[SKIP]' };
const TIMEOUT = 300_000;
/** 远端领先提示（SKIP 与 FAIL 共用，避免重复长文案） */
const PULL_HINT = '提示: git 报 rejected/non-fast-forward 时先 git pull 整合远端再重推。';

/* ---------------- 工具 ---------------- */

function sh(cmd, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  /** shell 执行命令（win32 兼容 .cmd），返回 { rc, out }。
   * 统一委托 _lib/proc.mjs（超时/错误分类契约；shell:true 时 win32 走 cmd.exe、
   * POSIX 走 /bin/sh，承载管道/重定向命令）。 */
  const r = procRun(cmd, [], { cwd, timeout, shell: true });
  return { rc: r.rc, out: r.out };
}

/**
 * shell 参数转义：文件名等动态值拼入命令字符串前必须包裹，防止含空格/元字符
 * 的路径被 shell 拆词或注入（code_review P1）。win32 走 cmd.exe 用双引号（"→""），
 * 其余平台走 /bin/sh 用单引号（'→'\''）。
 */
function shq(s) {
  const str = String(s);
  if (process.platform === 'win32') return `"${str.replace(/"/g, '""')}"`;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function git(args, { cwd = ROOT } = {}) {
  // core.quotepath=false：非 ASCII 文件名输出原始 UTF-8，避免引号/八进制转义破坏域匹配
  return sh(`git -c core.quotepath=false ${args}`, { cwd });
}

/* ---------------- 变更域分析 ---------------- */

const DATA_FILES = new Set([
  'resource_types.json', 'creators.json', 'workshop_sites.json', 'workshop-github.json',
]);

function classify(f) {
  /** 文件路径 → 域。返回 'go' | 'frontend' | 'data' | 'docs' | 'tests' | 'other'。 */
  if (f.endsWith('.go')) return 'go';
  if (f === 'wails.json') return 'frontend';
  if (f.startsWith('frontend/')) return 'frontend';
  if (DATA_FILES.has(f)) return 'data';
  if (f.startsWith('docs/') || f.endsWith('.md')) return 'docs';
  if (f.startsWith('tests/') || f.startsWith('scripts/')) return 'tests';
  return 'other';
}

function resolveChanges(remoteOid) {
  /**
   * 计算本次 push 的变更文件集（相对 HEAD）。
   * remoteOid 全 0（新分支/新仓库）→ 回退最近一次提交；
   * 无祖先提交 → 首个提交的完整文件清单。
   * 返回文件数组；解析彻底失败（git diff/show 均不可用）返回 null，
   * 由调用方阻断推送而非静默空跑放行（fail-closed）。
   */
  const isNew = /^0+$/.test(remoteOid || '');
  if (!isNew && remoteOid !== HEAD_OID) {
    const { rc, out } = git(`diff --name-only ${remoteOid}..HEAD`);
    if (rc === 0) return out.trim().split('\n').filter(Boolean); // 成功即权威答案（空 = 本次无变更）
  }
  // 新分支：优先 merge-base（有远端追踪分支时），否则 fallback 链
  // origin/<branch> → origin/HEAD → origin/main → origin/master，最后才最近提交，
  // 避免多提交新分支只看 HEAD~1..HEAD 漏检中间提交（code_review P3）。
  // 不用 `2>/dev/null`：cmd.exe 下会解析为 dev\null 相对路径并中止整条命令（code_review P3）
  const mergeBase = (ref) => {
    const r = git(`merge-base HEAD ${ref}`);
    return r.rc === 0 ? r.out.trim() : '';
  };
  let mb = mergeBase(`origin/${CURRENT_BRANCH}`) || mergeBase('origin/HEAD') || mergeBase('origin/main') || mergeBase('origin/master');
  if (mb) {
    const { rc, out } = git(`diff --name-only ${mb}..HEAD`);
    if (rc === 0) return out.trim().split('\n').filter(Boolean);
  }
  const { rc, out } = git(`diff --name-only HEAD~1..HEAD`);
  if (rc === 0) return out.trim().split('\n').filter(Boolean);
  // 首个提交（diff-tree 对 root commit 默认忽略，须用 git show）
  const t = git('show --name-only --format= HEAD');
  return t.rc === 0 && t.out.trim() ? t.out.trim().split('\n').filter(Boolean) : null;
}

function planFromFiles(files) {
  /** 文件集 → 需要跑的检查计划 { go, frontend, data, docs, adr, contractTests }。 */
  const p = { go: false, frontend: false, data: false, docs: false, adr: false, contractTests: false };
  for (const f of files) {
    const d = classify(f);
    if (d === 'go') p.go = true;
    if (d === 'frontend') p.frontend = true;
    if (d === 'data') p.data = true;
    if (d === 'docs') p.docs = true;
    if (d === 'tests') p.contractTests = true;
    // ADR 目录已迁移 docs/architecture/adr/ → docs/adr/（ccea186），与 adr-check.mjs 一致
    if (f.startsWith('docs/adr/') || f.startsWith('docs/architecture/adr/')) p.adr = true;
  }
  return p;
}

/* ---------------- 检查执行 ---------------- */

function runContractTests() {
  /** tests/*.mjs 全量契约测试（宪法基石，退出码可信）。 */
  const testsDir = path.join(ROOT, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  const testFiles = fs.readdirSync(testsDir)
    .filter((f) => f.endsWith('.mjs')).sort();
  const results = [];
  for (const f of testFiles) {
    const { rc, out } = sh(`node ${path.join('tests', f)}`);
    results.push({ name: f, ok: rc === 0, out: rc === 0 ? '' : out.trim().split('\n').slice(-4).join('\n') });
  }
  return results;
}

/* ---------------- gofmt 自动修复 + amend ---------------- */

function isAmendSafe(localRef, localOid, files) {
  /** amend 前提：push 的就是当前分支 HEAD，且工作区只有本次被修文件，无混入改动。 */
  if (localRef !== `refs/heads/${CURRENT_BRANCH}` || localOid !== HEAD_OID) return false;
  const { out } = git('status --porcelain');
  // 注意：不可对整体 trim —— porcelain 首行前导空格是 index 状态占位符，trim 后 slice(3) 会丢路径首字符
  const dirty = out.split('\n').filter(Boolean).map((l) => l.replace(/\r$/, '').slice(3));
  const want = new Set(files.map((f) => toPosix(f)));
  return dirty.every((f) => want.has(f));
}

function tryGofmtFix(goFiles, localRef, localOid) {
  /** gofmt -l 找出未格式化文件；安全前提下 -w 修复并 amend。返回 { fixed: string[], amended: boolean }。 */
  const unformatted = sh(`gofmt -l ${goFiles.map(shq).join(' ')}`).out.trim()
    .split('\n').filter((f) => f.endsWith('.go'));
  if (!unformatted.length) return { fixed: [], amended: false };
  // 先修复代码（无论能否 amend，格式化本身无副作用）
  sh(`gofmt -w ${unformatted.map(shq).join(' ')}`);
  const fixed = unformatted.map((f) => toPosix(f));
  // 守卫：工作区只含被修文件且 push 的就是 HEAD 才 amend，否则留待手动提交
  if (!isAmendSafe(localRef, localOid, fixed)) return { fixed, amended: false };
  const add = git(`add ${fixed.map(shq).join(' ')}`);
  if (add.rc !== 0) return { fixed, amended: false };
  const cm = git('commit --amend --no-edit');
  return { fixed, amended: cm.rc === 0 };
}

/* ---------------- 主流程 ---------------- */

function parseStdin() {
  try { return fs.readFileSync(0, 'utf-8').trim(); } catch { return ''; }
}

function main() {
  const dryRun = process.argv[2] === '--dry-run';
  const argBase = dryRun ? 3 : 2;
  const remoteName = process.argv[argBase];
  const remoteUrl = process.argv[argBase + 1];

  console.log('========== YSM 本地质量门禁 ==========');

  if (!remoteName) {
    console.log('用法: node scripts/pre-push-gate.mjs [--dry-run] <remote-name> <remote-url>');
    console.log('      stdin: <local ref> <local oid> <remote ref> <remote oid>');
    return 2;
  }

  const lines = parseStdin().split('\n').filter(Boolean);
  if (!lines.length) {
    console.log(`${B.SKIP} 无可推送 ref（空 stdin），跳过`);
    console.log(`${B.SKIP} ${PULL_HINT}`);
    return 0;
  }

  const [localRef, localOid, , remoteOid] = lines[0].trim().split(/\s+/);
  const files = resolveChanges(remoteOid);
  if (files === null) {
    console.log(`${B.FAIL} 变更集解析失败（git diff/show 均不可用），拒绝空跑放行 — 请检查本地 git 状态后重推`);
    console.log(PULL_HINT);
    return 1;
  }
  const plan = planFromFiles(files);
  const byDomain = {};
  for (const f of files) (byDomain[classify(f)] = byDomain[classify(f)] || []).push(f);

  console.log(`推送: ${localRef} ${localOid.slice(0, 7)} → ${remoteName} (${remoteUrl || '?'})`);
  const domainSummary = Object.keys(byDomain).length
    ? Object.entries(byDomain).map(([d, fs2]) => `${d}:${fs2.length}`).join('  ')
    : '无变更';
  console.log(`变更域: ${domainSummary}`);
  console.log('');

  const results = [];
  let blocked = false;

  /* --- Go 域 --- */
  if (plan.go) {
    const goFiles = (byDomain.go || []).filter((f) => f.endsWith('.go'));

    const t0 = Date.now();
    const goBuild = sh('go build ./go/...');
    results.push({ label: 'go build', ok: goBuild.rc === 0, time: Date.now() - t0,
      tail: goBuild.rc ? goBuild.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (goBuild.rc !== 0) blocked = true;

    const t1 = Date.now();
    const goTest = sh('go test ./go/... -count=1');
    results.push({ label: 'go test', ok: goTest.rc === 0, time: Date.now() - t1,
      tail: goTest.rc ? goTest.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (goTest.rc !== 0) blocked = true;

    // gofmt：可自动修复
    const t2 = Date.now();
    if (!dryRun) {
      const { fixed, amended } = tryGofmtFix(goFiles, localRef, localOid);
      if (fixed.length) {
        const headAfter = git('rev-parse --short HEAD').out.trim();
        results.push({
          label: 'gofmt', ok: amended, time: Date.now() - t2,
          note: `格式化 ${fixed.length} 个文件 → ${amended ? `amend ${headAfter}` : 'amend 失败(工作区不净/非 HEAD 推送)，已留待手动提交'}`,
        });
        if (!amended) {
          blocked = true;
          results[results.length - 1].tail = fixed.join('\n');
        }
      } else {
        results.push({ label: 'gofmt', ok: true, time: Date.now() - t2, note: '无未格式化文件' });
      }
    } else {
      const unformatted = sh(`gofmt -l ${goFiles.map(shq).join(' ')}`).out.trim() // 与自动修复分支一致的 shq 转义（code_review P3）
        .split('\n').filter((f) => f.endsWith('.go'));
      results.push({ label: 'gofmt', ok: unformatted.length === 0, time: Date.now() - t2,
        note: unformatted.length ? `DRY-RUN 检出 ${unformatted.length} 个未格式化文件（未修改）` : '无未格式化文件' });
      if (unformatted.length) blocked = true;
    }
  }

  /* --- 前端域 --- */
  if (plan.frontend) {
    // 分层守护：前端目录间反向依赖（R1/R2 零容忍 + R3/R4 基线，现基线 0 条）
    const tL = Date.now();
    const ll = sh('node scripts/check-layering.mjs --json');
    let lz = null;
    try { lz = JSON.parse(ll.out)._summary; } catch { /* parse fail */ }
    const lOk = ll.rc === 0;
    results.push({ label: 'check-layering', ok: lOk, time: Date.now() - tL,
      note: lz === null ? '输出解析失败（scripts/check-layering.mjs 缺失？）'
        : (lOk ? `分层合规（零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}）`
          : `零容忍 ${lz.zero_tolerance} + 新增回归 ${lz.regressions}`) });
    if (!lOk) blocked = true;

    const t0 = Date.now();
    const fb = sh('npx vite build', { cwd: path.join(ROOT, 'frontend') });
    results.push({ label: 'vite build', ok: fb.rc === 0, time: Date.now() - t0,
      tail: fb.rc ? fb.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (fb.rc !== 0) blocked = true;

    // ADR-023 P3：L3 Vitest 随前端域变更回归（写了要跑、坏了要红）
    const t1 = Date.now();
    const ft = sh('npx vitest run', { cwd: path.join(ROOT, 'frontend') });
    results.push({ label: 'vitest run', ok: ft.rc === 0, time: Date.now() - t1,
      tail: ft.rc ? ft.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (ft.rc !== 0) blocked = true;
  }

  /* --- 数据域 --- */
  if (plan.data) {
    const t0 = Date.now();
    const tc = sh('node scripts/type-consistency.mjs --json');
    let issues = null;
    try { issues = JSON.parse(tc.out)._summary?.issues ?? 0; } catch { /* parse fail */ }
    const ok = issues === 0;
    results.push({ label: 'type-consistency', ok, time: Date.now() - t0,
      note: issues === null ? '输出解析失败（scripts/type-consistency.mjs 缺失？）'
        : (ok ? 'resource_types.json ↔ extensions.js 一致' : `${issues} 个不一致`) });
    if (!ok) blocked = true;
  }

  /* --- 文档域 --- */
  if (plan.docs) {
    const t0 = Date.now();
    const lc = sh('node scripts/link-checker.mjs --json');
    let broken = null;
    try { broken = JSON.parse(lc.out)._summary?.links_broken ?? 0; } catch { /* parse fail */ }
    const ok = broken === 0;
    results.push({ label: 'link-checker', ok, time: Date.now() - t0,
      note: broken === null ? '输出解析失败（scripts/link-checker.mjs 缺失？）'
        : (ok ? '全部链接有效' : `${broken} 条断链`) });
    if (!ok) blocked = true;
  }
  if (plan.adr) {
    const t0 = Date.now();
    const ac = sh('node scripts/adr-check.mjs');
    results.push({ label: 'adr-check', ok: ac.rc === 0, time: Date.now() - t0,
      tail: ac.rc ? ac.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (ac.rc !== 0) blocked = true;
  }

  /* --- 生成器守护：索引产物是否过期（docs 或 adr 变更时） --- */
  if (plan.docs || plan.adr) {
    const t0 = Date.now();
    const gd = sh('node scripts/gen-docs-index.mjs --check');
    results.push({ label: 'gen-docs-index', ok: gd.rc === 0, time: Date.now() - t0,
      tail: gd.rc ? gd.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (gd.rc !== 0) blocked = true;
  }

  /* --- 契约测试 --- */
  if (plan.contractTests) {
    const t0 = Date.now();
    const tests = runContractTests();
    const ok = tests.length === 0 || tests.every((t) => t.ok);
    results.push({ label: `contract tests (${tests.length})`, ok, time: Date.now() - t0,
      note: tests.length === 0 ? '无 tests/*.mjs，跳过'
        : (ok ? '全部通过' : tests.filter((t) => !t.ok).map((t) => `${t.name}\n${t.out}`).join('\n')) });
    if (!ok) blocked = true;
  }

  /* --- 聚合摘要 --- */
  console.log('------------------- 结果 -------------------');
  for (const r of results) {
    const status = r.ok ? (r.note?.startsWith('格式化') ? B.FIX : B.OK) : B.FAIL;
    console.log(`${status} ${r.label.padEnd(20)} ${(r.time / 1000).toFixed(1)}s  ${r.note || ''}`);
    if (r.tail) {
      for (const line of r.tail.split('\n')) console.log(`       ${line}`);
    }
  }
  console.log('');
  if (!results.length) {
    console.log(`${B.SKIP} 无相关域变更（${domainSummary}），无需检查`);
    return 0;
  }
  if (!blocked) {
    console.log(`结论: PASS ✅ ${dryRun ? '（DRY-RUN）' : '放行推送'} ${results.filter((r) => r.ok).length}/${results.length} 项通过`);
    return 0;
  }
  console.log(`结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过，推送已${dryRun ? '将被' : ''}阻断`);
  // 修复指引：按 gofmt 实际状态给分支建议（amend 成功 ≠ 失败，盲重推会再次被拦）
  const gofmt = results.find((r) => r.label === 'gofmt');
  let gofmtHint = '';
  if (gofmt && !gofmt.ok) {
    gofmtHint = gofmt.note?.startsWith('格式化')
      ? 'gofmt 已修复但 amend 失败（工作区不净）——git add + git commit 后重推。'
      : 'gofmt 检出未格式化——gofmt -w 修复后 git commit 重推。';
  }
  console.log(`修复指引: 按上方 [FAIL] 项处理；${gofmtHint}紧急绕过: git push --no-verify`);
  console.log(PULL_HINT);
  return 1;
}

const HEAD_OID = git('rev-parse HEAD').out.trim();
const CURRENT_BRANCH = git('symbolic-ref --short HEAD').out.trim() || 'HEAD';

const GATE_CODE = main();

// ── 文档待补地图：推送前始终刷新（非阻断），供文档类 AI 定位「哪块城邦失修、该补哪里」──
// 无论门禁 PASS/FAIL 都执行；失败静默吞错，绝不拖累推送心流。
try {
  execFileSync('node', ['scripts/gen-doc-next-steps.mjs'], {
    cwd: ROOT, stdio: 'ignore', shell: true, timeout: 300_000,
  });
  console.log('[MAP] 已刷新 docs/.doc-next-steps.md（AI 待补地图，非阻断）');
} catch {
  /* 非阻断：地图生成失败不影响推送 */
}

process.exit(GATE_CODE);
