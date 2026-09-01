#!/usr/bin/env node
/**
 * collect-scripts.ts — scripts/ 目录 .mjs 收集共享层。
 *
 * 设计意图：check-proc-adoption / check-readme-index / check-script-hygiene 三处
 * 各自内联了一份「递归收集 scripts/ 下 .mjs（排除 _ 前缀共享层与测试）」的样板，
 * 差异仅在 hooks/ 子目录的取舍（proc/readme 含 hooks 登记与直调检查，hygiene 因
 * git 钩子协议参数语义排除 hooks）。2026-09 孤儿审计 ② 判定「同模板复制的铁证」，
 * 按 check-lib-adoption 既有 walk 姿势收敛为带 skipHooks 选项的单点实现。
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts（零外部依赖）。
 *
 * 用法：
 *   import { collectScripts } from './_lib/collect-scripts.ts';
 *   collectScripts({ skipHooks: true });  // 默认含 hooks/（proc/readme 口径）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-files.ts';

export const SCRIPTS_DIR = path.join(ROOT, 'scripts');

/**
 * 递归收集 dir 下所有 .mjs（默认 scripts/）。
 * @param {object} [opts]
 *   - skipHooks {boolean}  排除 hooks/ 子目录（hygiene 口径：git 钩子协议参数不适用
 *                          parse-args positional 等检查）；默认 false（含 hooks，proc/readme 口径）
 *   - dir {string}         起始目录，默认 SCRIPTS_DIR（测试可注入临时目录）
 * @returns {string[]} 相对起始目录的 posix 路径，排序后返回
 */
export function collectScripts(opts: { skipHooks?: boolean; dir?: string } = {}): string[] {
  const { skipHooks = false, dir = SCRIPTS_DIR } = opts;
  const out: string[] = [];
  const visit = (d: string) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // 目录不可读：跳过，不让单点异常炸掉整棵扫描树
    }
    for (const entry of entries) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) {
        // _ 前缀共享层（_lib 等）不纳入；hooks 按选项取舍（语义差异见文件头）
        if (entry.name.startsWith('_') || (skipHooks && entry.name === 'hooks')) continue;
        visit(abs);
      } else if (
        // 2026-09 顶层 .mjs→.ts 迁移完成：仅收 .ts（.mjs 已全量断除）
        entry.name.endsWith('.ts') &&
        !entry.name.startsWith('_') &&
        !/\.test\.ts$/.test(entry.name)
      ) {
        out.push(path.relative(dir, abs).replace(/\\/g, '/'));
      }
    }
  };
  visit(dir);
  return out.sort();
}
