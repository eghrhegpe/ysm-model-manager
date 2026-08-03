#!/usr/bin/env node
/**
 * check-circular.mjs — 循环依赖检测器（ESM import 图 DFS 找环）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/js/ 下所有 .js/.ts（ADR-014 后 TS 与 JS 并存），解析相对路径
 * import/export-from 语句，构建模块依赖图，DFS 三色标记找环，输出完整环链 + 涉及文件数。
 *
 * 非相对导入（node_modules 包）跳过；扩展名自动补全（.ts/.js/index.ts/index.js）。
 *
 * 用法：
 *   node scripts/check-circular.mjs            # 文本报告
 *   node scripts/check-circular.mjs --json     # JSON（CI 用）
 *
 * 退出码：发现环 → 1；否则 0。
 */
import fs from 'node:fs';
import { ROOT, SRC_DIR, walk, resolveImport, relPosix } from './_lib/scan-files.mjs';

const JSON_OUT = process.argv.includes('--json');

const IMPORT_RE = /(?:^|\n)\s*(?:import[\s\S]*?\sfrom\s+|import\s+|export\s*\{[^}]*\}\s*from\s+|export\s+\*\s+from\s+)['"]([^'"]+)['"]/g;

// ── 环检测（DFS 三色）─────────────────────────────────

function findCycles(graph) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = new Map(); // key（排序去重）→ 原始顺序环链

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        if (dfs(next)) return true;
      } else if (c === GRAY) {
        // 找到环：stack 中 next 位置截取，去掉首尾重复（next 即栈内起点）
        const start = stack.indexOf(next);
        const display = stack.slice(start); // [a, b]（a 在栈中）
        const key = [...display].sort().join('→');
        cycles.set(key, display);
        return true; // 剪枝防指数爆炸
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      stack.length = 0;
      dfs(node);
    }
  }
  return [...cycles.values()];
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(JSON_OUT ? JSON.stringify({ cycles: [], error: 'frontend/js 不存在' }) : 'frontend/js 目录不存在');
    process.exit(1);
  }

  const files = walk(SRC_DIR);
  const moduleSet = new Set(files);
  const graph = new Map(files.map((f) => [f, []]));

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    const deps = new Set();
    for (const m of text.matchAll(IMPORT_RE)) {
      // type-only import（`import type {...} from`）编译期擦除，不构成运行时依赖——
      // 计入会产生假阳性环（如 app-tree/events.ts `import type { AppTree }`）
      if (/^\s*import\s+type\b/.test(m[0])) continue;
      const target = resolveImport(f, m[1], moduleSet);
      if (target && target !== f) deps.add(target);
    }
    graph.set(f, [...deps]);
  }

  const cycles = findCycles(graph).map((cyc) => cyc.map((p) => relPosix(p)));

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { modules: files.length, cycles: cycles.length }, modules: files.length, cycles }, null, 2));
    process.exit(cycles.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 循环依赖检查 (check-circular)');
  console.log('══════════════════════════════════════');
  console.log(`扫描模块 : ${files.length}`);
  console.log(`循环     : ${cycles.length}`);
  console.log('──────────────────────────────────────');

  if (!cycles.length) {
    console.log('✅ 未发现循环依赖。');
    return;
  }
  cycles.forEach((c, i) => {
    console.log(`\n🔴 环 ${i + 1}（${c.length} 个模块）：`);
    for (const m of c) console.log(`   ${m}`);
  });
  console.log('\n退出码 1（可接 CI 卡点）。');
  process.exit(1);
}

main();
