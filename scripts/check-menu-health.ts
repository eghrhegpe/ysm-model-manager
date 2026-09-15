#!/usr/bin/env node
/**
 * check-menu-health.ts — 3D 预览菜单表健康门禁。
 *
 * 设计意图（ADR-085 配套闸门）：菜单表是单一事实来源，"加菜单项只改表、测试自动覆盖"
 * 的承诺需要自动兜底。本脚本作为 doctor / pre-push-gate 的一个 check，秒级零依赖扫完，
 * 避免再出现「switchModel 漏 i18n 键」这类靠运气才被测抓到的问题。
 *
 * 校验项（6 条；分层后各按所属层白名单判定）：
 *   1. id 全局唯一（渲染为 data-testid="preview-<id>"，撞车则 e2e 寻址失效）—— 仅根项
 *   2. labelKey 非空 —— 仅根项（叶子层的 divider/sectionTitle 等本无文案）
 *   3. labelKey 在 zh-CN 语言包存在（三语一致性由 locales-consistency.test 保证）—— 声明即校验，两层皆然
 *   4. dockGroup ∈ PreviewMenuGroupId 联合类型（单一事实来源，自动从 menu/node-types.ts 推导）或 无（非法值导致 dock 按钮进错组）—— 仅根项
 *   5. kind 合法（分层白名单）：根项 ∈ {panel, action, divider}（可 dock 项）；叶子节点 ∈ PreviewMenuNodeKind
 *      （自动从 menu/node-types.ts 推导，含 field/row/slider/card…）
 *   6. panel 项必有渲染通道；action 项必有 run（缺失则面板/动作不可执行）—— 仅根项
 *      渲染通道四选一：render | renderCustom（ADR-085 逃生舱）| children（ADR-126 P4-B 声明式子节点）
 *      | schemaId（ADR-126 P5 受控 schema 驱动，renderPreviewPanel 优先查 schema-registry）
 *
 * 根 / 叶子分层判据（2026-09-15 修误报：vrm-adapter 的 VRM_PLAY_EMPTY_NODE——独立 const 叶子
 *  kind:"field"——被按根白名单校验，致全仓 commit-with-check 假红）。根项 ⟺ 下述二选一，其余皆叶子：
 *   ① `const X: PreviewMenuNode[] = [...]` 的数组元素（含 export const 表，如 CORE_MENU_ITEMS）
 *   ② `<X>.push({...})` 的实参，X 取文件内 `PreviewMenuNode[]` 标注的 const
 * 独立 const 叶子（`: PreviewMenuNode = {...}`）、`children: [...]` 内联字面量、工厂函数返回值
 * 一律归叶子层——不按根白名单判，也不占用 id 唯一 / dockGroup 通道。
 *
 * 解析策略：正则解析 4 个菜单表文件（menu/node-types.ts + defs.ts + ysm/mmd/vrm-adapter.ts），
 * 对每个 `id: "xxx"` 匹配回溯对象块（配对 { }，跳过字符串内 { }），再反向定位父容器定层，提取字段。
 * `field` 等叶子 kind 是合法 PreviewMenuNodeKind（menu-node-types.ts）——分层即为此而生，勿再收窄根白名单。
 *
 * 用法：
 *   node scripts/check-menu-health.ts                 # 默认行为
 *   node scripts/check-menu-health.ts --json    # JSON 输出（供 pre-push-gate 解析）
 * 退出码：0 = 健康；1 = 存在违规（阻断推送）
 * 依赖：node:fs / node:path / node:url
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const ARGS = parseArgs(process.argv.slice(2), { bools: ["json"] });
const JSON_MODE = ARGS.json;
if (ARGS.help) {
  console.log("用法: node scripts/check-menu-health.ts [--json]");
  process.exit(0);
}
if (ARGS.unknown.length) {
  console.error(`❌ 未知参数: ${ARGS.unknown.join(", ")}（--help 查看用法）`);
  process.exit(2);
}

// ── 菜单表文件（相对 ROOT）──
const MENU_FILES = [
  "frontend/src/preview-3d/menu/defs.ts",
  "frontend/src/preview-3d/adapters/ysm-adapter.ts",
  "frontend/src/preview-3d/adapters/mmd/mmd-adapter.ts",
  "frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts",
];
const LOCALE_FILE = "frontend/src/locales/zh-CN.ts";
/** 根菜单项合法 kind：可 dock 的三类（根约束是「可挂底栏」的语义约定，无类型可推——见 header） */
const ROOT_KINDS = new Set(["panel", "action", "divider"]);

