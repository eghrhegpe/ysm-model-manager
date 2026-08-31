#!/usr/bin/env node
/**
 * domain-classify.mjs — 变更域分类共享层。
 *
 * 解决 pre-push-gate / doctor（--gate 与全量）重复内联 classify() + planFromFiles() 的问题。
 * 此前两处各自维护一份 DATA_FILES + classify() + planFromFiles()，逻辑一字不差；
 * 任一修改需双写，漂移即引入不一致（2026-08-13 audit-split 审计发现）。
 * 集中到本层后，单点修改、双端复用，符合 scripts/README.md「共享能力一律 import 自 _lib/」约定。
 *
 * 用法：
 *   import { classify, planFromFiles, DATA_FILES } from './_lib/domain-classify.mjs';
 *
 * 依赖：零依赖（纯函数，仅用 Set/String 内置 API）
 *
 * 设计意图：变更域分类——按文件路径判定所属域，进而调度对应检查。
 */

export const DATA_FILES = new Set([
  'resource_types.json', 'creators.json', 'workshop_sites.json', 'workshop-github.json',
]);

/**
 * 文件路径 → 域。返回 'go' | 'frontend' | 'data' | 'docs' | 'tests' | 'other'。
 * @param {string} f 相对仓库根的 POSIX 路径（如 'go/ysm/ysm_test.go'）。
 */
export function classify(f) {
  if (f.endsWith('.go')) return 'go';
  if (f === 'go.mod' || f === 'go.sum') return 'go';
  if (f === 'wails.json') return 'frontend';
  if (f.startsWith('frontend/')) return 'frontend';
  if (DATA_FILES.has(f)) return 'data';
  if (f.startsWith('docs/') || f.endsWith('.md')) return 'docs';
  if (f.startsWith('tests/') || f.startsWith('scripts/')) return 'tests';
  return 'other';
}

/**
 * 文件集 → 需要跑的检查计划 { go, frontend, data, docs, adr, contractTests, redlines }。
 * @param {string[]} files 相对仓库根的路径数组。
 */
export function planFromFiles(files) {
  const p = { go: false, frontend: false, data: false, docs: false, adr: false, contractTests: false };
  for (const f of files) {
    const d = classify(f);
    if (d === 'go') p.go = true;
    if (d === 'frontend') p.frontend = true;
    if (d === 'data') p.data = true;
    if (d === 'docs') p.docs = true;
    if (d === 'tests') p.contractTests = true;
    if (f.startsWith('docs/adr/') || f.startsWith('docs/architecture/adr/')) p.adr = true;
  }
  // redlines 门禁：任意非纯文档/纯测试变更都触发——红线规则覆盖 go 与 frontend，
  // 纯 docs/contracts 变更无代码面无需跑（code_review F 落地：把 R1-R10/W1-W6 从运动式
  // 子代理走查升级为 pre-push 强制门禁，不再靠"出问题 → 开批走查"脉冲修复）
  p.redlines = p.go || p.frontend;
  return p;
}

/**
 * 文件集 → 按域分组的映射 { 域: [文件...] }（摘要展示用，域 = classify 返回值）。
 * 2026-09 细读去重：pre-push-gate（--files 与 push 两分支）与 commit-with-check
 * 三处各内联一份相同的「循环 push 到 byDomain」逻辑，此处集中单点。
 * @param {string[]} files 相对仓库根的路径数组。
 * @returns {Record<string, string[]>}
 */
export function groupByDomain(files) {
  const byDomain = {};
  for (const f of files) (byDomain[classify(f)] = byDomain[classify(f)] || []).push(f);
  return byDomain;
}

/**
 * 分组 → 摘要串（如 "go:2  frontend:1"），供「变更域」控制台行复用。
 * @param {Record<string, string[]>} byDomain groupByDomain 的返回值。
 * @returns {string}
 */
export function domainSummaryText(byDomain) {
  return Object.keys(byDomain).length
    ? Object.entries(byDomain).map(([d, fs]) => `${d}:${fs.length}`).join('  ')
    : '无变更';
}
