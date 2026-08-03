#!/usr/bin/env node
/**
 * ripgrep.mjs — rg 调用共享层（scripts/_lib）。
 *
 * 统一 review.mjs / comment-checker.mjs 的内联 rg() 封装：
 *   1. 统一参数：--no-heading -n --path-separator /（正斜杠输出，Windows 友好）
 *   2. glob 过滤：'-g *.js' 追加到命令尾部
 *   3. 目标路径：相对仓库根拼接（paths 可为 string | string[]）
 *   4. 容错：rg 缺失/无匹配 → 返回 []，不抛异常
 *
 * 零依赖（仅 node:child_process / node:path / node:url）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。 */
export function getRoot() {
  return path.resolve(__dirname, '..', '..');
}

const ROOT = getRoot();

/**
 * 运行 ripgrep，返回匹配行数组（无匹配 → []）。
 * @param {string} pattern 正则模式（原始字符串）
 * @param {string|string[]} paths 相对仓库根的目录/文件
 * @param {string[]} [globs] glob 过滤，如 ['*.js', '*.ts']
 * @returns {string[]} "文件:行号:内容" 行
 */
export function rg(pattern, paths, globs = null) {
  const cmd = ['--no-heading', '-n', '--path-separator', '/', pattern];
  for (const g of (globs || [])) cmd.push('-g', g);
  const targets = Array.isArray(paths) ? paths : [paths];
  for (const p of targets) cmd.push(path.join(ROOT, p));
  try {
    const out = execFileSync('rg', cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (out.trim()) return out.trim().split('\n').filter((l) => l.trim());
  } catch { /* rg 缺失或无匹配 */ }
  return [];
}
