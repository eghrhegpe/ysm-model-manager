/**
 * tests/_lib.mts — 契约测试共享库（2026-09 收编跨文件重复脚手架）。
 *
 * 命名说明：`_` 前缀 + `.mts` 双保险——scripts/_lib/contract-tests.ts 的
 * collectContractTests 以 `f.endsWith('.ts') && !f.startsWith('_')` 枚举，
 * `for f in tests/*.ts` 的 glob 也不匹配 .mts，本文件不会被误当测试执行。
 *
 * 收编对象：check-knowledge-* 家族逐字节相同的 run/ok 本地实现与尾部汇总
 * （FAILED/✗ 格式为消费端事实标准——pre-push-gate 仅看退出码，格式统一安全）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** scripts 目录（供 runScript 定位被测脚本）。 */
export const SCRIPTS = path.join(process.cwd(), 'scripts');
const NODE = process.execPath;

/** 跨 helper 共享的失败收集器：ok/check 记入，finish 汇总裁决退出码。 */
export const failures: string[] = [];

/** 跑 scripts/<script>（60s 超时，utf-8），返回 spawnSync 结果。 */
export function runScript(script: string, ...args: string[]) {
  return spawnSync(NODE, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf-8',
    timeout: 60000,
  });
}

/** 断言：通过打 ✓，失败记入 failures（不打断执行，最后由 finish 裁决）。 */
export function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`   ✓ ${label}`);
  else failures.push(`[${label}] ${detail}`);
}

/** 尾部汇总：failures 非空则逐条打印并 exit 1，否则打印 OK 消息。 */
export function finish(okMessage: string): void {
  if (failures.length) {
    console.log(`FAILED: ${failures.length} issue(s)`);
    for (const e of failures) console.log(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(`OK: ${okMessage}`);
}
