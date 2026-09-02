#!/usr/bin/env node
/**
 * gen-config.ts — 生成物快照目标配置（单一事实源）。
 *
 * 用途：
 *   - pre-commit 调用 gen-stage.ts 时传入快照目标列表
 *   - gen-stage.ts CLI 模式读取此配置而非硬编码
 *   - 新增 gen 目标只需改本文件，无需同步多处
 *
 * 结构：每个 target 含目录 + 文件模式（可选 glob）
 *   - dir: 必须存在的根目录
 *   - patterns: 文件匹配模式（默认 ['*'] 表示全部文件）
 *
 * 依赖：零依赖（纯常量）
 */

export interface SnapTarget {
  /** 快照根目录（相对仓库根）。 */
  dir: string;
  /** 文件匹配模式（Node glob 简化版，默认 ['*'] 表示全部）。 */
  patterns?: string[];
}

/**
 * 快照目标清单——与 pre-commit 的 SNAP_BASES 对齐。
 * 新增 gen 目标请在此登记，并同步更新 .githooks/pre-commit。
 */
export const SNAP_TARGETS: SnapTarget[] = [
  { dir: 'docs', patterns: ['*.md', '.vitepress/**', 'knowledge/**', 'adr/**'] },
  { dir: 'frontend/public/locales', patterns: ['*.json'] },
  { dir: 'completions', patterns: ['*'] },
];

/** 快照根目录列表（便捷访问，兼容旧代码）。 */
export const SNAP_DIRS = SNAP_TARGETS.map((t) => t.dir);
