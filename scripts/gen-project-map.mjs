#!/usr/bin/env node
/**
 * gen-project-map.mjs — 项目结构地图生成器
 *
 * 扫描磁盘目录结构 + 合并基线用途说明 → 生成 docs/project-map.md。
 * 目录结构自动扫描防漂移；目录用途是人工知识，集中维护在
 * scripts/baseline/project-dirs.json（磁盘有新目录而基线未登记时 WARN 提醒补基线）。
 *
 * 用法：
 *   node scripts/gen-project-map.mjs            # 写入 docs/project-map.md
 *   node scripts/gen-project-map.mjs --check    # 只对比不写盘（doctor 守护）
 *   node scripts/gen-project-map.mjs --json     # JSON 摘要输出（子代理消费）
 *
 * 输出：docs/project-map.md，含 4 个 GEN 标记区：
 *   go-structure / internal-structure / frontend-structure / root-files
 * 零依赖（仅 node:fs / node:path + scripts/_lib/scan-files.mjs 共享层）。
 * 设计意图：gen-project-map 工具脚本
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, readText } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const OUT = path.join(ROOT, 'docs', 'project-map.md');
const BASELINE = path.join(ROOT, 'scripts', 'baseline', 'project-dirs.json');

// ── 参数 ──
const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const JSON_OUT = args.has('--json');

/** 读取基线：{ go: {...}, internal: {...}, frontend: {...}, root: {...} } */
function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

/** 一级子目录名（跳过隐藏项）。 */
function subdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** 一级文件名的子集（按扩展名过滤，跳过隐藏项）。 */
function topFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.') && exts.some((e) => d.name.endsWith(e)))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** 渲染一行表格；未登记基线的条目显示占位并计入漂移。 */
function row(label, usage, drift, kind) {
  if (!usage) {
    drift.unregistered.push(`${kind}:${label}`);
    return `| \`${label}\` | ⚠️ 用途待补基线（scripts/baseline/project-dirs.json） |`;
  }
  return `| \`${label}\` | ${usage} |`;
}

/** 生成完整 markdown（内存态，不落盘）。 */
function build() {
  const baseline = loadBaseline();
  const drift = { unregistered: [], ghost: [] };

  const goDirs = subdirs(path.join(ROOT, 'go'));
  const internalDirs = subdirs(path.join(ROOT, 'internal'));
  const feDirs = subdirs(path.join(ROOT, 'frontend', 'src'));
  const feFiles = topFiles(path.join(ROOT, 'frontend', 'src'), ['.ts', '.js']);
  const rootFiles = topFiles(ROOT, ['.go', '.json', '.md']);

  // 幽灵检查：基线有、磁盘无
  for (const kind of Object.keys(baseline)) {
    const onDisk = {
      go: goDirs,
      internal: internalDirs,
      frontend: [...feDirs, ...feFiles],
      root: rootFiles,
    }[kind] || [];
    for (const name of Object.keys(baseline[kind] || {})) {
      if (!onDisk.includes(name)) drift.ghost.push(`${kind}:${name}`);
    }
  }

  const goMap = baseline.go || {};
  const intMap = baseline.internal || {};
  const feMap = baseline.frontend || {};
  const rootMap = baseline.root || {};

  const goRows = goDirs
    .map((d) => row(d + '/', goMap[d], drift, 'go'))
    .join('\n');
  const intRows = internalDirs
    .map((d) => row(d + '/', intMap[d], drift, 'internal'))
    .join('\n');
  const feRows = [...feDirs, ...feFiles]
    .map((n) => row(n.endsWith('/') || !n.includes('.') ? n + '/' : n, feMap[n], drift, 'frontend'))
    .join('\n');
  const rootRows = rootFiles
    .map((n) => row(n, rootMap[n], drift, 'root'))
    .join('\n');

  const md = `# 项目结构地图

> **自动生成**：目录结构由 \`node scripts/gen-project-map.mjs\` 扫描磁盘 + 合并基线
> \`scripts/baseline/project-dirs.json\` 的用途说明。改目录结构后运行脚本刷新；
> \`--check\` 已接入 \`doctor.mjs\` 防漂移。目录用途是人工知识，维护在基线 JSON。

## Go 端

<!-- GEN: go-structure -->

| 包 | 用途 |
|----|------|
${goRows}

<!-- /GEN: go-structure -->

## internal（Wails Binding 入口）

<!-- GEN: internal-structure -->

| 包 | 用途 |
|----|------|
${intRows}

<!-- /GEN: internal-structure -->

## 前端

<!-- GEN: frontend-structure -->

| 路径 | 用途 |
|------|------|
${feRows}

<!-- /GEN: frontend-structure -->

## 根级文件

<!-- GEN: root-files -->

| 文件 | 用途 |
|------|------|
${rootRows}

<!-- /GEN: root-files -->
`;

  return { md, drift };
}

const { md, drift } = build();

// ── 输出 ──
let rc = 0;
if (drift.unregistered.length > 0) {
  console.warn(`[gen-project-map] ${drift.unregistered.length} 个磁盘目录/文件未登记基线用途：`);
  for (const d of drift.unregistered) console.warn(`  - ${d}`);
  console.warn('  → 在 scripts/baseline/project-dirs.json 补用途说明后重跑本脚本。');
}
if (drift.ghost.length > 0) {
  console.warn(`[gen-project-map] ${drift.ghost.length} 条基线指向不存在的目录/文件（幽灵）：`);
  for (const d of drift.ghost) console.warn(`  - ${d}`);
  console.warn('  → 清理基线中已删除的目录条目。');
}

if (CHECK) {
  const onDisk = fs.existsSync(OUT) ? readText(OUT) : '';
  const normalized = onDisk.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (normalized !== md) {
    rc = 1;
    if (!JSON_OUT) console.error(`[gen-project-map] docs/project-map.md 过期，运行 \`node scripts/gen-project-map.mjs\` 刷新。`);
  } else if (!JSON_OUT) {
    console.log('[gen-project-map] docs/project-map.md 最新。');
  }
} else {
  fs.writeFileSync(OUT, md, 'utf8');
  if (!JSON_OUT) console.log(`[gen-project-map] 已写入 ${path.relative(ROOT, OUT)}`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: rc === 0,
    check: CHECK,
    generated: !CHECK,
    drift: { unregistered: drift.unregistered, ghost: drift.ghost },
  }));
}

process.exitCode = rc;
