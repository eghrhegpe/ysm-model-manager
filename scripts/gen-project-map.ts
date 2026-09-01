#!/usr/bin/env node
/**
 * gen-project-map.ts — 项目结构地图生成器
 *
 * 扫描磁盘目录结构 → 生成 docs/project-map.md。
 * 目录结构自动扫描防漂移；目录用途是人工知识，直接维护在
 * docs/project-map.md 自身的 GEN 区表格里（脚本从现文档读回已有用途复用，
 * 不再依赖外部基线 JSON，消除双源漂移/幽灵基线维护负担）。
 *
 * 用法：
 *   node scripts/gen-project-map.ts            # 写入 docs/project-map.md
 *   node scripts/gen-project-map.ts --check    # 只对比不写盘（doctor 守护）
 *   node scripts/gen-project-map.ts --json     # JSON 摘要输出（子代理消费）
 *
 * 输出：docs/project-map.md，含 4 个 GEN 标记区：
 *   go-structure / internal-structure / frontend-structure / root-files
 * 零依赖（仅 node:fs / node:path + scripts/_lib/scan-files.ts 共享层）。
 * 设计意图：gen-project-map 工具脚本（结构自动扫描，用途从文档自身复用）
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, readText, writeText } from './_lib/scan-files.ts';

const ROOT = getRoot();
const OUT = path.join(ROOT, 'docs', 'project-map.md');

// ── 参数 ──
const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const JSON_OUT = args.has('--json');

/**
 * 从现有 docs/project-map.md 的 GEN 区表格读回「路径 → 用途」人工知识。
 * 这是唯一事实来源：脚本只扫结构，用途复用文档里已登记的内容。
 * 逐行解析（避免跨整行正则在含特殊字符描述上误截断），取首个反引号对为
 * label、末个 `|` 之前为 desc。返回 { 'avatar/': '...', 'bus.ts': '...', ... }。
 */
function loadUsageFromDoc() {
  const usage = {};
  if (!fs.existsSync(OUT)) return usage;
  const text = readText(OUT).replace(/^\uFEFF/, '');
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('`')) continue;
    const firstBar = line.indexOf('`');
    const closeBar = line.indexOf('`', firstBar + 1);
    if (closeBar === -1) continue;
    const label = line.slice(firstBar + 1, closeBar).trim();
    const rest = line.slice(closeBar + 1).replace(/^\s*\|\s*/, '');
    const lastBar = rest.lastIndexOf('|');
    const desc = lastBar === -1 ? rest.trim() : rest.slice(0, lastBar).trim();
    // 剥离自动形态尾巴（〔...〕，由脚本生成并读回，避免二次追加）
    const bare = desc.replace(/\s*〔[^〕]*〕$/, '');
    if (label && bare && !bare.startsWith('⚠️')) usage[label] = bare;
  }
  return usage;
}

/** 一级子目录名（跳过隐藏项）。 */
function subdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    // 字节序比较（排序名全 ASCII，见 code_review P1-1）：localeCompare 依赖 ICU/CLDR
    // 版本，跨平台排序可能不一致导致 --check 幂等误报；字节序与 locale 无关，确定性最强
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 一级文件名的子集（按扩展名过滤，跳过隐藏项与工具产物）。
 * 工具产出（link-checker-out.json / opencode.json）已在 .gitignore 显式排除，
 * 此处同步过滤，避免它们出现在项目地图里污染「根级结构」视图。 */
const ROOT_EXCLUDED = new Set(['link-checker-out.json', 'opencode.json']);

function topFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.') && !ROOT_EXCLUDED.has(d.name) && exts.some((e) => d.name.endsWith(e)))
    .map((d) => d.name)
    // 字节序比较（排序名全 ASCII）：locale 无关，跨 ICU/CLDR 版本确定性最强（code_review P1-1）
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 渲染一行表格；文档未登记用途的条目显示占位并计入漂移提示。 */
function row(label, usage, drift, kind, tail = '') {
  if (!usage) {
    drift.unregistered.push(`${kind}:${label}`);
    return `| \`${label}\` | ⚠️ 用途待补（在 docs/project-map.md 本表补一句）${tail} |`;
  }
  return `| \`${label}\` | ${usage}${tail} |`;
}

/** 测试文件判定（TS/JS 的 .test. / .spec.，Go 的 _test.）。 */
function isTestFile(name) {
  return /[.](test|spec)[.]/i.test(name) || /_test[.]/.test(name);
}

/** 源码文件判定（语言扩展名且非测试）。 */
function isSourceFile(name) {
  return /[.](ts|js|mjs|cjs|tsx|jsx|go)$/.test(name) && !isTestFile(name);
}

/** 目录形态扫描：{ source: [], test: [], other: [], dirs: [] }（直接子项，字节序排序）。 */
function scanShape(dir) {
  const shape: { source: string[]; test: string[]; other: string[]; dirs: string[] } = { source: [], test: [], other: [], dirs: [] };
  if (!fs.existsSync(dir)) return shape;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      shape.dirs.push(e.name);
    } else if (isTestFile(e.name)) {
      shape.test.push(e.name);
    } else if (isSourceFile(e.name)) {
      shape.source.push(e.name);
    } else {
      shape.other.push(e.name);
    }
  }
  for (const k of Object.keys(shape)) shape[k].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return shape;
}

/** 形态缓存：同一目录只扫一次磁盘（shapeTail 生成 markdown 与 --json 输出共用）。 */
const shapeCache = new Map();
function scanShapeCached(dir) {
  if (!shapeCache.has(dir)) shapeCache.set(dir, scanShape(dir));
  return shapeCache.get(dir);
}

/** 平铺源码名列表展示阈值：≤12 个列全名（防 AI 猜路径抓空），更长只显数字。 */
const SOURCE_LIST_MAX = 12;
const SOURCE_LIST_CHARS = 100;

