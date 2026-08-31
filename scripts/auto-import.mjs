#!/usr/bin/env node
/**
 * auto-import.mjs — TS/JS 缺失 import 检测（只读提示版，ADR-014 试水）。
 *
 * 零依赖（仅 node:fs / node:path），复用 _lib/scan-files.ts 共享层。
 *
 * 原理（goimports 轻量版，正则级非 AST 级）：
 *   1. 扫描 frontend/src 下所有 .ts/.js，提取每个模块的导出符号表
 *      （export const/function/class + export type/interface/enum + export { a, b }）；
 *   2. 对目标文件做词法剥离（注释/字符串/模板字面量），收集代码中出现的标识符；
 *   3. 排除：关键词/全局内置、本文件定义（const/function/class/参数/解构）、
 *      已 import（含别名/命名空间/默认导入）、属性访问（obj.prop 的 prop）；
 *   4. 剩余标识符 ∩ 导出符号表 = 疑似缺失 import，输出建议（不写文件）。
 *
 * 设计取舍（试水版已知局限，供误报率评估）：
 *   - 正则级分析，非 TS AST：局部变量与外部符号无法 100% 区分，靠「导出表
 *     命中才建议」把误报面压到最小（导出符号名多为专名，如 PageStore/ALL_EXTS）；
 *   - 模板字符串整体剥离：`${foo}` 插值内的符号不检测（漏报可接受）；
 *   - 方法体参数（method(a) 的 a）不收集：参数名撞导出名的场景低频；
 *   - 绑定符号（DetectZipType 等）刻意不补：项目规范走 getApp()（ADR-012）。
 *
 * 结构（2026-08-31 大脚本拆分基线 ADR 拆出）：
 *   本文件仅保留 CLI 入口；词法/符号/检测/修复各层拆至
 *   auto-import-lexer.mjs / auto-import-symbols.mjs /
 *   auto-import-detect.mjs / auto-import-fix.mjs。
 *
 * 用法：
 *   node scripts/auto-import.mjs                      # 检测全部 .ts
 *   node scripts/auto-import.mjs frontend/src/core/handler-other.ts   # 单文件
 *   node scripts/auto-import.mjs --include-js         # 连存量 .js 一起扫
 *   node scripts/auto-import.mjs --fix                # 自动写入缺失 import（歧义跳过）
 *   node scripts/auto-import.mjs --watch              # 监听变化自动重扫
 *   node scripts/auto-import.mjs --json               # JSON 输出（CI 用）
 *   node scripts/auto-import.mjs --strict             # 有缺失 → 退出码 1
 *
 * 退出码：默认 0（提示工具）；--strict 且存在缺失建议 → 1。
 * 设计意图：自动导入修复工具
 */
import fs from 'node:fs';
import { SRC_DIR, relPosix } from './_lib/scan-files.ts';
import { run } from './auto-import-detect.mjs';
import { applyFixes, fmtText, fmtJson } from './auto-import-fix.mjs';

// ── CLI ─────────────────────────────────────────────

const ARGS = process.argv.slice(2);
if (ARGS.includes('--help') || ARGS.includes('-h')) { console.log('用法: node scripts/auto-import.mjs [文件...] [--include-js|--strict|--fix|--json|--watch]'); process.exit(0); }
const KNOWN_FLAGS = new Set(['--include-js', '--strict', '--fix', '--json', '--watch']);
const unknown = ARGS.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
if (unknown.length) { console.error('[FAIL] 未知参数: ' + unknown.join(', ') + '（--help 查看用法）'); process.exit(1); }
const WATCH = ARGS.includes('--watch');
const INCLUDE_JS = ARGS.includes('--include-js');
const STRICT = ARGS.includes('--strict');
const FIX = ARGS.includes('--fix');
const JSON_OUT = ARGS.includes('--json');
const TARGETS = ARGS.filter((a) => !a.startsWith('--'));

function main() {
  const opts = { srcDir: SRC_DIR, targets: TARGETS, includeJs: INCLUDE_JS };
  const result = run(opts);
  if (FIX && result.totals.totalMissing > 0) {
    const { fixed, skipped } = applyFixes(result.suggestions);
    // 写回后重跑一轮，输出修复后状态（幂等自检：第二次应无新增）
    const after = run(opts);
    process.stdout.write(`--fix：写入 ${fixed} 行 import（歧义跳过 ${skipped}），修复后剩余 ${after.totals.totalMissing} 条建议。\n`);
    process.stdout.write((JSON_OUT ? fmtJson(after) : fmtText(after, SRC_DIR)) + '\n');
    if (STRICT && after.totals.totalMissing > 0) process.exit(1);
    return;
  }
  process.stdout.write((JSON_OUT ? fmtJson(result) : fmtText(result, SRC_DIR)) + '\n');
  if (STRICT && result.totals.totalMissing > 0) process.exit(1);
}

// ── --watch 模式 ─────────────────────────────────────

if (WATCH) {
  console.log(`[auto-import] 监听 ${relPosix(SRC_DIR)} 变化（Ctrl+C 退出）...`);
  let timer = null;
  const rerun = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('\n--- 重扫 ---');
      main();
    }, 300);
  };
  fs.watch(SRC_DIR, { recursive: true }, rerun);
  main();
} else {
  main();
}
