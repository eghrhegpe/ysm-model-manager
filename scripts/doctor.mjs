#!/usr/bin/env node
/**
 * 项目健康诊断 CLI 派发器。
 * doctor.mjs — 全量治理检查编排（2026-08-14 起为薄派发器）
 * 设计意图：三模式全部委托 pre-push-gate.mjs（单一实现源头，消除双端漂移）
 * 依赖：node:child_process / node:path / node:url
 * 用法：
 *   node scripts/doctor.mjs                 # 默认行为（委托 pre-push-gate --all --dry-run：全量体检）
 *   node scripts/doctor.mjs --docs          # 文档模式（委托 pre-push-gate --docs --dry-run：轻量）
 *   node scripts/doctor.mjs --gate          # 门禁模式（委托 pre-push-gate.mjs --dry-run，不触发 push）
 *   node scripts/doctor.mjs --gate <ref>    # 指定 ref（默认 HEAD，用于预检未提交的改动）
 *   node scripts/doctor.mjs --check  # 兼容旧参数，忽略（gate 无对应语义）
 *   node scripts/doctor.mjs --strict # 严格模式：等价 --all（静态工具挂载已自带 --strict，2026-08-17）
 *   node scripts/doctor.mjs --json   # 透传 pre-push-gate 原始输出（契约见 check-script-hygiene）
 * 退出码：任何非零检查([FAIL])均透传退出码阻断；仅 WARN/skip 不阻断
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';

const JSON_MODE = process.argv.includes('--json');
const DOCS_MODE = process.argv.includes('--docs');
const GATE_MODE = process.argv.includes('--gate');

// 顶层兜底：spawnSync 异常（ENOENT/git 缺失等）避免裸栈追踪
process.on('uncaughtException', (e) => {
  console.error(`[doctor] 异常: ${e.message}`);
  process.exit(1);
});

/** 委托 pre-push-gate.mjs 并透传退出码（stdin 可选，供 --gate 传 ref 行）。 */
function delegate(gateArgs, { stdin } = {}) {
  // --json 透传：gate 未来实现结构化输出时自动生效（契约见 check-script-hygiene）
  const args = JSON_MODE ? [...gateArgs, '--json'] : gateArgs;
  const gateResult = spawnSync(
    'node',
    [path.join('scripts', 'pre-push-gate.mjs'), ...args],
    { cwd: ROOT, input: stdin ? Buffer.from(stdin) : undefined, stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8' },
  );
  // 打印 pre-push-gate 原始输出（已含 ====== YSM 本地质量门禁 ====== 标题与 [OK]/[FAIL] 标记）
  if (gateResult.stdout) process.stdout.write(gateResult.stdout);
  if (gateResult.stderr) process.stderr.write(gateResult.stderr);
  process.exit(gateResult.status ?? 1);
}

if (GATE_MODE) {
  // --gate 模式：委托 pre-push-gate.mjs --dry-run（单一实现，避免双端漂移）。
  // 用法：node scripts/doctor.mjs --gate [ref]
  //   ref 默认 HEAD；也可传具体 commit oid。
  //   与 pre-push-gate 共享同一套域分类 + 检查链，不做 gofmt amend（只读校验）。
  const GATE_SKIP = process.env.YSM_SKIP_GATE;
  if (GATE_SKIP === '1') {
    console.log('[--gate] YSM_SKIP_GATE=1, 跳过');
    process.exit(0);
  }
  // 解析 ref → oid
  const refArgIdx = process.argv.indexOf('--gate') + 1;
  const refArg = process.argv[refArgIdx];
  const baseRef = refArg || 'HEAD';
  const oidR = spawnSync('git', ['rev-parse', '--verify', baseRef], { cwd: ROOT, encoding: 'utf8' });
  if (oidR.status !== 0) {
    console.log(`[--gate] 无法解析 ref "${baseRef}"，退化为全量`);
    delegate(['--all', '--dry-run']);
  }
  const localOid = (oidR.stdout || '').trim();
  // 构造 stdin 行（remoteOid 全 0 → pre-push-gate 走新分支 fallback：merge-base origin/<branch>/origin/HEAD/origin/main/origin/master → 上次提交）
  const branchR = spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' });
  const branch = (branchR.stdout || '').trim();
  const localRef = branch ? `refs/heads/${branch}` : 'HEAD';
  const stdinLine = `${localRef} ${localOid} ${localRef} 0000000000000000000000000000000000000000`;
  delegate(['--dry-run', 'origin', 'git@github.com:placeholder/placeholder.git'], { stdin: stdinLine });
} else if (DOCS_MODE) {
  // 文档模式：轻量（仅文档/ADR/索引/静态文档工具，跳过 Go/前端编译与测试）
  delegate(['--docs', '--dry-run']);
} else {
  // 全量模式：编译 + 构建 + 文件 + 红线 + Git（全量体检）。
  // --strict 不再忽略（2026-08-17 门禁锐评 P2-4）：runTools 已解析 _summary 判定
  // （i18n-check/auto-import 挂 --strict 硬门禁；orphan/boolean-naming/script-hygiene
  // 为审计类默认报告数量、退出码恒 0——与 deadcode/redlines 基线债务同口径：推送后修）。
  delegate(['--all', '--dry-run']);
}
