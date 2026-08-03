#!/usr/bin/env node
/**
 * scan-files.mjs — 源码扫描共享层（scripts/_lib）。
 *
 * 统一解决两类跨脚本重复问题（ADR-014 前端 .js→.ts 迁移后集中收口）：
 *   1. 文件格式层：walk 同时收集 .js/.ts；resolveImport 自动补全
 *      .ts/.js/index.ts/index.js（TS 用 `from "./x.ts"` 显式扩展名风格）。
 *   2. 操作系统层：Windows 反斜杠 → 正斜杠（toPosix）、CRLF/BOM 读文件容错。
 *
 * 各治理脚本 import 本模块，删除各自内联的 walk()/resolveImport()/ROOT 样板。
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   import { walk, resolveImport, toPosix, readText, getRoot, SRC_DIR } from './_lib/scan-files.mjs';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。 */
export function getRoot() {
  return path.resolve(__dirname, '..', '..');
}

/** 前端源码根目录（frontend/js）。 */
export function getSrcDir() {
  return path.join(getRoot(), 'frontend/js');
}

export const ROOT = getRoot();
export const SRC_DIR = getSrcDir();

/** 可扫描的前端源码扩展名。 */
export const SRC_EXTS = ['.js', '.ts'];

/**
 * 递归收集 dir 下所有前端源码文件（.js/.ts）。
 * 跳过：隐藏项、node_modules、css/ 样式目录。
 * @param {string} dir 起始目录
 * @param {object} [opts] { skipTest: true } 排除 *.test.* / *.spec.*（vitest 用）
 * @returns {string[]} 绝对路径数组
 */
export function walk(dir = SRC_DIR, opts = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'css') continue;
      out.push(...walk(p, opts));
    } else if (SRC_EXTS.some((ext) => d.name.endsWith(ext))) {
      if (opts.skipTest && /\.(test|spec)\.(js|ts)$/.test(d.name)) continue;
      out.push(p);
    }
  }
  return out;
}

/** TS/JS 相对导入补全候选扩展名顺序。 */
const IMPORT_EXTS = ['ts', 'js'];

/**
 * 解析相对导入目标（自动补 .ts/.js 及 index.ts/index.js）。
 * @param {string} fromFile 发起导入的文件绝对路径
 * @param {string} spec import 语句中的模块说明符（如 ./debug / ../x.ts）
 * @param {Set<string>} moduleSet 已收集模块绝对路径集合
 * @returns {string|null} 解析到的绝对路径；包导入或不存在返回 null
 */
export function resolveImport(fromFile, spec, moduleSet) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // 包导入跳过
  const base = path.dirname(fromFile);
  const candidates = [path.join(base, spec)];
  if (!path.extname(spec)) {
    for (const ext of IMPORT_EXTS) {
      candidates.push(path.join(base, `${spec}.${ext}`), path.join(base, spec, `index.${ext}`));
    }
  }
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (moduleSet.has(resolved)) return resolved;
  }
  return null;
}

/** Windows 反斜杠 → 正斜杠（统一展示/对比用）。 */
export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/** 相对仓库根的正斜杠路径（报告展示用）。 */
export function relPosix(p) {
  return toPosix(path.relative(ROOT, p));
}

/** 容错读文本：去 BOM + 统一 CRLF → LF（Windows 下编辑的源文件常见）。 */
export function readText(fp) {
  return fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}
