#!/usr/bin/env node
/**
 * git-ref.ts — 跨 ref 安全 git 内容访问共享层。
 *
 * 解决"拿历史某版本源码文本做符号分析"的通用问题：audit-split / rollback-impact /
 * bloat-history / api-break 都需要在多个 git ref 上读同一文件的快照，此前各自
 * 内联 `git show <ref>:<path>` 并各自处理路径/失败——集中到本共享层，统一：
 *   - Windows 安全：execFileSync 无 shell 展开，避免 `commit:file` 被路径展开吞掉；
 *   - 失败容错：路径不存在 / 二进制 / 非文本 → 返回 null，调用方按需判断；
 *   - 路径口径：统一用正斜杠路径（git 内部路径格式），Windows 反斜杠自动归一化。
 *
 * 与 `source-graph.ts` 搭配：`textOverride` 参数即本层的产出——把 `git show` 得到的
 * 历史文本直接传入符号提取，避免把历史 blob 落盘再读盘的双重开销。
 *
 * 零外部依赖；仅 Node 内置模块（child_process/fs/path/url）+ ./scan-files.ts（ROOT/toPosix）。
 *
 * 用法：
 *   import { showAt, existsAt, logPath, diffTree, renamePairs }
 *     from './_lib/git-ref.ts';
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, toPosix } from './scan-files.ts';

/**
 * Windows 安全 git 命令执行器。
 * - execFileSync 无 shell 展开，避免 `commit:path` 被 cmd/pwsh 路径展开吞掉；
 * - maxBuffer 128 MB（大文件 diff 可能超默认）；
 * - 路径参数统一归一化为正斜杠，git 内部路径格式；
 * - `-c core.quotepath=false`：ls-tree/diff 输出非 ASCII（中文）路径时不做八进制
 *   转义（否则 \345\220\204 串经 toPosix 归一化后路径损坏，git show 报 does not exist）。
 * @param {string[]} args  git 命令参数数组
 * @returns {string}       stdout 文本
 */
function git(args: string[]) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    // Windows 上 execFileSync 默认 stdio 会把 git 的 stderr 透传到父进程
    // （cat-file -e 失败等探测路径会刷 fatal 噪声）；显式 pipe 捕获进 error.stderr
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** git 命令，失败返回 null（如路径不存在 / 二进制 / 非 git 仓库）。 */
export function gitMaybe(args: string[]) {
  try { return git(args); } catch { return null; }
}

/** 把本地路径归一化为 git 内部路径格式（正斜杠，相对仓库根）。
 *  相对路径按 ROOT 解析（path.resolve），cwd 无关——此前直接用
 *  path.relative(ROOT, p) 对相对输入会按进程 cwd 解析而错位（code_review P3，
 *  一处修复覆盖 audit-split/rollback-impact/bloat-history/api-break 全部调用点）。 */
function toGitPath(p: string) {
  return toPosix(path.relative(ROOT, path.resolve(ROOT, p)));
}

/**
 * 读取 git 中指定 ref 下某路径的文本内容。
 * - `git show <ref>:<path>` 的标准用法；
 * - 返回 null 表示：路径在 ref 不存在 / git 命令失败；
 * - 注意：二进制内容在 utf8 解码下会返回乱码字符串而非 null（git show 本身不
 *   区分文本/二进制），调用方如需区分应自行判定（如 NUL 字节探测）；
 * - 调用方据此判断"该路径在该 ref 有文本内容"。
 * @param {string} ref   git ref（commit hash / branch / tag / HEAD / HEAD^ 等）
 * @param {string} p     路径（绝对路径或相对路径；内部自动归一化为正斜杠）
 * @returns {string|null} 文件文本内容；不存在/失败 → null
 */
export function showAt(ref: string, p: string) {
  const gp = typeof p === 'string' ? toGitPath(p) : p;
  return gitMaybe(['show', `${ref}:${gp}`]);
}

/**
 * 判断路径在指定 ref 是否存在。
 * - 用 `git cat-file -e <ref>:<path>`（只探存在性，不下载内容，比 showAt 轻）；
 * - 二进制文件也算"存在"。
 * @returns {boolean}
 */
export function existsAt(ref: string, p: string) {
  return gitMaybe(['cat-file', '-e', `${ref}:${toGitPath(p)}`]) !== null;
}

/**
 * 统计某 ref 下某路径的文件行数。
 * - 复用 line-counter 口径：换行数 +（非空且不以换行结尾 ? 1 : 0）；
 * - 路径不存在/二进制 → null。
 * @returns {number|null}
 */
export function lineCountAt(ref: string, p: string) {
  const text = showAt(ref, p);
  if (!text) return null;
  const nl = (text.match(/\n/g) || []).length;
  return nl + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
}

/**
 * 获取路径的 git 提交历史。
 * - 默认：`git log --follow --oneline -N -- <path>`（跟随 rename，取最近 N 条）；
 * - `--no-follow` 忽略文件 rename（更快，适用于"文件名没变过"的常见场景）。
 * @param {string} p     路径
 * @param {object} [opts]
 * @param {number} [opts.limit]   条数上限，默认 30
 * @param {boolean} [opts.follow] 跟随 rename（默认 true）
 * @param {boolean} [opts.long]   用完整 hash（%H）而非缩写（%h）
 * @returns {string[]}  每行一条：hash + subject（可能为空字符串数组）
 */
