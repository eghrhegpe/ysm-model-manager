#!/usr/bin/env node
/**
 * pre-push-gate.ts — 本地质量门禁核心（.githooks/pre-push 的调度器）。
 *
 * 设计目标：CI 红之前，本地先红。按变更域（Go / 前端 / 数据 / 文档）只跑相关检查；
 * gofmt 修复下沉 pre-commit（提交时自动 -w 修复 + stage）；pre-push 对未格式化只读检出即阻断
 * （防 --no-verify 绕过 pre-commit 的自动修复）；
 * 需人工的（构建失败、断链、契约失败、红线扫描不可用）同样阻断推送。
 * 分层哲学（2026-08-13）：硬错误（编译/测试/契约/链接）阻断推送；基线债务
 * （红线新增、死代码等"没有报错"的治理欠账）只报告不阻断——推送后修，发布前全量 doctor 兜底。
 * 例外：红线扫描本身不可用（rg 缺失/fail-closed）必须阻断，扫描没跑成不等于债务。
 *
 * 用法（由 .githooks/pre-push 调用）：
 *   node scripts/pre-push-gate.ts <remote-name> <remote-url>
 *     标准输入：每行 `<local ref> <local oid> <remote ref> <remote oid>`
 *   node scripts/pre-push-gate.ts --dry-run <remote-name> <remote-url>
 *     只检查不修改（gofmt 只读检出、不自动修复），供调试与 CI 复用
 *   node scripts/pre-push-gate.ts --all [--dry-run]
 *     全量模式（等价 doctor 默认全量，无 stdin）：Go/前端/数据/文档/红线/契约 + 静态工具
 *   node scripts/pre-push-gate.ts --docs [--dry-run]
 *     文档模式（等价 doctor --docs）：仅文档/ADR/索引/静态文档工具
 *
 * 已知坑（2026-08-03 确认，2026-08-07 更新，2026-08-12 增补）：
 *   - link-checker.ts / type-consistency.ts 正常路径退出码恒 0，
 *     必须用 --json 解析 _summary 判定，不得依赖退出码；
 *     type-consistency 数据损坏/缺失的 fatal 路径现在 exit 1（+哨兵 _summary.issues=9999，code_review P3）。
 *   - Windows 下 npx 是 npx.cmd，node spawn 需 shell:true。
 *   - 严禁在 pre-push 内 commit --amend：git push 在调用钩子前已快照要推送的 oid，
 *     钩子里 amend 只是改本地 HEAD，推送的仍是旧 oid → 本地与远端分叉、二次 push 必被拒
 *     （2026-08-12 实测：gofmt amend 3291cb16 假成功，实际推送 b644e96b）。
 *     gofmt 修复因此下沉 pre-commit，此处只读校验。
 * 设计意图：pre-push-gate 工具脚本（doctor --gate/--all/--docs 的单一实现源头，2026-08-14 合并）
 * 依赖：node:child_process / node:fs / node:path / node:url
 *
 * 退出码：0 = 门禁通过（放行推送）；1 = 门禁失败（阻断推送）；2 = 用法错误。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { run as procRun } from './_lib/proc.ts';
import { planFromFiles, groupByDomain, domainSummaryText } from './_lib/domain-classify.ts';
import { runContractTestsParallel } from './_lib/contract-tests.ts';
import { logPush } from './_lib/log-push.ts';
import { shq } from './_lib/proc.ts';
import { ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, DOC_EXTRA_SCRIPTS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS } from './_lib/gate-config.ts';


const B = { OK: '[OK]', FAIL: '[FAIL]', FIX: '[FIX]', SKIP: '[SKIP]' };
const TIMEOUT = 300_000;
/** 远端领先提示（SKIP 与 FAIL 共用，避免重复长文案） */
const PULL_HINT = '提示: git 报 rejected/non-fast-forward 时先 git pull 整合远端再重推。';

/* ---------------- 工具 ---------------- */

function sh(cmd, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  /** shell 执行命令（win32 兼容 .cmd），返回 { rc, out }。
   * 统一委托 _lib/proc.ts（超时/错误分类契约；shell:true 时 win32 走 cmd.exe、
   * POSIX 走 /bin/sh，承载管道/重定向命令）。
   * out 回退 err：ENOENT/超时诊断在 r.err，空 out 时保留原因（P3 复核）。 */
  const r = procRun(cmd, [], { cwd, timeout, shell: true });
  return { rc: r.rc, out: r.out || r.err || '' };
}

/**
 * 异步版 sh——用 spawn 包装 Promise，供 Promise.all 并行执行。
 * 仅用于 npm 三件套并行（vite build / tsc --noEmit），不替代同步 sh。
 */
