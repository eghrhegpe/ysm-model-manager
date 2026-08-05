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
 *   import { walk, resolveImport, readText, getRoot, SRC_DIR } from './_lib/scan-files.mjs';
 *   import { toPosix } from './_lib/to-posix.mjs';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './to-posix.mjs';

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
 * 递归收集 dir 下满足条件的源文件；共享底层遍历，供 source-graph.walkSourceFiles 复用。
 * @param {string} dir 起始目录
 * @param {object} [opts]
 *   - exts {string[]}                  匹配扩展名，默认 SRC_EXTS（.js/.ts）
 *   - skipDir {(n:string)=>boolean}    返回 true 跳过该目录（默认跳过隐藏项 / node_modules / css）
 *   - skipFile {(n:string)=>boolean|RegExp} 返回/匹配 true 跳过该文件
 *   - rel {boolean}                    true 返回 { abs, rel }（rel 相对 dir），false 返回绝对路径字符串
 *   - base {string}                    rel 模式下的初始相对前缀
 * @returns {string[]|{abs:string,rel:string}[]}
 */
export function walk(dir = SRC_DIR, opts = {}) {
  const {
    exts = SRC_EXTS,
    skipDir = (n) => n.startsWith('.') || n === 'node_modules' || n === 'css',
    skipFile = null,
    rel = false,
    base = '',
  } = opts;
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (skipDir(d.name)) continue;
      const childBase = rel ? (base ? `${base}/${d.name}` : d.name) : base;
      out.push(...walk(path.join(dir, d.name), { ...opts, base: childBase }));
    } else if (d.isFile()) {
      if (!exts.some((ext) => d.name.endsWith(ext))) continue;
      if (skipFile && (skipFile instanceof RegExp ? skipFile.test(d.name) : skipFile(d.name))) continue;
      const abs = path.join(dir, d.name);
      out.push(rel ? { abs, rel: base ? `${base}/${d.name}` : d.name } : abs);
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

/** 相对仓库根的正斜杠路径（报告展示用）；toPosix 复用 ./to-posix.mjs，避免重复定义。 */
export function relPosix(p) {
  return toPosix(path.relative(ROOT, p));
}

/** 容错读文本：去 BOM + 统一 CRLF → LF（Windows 下编辑的源文件常见）。 */
export function readText(fp) {
  return fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}
