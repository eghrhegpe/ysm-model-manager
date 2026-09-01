#!/usr/bin/env node
/**
 * 契约测试：app-tree 测试「inline 私有断言」孤儿守卫（ADR-147 配套）。
 *
 * 背景：AppTree._typeFilter 等死字段被测试直接写入制造自证循环（测试写
 * 私有字段 → 断言渲染效果，只证明「filter 代码能 filter」，不证明生产路径
 * 可达）。ADR-147 决策「删字段 + 用契约测试兜底」：字段从类声明中消失后，
 * 任何测试仍引用它（写入或 as-unknown-as 断言）→ 契约红，防「删了字段却
 * 漏清测试」的静默漂移。app-tree 独占全仓 78% 的 inline 私有断言，本测试
 * 是「测试耦合私有字段」治理的第一道闸（test-internals.ts 收敛层为终态）。
 *
 * 规则（孤儿守卫）：
 *   扫描 frontend/src/views/app-tree/*.test.ts 中对私有字段的两种引用形态：
 *     1. 写入：`. _xxx =`（排除 `==`/`===`/`=>`）——自证循环特征
 *     2. 断言：`as unknown as { _xxx` / `as unknown as X & { _xxx` / `as X & { _xxx`
 *       ——读断言；`{` 与字段名可跨行（如 `as unknown as AppTree & {` 换行
 *       `_filterPaths: Set<string> | null;`），按整文件内容括号平衡窗口收集全部 `_xxx`
 *   断言该字段要么仍声明于 index.ts 的 AppTree 类，要么在 KNOWN_EXTERNAL
 *   白名单（非 AppTree 自有、属虚拟滚动容器等外部对象的字段，如 _vsRows）。
 *   删除字段但未清理测试 → 立即红；清理后转绿。
 *
 * 依赖声明：零依赖（node:fs / node:path 内置）。
 * 设计意图：删除死字段的 TDD「红」落点；本测试非全量禁 inline 断言——
 * 只禁「引用了已删除字段」的断言，保证删除动作可被机器校验。
 *
 * 运行：node tests/test_private_access_contract.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_TREE_DIR = path.join(ROOT, "frontend/src/views/app-tree");
const INDEX_TS = path.join(APP_TREE_DIR, "index.ts");

/** 非 AppTree 自有、测试会合法引用的外部对象字段（虚拟滚动容器等）。
 *  注意：捕获组不含下划线前缀，白名单存裸名 `vsRows`。 */
const KNOWN_EXTERNAL = new Set(["vsRows"]);

let failed = 0;
const fail = (msg) => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

// ─── 1. 提取 AppTree 类私有字段声明（index.ts 类体内 `  _xxx =` / `  _xxx:`） ───
function extractClassPrivateFields(filePath) {
  const content = readFileSync(filePath, "utf8");
  const fields = new Set();
  const classMatch = content.match(/class\s+AppTree\b[^{]*\{/);
  if (!classMatch) return fields;
  const start = content.indexOf("{", classMatch.index) + 1;
  // 自 class 起始处做括号平衡，截取类体
  let depth = 1;
  let end = start;
  for (let i = start; i < content.length && depth > 0; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    end = i;
  }
  const body = content.slice(start, end);
  // 类体缩进成员声明：字段（`_xxx =` / `_xxx:`）与方法（`_xxx(`）都算「已声明」，
  // 允许任意修饰符序列（private/protected/public/async/static，如 `private async _deleteSelected`）。
  // 方法也算入 declared：测试合法 stub 方法（`el._load = vi.fn()`），排除会误报孤儿。
  const re = /^\s{2}(?:(?:private|protected|public|async|static)\s+)*_([a-zA-Z]\w*)\s*(?=[:=(])/gm;
  let m;
  while ((m = re.exec(body)) !== null) fields.add(m[1]);
  return fields;
}

// ─── 2. 扫描测试文件：私有字段引用（写入 + 断言） ───
function scanTestRefs(filePath) {
  const content = readFileSync(filePath, "utf8");
  const hits = [];
  const lines = content.split("\n");
  // 写入形态：`. _xxx =`（排除 `==`/`===`/`=>`）——逐行即可（写入不跨行）
  for (let i = 0; i < lines.length; i++) {
    const writeRe = /\.\s*_([a-zA-Z]\w*)\s*=(?!=)/g;
    let m;
    while ((m = writeRe.exec(lines[i])) !== null) {
      hits.push({ field: m[1], line: i + 1, kind: "write" });
    }
  }
  // 断言形态：`as unknown as X & {` / `as X & {` / `as {`，`{` 与字段名可跨行
  //（index.extra.test.ts `as unknown as AppTree & {` 换行 `_filterPaths:` 即此形态；
  //  toolbar-events.test.ts `as HTMLElement & {` 亦如此）。对整文件匹配断言起点，
  //  括号平衡取窗口，收集窗口内全部 `_xxx`（含嵌套花括号，如 `Array<{...}>`）。
  const castRe = /as\s+(?:unknown\s+as\s+)?[^{;]*?\{/g;
  let cm;
  while ((cm = castRe.exec(content)) !== null) {
    const openIdx = content.indexOf("{", cm.index);
    if (openIdx < 0) continue;
    const closeIdx = findBalancedBrace(content, openIdx);
    if (closeIdx < 0) continue;
    const window = content.slice(openIdx, closeIdx + 1);
    const fRe = /_([a-zA-Z]\w*)/g;
    let f;
    while ((f = fRe.exec(window)) !== null) {
      hits.push({ field: f[1], line: lineAt(content, openIdx), kind: "assert" });
    }
    castRe.lastIndex = closeIdx + 1; // 从窗口末尾继续，避免同一断言重复扫描
  }
  return hits;
}

/** 从 openIdx（`{`）做括号平衡，返回匹配 `}` 的下标；字符串字面量内的括号跳过 */
function findBalancedBrace(content, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 偏移量 → 1 起始行号 */
function lineAt(content, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") n++;
  }
  return n;
}

// ─── 主逻辑 ───
if (!existsSync(INDEX_TS)) {
  fail(`AppTree 源码不存在: ${INDEX_TS}`);
  process.exit(1);
}
const declared = extractClassPrivateFields(INDEX_TS);
console.log(`[info] AppTree 类私有字段声明 ${declared.size} 个`);

const testFiles = readDirTs(APP_TREE_DIR);
let refCount = 0;
let writeCount = 0;
for (const f of testFiles) {
  const hits = scanTestRefs(f.path);
  for (const h of hits) {
    refCount++;
    if (h.kind === "write") writeCount++;
    if (!declared.has(h.field) && !KNOWN_EXTERNAL.has(h.field)) {
      fail(`${f.rel}:${h.line} 引用私有字段 _${h.field}（${h.kind}），但 AppTree 类已无此声明（孤儿引用，需清理）`);
    }
  }
}
console.log(`[info] 扫描测试文件 ${testFiles.length} 个；私有字段引用 ${refCount} 处（其中写入 ${writeCount} 处）`);

if (failed > 0) {
  console.error(`\n契约失败: ${failed} 项 — 测试引用了已删除的私有字段，请清理残留断言`);
  process.exit(1);
}
console.log("[OK] app-tree 私有字段孤儿守卫通过（测试引用字段均有类声明或白名单）");
process.exit(0);

/** 收集目录下 *.test.ts（递归） */
function readDirTs(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readDirTs(full));
    else if (e.name.endsWith(".test.ts")) {
      out.push({ path: full, rel: path.relative(ROOT, full).replace(/\\/g, "/") });
    }
  }
  return out;
}
