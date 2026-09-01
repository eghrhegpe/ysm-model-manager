#!/usr/bin/env node
/**
 * scan-files.ts — 源码扫描共享层（scripts/_lib）。
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
 *   import { walk, resolveImport, readText, getRoot, SRC_DIR } from './_lib/scan-files.ts';
 *   import { toPosix } from './_lib/to-posix.ts';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './to-posix.ts';
import { tryResolveAlias } from './alias-resolve.ts';
export { toPosix };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。 */
export function getRoot() {
  return path.resolve(__dirname, '..', '..');
}

export const ROOT = getRoot();
export const SRC_DIR = path.join(ROOT, 'frontend/src');

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
 *   - skipTest {boolean}               跳过测试文件（*.test.ts / *.spec.ts 及其 __tests__ 目录），默认 false
 * @returns {string[]|{abs:string,rel:string}[]}
 */
/** 已告警过的未知选项键（walk 递归每层都会校验，按键去重避免每目录刷屏）。 */
const warnedWalkOpts = new Set<string>();

/** walk 选项。 */
export interface WalkOpts {
  exts?: string[];
  skipDir?: (name: string) => boolean;
  skipFile?: ((name: string) => boolean) | RegExp | null;
  rel?: boolean;
  base?: string;
  skipTest?: boolean;
}

export function walk(dir: string = SRC_DIR, opts: WalkOpts = {}): Array<string | { abs: string; rel: string }> {
  const KNOWN_WALK_OPTS = new Set(['exts', 'skipDir', 'skipFile', 'rel', 'base', 'skipTest']);
  for (const k of Object.keys(opts)) {
    if (!KNOWN_WALK_OPTS.has(k) && !warnedWalkOpts.has(k)) {
      warnedWalkOpts.add(k);
      console.warn(`[scan-files.walk] 忽略未知选项 "${k}"（已知：${[...KNOWN_WALK_OPTS].join('/')}）`);
    }
  }
  const {
    exts = SRC_EXTS,
    skipDir = (n: string) => n.startsWith('.') || n === 'node_modules' || n === 'css',
    skipFile = null,
    rel = false,
    base = '',
    skipTest = false,
  } = opts;
  const out: Array<string | { abs: string; rel: string }> = [];
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // 子目录权限拒绝/超长路径等：跳过该目录，不让单点异常炸掉整棵扫描树
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOTDIR' || err.code === 'ENAMETOOLONG') return out;
    throw e;
  }
  for (const d of entries) {
    if (d.isDirectory()) {
      if (skipDir(d.name)) continue;
      if (skipTest && d.name === '__tests__') continue;
      const childBase = rel ? (base ? `${base}/${d.name}` : d.name) : base;
      out.push(...walk(path.join(dir, d.name), { ...opts, base: childBase }));
    } else if (d.isFile()) {
      if (!exts.some((ext) => d.name.endsWith(ext))) continue;
      if (skipTest && /\.(test|spec)\.[jt]s$/.test(d.name)) continue;
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
export function resolveImport(fromFile: string, spec: string, moduleSet: Set<string>) {
  // ADR-146 闸二：别名 spec 优先展开（治 check-circular 开闸后环检测假阴性）。
  // tryResolveAlias 对非别名 spec（相对/裸包名）返回 null，自然落入下方相对路径分支。
  const aliasAbs = tryResolveAlias(spec);
  if (aliasAbs) return matchModule(aliasAbs, moduleSet);
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // 包导入跳过
  return matchModule(path.join(path.dirname(fromFile), spec), moduleSet);
}

/** 绝对路径 → 补 .ts/.js/index.* 候选 → moduleSet 命中返回绝对路径，否则 null。别名与相对路径共用。 */
function matchModule(abs: string, moduleSet: Set<string>): string | null {
  const candidates = [abs];
  if (!path.extname(abs)) {
    for (const ext of IMPORT_EXTS) {
      candidates.push(`${abs}.${ext}`, path.join(abs, `index.${ext}`));
    }
  }
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (moduleSet.has(resolved)) return resolved;
  }
  return null;
}

/** 相对仓库根的正斜杠路径（报告展示用）；toPosix 复用 ./to-posix.mjs，避免重复定义。 */
export function relPosix(p: string) {
  return toPosix(path.relative(ROOT, p));
}

/** 容错读文本：去 BOM + 统一 CRLF → LF（Windows 下编辑的源文件常见）。 */
export function readText(fp: string) {
  return fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/**
 * 容错写文本：保留原文件行尾风格（CRLF 文件不被改写为 LF），避免无意义 diff。
 * 与 readText 配套：readText 归一化读 → 比较/处理 → writeText 按原风格写回，
 * 生成器在 CRLF 检出（Windows autocrlf）下 --check 幂等判定不失效。
 */
export function writeText(fp: string, content: string) {
  let eol = '\n';
  try {
    if (fs.readFileSync(fp, 'utf-8').includes('\r\n')) eol = '\r\n';
  } catch { /* 文件不存在等：默认 LF */ }
  fs.writeFileSync(fp, eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content, 'utf-8');
}
