#!/usr/bin/env node
/**
 * 契约测试：关键 data-testid 存在性校验（G-1 抗脆弱测试基础设施 — ADR-035 / Design.md §19.1）。
 * 关键交互元素的 data-testid 被删除 → 契约红，防钩子静默失效。
 *
 * ADR-133 阶段 B：注册表不再手工维护。各视图以 `export const VIEW_TESTIDS`
 * 声明其稳定 testid（G-1 钩子单一事实源，与视图同生命周期），本测试运行期
 * 静态聚合为注册表。双校验：
 *   1. must-have：声明于 VIEW_TESTIDS 的 testid 必须在源码有对应 data-testid/dataset.testid
 *      钩子。删钩子忘删声明 → 红（保留 G-1「删能红」）。
 *   2. 孤儿扫描：源码中命中关键命名约定的 testid 必须被某 VIEW_TESTIDS 声明。
 *      加关键元素忘登记 → 红（消除病根 1「漏登」）。
 * 手工集中清单 TESTID_REGISTRY 已移除（病根 1 结构性消除）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');

// 关键命名约定（收窄作用域，避免装饰性 testid 误伤）；与阶段 A 孤儿扫描一致。
// 阶段 C+ 增补 'diag-' / 'ws-' / 'set-' / 'ins-'：这几族原先只有 #id、无 testid，e2e 靠
// getElementById / locator("#id") 绕过契约通道；补钩子后须一并纳入孤儿扫描，否则新增关键元素仍可漏登。
const KEY_PREFIXES = ['tree-', 'sm-', 'gh-', 'ctx-', 'dlg-', 'recy-', 'sidebar-', 'nav-', 'content-', 'toast', 'diag-', 'ws-', 'set-', 'ins-'];
const isKeyTestid = (id) => KEY_PREFIXES.some((p) => id === p.replace(/-$/, '') || id.startsWith(p));

const errors = [];
const REGISTRY = {}; // testid -> 声明它的源文件（相对 frontend/）

// ── 运行期聚合 VIEW_TESTIDS（ADR-133 阶段 B） ──────────────
// 各视图文件顶部 `export const VIEW_TESTIDS: readonly string[] = ['a','b',...]` 声明。
// 纯字面量数组，正则提取，无需编译 TS；动态拼接 testid（如 "preview-"+id）不匹配，自然排除。
// 单趟遍历（审核修复 P3）：同时聚合 VIEW_TESTIDS 声明 + 收集钩子字面量，每文件只读一次。
// 跳过测试文件（审核修复 P2）：*.test.ts 的 fixture HTML 字符串里的 testid 是测试产物，
// 不是真实钩子——若计入 seen，「删真实钩子忘删 VIEW_TESTIDS」契约仍绿（G-1 删能红被静默打穿），
// 且 fixture 引入的未注册关键 testid 会制造 ORPHAN 误报。
const isTestFile = (name) => /\.(test|spec|integration\.test)\.(ts|tsx|js|jsx)$/.test(name);
const seen = new Set(); // 真实源码钩子字面量（仅非测试源码）
(function walkSource(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('dist')) continue;
      walkSource(p);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(e.name) || isTestFile(e.name)) continue;
    const c = fs.readFileSync(p, 'utf8');
    // 1. VIEW_TESTIDS 声明 → 注册表（首个声明为准）
    const m = c.match(/export\s+const\s+VIEW_TESTIDS\s*:\s*readonly\s+string\[\]\s*=\s*\[([\s\S]*?)\]/);
    if (m) {
      const rel = path.relative(FE, p).replace(/\\/g, '/');
      for (const idm of m[1].matchAll(/'([a-z0-9-]+)'/g)) {
        const id = idm[1];
        if (!(id in REGISTRY)) REGISTRY[id] = rel;
      }
    }
    // 2. 钩子字面量收集
    for (const hm of c.matchAll(/data-testid="([a-z0-9-]+)"/g)) seen.add(hm[1]);
    for (const hm of c.matchAll(/dataset\.testid\s*=\s*"([a-z0-9-]+)"/g)) seen.add(hm[1]);
  }
})(path.join(FE, 'src'));

// ── 1. must-have：声明了就必须有钩子（保 G-1 删能红） ──
for (const [testid, relFile] of Object.entries(REGISTRY)) {
  if (!seen.has(testid)) {
    errors.push(
      `MISSING: testid="${testid}" 声明于 ${relFile} 的 VIEW_TESTIDS，但源码无对应 data-testid/dataset.testid 钩子。\n` +
      `      ↳ canonical fix（ADR-133 阶段 B）：删除 ${relFile} 中 VIEW_TESTIDS 的 '${testid}' 项（功能已删）；禁止为过门禁补无 handler 假按钮。`
    );
  }
}

// ── 2. 孤儿扫描：源码关键 testid 必须被声明（消病根 1 漏登） ──
for (const id of seen) {
  if (isKeyTestid(id) && !(id in REGISTRY)) {
    errors.push(
      `ORPHAN: data-testid="${id}" 命中关键命名约定但未声明于任何视图的 VIEW_TESTIDS。\n` +
      `      ↳ canonical fix（ADR-133 阶段 B）：在其所属视图文件导出 VIEW_TESTIDS 中加入 '${id}'。`
    );
  }
}

// ── G-1 ③④ 文件存在性守护（与 testid 注册表正交，保留） ──
if (!fs.existsSync(path.join(FE, 'src/test-utils/index.ts'))) {
  errors.push('MISSING: src/test-utils/index.ts（G-1 测试基础设施 helper 缺失）');
}
if (!fs.existsSync(path.join(FE, 'src/views/app-tree/app-tree.state.test.ts'))) {
  errors.push('MISSING: src/views/app-tree/app-tree.state.test.ts（G-1 首个组件测试缺失）');
}

if (errors.length > 0) {
  console.error('❌ 契约测试失败：关键 data-testid 缺失 / 孤儿未登记');
  for (const e of errors) console.error('  ', e);
  process.exit(1);
} else {
  const count = Object.keys(REGISTRY).length;
  console.log(`✅ 契约测试通过：${count} 个关键 data-testid 全部有钩子，无孤儿未登记`);
}
