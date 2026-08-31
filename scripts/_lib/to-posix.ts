/**
 * to-posix.ts — 统一路径分隔符归一化（scripts/_lib）。
 *
 * 零第三方依赖（仅 node:path），为 scripts/*.mjs 消除散落的 `.replace(/\\/g, '/')`
 * / `asPosix` 手写实现。
 *
 * 约定：脚本输出（文档引用、知识卡 source_files、报告行）一律 posix 风格（`/`），
 * 落地文件系统时才转回平台分隔符。两个方向各封装一次，禁止再各自内联。
 */
import path from 'node:path';

/** 归一化为 posix 风格（`\` → `/`）。幂等：已含 `/` 的输入原样返回。
 * null/undefined 返回 ''——String(p) 会产出字面量 'undefined'/'null'
 * 伪路径，与 posix-gitpath 的 `if (!p) return p` 契约对齐。 */
export function toPosix(p: string | null | undefined): string {
  if (p === null || p === undefined) return '';
  return String(p).replace(/\\/g, '/');
}

/** 反向：posix 风格 → 平台分隔符（win32 为 `\`，其余为 `/`）。null/undefined 同样返回 ''。 */
export function toNative(p: string | null | undefined): string {
  if (p === null || p === undefined) return '';
  return String(p).replace(/\//g, path.sep);
}
