/**
 * to-posix.mjs
 * 统一路径分隔符归一化 —— 零第三方依赖（仅 node:path），为 scripts/*.mjs 消除
 * 散落的 `.replace(/\\/g, '/')` / `asPosix` 手写实现。
 *
 * 约定：脚本输出（文档引用、知识卡 source_files、报告行）一律 posix 风格（`/`），
 * 落地文件系统时才转回平台分隔符。两个方向各封装一次，禁止再各自内联。
 *
 * 用法：
 *   import { toPosix, toNative } from './_lib/to-posix.mjs';
 *   toPosix('src\\scene\\env.ts')   // → 'src/scene/env.ts'（任何平台）
 *   toNative('src/scene/env.ts')    // → 平台分隔符（win32 下 'src\\scene\\env.ts'）
 */
import path from 'node:path';

/** 归一化为 posix 风格（`\` → `/`）。幂等：已含 `/` 的输入原样返回。
 * P2-1（code_review）：null/undefined 返回 ''——String(p) 会产出字面量 'undefined'/'null'
 * 伪路径（source_file 不存在: undefined 之类困惑报错），与 posix-gitpath 的 `if (!p) return p` 契约对齐。 */
export function toPosix(p) {
  if (p == null) return '';
  return String(p).replace(/\\/g, '/');
}

/** 反向：posix 风格 → 平台分隔符（win32 为 `\`，其余为 `/`）。null/undefined 同样返回 ''。 */
export function toNative(p) {
  if (p == null) return '';
  return String(p).replace(/\//g, path.sep);
}
