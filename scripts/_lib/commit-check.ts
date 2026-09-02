/**
 * commit-check.ts — 轻量级提交校验清单（commit-with-check 专属，2026-09-02 重构）。
 *
 * 设计意图：commit-with-check 此前是 pre-push-gate 的 thin wrapper，等于在提交阶段
 * 跑了一遍「重型 push 门禁」（go build / go test / vite build / vitest / link-checker /
 * 全量静态工具），且与 pre-push 钩子双重付费——小提交纯增成本、定位迷糊。
 *
 * 本模块把 commit 阶段的检查**独立**出来，只回答一个问题：「本次变更文件本身有没有问题？」
 * 严格按文件裁剪，不复用 pre-push-gate 编排（避免继承重型构建/全量静态工具）：
 *
 *   1. check-redlines --files       红线合规（仅查变更文件内新增违规；scanHealthy fail-closed）
 *   2. check-doc-drift --files       知识卡漂移（仅查变更卡；跳未跟踪草稿）
 *      check-knowledge-drift --files 同上
 *   3. 变更域契约测试（selectContractTests 按域选子集，并行跑）
 *
 * 显式跳过（这些是 push 阶段 pre-push 钩子的职责，不在此处重复验证）：
 *   - go build / go test -race / go vet
 *   - npx vite build / vitest run
 *   - link-checker / type-consistency / release-notes
 *   - FRONTEND/GO/DOC 全量静态工具清单（check-circular / check-biome / jscpd-go …）
 *
 * 复用原子能力（非编排器）：_lib/proc.run、_lib/domain-classify、_lib/contract-tests。
 *
 * 依赖：零三方；仅 node 内置 + 上述 _lib 模块。
 */

import { run } from './proc.ts';
import { classify, type Domain } from './domain-classify.ts';
import { selectContractTests, runContractTestsParallel } from './contract-tests.ts';

const ROOT = process.cwd();
const TIMEOUT = 120_000;

/** 单条检查结果。 */
export interface CheckItem {
  label: string;
  ok: boolean;
  time: number;
  note?: string;
  tail?: string;
  /** failClosed：工具本身不可用才阻断（如 rg 缺失），否则记录不阻断。 */
  failClosed?: boolean;
}

/** 轻量提交校验结果。 */
export interface CommitCheckResult {
  ok: boolean;
  results: CheckItem[];
}

/**
 * 运行轻量级提交校验（仅针对本次变更文件）。
 * @param files 相对仓库根的文件路径数组（已含 --files 白名单或 staged 清单）。
 * @param deps 可选依赖注入（单测桩子进程用；缺省跑真实 run / runContractTestsParallel）。
 */
export async function runCommitChecks(
  files: string[],
  deps: {
    /** 子进程执行器桩（单测注入 canned JSON，避免真跑 check-*.ts）。 */
    run?: typeof run;
    /** 契约测试并行执行器桩（单测注入 canned 结果，避免真 spawn tests/*.ts）。 */
    runTests?: typeof runContractTestsParallel;
  } = {},
): Promise<CommitCheckResult> {
  const runFn = deps.run ?? run;
  const runTestsFn = deps.runTests ?? runContractTestsParallel;
  const results: CheckItem[] = [];
  let blocked = false;
  const record = (item: CheckItem) => {
    results.push(item);
    if (!item.ok) blocked = true;
  };

  const joined = files.join('\n');

  /* --- 1. 红线合规（按 --files 裁剪，仅查变更文件内新增违规）--- */
  {
    const t0 = Date.now();
    const r = runFn(process.execPath, ['scripts/check-redlines.ts', '--json', '--baseline', '--files', joined], {
      cwd: ROOT,
      shell: false,
      timeout: TIMEOUT,
    });
    let ok = false;
    let scanHealthy = false;
    let note = '';
    try {
      const s = JSON.parse(r.out || r.err || '{}')._summary || {};
      ok = s.ok === true;
      // 扫描健康门（fail-closed）：rg 缺失/执行失败时 scanHealthy=false → 必须阻断
      scanHealthy = s.scanHealthy === true;
      const nv = s.newViolations ?? null;
      note = nv === null ? '输出解析失败（rg 不可用？）' : `新增违规 ${nv}（基线 ${s.baselineViolations ?? 0}）`;
    } catch {
      ok = false;
      scanHealthy = false;
      note = '输出解析失败（非 JSON）';
    }
    // 阻断语义（fail-closed 合取，2026-09-02 code_review P1 修复）：
    //   ok=false（变更文件内存在新增红线违规或基线缺失）→ 必须阻断；
    //   scanHealthy=false（rg 缺失/执行失败）→ 必须阻断（fail-closed）；
    //   仅存量基线债务不阻断（发布前全量 doctor 仍报告）。
    // 原 `ok || scanHealthy` 在「扫描健康 + 有新增违规」时恒放行，红线检查形同虚设。
    const pass = ok && scanHealthy;
    record({
      label: '红线合规',
      ok: pass,
      time: Date.now() - t0,
      note,
      failClosed: !scanHealthy,
    });
  }

  /* --- 2. 文档/知识卡漂移（仅当变更含 docs/.md 时跑，避免无关提交空转）--- */
  const hasDocs = files.some((f) => f.startsWith('docs/') || f.endsWith('.md'));
  if (hasDocs) {
    for (const tool of ['check-doc-drift.ts', 'check-knowledge-drift.ts'] as const) {
      const t0 = Date.now();
      const r = runFn(process.execPath, ['scripts/' + tool, '--json', '--files', joined], {
        cwd: ROOT,
        shell: false,
        timeout: TIMEOUT,
      });
      let ok = true;
      let note = '';
      try {
        const parsed = JSON.parse(r.out || r.err || '{}');
        const s = parsed._summary || parsed;
        if (typeof s.ok === 'boolean') ok = s.ok;
        else if (typeof s.errors === 'number') ok = s.errors === 0;
        else {
          // 缺 ok/errors 双键 = summary 契约缺失，fail-closed（code_review P3 加固：
          // 未来 drift 工具改名 summary key 时不得静默放行）
          ok = false;
        }
        note = `errors=${s.errors ?? '?'} warns=${s.warns ?? '?'}`;
      } catch {
        ok = false;
        note = '输出解析失败（非 JSON）';
      }
      record({ label: tool, ok, time: Date.now() - t0, note });
    }
  }

  /* --- 3. 变更域契约测试（按域选子集；scripts→tests 域按变更文件精确裁剪，不再全量）--- */
  {
    const domains = [...new Set(files.map((f) => classify(f)))] as Domain[];
    const selected = selectContractTests(domains, files);
    if (selected.length > 0) {
      const t0 = Date.now();
      const tests = await runTestsFn(selected);
      const ok = tests.length === 0 || tests.every((t) => t.ok);
      const failed = tests.filter((t) => !t.ok).map((t) => `${t.name}\n${t.out}`).join('\n');
      record({
        label: `契约测试（${tests.length}）`,
        ok,
        time: Date.now() - t0,
        note: ok ? '全部通过' : failed.slice(0, 400),
        tail: ok ? '' : failed,
      });
    }
  }

  return { ok: !blocked, results };
}
