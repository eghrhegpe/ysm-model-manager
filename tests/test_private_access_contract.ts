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
 *     2. 断言：`as unknown as { _xxx` / `as unknown as X & { _xxx` ——读断言
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
  // 类体缩进成员声明：`  _xxx =` / `  _xxx:` / `private _xxx =` / `private _xxx:`
  //（`private` 关键字在 TS 类字段上合法，_ready/_deleting/_pendingRoot 等即此形态）
  const re = /^\s{2}(?:private\s+)?_([a-zA-Z]\w*)\s*(?::[^=;]*)?=(?!=)|^\s{2}(?:private\s+)?_([a-zA-Z]\w*)\s*:/gm;
  let m;
  while ((m = re.exec(body)) !== null) fields.add(m[1] || m[2]);
  return fields;
}

// ─── 2. 扫描测试文件：私有字段引用（写入 + as-unknown-as 断言） ───
function scanTestRefs(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    // 写入形态：`. _xxx =`（排除 `==`/`===`/`=>`）
    const writeRe = /\.\s*_([a-zA-Z]\w*)\s*=(?!=)/g;
    let m;
    while ((m = writeRe.exec(lines[i])) !== null) {
      hits.push({ field: m[1], line: i + 1, kind: "write" });
    }
    // 断言形态：`as unknown as { _xxx` 或 `as unknown as X & { _xxx`
    const assertRe = /as unknown as [^;{]*?\{[^}]*?_([a-zA-Z]\w*)/g;
    while ((m = assertRe.exec(lines[i])) !== null) {
      hits.push({ field: m[1], line: i + 1, kind: "assert" });
    }
  }
  return hits;
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
