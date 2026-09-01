#!/usr/bin/env node
/**
 * alias-resolve.ts — 前端 TS 路径别名解析共享层（ADR-146 闸二前置）。
 *
 * 唯一真相源 = frontend/tsconfig.json 的 compilerOptions.paths（12 个 @/dir/* 目录级名 +
 * #root/* 过渡别名）。vite.config.js 的 resolve.alias 由 D3 双写一致性校验保证与 tsconfig
 * 同步，本模块不重复解析 vite，避免双份解析逻辑漂移。
 *
 * 导出：
 *   - loadAliases()             ：解析 tsconfig paths → [{ prefix, targetAbs }]（带缓存，最长前缀优先）
 *   - tryResolveAlias(spec)     ：spec → 别名展开后的绝对路径（无扩展名补全）｜ null（非别名 spec）
 *   - resolveAliasToSrcRel(spec)：spec → 相对 SRC_ROOT 的 posix 路径 ｜ null（非别名或展开后落 src 外）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：被 scan-files.resolveImport（治 check-circular 假阴性）与 check-layering.resolveTarget
 * （稳健化 slice(2)）复用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './to-posix.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
/** frontend/src 绝对路径（与 scan-files.SRC_DIR 同源，供契约测试复用）。 */
export const SRC_ROOT = path.join(REPO_ROOT, 'frontend', 'src');
const TSCONFIG = path.join(REPO_ROOT, 'frontend', 'tsconfig.json');
const FRONTEND_DIR = path.dirname(TSCONFIG); // frontend/

interface AliasEntry {
  /** 别名前缀（已去 `/*`）：如 `@/preview-3d` / `#root`。 */
  prefix: string;
  /** 展开目标绝对目录（已解析相对 frontend/）。 */
  targetAbs: string;
}

let cache: AliasEntry[] | null = null;

/**
 * 解析 tsconfig.paths（catch-all @/* 永不在列，ADR-146 D1 硬约束）。
 * 结果按 prefix 长度降序（最长优先），防止短前缀误吞长前缀（如 @/preview 吞 @/preview-3d）。
 * tsconfig 缺失时 fail-soft 返回空（避免扫描脚本集体崩溃）。
 */
export function loadAliases(): AliasEntry[] {
  if (cache) return cache;
  const entries: AliasEntry[] = [];
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(TSCONFIG, 'utf-8'));
  } catch {
    cache = entries; // tsconfig 缺失 → 无别名（fail-soft）
    return entries;
  }
  const paths = (raw?.compilerOptions?.paths || {}) as Record<string, string | string[]>;
  for (const [k, v] of Object.entries(paths)) {
    const targetPattern = Array.isArray(v) ? v[0] : v;
    if (!targetPattern || typeof targetPattern !== 'string') continue;
    const prefix = k.replace(/\/\*$/, ''); // '@/preview-3d' / '#root'
    const targetNoStar = targetPattern.replace(/\/\*$/, ''); // './src/preview-3d' / '../'
    const targetAbs = path.resolve(FRONTEND_DIR, targetNoStar);
    entries.push({ prefix, targetAbs });
  }
  // 最长前缀优先：@/preview-3d 先于 @/preview 等潜在短前缀匹配
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  cache = entries;
  return entries;
}

/**
 * spec → 别名展开后的绝对路径（不含扩展名补全）。
 * 非别名 spec（相对路径或裸包名，即不以 @/ 或 #root 开头）→ null。
 */
export function tryResolveAlias(spec: string): string | null {
  if (!spec.startsWith('@/') && !spec.startsWith('#root')) return null;
  for (const { prefix, targetAbs } of loadAliases()) {
    if (spec === prefix) return targetAbs; // 整段别名（无子路径，指向目录）
    if (spec.startsWith(prefix + '/')) {
      return path.join(targetAbs, spec.slice(prefix.length + 1));
    }
  }
  return null; // 形如 @/ 但无匹配别名（catch-all 被禁，正常不应发生）
}

/**
 * spec → 相对 SRC_ROOT 的 posix 路径（供分层判定取顶层目录）。
 * 非别名 spec → null；展开后落 src 外（#root/bindings、仓库根 JSON）→ null（不污染分层/环判定）。
 */
export function resolveAliasToSrcRel(spec: string): string | null {
  const abs = tryResolveAlias(spec);
  if (!abs) return null;
  const rel = toPosix(path.relative(SRC_ROOT, abs));
  return rel.startsWith('..') ? null : rel;
}