function readRel(rel: string) {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

// 合法 dockGroup 从单一事实来源 menu/node-types.ts 的 `PreviewMenuGroupId` 联合类型推导，
// 不在此处硬编码第二份清单——否则新增组（如 2026-08-19 的 "env"）时漏改闸门即双源漂移、误阻断推送。
const LEGAL_GROUPS = deriveLegalGroups();

function deriveLegalGroups() {
  // PreviewMenuGroupId 联合本体已归位共享叶 menu-node-types.ts（[ADR-195 刀2] 下沉：
  // menu/node-types.ts 只 re-export），推导须跟类型本体走——同 [2026-09 锐评收口] 精神。
  const leaf = readRel("frontend/src/preview-3d/menu/menu-node-types.ts");
  const m = leaf.match(/type\s+PreviewMenuGroupId\s*=\s*([^;]+);/);
  const ids = m ? [...(m[1]?.matchAll(/"([a-z0-9-]+)"/g) ?? [])].map((x) => x[1]) : [];
  if (!ids.length) {
    throw new Error(
      "check-menu-health: 无法从 menu-node-types.ts 推导 PreviewMenuGroupId（单一事实来源缺失），拒绝用兜底硬编码清单",
    );
  }
  return new Set(ids);
}

/** 叶子节点合法 kind：从单一事实来源 PreviewMenuNodeKind 联合推导（同 LEGAL_GROUPS 精神——
 *  类型新增一种控件（field/row/card/controls…）时闸门自动跟随，不制造第二份硬编码清单漂移）。
 *  惰性求值：契约测试与门禁都 import 本模块，顶层读盘会拖慢测试启动。 */
export function deriveLegalLeafKinds(): Set<string> {
  const leaf = readRel("frontend/src/preview-3d/menu/menu-node-types.ts");
  const m = leaf.match(/type\s+PreviewMenuNodeKind\s*=\s*([\s\S]+?);/);
  // 含驼峰（sectionTitle）——故字符类不能限小写
  const kinds = [...(m?.[1] ?? "").matchAll(/"([A-Za-z][A-Za-z0-9-]*)"/g)]
    .map((x) => x[1])
    .filter((k): k is string => typeof k === "string");
  if (!kinds.length) {
    throw new Error(
      "check-menu-health: 无法从 menu-node-types.ts 推导 PreviewMenuNodeKind（单一事实来源缺失），拒绝用兜底硬编码清单",
    );
  }
  return new Set(kinds);
}

let leafKindsCache: Set<string> | null = null;
function legalLeafKinds(): Set<string> {
  if (!leafKindsCache) leafKindsCache = deriveLegalLeafKinds();
  return leafKindsCache;
}

// 收集 zh-CN 语言包所有 preview.* 键
function collectZhCNPreviewKeys(): Set<string> {
  const keys = new Set<string>();
  const src = readRel(LOCALE_FILE);
  const re = /"preview\.([a-zA-Z0-9_\-.]+)"/g;
  for (const m of src.matchAll(re)) {
    keys.add(`preview.${m[1]}`);
  }
  return keys;
}

// 从 `id` 匹配位置回溯最近未配对的 `{`，再配对找到对象闭合 `}`。
// 跳过字符串字面量内的 { }（避免误配 render 函数体）。
export function extractItemBlockRange(
  content: string,
  idPos: number,
): { start: number; end: number; text: string } | null {
  // 往前找最近的 {（跳过字符串内）
  let i = idPos - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let openLine = -1;
  while (i >= 0) {
    const c = content[i];
    if (esc) {
      esc = false;
      i--;
      continue;
    }
    if (c === "\\") {
      esc = true;
      i--;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = !inStr;
      i--;
      continue;
    }
    if (inStr) {
      i--;
      continue;
    }
    if (c === "}") {
      depth++;
      i--;
      continue;
    } // 回退时遇到 } 说明在嵌套内
    if (c === "{") {
      if (depth === 0) {
        openLine = i;
        break;
      }
      depth--;
    }
    i--;
  }
  if (openLine < 0) return null;
  // 从 openLine 前进配对找闭合 }
  let closePos = -1;
  let d = 0;
  inStr = false;
  esc = false;
  for (let k = openLine; k < content.length; k++) {
    const c = content[k];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") d++;
    if (c === "}") {
      d--;
      if (d === 0) {
        closePos = k;
        break;
      }
    }
  }
  if (closePos < 0) return null;
  return { start: openLine, end: closePos, text: content.slice(openLine, closePos + 1) };
}

/** 兼容薄壳：既有调用方/测试只需块文本 */
export function extractItemBlock(content: string, idPos: number) {
  const r = extractItemBlockRange(content, idPos);
  return r ? r.text : null;
}

/* ── 根 / 叶子分层判据（2026-09-15 修误报，见 header）────────────────────────────
 * 根项 ⟺ ① `const X: PreviewMenuNode[] = [...]` 数组元素；② `<X>.push({...})` 实参
 *        （X 为文件内 PreviewMenuNode[] 标注的 const）。
 * 其余（独立 const 叶子 / children 内联 / 工厂返回值）皆叶子——叶子不再被按根白名单校验。
 * 判据挂在**容器归属**上，而不是「对象块里有没有 id+kind」（后者正是原误报的代理假设）。 */

/** 文件内所有 `PreviewMenuNode[]` 标注的 const 名（根表变量白名单） */
function collectRootArrayVars(content: string): Set<string> {
  const vars = new Set<string>();
  for (const m of content.matchAll(/const\s+(\w+)\s*:\s*PreviewMenuNode\[\]\s*=/g)) {
    const name = m[1];
    if (name) vars.add(name);
  }
  return vars;
}

/** 反向定位紧邻对象块之前的容器开启符（跳过已闭合的兄弟块，字符串内不计）。
 *  命中 `[` / `(` / `{` 即父容器；命中 `:` / `=` 说明父是对象属性或声明（皆叶子）。 */
function findParentOpener(
  content: string,
  blockStart: number,
): { char: string; idx: number } | null {
  let i = blockStart - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  while (i >= 0) {
    const c = content[i];
    if (esc) {
      esc = false;
      i--;
      continue;
    }
    if (c === "\\") {
      esc = true;
      i--;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = !inStr;
      i--;
      continue;
    }
    if (inStr) {
      i--;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth++;
      i--;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      if (depth === 0) return { char: c, idx: i };
      depth--;
      i--;
      continue;
    }
    if (depth === 0 && (c === ":" || c === "=")) return { char: c, idx: i };
    i--;
  }
  return null;
}

/** 定层：由对象块所属容器判定 root / leaf */
export function classifyTier(
  content: string,
  blockStart: number,
  rootVars?: Set<string>,
): "root" | "leaf" {
  const vars = rootVars ?? collectRootArrayVars(content);
  const parent = findParentOpener(content, blockStart);
  if (!parent) return "leaf";
  const before = content.slice(Math.max(0, parent.idx - 120), parent.idx);
  if (parent.char === "[") {
    // 根表：const X: PreviewMenuNode[] = [ … ]（children: [ … ] 是属性数组 → 不匹配 → 叶子）
    const name = before.match(/(\w+)\s*:\s*PreviewMenuNode\[\]\s*=\s*$/)?.[1];
    return name && vars.has(name) ? "root" : "leaf";
  }
  if (parent.char === "(") {
    // 根表续：items.push({ … })，items 须是本文档 PreviewMenuNode[] 标注的 const
    // （parent.idx 指向 `(` 本身，故只匹配到 push 为止）
    const name = before.match(/(\w+)\s*\.push\s*$/)?.[1];
    return name && vars.has(name) ? "root" : "leaf";
  }
  return "leaf";
}

// 渲染通道识别正则（hasRender 与 dualChannel 共用——a48f74fd review P3 抽常量防双源漂移）
const SCHEMA_ID_RE = /schemaId:\s*[\w$.'"]/;
const RENDER_CUSTOM_RE = /renderCustom:\s*\(/;

/** 剥离 item 块内顶层 children: [...] 数组（子节点的 renderCustom 不计入父项 dualChannel——
 *  a48f74fd review P2：正则作用于整块会把 children 子节点误判为父项双通道） */
function stripTopChildren(block: string) {
  const m = block.match(/children:\s*\[/);
  if (!m) return block;
  const start = block.indexOf(m[0]) + m[0].length - 1; // '[' 位置
  let d = 0;
  for (let i = start; i < block.length; i++) {
    const c = block[i];
    if (c === "[") d++;
    else if (c === "]") {
      d--;
      if (d === 0) return block.slice(0, start) + block.slice(i + 1);
    }
  }
  return block;
}

export function parseItem(
  block: string,
  id: string,
  tier: "root" | "leaf" = "root",
): {
  id: string;
  labelKey: string | null;
  dockGroup: string | null;
  kind: string | null;
  hasRender: boolean;
  hasRun: boolean;
  dualChannel: boolean;
  tier: "root" | "leaf";
  file?: string;
} {
  const field = (re: RegExp) => {
    const m = block.match(re);
    return m ? m[1]! : null;
  };
  return {
    id,
    tier,
    labelKey: field(/labelKey:\s*"([^"]+)"/),
    dockGroup: field(/dockGroup:\s*"([^"]+)"/),
    kind: field(/kind:\s*"([^"]+)"/),
    // [doc:adr-126-p4-b] children 是第三渲染通道（声明式节点，renderPreviewPanel children 分支渲染）。
    // P4-B 系列把 model/shot 面板从 renderCustom 迁移到 children（纯数据节点）后，门禁须同步认识。
    // [doc:adr-126-p5-a] schemaId 是第四通道（受控 schema 驱动：renderPreviewPanel 优先查 schema-registry；
    // 契约「带 schemaId 不得同时带 renderCustom——双通道歧义」），如 ysm-adapter model 项。
    hasRender:
      /(?:render|renderCustom):\s*\(/.test(block) ||
      /children:\s*(?:\[|[\w$.(])/.test(block) ||
      SCHEMA_ID_RE.test(block),
    hasRun: /\brun:\s*\(/.test(block),
    // [doc:adr-126-p5-a] 契约执行（62c83271 review P3）：schemaId 与 renderCustom 双通道歧义——
    // 注释声明不够，门禁须拦截「schemaId 带 renderCustom」的同存状态；renderCustom 只查顶层
    //（stripTopChildren 剥离 children 数组，防 P4-B 子节点误报——a48f74fd review P2）
    dualChannel: SCHEMA_ID_RE.test(block) && RENDER_CUSTOM_RE.test(stripTopChildren(block)),
  };
}

/** 按分层解析单文件：roots = 根菜单项（row 1/2/4/6 的适用对象）；leaves = 叶子节点（仅 kind 白名单 + 已声明 labelKey 的 i18n） */
export function parseContent(content: string, rel: string) {
  const rootVars = collectRootArrayVars(content);
  const roots: Array<ReturnType<typeof parseItem>> = [];
  const leaves: Array<ReturnType<typeof parseItem>> = [];
  const idRe = /id:\s*"([a-z0-9-]+)"/g;
  for (const m of content.matchAll(idRe)) {
    const id = m[1];
    if (!id) continue;
    const range = extractItemBlockRange(content, m.index + 3); // 跳 id:
    if (!range) continue;
    const tier = classifyTier(content, range.start, rootVars);
    const item = parseItem(range.text, id, tier);
    // 无 kind 字段 → 非菜单项对象（如 GroupDef / PreviewAdapter.id），跳过
    if (!item.kind) continue;
    item.file = rel;
    (tier === "root" ? roots : leaves).push(item);
  }
  return { roots, leaves };
}

/** 全量分层结果（门禁主逻辑用） */
export function parseFileNodes(rel: string) {
  return parseContent(readRel(rel), rel);
}

/** 根项薄壳（既有调用方/测试兼容） */
export function parseFile(rel: string) {
  return parseFileNodes(rel).roots;
}

/** 单 item 规则判定（rule 2-6；分层后根 / 叶子各按所属层白名单）——导出供契约测试端到端覆盖门禁拦截路径（a48f74fd review P3） */
export function itemViolations(it: any, zhCNKeys: Set<string>) {
  const v: Array<{ rule: string; item: string; file?: string; detail: string }> = [];
  const tier: "root" | "leaf" = it.tier === "leaf" ? "leaf" : "root";
  // 5. kind 合法（分层白名单）：根项 = 可 dock 三类；叶子 = PreviewMenuNodeKind 派生集（field/row/card… 皆合法）
  const legal = tier === "leaf" ? legalLeafKinds() : ROOT_KINDS;
  if (!legal.has(it.kind as string)) {
    v.push({
      rule: "kind-valid",
      item: it.id,
      file: it.file,
      detail: `kind "${it.kind || "(空)"}" 非法（${
        tier === "leaf" ? "叶子节点" : "根菜单项"
      }须为 ${[...legal].join("/")}）`,
    });
  }
  // 3. labelKey 在 zh-CN 存在（两层皆然：声明了就必须可译）
  if (it.labelKey && !zhCNKeys.has(it.labelKey)) {
    v.push({
      rule: "labelKey-i18n",
      item: it.id,
      file: it.file,
      detail: `labelKey "${it.labelKey}" 在 zh-CN 语言包不存在`,
    });
  }
  // 叶子层到此为止：id 唯一 / dockGroup / panel 渲染通道 是「根菜单项」契约，
  // 叶子（divider/sectionTitle/row…）既不挂 dock 也无独立 testid，按根判即 2026-09-15 那类误报。
  if (tier === "leaf") return v;
  // 2. labelKey 非空（仅根项：叶子层 divider/sectionTitle 等本无文案）
  if (!it.labelKey)
    v.push({ rule: "labelKey-present", item: it.id, file: it.file, detail: "缺 labelKey" });
  // 4. dockGroup 合法
  if (it.dockGroup && !LEGAL_GROUPS.has(it.dockGroup)) {
    v.push({
      rule: "dockGroup-valid",
      item: it.id,
      file: it.file,
      detail: `dockGroup "${it.dockGroup}" 非法（须为 ${[...LEGAL_GROUPS].join("/")}）`,
    });
  }
  // 6. panel 有 render / action 有 run（CORE 文件走 preview-menu.ts fillers 映射渲染，不写 render，豁免）
  const isCoreFile = (it.file ?? "").endsWith("menu/defs.ts");
  if (it.kind === "panel" && !isCoreFile && !it.hasRender) {
    v.push({ rule: "panel-has-render", item: it.id, file: it.file, detail: "panel 项缺 render" });
  }
  // [doc:adr-126-p5-a] 双通道歧义（62c83271 review P3）：schemaId 是受控 schema 通道（renderPreviewPanel
  // 优先查 registry），同时带 renderCustom 即两条渲染路径并存——契约禁止，门禁拦截而非仅注释声明
  if (it.kind === "panel" && !isCoreFile && it.dualChannel) {
    v.push({
      rule: "render-channel-ambiguous",
      item: it.id,
      file: it.file,
      detail: "schemaId 与 renderCustom 双通道歧义，契约禁止同存",
    });
  }
  if (it.kind === "action" && !it.hasRun) {
    v.push({ rule: "action-has-run", item: it.id, file: it.file, detail: "action 项缺 run" });
  }
  return v;
}

// ── 主逻辑 ──
function main() {
  const allItems: Array<ReturnType<typeof parseItem>> = [];
  const allLeaves: Array<ReturnType<typeof parseItem>> = [];
  for (const f of MENU_FILES) {
    const { roots, leaves } = parseFileNodes(f);
    allItems.push(...roots);
    allLeaves.push(...leaves);
  }
  const zhCNKeys = collectZhCNPreviewKeys();

  const violations: Array<{ rule: string; item: string; file?: string; detail: string }> = [];
  const idFiles = new Map<string, string[]>(); // id → [文件,...] 收集所有出现（仅根项）
  const byFile = new Map<string, string[]>(); // file → [id,...] 每文件内部 id 列表（仅根项）
  for (const it of allItems) {
    const file = it.file ?? "";
    if (!idFiles.has(it.id)) idFiles.set(it.id, []);
    idFiles.get(it.id)?.push(file);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)?.push(it.id);
    violations.push(...itemViolations(it, zhCNKeys));
  }
  // 叶子节点不走 id 唯一 / dockGroup / 渲染通道（那是根菜单项契约），只查 kind 白名单 + 已声明 labelKey 的 i18n
  for (const it of allLeaves) violations.push(...itemViolations(it, zhCNKeys));

  // ── id 唯一性校验（独立段：每文件内部唯一 + core∩适配器无交集）──
  // 适配器按次挂载互斥（一次预览只加载一种模型），故 ysm/mmd/vrm 可共享 id（model/shot/bones）；
  // 仅「同一文件内重复」与「适配器 id 与 core 撞车」才报违规。
  const coreFile = "frontend/src/preview-3d/menu/defs.ts";
  const coreIds = new Set(byFile.get(coreFile) || []);
  const sharedIds: string[] = []; // 跨适配器同名的 id（不违规，仅报告）
  for (const [file, ids] of byFile) {
    // 同一文件内重复
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) {
        violations.push({
          rule: "id-unique",
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
            rule: "id-unique",
            item: id,
            file,
            detail: `适配器 id "${id}" 与 core 菜单项撞车`,
          });
        }
      }
    }
  }
  for (const [id, files] of idFiles) {
    if (files.length > 1)
      sharedIds.push(`${id}（${files.map((f) => path.basename(f)).join(" · ")}）`);
  }

  const ok = violations.length === 0;

  // ── 输出 ──
  if (JSON_MODE) {
    console.log(
      JSON.stringify({
        _summary: {
          ok,
          total: allItems.length,
          leaves: allLeaves.length,
          violations: violations.length,
        },
        items: allItems.map((it) => ({
          id: it.id,
          file: it.file,
          labelKey: it.labelKey,
          dockGroup: it.dockGroup,
          kind: it.kind,
        })),
        leafNodes: allLeaves.map((it) => ({
          id: it.id,
          file: it.file,
          labelKey: it.labelKey,
          kind: it.kind,
        })),
        violations,
      }),
    );
  } else {
    console.log(`\n${"=".repeat(60)}`);
    console.log(` 3D 菜单表健康检查（根项 ${allItems.length} · 叶子 ${allLeaves.length}）`);
    console.log(`${"=".repeat(60)}`);
    if (ok) {
      console.log(
        " [OK] 6 项校验全通过：id 唯一 · labelKey 非空 · i18n 齐全 · dockGroup 合法 · kind 合法 · render/run 完备",
      );
      console.log(`   覆盖文件：${MENU_FILES.map((f) => f.split("/").pop()).join(" · ")}`);
      if (allLeaves.length)
        console.log(
          `   叶子节点 ${allLeaves.length} 项按 PreviewMenuNodeKind 白名单校验（不占 id 唯一 / dockGroup 通道）`,
        );
      // 按 dockGroup 统计
      const byGroup = allItems.reduce(
        (acc, it) => {
          acc[it.dockGroup || "(无组)"] = (acc[it.dockGroup || "(无组)"] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      Object.entries(byGroup).forEach(([g, n]) => {
        console.log(`   ${g === "(无组)" ? " 无 dockGroup" : g}: ${n} 项`);
      });
      if (sharedIds.length)
        console.log(`   跨适配器共享 id（设计如此，按次挂载互斥）：${sharedIds.join(", ")}`);
    } else {
      console.log(` [FAIL] ${violations.length} 条违规：`);
      violations.forEach((v) => {
        console.log(`   - [${v.rule}] ${v.item} @ ${v.file}: ${v.detail}`);
      });
      console.log("   → 修复: 检查菜单表对应字段（id/labelKey/i18n/dockGroup/kind/render/run）");
    }
    console.log("");
  }

  process.exit(ok ? 0 : 1);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
