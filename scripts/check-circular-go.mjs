#!/usr/bin/env node
/**
 * check-circular-go.mjs — Go 包级循环依赖检测器。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 go/、internal/ 及根级 .go（排除 _test.go），按【目录 = 包】构建
 * 依赖图：
 *   - 解析每个文件的 import 路径，仅保留本项目 module（ysm-model-manager/...）内部包；
 *   - DFS 三色标记找 import 级循环（与前端 check-circular.mjs 对称）。
 *
 * 说明：Go 编译器本身拒绝包级 import 循环（编译错误），本工具提供
 *   可读环链 + 独立 CI 卡点，不依赖完整编译。本工具【不】覆盖
 *   对象级（struct 互引）循环，例如 ADR-002 记录的 DownloadQueue ↔ App。
 *
 * 用法：
 *   node scripts/check-circular-go.mjs          # 文本报告
 *   node scripts/check-circular-go.mjs --json   # JSON（CI 用）
 *
 * 退出码：发现环 → 1；否则 0。
 * 设计意图：check-circular-go 工具脚本
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, toPosix } from './_lib/scan-files.mjs';

const MODULE = 'ysm-model-manager';
const JSON_OUT = process.argv.includes('--json');

// ── 收集 .go（排除 _test.go）─────────────────────────

function collectGo() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.go') && !ent.name.endsWith('_test.go')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'go'));
  walk(path.join(ROOT, 'internal'));
  // 根级 .go（main.go / embed.go / cli_export.go），不递归子目录
  for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.go') && !ent.name.endsWith('_test.go')) {
      out.push(path.join(ROOT, ent.name));
    }
  }
  return out;
}

// ── import 路径提取 ─────────────────────────────────

function extractImports(text) {
  const imports = new Set();
  // 块式 import ( ... )
  const blockRe = /import\s*\(([\s\S]*?)\)/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const strRe = /"(?:[^"\\]|\\.)*"/g;
    let s;
    while ((s = strRe.exec(m[1]))) imports.add(s[0].slice(1, -1));
  }
  // 单行 import "path"
  const singleRe = /import\s+"([^"]+)"/g;
  while ((m = singleRe.exec(text))) imports.add(m[1]);
  return imports;
}

// 目录 → 包节点 key（相对 ROOT，posix 风格；根目录用 "."）
function dirKey(file) {
  const rel = path.relative(ROOT, path.dirname(file));
  return toPosix(rel) || '.';
}

// ── 环检测（DFS 三色，复用 check-circular.mjs 算法）──

function findCycles(graph) {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = new Map();

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        if (dfs(next)) return true;
      } else if (c === GRAY) {
        const start = stack.indexOf(next);
        const display = stack.slice(start);
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
  const goFiles = collectGo();
  const dirImports = new Map();

  for (const f of goFiles) {
    const k = dirKey(f);
    if (!dirImports.has(k)) dirImports.set(k, new Set());
    const text = fs.readFileSync(f, 'utf-8');
    for (const imp of extractImports(text)) {
      if (imp === MODULE || imp.startsWith(MODULE + '/')) {
        const sub = imp.slice(MODULE.length).replace(/^\//, '');
        const targetKey = sub === '' ? '.' : sub;
        if (targetKey !== k) dirImports.get(k).add(targetKey);
      }
    }
  }

  const nodes = new Set(dirImports.keys());
  const graph = new Map([...nodes].map((n) => [n, []]));
  for (const [k, imps] of dirImports) {
    for (const t of imps) if (nodes.has(t)) graph.get(k).push(t);
  }

  const cycles = findCycles(graph).map((cyc) =>
    cyc.map((p) => (p === '.' ? '(root)' : p))
  );

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: { packages: nodes.size, cycles: cycles.length },
          packages: nodes.size,
          cycles,
        },
        null,
        2
      )
    );
    process.exit(cycles.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' Go 包级循环依赖检查 (check-circular-go)');
  console.log('══════════════════════════════════════');
  console.log(`扫描包 : ${nodes.size}`);
  console.log(`循环   : ${cycles.length}`);
  console.log('──────────────────────────────────────');

  if (!cycles.length) {
    console.log('✅ 未发现 Go 包级循环依赖。');
    return;
  }
  cycles.forEach((c, i) => {
    console.log(`\n🔴 环 ${i + 1}（${c.length} 个包）：`);
    for (const m of c) console.log(`   ${m}`);
  });
  console.log('\n退出码 1（可接 CI 卡点）。');
  process.exit(1);
}

main();