export function logPath(p: string, opts: { limit?: number; follow?: boolean; long?: boolean } = {}) {
  const { limit = 30, follow = true, long = false } = opts;
  const fmt = long ? '%H%x09%s' : '%h%x09%s';
  const args = ['log', `--format=${fmt}`];
  if (follow) args.push('--follow');
  args.push(`-${limit}`, '--', toGitPath(p));
  const out = gitMaybe(args);
  if (!out) return [];
  return out.trim().split('\n').map((l) => {
    const [hash, ...rest] = l.split('\t');
    return `${hash} ${rest.join('\t')}`;
  }).filter(Boolean);
}

/**
 * 获取某路径的 git 修改提交日志（更详细版，带 author/date）。
 * - 用于 bloat-history 展示每次触及该文件的完整上下文。
 * @param {string} p
 * @param {object} [opts]
 * @param {number} [opts.limit]   默认 30
 * @param {boolean} [opts.follow] 默认 true
 * @returns {{hash:string, short:string, author:string, date:string, subject:string}[]}
 */
export function logPathDetail(p: string, opts: { limit?: number; follow?: boolean } = {}) {
  const { limit = 30, follow = true } = opts;
  const args = ['log'];
  if (follow) args.push('--follow');
  args.push('--format=%H%x09%h%x09%an%x09%ad%x09%s', '--date=short', `-${limit}`, '--', toGitPath(p));
  const out = gitMaybe(args);
  if (!out) return [];
  return out.trim().split('\n').map((l) => {
    const parts = l.split('\t');
    return {
      hash: parts[0] || '',
      short: parts[1] || '',
      author: parts[2] || '',
      date: parts[3] || '',
      subject: parts.slice(4).join('\t') || '',
    };
  }).filter((c) => c.hash);
}

/**
 * 列出 <ref> 下某个目录的文件（递归）。
 * - `git ls-tree -r <ref> -- <dir>`；
 * - 用于 audit-split / api-break 的"该 ref 下涉及哪些文件"。
 * @param {string} ref   git ref
 * @param {string} [dir] 目录（默认仓库根）
 * @returns {string[]}  相对仓库根的正斜杠路径列表
 */
export function lsTree(ref: string, dir = '') {
  const args = ['ls-tree', '-r', '--name-only', ref];
  if (dir) args.push('--', dir);
  const out = gitMaybe(args);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean);
}

/**
 * 对比两个 ref 之间某目录下的文件清单变化。
 * - 返回 { added, removed, common, all }；
 * - common = 在 both ref 下都存在的路径；
 * - added / removed = 相对 `older` 而言在 `newer` 增加/消失的路径。
 * @param {string} older   较早的 ref
 * @param {string} newer   较晚的 ref
 * @param {string} [dir]   限定目录（可选）
 * @returns {{added:string[], removed:string[], common:string[], all:string[]}}
 */
export function diffTree(older: string, newer: string, dir = ''): { added: string[]; removed: string[]; common: string[]; all: string[] } {
  const oldFiles = new Set(lsTree(older, dir));
  const newFiles = new Set(lsTree(newer, dir));
  const added: string[] = [];
  const removed: string[] = [];
  const common: string[] = [];
  for (const f of newFiles) {
    if (oldFiles.has(f)) common.push(f); else added.push(f);
  }
  for (const f of oldFiles) {
    if (!newFiles.has(f)) removed.push(f);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    common: common.sort(),
    all: [...new Set([...oldFiles, ...newFiles])].sort(),
  };
}

/**
 * 检测两个 ref 之间的路径 rename 配对。
 * - 用 `git diff --name-status -M<sim> <older> <newer>`（refs 前不放 `--`，
 *   `--` 只能在 refs 之后作路径分隔，放前面会把 refs 当 pathspec 解析失败）；
 * - R 开头的行格式：`R<similarity> old-path\tnew-path`；
 * - 输出 [[oldPath, newPath], ...] 的配对数组，供 api-break 判断"文件搬家"。
 * @param {string} older
 * @param {string} newer
 * @param {number} [similarityThreshold]  相似度假说（0-100），默认 50
 * @returns {{oldPath:string, newPath:string, similarity:number}[]}
 */
export function renamePairs(older: string, newer: string, similarityThreshold = 50): Array<{ oldPath: string; newPath: string; similarity: number }> {
  const out = gitMaybe(['diff', '--name-status', '-M' + similarityThreshold, older, newer]);
  if (!out) return [];
  const pairs: Array<{ oldPath: string; newPath: string; similarity: number }> = [];
  for (const line of out.trim().split('\n')) {
    const m = line.match(/^R(\d+)\t(.+)\t(.+)$/);
    if (m) pairs.push({
      similarity: Number(m[1]!),
      oldPath: m[2]!,
      newPath: m[3]!,
    });
  }
  return pairs;
}

/**
 * 一次获取某 ref 下多个路径的文本（批量）。
 * - 单路径仍走 showAt；paths 为空时短路。
 * @param {string} ref
 * @param {string[]} paths
 * @returns {Map<string, string|null>}  path → 文本或 null
 */
export function showAllAt(ref: string, paths: string[]) {
  if (paths.length === 0) return new Map();
  const result = new Map();
  for (const p of paths) {
    result.set(p, showAt(ref, p));
  }
  return result;
}
