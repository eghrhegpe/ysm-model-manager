/**
 * posix-gitpath.ts — Git 传递路径的跨平台归一化（零依赖，仅 node:path）。
 *
 * 背景：Git（尤其 Windows 上的 Git Bash）把路径以 msys 风格（/c/Users/...）传给钩子，
 * 而 Windows 版 Node 的 path.isAbsolute 会误判其"非绝对"，导致 path.join 拼坏路径、
 * fs 读取静默失败。本模块把这类路径归一为 Windows 绝对路径（C:\Users\...），
 * 再判定绝对 / 相对，统一交给 fs 操作。
 *
 * 这是「全平台前置解析」的最后一块拼图：frontmatter 解析在 _lib/frontmatter.ts，
 * 路径分隔符在 _lib/to-posix.ts，Git 传递路径归一在此。
 *
 * 用法：
 *   import { normalizeGitPath } from './_lib/posix-gitpath.ts';
 *   normalizeGitPath('/c/Users/x/msg.txt', 'C:\\repo')  // → 'C:\\Users\\x\\msg.txt'
 *   normalizeGitPath('C:\\repo\\docs\\x.md', 'C:\\repo') // → 'C:\\repo\\docs\\x.md'（绝对直返）
 *   normalizeGitPath('docs/x.md', 'C:\\repo')            // → 'C:\\repo\\docs\\x.md'（相对 join root）
 */
import path from 'node:path';
import { toNative } from './to-posix.ts';

/**
 * 归一化 Git 传递的路径为可用于 fs 的绝对路径。
 * @param {string} p 输入路径（可能来自钩子 argv，或被 Git Bash 转成 msys 形式）
 * @param {string} root 仓库根目录（用于解析相对路径）
 * @returns {string} 归一后的绝对路径（平台原生分隔符）；空值原样返回
 */
export function normalizeGitPath(p, root) {
  if (!p) return p;
  // msys 风格 /c/Users/... → C:/Users/... 仅发生在 win32（Git Bash 特有）。
  // 非 win32 平台不做此变换，避免把 /home/x 误判成 msys（h:/...）再 join root。
  if (process.platform === 'win32') {
    const m = p.match(/^\/([a-zA-Z])\/(.*)$/);
    if (m) p = `${m[1].toUpperCase()}:/${m[2]}`;
  }
  return path.isAbsolute(p) ? toNative(p) : path.join(root, p);
}