function shAsync(cmd, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  return new Promise<{ rc: number | null; out: string }>((resolve) => {
    const child = spawn(cmd, [], { cwd, shell: true, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d.toString(); });
    child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('close', (code) => resolve({ rc: code, out: buf }));
    child.on('error', (err) => resolve({ rc: -1, out: err.message }));
  });
}

function git(args, { cwd = ROOT } = {}) {
  // core.quotepath=false：非 ASCII 文件名输出原始 UTF-8，避免引号/八进制转义破坏域匹配。
  // 数组参数直走 procRun（无 shell 拼接）：git ref 允许 $/`/;/| 等元字符，
  // 拼字符串后交给 sh() 经 shell 执行会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）。
  const r = procRun('git', ['-c', 'core.quotepath=false', ...args], { cwd });
  return { rc: r.ok ? 0 : r.rc, out: r.out || '' };
}

/* ---------------- 变更域分析 ---------------- */

function resolveChanges(localRef, localOid, remoteOid) {
  /**
   * 计算本次 push 的变更文件集（相对被推送的 localOid，而非当前检出 HEAD——
   * 推非当前分支时 HEAD 与推送对象不一致，用 HEAD 会分析错快照，2026-08-12 排查）。
   * remoteOid 全 0（新分支/新仓库）→ 回退最近一次提交；
   * 无祖先提交 → 首个提交的完整文件清单。
   * 返回文件数组；解析彻底失败（git diff/show 均不可用）返回 null，
   * 由调用方阻断推送而非静默空跑放行（fail-closed）。
   */
  const isNew = /^0+$/.test(remoteOid || '');
  if (!isNew && remoteOid !== localOid) {
    const { rc, out } = git(['diff', '--name-only', `${remoteOid}..${localOid}`]);
    if (rc === 0) return out.trim().split('\n').filter(Boolean); // 成功即权威答案（空 = 本次无变更）
  }
  // 新分支：优先 merge-base（有远端追踪分支时），否则 fallback 链
  // origin/<分支名> → origin/HEAD → origin/main → origin/master，最后才最近提交，
  // 避免多提交新分支只看 HEAD~1..HEAD 漏检中间提交（code_review P3）。
  // 分支名取自 stdin 的 localRef（推非当前分支时不能用 CURRENT_BRANCH）。
  // 不用 `2>/dev/null`：cmd.exe 下会解析为 dev\null 相对路径并中止整条命令（code_review P3）
  const mergeBase = (ref) => {
    const r = git(['merge-base', localOid, ref]);
    return r.rc === 0 ? r.out.trim() : '';
  };
  const branchName = localRef.startsWith('refs/heads/') ? localRef.slice('refs/heads/'.length) : null;
  let mb = (branchName && mergeBase(`origin/${branchName}`)) || mergeBase('origin/HEAD') || mergeBase('origin/main') || mergeBase('origin/master');
  if (mb) {
    const { rc, out } = git(['diff', '--name-only', `${mb}..${localOid}`]);
    if (rc === 0) return out.trim().split('\n').filter(Boolean);
  }
  const { rc, out } = git(['diff', '--name-only', `${localOid}~1..${localOid}`]);
  if (rc === 0) return out.trim().split('\n').filter(Boolean);
  // 首个提交（diff-tree 对 root commit 默认忽略，须用 git show）
  const t = git(['show', '--name-only', '--format=', localOid]);
  return t.rc === 0 && t.out.trim() ? t.out.trim().split('\n').filter(Boolean) : null;
}

/* ---------------- 检查执行 ---------------- */

async function runContractTests() {
  /** tests/*.mjs 全量契约测试（宪法基石，退出码可信）。并行执行。 */
  return runContractTestsParallel();
}

/* ---------------- gofmt 只读校验 ---------------- */

function gofmtCheck(goFiles) {
  /** gofmt -l 只读检出未格式化文件（不修改）。修复由 pre-commit 提交时自动完成；
   * 此处若仍检出，说明提交绕过了 pre-commit（--no-verify 等），阻断并提示手动修复。 */
  return sh(`gofmt -l ${goFiles.map(shq).join(' ')}`).out.trim()
    .split('\n').filter((f) => f.endsWith('.go'));
}

/* ---------------- 静态分析工具清单（--all / --docs 模式，doctor 全量迁入） ---------------- */
// 工具清单单一事实来源 = _lib/gate-config.ts；gate 本身只负责调度，不改清单逻辑。


/* ---------------- 主流程 ---------------- */

