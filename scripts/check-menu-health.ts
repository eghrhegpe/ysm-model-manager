#!/usr/bin/env node
/**
 * check-menu-health.ts — 3D 预览菜单表健康门禁。
 *
 * 设计意图（ADR-085 配套闸门）：菜单表是单一事实来源，"加菜单项只改表、测试自动覆盖"
 * 的承诺需要自动兜底。本脚本作为 doctor / pre-push-gate 的一个 check，秒级零依赖扫完，
 * 避免再出现「switchModel 漏 i18n 键」这类靠运气才被测抓到的问题。
 *
 * 校验项（6 条）：
 *   1. id 全局唯一（渲染为 data-testid="preview-<id>"，撞车则 e2e 寻址失效）
 *   2. labelKey 非空
 *   3. labelKey 在 zh-CN 语言包存在（三语一致性由 locales-consistency.test 保证）
 *   4. dockGroup ∈ PreviewMenuGroupId 联合类型（单一事实来源，自动从 preview-menu/defs.ts 推导）或 无（非法值导致 dock 按钮进错组）
 *   5. kind ∈ {panel, action, divider}
 *   6. panel 项必有渲染通道；action 项必有 run（缺失则面板/动作不可执行）
 *      渲染通道四选一：render | renderCustom（ADR-085 逃生舱）| children（ADR-126 P4-B 声明式子节点）
 *      | schemaId（ADR-126 P5 受控 schema 驱动，renderPreviewPanel 优先查 schema-registry）
 *
 * 解析策略：正则解析 4 个菜单表文件（preview-menu/defs.ts + ysm/mmd/vrm-adapter.ts），
 * 对每个 `id: "xxx"` 匹配回溯对象块（配对 { }，跳过字符串内 { }），提取字段。
 *
 * 用法：
 *   node scripts/check-menu-health.ts                 # 默认行为
 *   node scripts/check-menu-health.ts --json    # JSON 输出（供 pre-push-gate 解析）
 * 退出码：0 = 健康；1 = 存在违规（阻断推送）
 * 依赖：node:fs / node:path / node:url
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';

const ARGS = parseArgs(process.argv.slice(2), { bools: ['json'] });
const JSON_MODE = ARGS.json;
if (ARGS.help) {
  console.log('用法: node scripts/check-menu-health.ts [--json]');
  process.exit(0);
}
if (ARGS.unknown.length) {
  console.error(`❌ 未知参数: ${ARGS.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}

// ── 菜单表文件（相对 ROOT）──
const MENU_FILES = [
  'frontend/src/preview-3d/menu/defs.ts',
  'frontend/src/preview-3d/adapters/ysm-adapter.ts',
  'frontend/src/preview-3d/adapters/mmd-adapter.ts',
  'frontend/src/preview-3d/adapters/vrm-adapter.ts',
];
const LOCALE_FILE = 'frontend/src/core/i18n/locales/zh-CN.ts';
const LEGAL_KINDS = new Set(['panel', 'action', 'divider']);

function readRel(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8');
}

// 合法 dockGroup 从单一事实来源 preview-menu/defs.ts 的 `PreviewMenuGroupId` 联合类型推导，
// 不在此处硬编码第二份清单——否则新增组（如 2026-08-19 的 "env"）时漏改闸门即双源漂移、误阻断推送。
const LEGAL_GROUPS = deriveLegalGroups();

function deriveLegalGroups() {
  const defs = readRel(MENU_FILES[0]);
  const m = defs.match(/type\s+PreviewMenuGroupId\s*=\s*([^;]+);/);
  const ids = m ? [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]) : [];
  if (!ids.length) {
    throw new Error('check-menu-health: 无法从 preview-menu/defs.ts 推导 PreviewMenuGroupId（单一事实来源缺失），拒绝用兜底硬编码清单');
  }
  return new Set(ids);
}

// 收集 zh-CN 语言包所有 preview.* 键
function collectZhCNPreviewKeys() {
  const keys = new Set();
  const src = readRel(LOCALE_FILE);
  const re = /"preview\.([a-zA-Z0-9_\-\.]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    keys.add('preview.' + m[1]);
  }
  return keys;
}

// 从 `id` 匹配位置回溯最近未配对的 `{`，再配对找到对象闭合 `}`。
// 跳过字符串字面量内的 { }（避免误配 render 函数体）。
export function extractItemBlock(content, idPos) {
  // 往前找最近的 {（跳过字符串内）
  let i = idPos - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let openLine = -1;
  while (i >= 0) {
    const c = content[i];
    if (esc) { esc = false; i--; continue; }
    if (c === '\\') { esc = true; i--; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = !inStr; i--; continue; }
    if (inStr) { i--; continue; }
    if (c === '}') { depth++; i--; continue; } // 回退时遇到 } 说明在嵌套内
    if (c === '{') {
      if (depth === 0) { openLine = i; break; }
      depth--;
    }
    i--;
  }
  if (openLine < 0) return null;
  // 从 openLine 前进配对找闭合 }
  let closePos = -1;
  let d = 0;
  inStr = false; esc = false;
  for (let k = openLine; k < content.length; k++) {
    const c = content[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') d++;
    if (c === '}') { d--; if (d === 0) { closePos = k; break; } }
  }
  if (closePos < 0) return null;
  return content.slice(openLine, closePos + 1);
}

// 渲染通道识别正则（hasRender 与 dualChannel 共用——a48f74fd review P3 抽常量防双源漂移）
const SCHEMA_ID_RE = /schemaId:\s*[\w$.'"]/;
const RENDER_CUSTOM_RE = /renderCustom:\s*\(/;

/** 剥离 item 块内顶层 children: [...] 数组（子节点的 renderCustom 不计入父项 dualChannel——
 *  a48f74fd review P2：正则作用于整块会把 children 子节点误判为父项双通道） */
