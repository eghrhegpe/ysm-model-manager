#!/usr/bin/env node
/**
 * check-proc-adoption.mjs — 子进程直调收敛检查（ADR-043 落地率守护）
 *
 * 职责：扫描 scripts/ 下所有 .mjs（含 hooks/ 子目录，排除 _lib 与测试），
 * 捕捉仍直调 `execFileSync` / `execSync`（node:child_process）而未走共享层
 * `_lib/proc.mjs` 的脚本——ADR-043「消灭各自内联 execFileSync」目标的防回潮闸。
 * R15 审计实测：_lib/proc.mjs 接入率仅 17%（7/40），33+ 处直调无自动检测，
 * 本脚本补上 WARN 报告，推动落地率回升（不强制阻断，避免误伤领域专用直调）。
 *
 * 判定：文件 import 了 execFileSync/execSync（node:child_process），
 * 且未 import `_lib/proc.mjs` → 计入直调清单。已接入共享层的脚本自动豁免。
 *
 * 设计意图：把「子进程收敛」从纸面约定升级为可机检、可汇报的卡点——
 * 与 check-script-hygiene 的共享层内联口径互补：那边查「样板内联」，这里查「直调未收敛」。
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.mjs（零外部依赖）
 *
 * 用法：
 *   node scripts/check-proc-adoption.mjs           # 文本报告（WARN，不阻断）
 *   node scripts/check-proc-adoption.mjs --json    # JSON（doctor/CI 消费）
 *   node scripts/check-proc-adoption.mjs --strict  # 有 WARN → 退出码 1
 *
 * 退出码：默认 0（提示工具，WARN 不阻断）；--strict 且存在 WARN → 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';
import { collectScripts } from './_lib/collect-scripts.mjs';

const ROOT = getRoot();
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

// 直调特征：import 块含 execFileSync/execSync，来源 node:child_process
const DIRECT_EXEC_IMPORT_RE = /import\s*\{[^}]*\b(?:execFileSync|execSync)\b[^}]*\}\s*from\s*['"]node:child_process['"]/;
// 已接入共享层：import 了 _lib/proc.mjs
const PROC_ADOPTED_RE = /from\s*['"].*_lib[\\/]proc\.mjs['"]/;

function main() {
  const files = collectScripts(); // 含 hooks/（git 钩子辅助脚本同样可能直调子进程）
  const direct = [];

  for (const f of files) {
    const text = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
    if (DIRECT_EXEC_IMPORT_RE.test(text) && !PROC_ADOPTED_RE.test(text)) {
      direct.push(f);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      _summary: { scripts: files.length, directExec: direct.length },
      direct: direct,
    }, null, 2));
    if (STRICT && direct.length) process.exit(1);
    return;
  }

  const pct = files.length ? Math.round((1 - direct.length / files.length) * 100) : 100;
  console.log('══════════════════════════════════════');
  console.log(' 子进程收敛检查 (check-proc-adoption)');
  console.log('══════════════════════════════════════');
  console.log(`扫描 ${files.length} 个脚本，直调 execFileSync/execSync 未走 proc.mjs：${direct.length} 个（非直调占比 ${pct}%）`);
  console.log('──────────────────────────────────────');
  for (const f of direct) console.log(`⚠ ${f}：直调 execFileSync/execSync（应 import _lib/proc.mjs 的 run/runSafe）`);
  if (!direct.length) console.log('✅ 所有脚本均已接入 _lib/proc.mjs（或未直调子进程）。');
  else console.log('\n（WARN 不阻断；加 --strict 后退出码 1）');
  if (STRICT && direct.length) process.exit(1);
}

main();