function parseStdin() {
  try { return fs.readFileSync(0, 'utf-8').trim(); } catch { return ''; }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noBanner = process.argv.includes('--no-banner');
  const allMode = process.argv.includes('--all');
  const docsMode = process.argv.includes('--docs');
  const filesIdx = process.argv.indexOf('--files');
  const filesMode = filesIdx !== -1;
  const argBase = dryRun ? 3 : 2;

  console.log('========== YSM 本地质量门禁 ==========');

  // 统一结果收集与阻断标记
  const results: any[] = [];
  let blocked = false;
  const record = (label, ok, { time = 0, note = '', tail = '' } = {}) => {
    results.push({ label, ok, time, note, tail });
    if (!ok) blocked = true;
  };

  let plan;
  let domainSummary = '';
  let byDomain: Record<string, string[]> = {};
  let files: string[] = []; // 本次变更文件集（--files / push 模式填充；--all / --docs 保持为空）

  if (allMode) {
    // —— 全量模式：所有域 + 静态工具（等价 doctor 默认全量）——
    plan = { go: true, frontend: true, data: true, docs: true, adr: true, contractTests: true, redlines: true };
    domainSummary = 'all';
    console.log('模式: 全量检查（--all）');
    console.log('');
  } else if (docsMode) {
    // —— 文档模式：轻量（等价 doctor --docs）——
    plan = { go: false, frontend: false, data: false, docs: true, adr: true, contractTests: false, redlines: false };
    domainSummary = 'docs';
    console.log('模式: 文档检查（--docs）');
    console.log('');
  } else if (filesMode) {
    // —— 文件驱动模式（commit-with-check 调用）：按 staged files 真按域裁剪 ——
    const filesRaw = process.argv[filesIdx + 1] || '';
    files = filesRaw ? filesRaw.split('\n').filter(Boolean) : [];
    if (!files.length) {
      console.log('用法: node scripts/pre-push-gate.ts --files "<file1>\\n<file2>..." [--dry-run]');
      return 2;
    }
    plan = planFromFiles(files);
    byDomain = groupByDomain(files);
    domainSummary = domainSummaryText(byDomain);
    console.log(`模式: 文件驱动（--files，${files.length} 个文件）`);
    console.log(`变更域: ${domainSummary}`);
    console.log('');
  } else {
    // —— 推送门禁模式（默认）：stdin 驱动 ——
    const remoteName = process.argv[argBase];
    const remoteUrl = process.argv[argBase + 1];

    if (!remoteName) {
      console.log('用法: node scripts/pre-push-gate.ts [--dry-run] <remote-name> <remote-url>');
      console.log('      node scripts/pre-push-gate.ts --all [--dry-run]');
      console.log('      node scripts/pre-push-gate.ts --docs [--dry-run]');
      console.log('      stdin: <local ref> <local oid> <remote ref> <remote oid>');
      return 2;
    }

    const lines = parseStdin().split('\n').filter(Boolean);
    if (!lines.length) {
      console.log(`${B.SKIP} 无可推送 ref（空 stdin），跳过`);
      console.log(`${B.SKIP} ${PULL_HINT}`);
      return 0;
    }

    // 多 ref 推送（git push origin a b）逐行分析，按文件集并集计算变更域；
    // delete 行（local oid 全零）跳过。全零 localOid = 删除远端 ref，无本地文件可查。
    const fileSet = new Set<string>();
    const pushed: { localRef: string; localOid: string; remoteOid: string }[] = [];
    for (const line of lines) {
      const [localRef, localOid, , remoteOid] = line.trim().split(/\s+/);
      if (!localOid || /^0+$/.test(localOid)) continue; // delete ref，跳过
      const refFiles = resolveChanges(localRef, localOid, remoteOid);
      if (refFiles === null) {
        console.log(`${B.FAIL} 变更集解析失败（git diff/show 均不可用），拒绝空跑放行 — 请检查本地 git 状态后重推`);
        console.log(PULL_HINT);
        return 1;
      }
      for (const f of refFiles) fileSet.add(f);
      pushed.push({ localRef, localOid, remoteOid });
    }
    if (!pushed.length) {
      console.log(`${B.SKIP} 无有效推送 ref（均为删除/空 oid），跳过`);
      return 0;
    }
    files = [...fileSet];
    plan = planFromFiles(files);
    byDomain = groupByDomain(files);

    const { localRef, localOid } = pushed[0];
    const multiRef = pushed.length > 1;
    console.log(`推送: ${multiRef ? `${pushed.length} 个 ref` : localRef} ${multiRef ? '' : `${localOid.slice(0, 7)} `}→ ${remoteName} (${remoteUrl || '?'})`);
    domainSummary = domainSummaryText(byDomain);
    console.log(`变更域: ${domainSummary}`);
    console.log('');
  }

  /* --- 静态工具统一执行器 --- */
  // 回退 ADR-088 静态工具并行（实测 2m15s vs 基线 75s，runSpawn spawn 开销吃掉并行收益）
  // 恢复串行 runTools——域间并行（Go ∥ 前端）留作后续 Take巧，静态工具段不并行
  const runTools = (tools) => {
    for (const entry of tools) {
      const tool = typeof entry === 'string' ? entry : entry.tool;
      const extraArgs = typeof entry === 'string' ? [] : entry.args || [];
      const t0 = Date.now();
      const r = sh(`node scripts/${tool} --json ${extraArgs.join(' ')}`);
      // P1 修复（2026-08-17）：审计类工具退出码不可靠（i18n/孤儿/命名/卫生默认恒 0），
      // 必须解析 --json 的 _summary 判定——与文件头「不得依赖退出码」契约对齐。
      let ok = r.rc === 0;
      let note = '';
      try {
        const parsed = JSON.parse(r.out);
        const s = parsed._summary || parsed;
        if (typeof s.ok === 'boolean') ok = s.ok;
        else if (typeof s.errors === 'number') ok = s.errors === 0;
        // 有结构化计数时填充 note（替代空 OK 的假绿）
        const cnt = Object.entries(s)
          .filter(([k, v]) => /count|total|errors|issues|warns|violations|orphan|missing|flagged/.test(k) && typeof v === 'number')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        if (cnt) note = cnt;
      } catch { /* 非 JSON 输出，退回 rc 判定 */ }
      // autoFix（2026-08-23 用户诉求"gen 产物老要 AI 手打刷新"）：--check FAIL 的
      // gen 产物工具自动跑写盘版刷新后重验——修"提交间隙 gen 产物过期 → doctor FAIL"
      // 的鸡生蛋（pre-commit 只在提交时跑 gen；间隙跑 doctor 需手打对应 gen 脚本）
      if (!ok && typeof entry === 'object' && entry.autoFix) {
        const fixR = sh(`node scripts/${tool} --json`); // 写盘刷新（无 --check）
        if (fixR.rc === 0) {
          const re = sh(`node scripts/${tool} --json ${extraArgs.join(' ')}`);
          let reOk = re.rc === 0;
          try {
            const s2 = JSON.parse(re.out);
            const sm = s2._summary || s2;
            if (typeof sm.ok === 'boolean') reOk = sm.ok;
            else if (typeof sm.errors === 'number') reOk = sm.errors === 0;
          } catch { /* 非 JSON 输出，退回 rc 判定 */ }
          if (reOk) {
            ok = true;
            note = `autoFix: ${tool} 已自动刷新`;
          }
        }
      }
      record(tool, ok, { time: Date.now() - t0, note, tail: !ok ? r.out.trim().split('\n').slice(-12).join('\n') : '' });
    }
  };

  /* --- 域间并行：Go ∥ 前端（ADR-088 Take巧 #1）--- */
  // Go 和前端域完全独立（无共享状态、无文件写冲突），用 Promise.all 并行。
  // Take巧 #4（静态工具并行）已回退（spawn 开销吃掉 sub-second 工具收益）；
  // 此处仅 2 个域级操作，spawn 开销 0.6s << 域本身 58s，收益成立。
  // 域内用 shAsync（spawn 异步）替代 sh（execFileSync 同步），避免阻塞主线程。
  await Promise.all([
    // ── Go 域 ──
    (async () => {
      if (!plan.go) return;
    // updater helper 前置构建（doctor 全量协议）：go/updater/updater.go 通过 //go:embed
    // 内嵌 ysm-updater-helper.exe（.gitignore 不入库），干净 checkout 缺此文件会导致
    // go build/vet/test 失败（2026-08-14 补入 gate，对齐 doctor）。
    const tH = Date.now();
    const uh = await shAsync('go build -o go/updater/ysm-updater-helper.exe ./cmd/updater');
    record('updater helper', uh.rc === 0, { time: Date.now() - tH, tail: uh.rc ? uh.out.trim().split('\n').slice(-4).join('\n') : '' });

    const goFiles = (byDomain.go || []).filter((f) => f.endsWith('.go'));

    const t0 = Date.now();
    const goBuild = await shAsync('go build ./go/...');
    record('go build', goBuild.rc === 0, { time: Date.now() - t0, tail: goBuild.rc ? goBuild.out.trim().split('\n').slice(-4).join('\n') : '' });

    const t1 = Date.now();
    // 对齐 doctor 全量：go test 同时跑 ./internal/app/（2026-08-14 修复漏测）
    const goTest = await shAsync('go test -race ./go/... ./internal/app/ -count=1 -timeout 60s');
    record('go test', goTest.rc === 0, { time: Date.now() - t1, tail: goTest.rc ? goTest.out.trim().split('\n').slice(-4).join('\n') : '' });

    const tV = Date.now();
    const goVet = await shAsync('go vet ./go/... ./internal/app/...');
    record('go vet', goVet.rc === 0, { time: Date.now() - tV, tail: goVet.rc ? goVet.out.trim().split('\n').slice(-4).join('\n') : '' });

    // gofmt：只读校验（修复已下沉 pre-commit；此处检出即阻断，防止绕过提交）
    const t2 = Date.now();
    const unformatted = gofmtCheck(goFiles);
    record('gofmt', unformatted.length === 0, {
      time: Date.now() - t2,
      note: unformatted.length
        ? `检出 ${unformatted.length} 个未格式化文件（pre-commit 应已自动修复；疑似 --no-verify 绕过）`
        : '无未格式化文件',
      tail: unformatted.length ? unformatted.join('\n') : '',
    });
    // 格式类债务阻断推送（2026-08-17 注释对齐：record 已置 blocked；pre-commit 正常已自动 gofmt -w，
    // 此处检出即说明绕过了 pre-commit——防 --no-verify 绕过，与 .githooks/pre-commit 口径一致）

    const t3 = Date.now();
    const bc = await shAsync('node scripts/binding-check.ts --json');
    record('binding-check', bc.rc === 0, { time: Date.now() - t3, tail: bc.rc ? bc.out.trim().split('\n').slice(-4).join('\n') : '' });
    }),
    (async () => {
      if (!plan.frontend) return;
    // 分层守护：前端目录间反向依赖（R1/R2 零容忍 + R3/R4 基线，现基线 0 条）
    const tL = Date.now();
    const ll = await shAsync('node scripts/check-layering.ts --json');
    let lz: any = null;
    try { lz = JSON.parse(ll.out)._summary; } catch { /* parse fail */ }
    const lOk = ll.rc === 0;
    record('check-layering', lOk, {
      time: Date.now() - tL,
      note: lz === null ? '输出解析失败（scripts/check-layering.ts 缺失？）'
        : (lOk ? `分层合规（零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}）`
          : `零容忍 ${lz.zero_tolerance} + 新增回归 ${lz.regressions}`),
    });

    // ADR-085：菜单表健康门禁——"加菜单项只改表"的自动兜底（秒级正则扫描，早失败早停）。
    // 校验：id 唯一 / labelKey 非空 / i18n 三语齐全 / dockGroup 合法 / kind 合法 / render·run 完备。
    const tM = Date.now();
    const mh = await shAsync('node scripts/check-menu-health.ts --json');
    let mz: any = null;
    try { mz = JSON.parse(mh.out)._summary; } catch { /* parse fail */ }
    const mOk = mh.rc === 0 && mz && mz.ok === true;
    record('check-menu-health', mOk, {
      time: Date.now() - tM,
      note: mz === null ? '输出解析失败'
        : (mOk ? `菜单表 ${mz.total} 项全绿`
          : `${mz.violations} 条菜单表违规（id/labelKey/i18n/dockGroup/kind/render-run）`),
      tail: mOk ? '' : mh.out.trim().split('\n').slice(-4).join('\n'),
    });
    if (!mOk) blocked = true; // 菜单表违规阻断推送（硬错误：加错键/漏 i18n 会破坏菜单渲染）

    // npm 三件套并行优化：vite build ∥ tsc --noEmit，vitest 串行在后
    // （vitest 是重活儿，独占资源更稳；build 与 tsc 无依赖，墙钟减半）
    const tscBin = path.join(ROOT, 'frontend', 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const tscExists = fs.existsSync(tscBin);
    const t0 = Date.now();
    const [fb, tscResult] = await Promise.all([
      shAsync('npx vite build', { cwd: path.join(ROOT, 'frontend') }),
      tscExists
        ? shAsync(`"${tscBin}" --noEmit`, { cwd: path.join(ROOT, 'frontend') })
        : Promise.resolve({ rc: -1, out: '' }),
    ]);
    const wallA = Date.now() - t0;
    record('vite build', fb.rc === 0, { time: wallA, tail: fb.rc ? fb.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (tscExists) {
      const lines = tscResult.out.trim().split('\n').filter(Boolean);
      record('tsc --noEmit', tscResult.rc === 0, { time: wallA, note: tscResult.rc === 0 ? '' : `${lines.length} errors`, tail: tscResult.rc === 0 ? '' : lines.slice(-5).join('\n') });
    } else {
      record('tsc --noEmit', false, { time: 0, note: 'tsc 未安装（frontend/node_modules 缺失）——请 npm ci 后重推' });
    }

    // ADR-023 P3：L3 Vitest 随前端域变更回归（串行在后，独占资源）
    const t1 = Date.now();
    // 与 frontend/package.json test 对齐：--maxWorkers 8（24 核默认并发过载反慢 ~10s）
    const ft = await shAsync('npx vitest run --maxWorkers 8', { cwd: path.join(ROOT, 'frontend') });
    record('vitest run', ft.rc === 0, { time: Date.now() - t1, tail: ft.rc ? ft.out.trim().split('\n').slice(-4).join('\n') : '' });
    })
  ]);

  /* --- 数据域 --- */
  if (plan.data) {
    const t0 = Date.now();
    const tc = sh('node scripts/type-consistency.ts --json');
    let issues = null;
    try { issues = JSON.parse(tc.out)._summary?.issues ?? 0; } catch { /* parse fail */ }
    const ok = issues === 0;
    record('type-consistency', ok, {
      time: Date.now() - t0,
      note: issues === null ? '输出解析失败（scripts/type-consistency.ts 缺失？）'
        : (ok ? 'resource_types.json ↔ extensions.js 一致' : `${issues} 个不一致`),
    });
  }

  /* --- 文档域 --- */
  if (plan.docs) {
    const t0 = Date.now();
    const lc = sh('node scripts/link-checker.ts --json');
    let broken = null;
    try { broken = JSON.parse(lc.out)._summary?.links_broken ?? 0; } catch { /* parse fail */ }
    const ok = broken === 0;
    record('link-checker', ok, {
      time: Date.now() - t0,
      note: broken === null ? '输出解析失败（scripts/link-checker.ts 缺失？）'
        : (ok ? '全部链接有效' : `${broken} 条断链`),
    });

    // 发版说明漂移守护：git tag 单一事实源——每个正式 tag 必须有 docs/releases/<tag>.md
    // （失败输出 AI 友好：--check 自带每条缺失的 git 区间补写命令）
    const t1 = Date.now();
    const rn = sh('node scripts/release-notes-gen.ts --check');
    record('release-notes', rn.rc === 0, { time: Date.now() - t1, tail: rn.rc ? rn.out.trim().split('\n').slice(-14).join('\n') : '' });
  }
  if (plan.redlines) {
    const t0 = Date.now();
    // 变更域过滤（--files，2026-08-26）：文件驱动/push 模式把本次变更文件传给
    // check-redlines——仅「变更文件内」的违规计入新增阻断，仓库内其他文件既有债务
    // 不干扰当前提交（否则只改 Go/文档会被未提交 frontend 存量新增红线卡住）。
    // --all / --docs 模式 files 为空、不传 --files → 全库基线比对，向后兼容。
    // 数组参数直走 procRun（无 shell）：--files 大列表（整目录搬家可达 300+ 文件）经
    // shell:true 会超 cmd.exe 8191 限制，check-redlines 进程起不来 → fail-closed 报
    // 「输出解析失败」误阻断推送（2026-08-31 ADR-129 第三刀 utils/3d → preview-3d 实证）。
    // 数组直传走 Windows CreateProcess 32767 上限，避开 cmd 8K 墙。all/docs 模式 files 为空 → 全库比对。
    const rlArgs = ['scripts/check-redlines.ts', '--json', '--baseline'];
    if (files.length) rlArgs.push('--files', files.join('\n'));
    const rlRaw = procRun('node', rlArgs, { cwd: ROOT, timeout: TIMEOUT });
    const rl = { rc: rlRaw.rc, out: rlRaw.out || rlRaw.err || '' };
    let newV = null, ok = false, scanHealthy = false, baseCount = 0, rlTail = '';
    try {
      const parsed = JSON.parse(rl.out);
      const s = parsed._summary;
      newV = s.newViolations ?? null;
      baseCount = s.baselineViolations ?? 0;
      ok = s.ok === true;
      // 扫描健康门（fail-closed）：rg 缺失/执行失败时 check-redlines 输出
      // scanHealthy:false——必须阻断推送，否则红线门禁静默放行（P1 修复）
      scanHealthy = s.scanHealthy === true;
      // 违规详情（供 tail 展示方向，不阻断推送）
      if (!ok && Array.isArray(parsed.results)) {
        rlTail = parsed.results
          .filter((r) => r.count > 0)
          .map((r) => `[${r.rule_id} ${r.name}] ` + r.violations.map((v) => `${v.file}:${v.line}`).join(', '))
          .join('\n');
      }
    } catch { /* parse fail */ ok = false; scanHealthy = false; }
    record('check-redlines', ok, {
      time: Date.now() - t0,
      // note 顺序：newV===null 唯一标识 JSON parse 失败（rg 不可用时 newViolations
      // 非 null——runBaseline fail-closed 返回 allKeys），必须先于 scanHealthy 判定
      note: newV === null ? '输出解析失败——fail-closed 阻断，红线门禁未执行'
        : (!scanHealthy ? '扫描不可用（rg 缺失/执行失败）——fail-closed 阻断，红线门禁未执行'
          : (ok ? `红线零新增（基线 ${baseCount} 条）`
            : `${newV} 条新增红线违规（基线 ${baseCount} 条）——债务项，推送后处理`)),
      tail: rlTail,
    });
    // 基线债务（红线新增）不阻断推送：推送后修；发布前全量 doctor 仍会报告（2026-08-13 决策）
    // 但扫描不可用（fail-closed）必须阻断——扫描本身没跑成，不能当作「债务」放行
    if (!scanHealthy) blocked = true;
  }
  if (plan.adr) {
    const t0 = Date.now();
    const ac = sh('node scripts/adr-check.ts');
    record('adr-check', ac.rc === 0, { time: Date.now() - t0, tail: ac.rc ? ac.out.trim().split('\n').slice(-4).join('\n') : '' });
  }

  /* --- 生成器守护：索引产物是否过期（docs 或 adr 变更时） --- */
  if (plan.docs || plan.adr) {
    const t0 = Date.now();
    const gd = sh('node scripts/gen-docs-index.ts --check');
    record('gen-docs-index', gd.rc === 0, { time: Date.now() - t0, tail: gd.rc ? gd.out.trim().split('\n').slice(-4).join('\n') : '' });
  }

  /* --- 契约测试 --- */
  if (plan.contractTests) {
    const t0 = Date.now();
    const tests = await runContractTests();
    const ok = tests.length === 0 || tests.every((t) => t.ok);
    record(`contract tests (${tests.length})`, ok, {
      time: Date.now() - t0,
      note: tests.length === 0 ? '无 tests/*.mjs，跳过'
        : (ok ? '全部通过' : tests.filter((t) => !t.ok).map((t) => `${t.name}\n${t.out}`).join('\n')),
    });
  }

  /* --- 静态工具（--all / --docs / push 按变更域补挂） --- */
  // 回退 ADR-088：runTools 恢复串行，调用点去掉 await
  if (allMode) {
    runTools(ALL_STATIC_TOOLS);
    runTools(DOC_EXTRA_SCRIPTS);
  }
  if (docsMode) {
    runTools(DOC_STATIC_TOOLS);
    runTools(DOC_EXTRA_SCRIPTS);
  }
  // 2026-08-17 P1-1 修复：push 模式此前从不执行静态治理工具（ALL_STATIC_TOOLS 只在
  // --all/--docs 跑）→ gate 名存实亡。现按变更域补挂子集：frontend 变更跑前端静态工具、
  // go 变更跑 Go 静态工具、docs/adr 变更跑文档静态工具——保持按域裁剪的轻量。
  if (!allMode && !docsMode) {
    if (plan.frontend) runTools(FRONTEND_STATIC_TOOLS);
    if (plan.go) runTools(GO_STATIC_TOOLS);
    if (plan.docs || plan.adr) {
      runTools(DOC_STATIC_TOOLS);
      runTools(DOC_EXTRA_SCRIPTS);
    }
  }

  /* --- scripts/ TS 类型检查（--all 模式；.ts 文件随 _lib/ 迁移逐步出现）--- */
  // tsc 不是 mjs 脚本，不走 runTools 的 node scripts/ 路径；TS18003（无输入）容忍为通过。
  // 当前 _lib/ 尚未有 .ts 文件，tsc 返回 rc=2；allowRc2=true 时视为通过（零 .ts = 零错误）。
  // 未来 _lib/proc.ts 等迁移到位后，rc=2 自动变为 rc=0/1，无需额外改 gate。
  if (allMode || docsMode) {
    const tSC0 = Date.now();
    const tSC = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const tscResult = await shAsync(`"${tSC}" --noEmit -p scripts/tsconfig.json`);
    const tscOk = tscResult.rc === 0 || tscResult.rc === 2; // rc=2 = TS18003 无输入，容忍
    record('tsc scripts/', tscOk, {
      time: Date.now() - tSC0,
      note: tscResult.rc === 2 ? '无 .ts 文件（待 _lib/ 迁移后生效）'
        : (tscResult.rc === 0 ? '类型检查通过' : `${tscResult.out.trim().split('\n').filter(Boolean).length} 个错误`),
      tail: tscResult.rc === 0 ? '' : tscResult.out.trim().split('\n').slice(-5).join('\n'),
    });
  }

  /* --- 聚合摘要 --- */
  logPush('------------------- 结果 -------------------');
  // FAIL 前置（2026-08-29 可观测性）：失败项先出，不被 OK 洪流淹没——
  // 28 项全跑完才出结论，若 FAIL 混排在末尾用户找不到是哪个指令有问题。
  // 比较器：Number(true)-Number(false) = 1 → ok 排后；fail(0) 自然排前。
  const sortedResults = [...results].sort((a, b) => Number(a.ok) - Number(b.ok));
  for (const r of sortedResults) {
    const status = r.ok ? B.OK : B.FAIL;
    logPush(`${status} ${r.label.padEnd(20)} ${(r.time / 1000).toFixed(1)}s  ${r.note || ''}`);
    if (r.tail) {
      for (const line of r.tail.split('\n')) logPush(`       ${line}`);
    }
  }
  logPush('');
  if (!results.length) {
    logPush(`${B.SKIP} 无相关域变更（${domainSummary}），无需检查`);
    return 0;
  }
  if (!blocked) {
    const passCount = results.filter((r) => r.ok).length;
    logPush(`结论: PASS ✅ ${dryRun ? '（DRY-RUN）' : '放行推送'} ${passCount}/${results.length} 项通过`);
    // P0 修复（子代理锐评）：横幅移到 dry-run 分支——AI 验证完（dry-run）时看到「可直接 push」，
    // 真实 push 时（!dryRun）已在执行，复读机提示无意义。
    // Q1 修复（子代理再洗礼）：--no-banner 抑制横幅，由调用方（commit-with-check）在 commit 成功后自己打印
    // （commit-with-check 恒走 dry-run，横幅在自动 commit 前出现会诱导 AI push 旧 HEAD）
    if (dryRun && !noBanner) {
      logPush('');
      logPush('════════════════════════════════════════');
      logPush('  ✅ 门禁全绿，可直接执行：git push');
      logPush('  （无需再手动跑 doctor --docs / tsc / build 确认）');
      logPush('════════════════════════════════════════');
    }
    return 0;
  }
  logPush(`结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过，推送已${dryRun ? '将被' : ''}阻断`);
  // 失败项清单（2026-08-29 可观测性）：一行点名全部失败指令，无需在结果表里逐行找
  const fails = results.filter((r) => !r.ok);
  logPush(`失败项 (${fails.length}): ${fails.map((r) => r.label).join(' / ')}`);
  logPush('详情见上方 [FAIL] 块（已前置到结果表最前）');
  // 修复指引：gofmt 检出未格式化（疑似 --no-verify 绕过 pre-commit）→ 手动修复后重推
  const gofmt = results.find((r) => r.label === 'gofmt');
  let gofmtHint = '';
  if (gofmt && !gofmt.ok) {
    gofmtHint = 'gofmt 检出未格式化——gofmt -w 修复后 git add + git commit 重推。';
  }
  logPush(`修复指引: 按上方 [FAIL] 项处理；${gofmtHint}紧急绕过: git push --no-verify`);
  logPush(PULL_HINT);
  return 1;
}

// ── 文档待补地图：仅门禁 PASS 时刷新（非阻断），供文档类 AI 定位「哪块城邦失修、该补哪里」──
// 失败/用法错误时跳过：失败推送无地图消费方，且 gen-doc-next-steps 内部会重跑
// check-knowledge-drift / link-checker / adr-check 三个重型检查，会延迟失败回执（2026-08-12 排查）。
main().then(async (code) => {
  if (code === 0) {
    // P2 修复（2026-08-17）：地图刷新此前 execFileSync 同步阻塞每次成功推送（≤300s），
    // 失败空 catch 吞掉 + stdio ignore 无感知——改为后台 spawn（detached+unref），
    // 推送立即返回，失败至少打一行可见提示（门禁锐评 P2-1）。
    try {
      // 2026-08-17 code_review P2：去掉 shell:true——process.execPath 是真实 .exe
      // 直接 spawn；带 shell 会经 cmd.exe 重新解析 `C:\Program Files\...` 路径（空格炸）。
      const child = spawn(process.execPath, ['scripts/gen-doc-next-steps.ts'], {
        cwd: ROOT, stdio: 'ignore', detached: true,
      });
      child.unref();
      child.on('error', (e) => console.error(`[MAP] 后台刷新启动失败（不影响推送）: ${e.message}`));
      console.log('[MAP] 已触发后台刷新 docs/.doc-next-steps.md（AI 待补地图，非阻断，不阻塞推送）');
    } catch (e: any) {
      console.error(`[MAP] 后台刷新启动失败（不影响推送）: ${e.message}`);
    }
  }
  process.exit(code ?? 0);
}).catch((e) => { console.error(e); process.exit(1); });