function stripTopChildren(block) {
  const m = block.match(/children:\s*\[/);
  if (!m) return block;
  const start = block.indexOf(m[0]) + m[0].length - 1; // '[' 位置
  let d = 0;
  for (let i = start; i < block.length; i++) {
    const c = block[i];
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) return block.slice(0, start) + block.slice(i + 1); }
  }
  return block;
}

export function parseItem(block, id): {
  id: string;
  labelKey: string | null;
  dockGroup: string | null;
  kind: string | null;
  hasRender: boolean;
  hasRun: boolean;
  dualChannel: boolean;
  file?: string;
} {
  const field = (re) => {
    const m = block.match(re);
    return m ? m[1] : null;
  };
  return {
    id,
    labelKey: field(/labelKey:\s*"([^"]+)"/),
    dockGroup: field(/dockGroup:\s*"([^"]+)"/),
    kind: field(/kind:\s*"([^"]+)"/),
    // [doc:adr-126-p4-b] children 是第三渲染通道（声明式节点，renderPreviewPanel children 分支渲染）。
    // P4-B 系列把 model/shot 面板从 renderCustom 迁移到 children（纯数据节点）后，门禁须同步认识。
    // [doc:adr-126-p5-a] schemaId 是第四通道（受控 schema 驱动：renderPreviewPanel 优先查 schema-registry；
    // 契约「带 schemaId 不得同时带 renderCustom——双通道歧义」），如 ysm-adapter model 项。
    hasRender: /(?:render|renderCustom):\s*\(/.test(block) || /children:\s*(?:\[|[\w$.(])/.test(block) || SCHEMA_ID_RE.test(block),
    hasRun: /\brun:\s*\(/.test(block),
    // [doc:adr-126-p5-a] 契约执行（62c83271 review P3）：schemaId 与 renderCustom 双通道歧义——
    // 注释声明不够，门禁须拦截「schemaId 带 renderCustom」的同存状态；renderCustom 只查顶层
    //（stripTopChildren 剥离 children 数组，防 P4-B 子节点误报——a48f74fd review P2）
    dualChannel: SCHEMA_ID_RE.test(block) && RENDER_CUSTOM_RE.test(stripTopChildren(block)),
  };
}

export function parseFile(rel) {
  const content = readRel(rel);
  const items: Array<ReturnType<typeof parseItem>> = [];
  const idRe = /id:\s*"([a-z0-9\-]+)"/g;
  let m;
  while ((m = idRe.exec(content)) !== null) {
    const block = extractItemBlock(content, m.index + 3); // 跳 id:
    if (!block) continue;
    const item = parseItem(block, m[1]);
    // 无 kind 字段 → 非菜单项对象（如 GroupDef / PreviewAdapter.id），跳过
    if (!item.kind) continue;
    item.file = rel;
    items.push(item);
  }
  return items;
}

/** 单 item 规则判定（rule 2-6）——导出供契约测试端到端覆盖门禁拦截路径（a48f74fd review P3） */
export function itemViolations(it, zhCNKeys) {
  const v: Array<{ rule: string; item: string; file?: string; detail: string }> = [];
  // 2. labelKey 非空
  if (!it.labelKey) v.push({ rule: 'labelKey-present', item: it.id, file: it.file, detail: '缺 labelKey' });
  // 3. labelKey 在 zh-CN 存在
  if (it.labelKey && !zhCNKeys.has(it.labelKey)) {
    v.push({ rule: 'labelKey-i18n', item: it.id, file: it.file, detail: `labelKey "${it.labelKey}" 在 zh-CN 语言包不存在` });
  }
  // 4. dockGroup 合法
  if (it.dockGroup && !LEGAL_GROUPS.has(it.dockGroup)) {
    v.push({ rule: 'dockGroup-valid', item: it.id, file: it.file, detail: `dockGroup "${it.dockGroup}" 非法（须为 ${[...LEGAL_GROUPS].join('/')}）` });
  }
  // 5. kind 合法
  if (!LEGAL_KINDS.has(it.kind as string)) {
    v.push({ rule: 'kind-valid', item: it.id, file: it.file, detail: `kind "${it.kind || '(空)'}" 非法（须为 panel/action/divider）` });
  }
  // 6. panel 有 render / action 有 run（CORE 文件走 preview-menu.ts fillers 映射渲染，不写 render，豁免）
  const isCoreFile = it.file.endsWith('menu/defs.ts');
  if (it.kind === 'panel' && !isCoreFile && !it.hasRender) {
    v.push({ rule: 'panel-has-render', item: it.id, file: it.file, detail: 'panel 项缺 render' });
  }
  // [doc:adr-126-p5-a] 双通道歧义（62c83271 review P3）：schemaId 是受控 schema 通道（renderPreviewPanel
  // 优先查 registry），同时带 renderCustom 即两条渲染路径并存——契约禁止，门禁拦截而非仅注释声明
  if (it.kind === 'panel' && !isCoreFile && it.dualChannel) {
    v.push({ rule: 'render-channel-ambiguous', item: it.id, file: it.file, detail: 'schemaId 与 renderCustom 双通道歧义，契约禁止同存' });
  }
  if (it.kind === 'action' && !it.hasRun) {
    v.push({ rule: 'action-has-run', item: it.id, file: it.file, detail: 'action 项缺 run' });
  }
  return v;
}

// ── 主逻辑 ──
function main() {
const allItems: Array<ReturnType<typeof parseItem>> = [];
for (const f of MENU_FILES) allItems.push(...parseFile(f));
const zhCNKeys = collectZhCNPreviewKeys();

const violations: Array<{ rule: string; item: string; file?: string; detail: string }> = [];
const idFiles = new Map<string, string[]>(); // id → [文件,...] 收集所有出现
const byFile = new Map<string, string[]>(); // file → [id,...] 每文件内部 id 列表
for (const it of allItems) {
  if (!idFiles.has(it.id)) idFiles.set(it.id, []);
  idFiles.get(it.id)!.push(it.file!);
  if (!byFile.has(it.file!)) byFile.set(it.file!, []);
  byFile.get(it.file!)!.push(it.id);
  violations.push(...itemViolations(it, zhCNKeys));
}

// ── id 唯一性校验（独立段：每文件内部唯一 + core∩适配器无交集）──
// 适配器按次挂载互斥（一次预览只加载一种模型），故 ysm/mmd/vrm 可共享 id（model/shot/bones）；
// 仅「同一文件内重复」与「适配器 id 与 core 撞车」才报违规。
const coreFile = 'frontend/src/preview-3d/menu/defs.ts';
const coreIds = new Set((byFile.get(coreFile) || []));
const sharedIds: string[] = []; // 跨适配器同名的 id（不违规，仅报告）
for (const [file, ids] of byFile) {
  // 同一文件内重复
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      violations.push({
        rule: 'id-unique',
        item: id,
        file,
        detail: `id "${id}" 在 ${path.basename(file)} 内重复`,
      });
    }
    seen.add(id);
  }
  // 适配器 id 与 core 撞车
  if (file !== coreFile) {
    for (const id of ids) {
      if (coreIds.has(id)) {
        violations.push({
          rule: 'id-unique',
          item: id,
          file,
          detail: `适配器 id "${id}" 与 core 菜单项撞车`,
        });
      }
    }
  }
}
for (const [id, files] of idFiles) {
  if (files.length > 1) sharedIds.push(`${id}（${files.map((f) => path.basename(f)).join(' · ')}）`);
}

const ok = violations.length === 0;

// ── 输出 ──
if (JSON_MODE) {
  console.log(JSON.stringify({
    _summary: { ok, total: allItems.length, violations: violations.length },
    items: allItems.map((it) => ({ id: it.id, file: it.file, labelKey: it.labelKey, dockGroup: it.dockGroup, kind: it.kind })),
    violations,
  }));
} else {
  console.log(`\n${'='.repeat(60)}`);
  console.log(` 3D 菜单表健康检查（${allItems.length} 项）`);
  console.log(`${'='.repeat(60)}`);
  if (ok) {
    console.log(' [OK] 6 项校验全通过：id 唯一 · labelKey 非空 · i18n 齐全 · dockGroup 合法 · kind 合法 · render/run 完备');
    console.log(`   覆盖文件：${MENU_FILES.map((f) => f.split('/').pop()).join(' · ')}`);
    // 按 dockGroup 统计
    const byGroup = allItems.reduce((acc, it) => { acc[it.dockGroup || '(无组)'] = (acc[it.dockGroup || '(无组)'] || 0) + 1; return acc; }, {});
    Object.entries(byGroup).forEach(([g, n]) => console.log(`   ${g === '(无组)' ? ' 无 dockGroup' : g}: ${n} 项`));
    if (sharedIds.length) console.log(`   跨适配器共享 id（设计如此，按次挂载互斥）：${sharedIds.join(', ')}`);
  } else {
    console.log(` [FAIL] ${violations.length} 条违规：`);
    violations.forEach((v) => {
      console.log(`   - [${v.rule}] ${v.item} @ ${v.file}: ${v.detail}`);
    });
    console.log('   → 修复: 检查菜单表对应字段（id/labelKey/i18n/dockGroup/kind/render/run）');
  }
  console.log('');
}

process.exit(ok ? 0 : 1);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
