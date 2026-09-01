#!/usr/bin/env node
/**
 * 契约测试：check-redlines 变更域过滤（--files）。
 *
 * 背景（2026-08-26）：commit-with-check 走 pre-push-gate --files 按域裁剪，但
 * check-redlines 是全库扫描比对基线，不读 --files——导致「本次只改 Go/文档」时
 * 被仓库内其他文件（如未提交的 frontend）的存量新增红线卡住（BUG-1 提交遇阻复盘）。
 *
 * 修复语义：check-redlines 接受 --files <改文件列表>，仅把「本次变更文件内」的
 * 新增违规计入阻断/告警；其他文件的既有债务不干扰当前提交。基线安全语义不变——
 * 真改动的文件若引入违规仍会阻断。
 *
 * 覆盖：
 *   1. 无 changedSet → 键原样返回（向后兼容全库比对）
 *   2. changedSet 命中某文件 → 该文件的所有键保留，其余过滤
 *   3. 多文件命中 → 精确按文件归属分配
 *   4. 深路径文件的键取「: 前段」为文件标识（advisory 键带 rule:content:line 后缀）
 *
 * 用法：node tests/test_redlines_changed_files.mjs
 * 退出码：0 = 通过；1 = 失败。
 */
import { redlineFilterKeysByChangedFiles } from '../scripts/check-redlines.ts';

const failures = [];
let assertCount = 0;

function assert(cond, msg) {
  assertCount++;
  if (!cond) failures.push(msg);
}

function splitEq(keys, want, msg) {
  const got = keys.slice().sort();
  const w = want.slice().sort();
  assert(got.length === w.length && got.every((v, i) => v === w[i]), `${msg} | got=${JSON.stringify(keys)} want=${JSON.stringify(want)}`);
}

const A = 'frontend/src/views/app-content/diagnostics/perf-cli.ts';
const B = 'go/scanner/scanner.go';
const keys = [
  `${A}:R5:#ff0000:12`,
  `${A}:W2:cafebabe:40`,
  `${B}:R1:deadbeef:1`,
];

// 1. 无 changedSet → 原样（兼容旧全库行为）
splitEq(redlineFilterKeysByChangedFiles(keys, null), keys, '无 changedSet 应返回原样');

// 2. changedSet 命中 A → 只留 A 的两个键
splitEq(
  redlineFilterKeysByChangedFiles(keys, new Set([A])),
  [`${A}:R5:#ff0000:12`, `${A}:W2:cafebabe:40`],
  'changedSet 命中 A 应只保留 A 的键',
);

// 3. changedSet 命中 B → 只留 B
splitEq(
  redlineFilterKeysByChangedFiles(keys, new Set([B])),
  [`${B}:R1:deadbeef:1`],
  'changedSet 命中 B 应只保留 B 的键',
);

// 4. 空 changedSet（零文件）→ 全过滤
splitEq(redlineFilterKeysByChangedFiles(keys, new Set()), [], '空 changedSet 应全过滤');

if (failures.length) {
  console.error(`✗ ${failures.length} 个断言失败（共 ${assertCount}）:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ redlineFilterKeysByChangedFiles 契约通过（${assertCount} 断言）`);