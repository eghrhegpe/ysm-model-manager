#!/usr/bin/env node
/**
 * ripgrep.ts — rg 调用共享层（scripts/_lib）。
 *
 * 统一 check-redlines.ts / comment-checker.ts 的内联 rg() 封装：
 *   1. 统一参数：--no-heading -n --path-separator /（正斜杠输出，Windows 友好）
 *   2. glob 过滤：'-g *.js' 追加到命令尾部
 *   3. 目标路径：相对仓库根拼接（paths 可为 string | string[]）
 *   4. 退出码语义：rg 退出码 1（无匹配）→ 返回 []；rg 缺失(ENOENT)/坏正则(status 2) → 抛错（供严格调用方感知）；提示工具请用 rgSafe
 *
 * 零依赖（仅 node:child_process / node:path / node:url）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRoot } from './scan-files.ts';

// 注：ROOT 由 execFileSync 的 cwd 选项使用（见 rg()），不再单独存模块级常量

/**
 * 运行 ripgrep，返回匹配行数组（无匹配 → []）。
 * @param {string} pattern 正则模式（原始字符串）
 * @param {string|string[]} paths 相对仓库根的目录/文件
 * @param {string[]} [globs] glob 过滤，如 ['*.js', '*.ts']
 * @returns {string[]} "文件:行号:内容" 行
 */
export function rg(pattern, paths, globs = null) {
  // P1（code_review）：路径契约校验——传绝对路径给 rg 会让输出带绝对路径前缀，
  // 消费者 parseRgLine 按 `:` 切分拿错路径（Windows 盘符冒号尤其）；undefined/空数组
  // 会抛 TypeError 或误扫整个 ROOT。统一在入口拒绝，把编程错误与扫描失败分开。
  if (!pattern) throw new Error('ripgrep: pattern 不能为空');
  const targets = Array.isArray(paths) ? paths : [paths];
  if (targets.length === 0) throw new Error('ripgrep: paths 为空，至少需要一个相对仓库根的路径');
  const cmd = ['--no-heading', '-n', '--path-separator', '/', pattern];
  for (const g of (globs || [])) cmd.push('-g', g);
  for (const p of targets) {
    if (typeof p !== 'string' || !p) throw new TypeError(`ripgrep: paths 元素必须为非空字符串（got ${typeof p}）`);
    // P1（code_review）：显式拒绝绝对路径——path.join(ROOT, abs) 在 Windows 不重置、
    // path.relative 又可能还原出盘符路径，导致 rg 实际去扫系统目录（os error 32/5 实证）。
    // isAbsolute 才是可靠判定：rg 输出须为相对仓库根路径，parseRgLine 才能正确切分。
    if (path.isAbsolute(p)) throw new Error(`ripgrep: paths 元素应为相对仓库根路径（got ${p}）`);
    cmd.push(p);
  }
  try {
    // cwd 用 getRoot()（code_review P2）：paths 按文档契约相对仓库根——若不设 cwd，
    // rg 会按调用方 process.cwd() 解析相对路径，非 ROOT 目录调用会扫错树 → rgSafe 假绿。
    // 注意不能引用已删除的模块级 ROOT 常量（ReferenceError 会被 catch 成 status=unknown）
    const out = execFileSync('rg', cmd, { cwd: getRoot(), encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (out.trim()) return out.trim().split('\n').filter((l) => l.trim());
    return []; // rg 退出码 1：无匹配
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    // 退出码 1 = 无匹配（正常返回空）；其余视为扫描不可信，向上抛错让调用方知情
    if (err.status === 1) return [];
    if (err.code === 'ENOENT') {
      throw new Error(`ripgrep(rg) 未安装或不在 PATH，无法执行扫描：pattern=${pattern}`);
    }
    throw new Error(`ripgrep 执行失败（status=${err.status ?? 'unknown'}）：pattern=${pattern}`);
  }
}

/**
 * 容错版 rg：供「恒 exit 0」的提示工具（check-redlines / comment-checker）使用。
 * rg 抛错（缺失/坏正则）时打印 WARN 并返回 []，避免静默假绿或崩溃（仍能被用户/AI 察觉扫描不可用）。
 * @param {string} pattern 正则模式（原始字符串）
 * @param {string|string[]} paths 相对仓库根的目录/文件
 * @param {string[]} [globs] glob 过滤
 * @returns {string[]}
 */
export function rgSafe(pattern, paths, globs = null) {
  try {
    return rg(pattern, paths, globs);
  } catch (e) {
    console.error(`[warn] ripgrep 扫描跳过（${(e as Error).message}）`);
    return [];
  }
}