/** 目录形态自动标注：〔源码 N: a.ts b.ts … · 测试 M · 子目录 K: x/ y/〕。
 *  结构变化后重跑脚本即更新（--check 接入 doctor 防漂移），形态描述不再靠手写。 */
function shapeTail(dir) {
  const sh = scanShapeCached(dir);
  const parts: string[] = [];
  if (sh.source.length > 0) {
    if (sh.source.length <= SOURCE_LIST_MAX) {
      const list = sh.source.join(' ');
      parts.push(`源码 ${sh.source.length}: ${list.length <= SOURCE_LIST_CHARS ? list : list.slice(0, SOURCE_LIST_CHARS - 3) + '…'}`);
    } else {
      parts.push(`源码 ${sh.source.length}`);
    }
  }
  if (sh.test.length > 0) parts.push(`测试 ${sh.test.length}`);
  if (sh.dirs.length > 0) parts.push(`子目录 ${sh.dirs.length}: ${sh.dirs.map((d) => d + '/').join(' ')}`);
  return parts.length > 0 ? ` 〔${parts.join(' · ')}〕` : '';
}

/** 生成完整 markdown（内存态，不落盘）。 */
function build() {
  const usage = loadUsageFromDoc();
  const drift = { unregistered: [] };

  const goDirs = subdirs(path.join(ROOT, 'go'));
  const internalDirs = subdirs(path.join(ROOT, 'internal'));
  const feDirs = subdirs(path.join(ROOT, 'frontend', 'src'));
  const feFiles = topFiles(path.join(ROOT, 'frontend', 'src'), ['.ts', '.js']);
  const rootFiles = topFiles(ROOT, ['.go', '.json', '.md']);

  const goRows = goDirs
    .map((d) => row(d + '/', usage[d + '/'], drift, 'go', shapeTail(path.join(ROOT, 'go', d))))
    .join('\n');
  const intRows = internalDirs
    .map((d) => row(d + '/', usage[d + '/'], drift, 'internal', shapeTail(path.join(ROOT, 'internal', d))))
    .join('\n');
  const feRows = [...feDirs, ...feFiles]
    .map((n) => {
      // subdirs/topFiles 返回不带斜杠的名字：目录判定用「无扩展名」与 key 同源
      const isDir = !n.includes('.');
      const key = isDir ? n + '/' : n;
      const tail = isDir ? shapeTail(path.join(ROOT, 'frontend', 'src', n)) : '';
      return row(key, usage[key], drift, 'frontend', tail);
    })
    .join('\n');
  const rootRows = rootFiles
    .map((n) => row(n, usage[n], drift, 'root'))
    .join('\n');

  const md = `# 项目结构地图

> **自动生成**：目录结构由 \`node scripts/gen-project-map.ts\` 扫描磁盘生成；
> 目录用途是人工知识，直接维护在本文档的表格里（脚本从本文件读回复用，无外部基线）。
> 改目录结构后运行脚本刷新；\`--check\` 已接入 \`doctor.ts\` 防漂移。
> 🤖 **AI 代理优先** \`node scripts/gen-project-map.ts --json\` 取结构化路径（源码/测试/子目录区分，含文件清单），
> 别按表格猜路径——平铺文件（如 \`features/import-dnd.ts\`）不是子目录。

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

  return {
    md,
    drift,
    usage,
    zones: { go: goDirs, internal: internalDirs, frontend: feDirs, frontendFiles: feFiles, root: rootFiles },
  };
}

const { md, drift, usage, zones } = build();

// ── 输出 ──
let rc = 0;
if (drift.unregistered.length > 0) {
  console.warn(`[gen-project-map] ${drift.unregistered.length} 个磁盘目录/文件未登记用途：`);
  for (const d of drift.unregistered) console.warn(`  - ${d}`);
  console.warn('  → 在 docs/project-map.md 对应表格行补一句用途说明后重跑本脚本。');
}

if (CHECK) {
  const onDisk = fs.existsSync(OUT) ? readText(OUT) : '';
  const normalized = onDisk.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (normalized !== md) {
    rc = 1;
    if (!JSON_OUT) console.error(`[gen-project-map] docs/project-map.md 过期，运行 \`node scripts/gen-project-map.ts\` 刷新。`);
  } else if (!JSON_OUT) {
    console.log('[gen-project-map] docs/project-map.md 最新。');
  }
} else {
  writeText(OUT, md); // 保留原行尾风格（CRLF 文件不被改写为 LF，--check 幂等不失效，code_review P2-1）
  if (!JSON_OUT) console.log(`[gen-project-map] 已写入 ${path.relative(ROOT, OUT)}`);
}

if (JSON_OUT) {
  // 结构化输出：目录形态（源码/测试/其他/子目录）+ 用途——fast worker 程序化消费，
  // 绕开 markdown 表格解析（根治「猜路径抓空」）。
  const structure: Record<string, any> = {};
  for (const zone of ['go', 'internal', 'frontend']) {
    structure[zone] = {};
    for (const d of zones[zone]) {
      const key = d + '/';
      structure[zone][key] = { usage: usage[key] || null, ...scanShapeCached(path.join(ROOT, zone === 'frontend' ? 'frontend/src' : zone, d)) };
    }
  }
  structure.frontendFiles = {};
  for (const f of zones.frontendFiles) structure.frontendFiles[f] = { usage: usage[f] || null };
  structure.root = {};
  for (const f of zones.root) structure.root[f] = { usage: usage[f] || null };
  console.log(JSON.stringify({
    ok: rc === 0,
    check: CHECK,
    generated: !CHECK,
    drift: { unregistered: drift.unregistered },
    structure,
  }));
}

process.exitCode = rc;
