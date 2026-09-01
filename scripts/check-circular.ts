#!/usr/bin/env node
/**
 * check-circular.ts — 循环依赖检测器（ESM import 图 DFS 找环）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/src/ 下所有 .js/.ts（ADR-014 后 TS 与 JS 并存），解析相对路径
 * import/export-from 语句，构建模块依赖图，DFS 三色标记找环，输出完整环链 + 涉及文件数。
 *
 * 非相对导入（node_modules 包）跳过；扩展名自动补全（.ts/.js/index.ts/index.js）。
 *
 * 用法：
 *   node scripts/check-circular.ts            # 文本报告
 *   node scripts/check-circular.ts --json     # JSON（CI 用）
 *
 * 退出码：发现环 → 1；否则 0。
 * 设计意图：循环依赖检查（source-graph 分析）
 */
import fs from 'node:fs';
import { ROOT, SRC_DIR, walk, resolveImport, relPosix } from './_lib/scan-files.ts';
import { findCycles } from './_lib/cycles.ts';

const JSON_OUT = process.argv.includes('--json');

const IMPORT_RE = /(?:^|\n)\s*(?:import[\s\S]*?\sfrom\s+|import\s+|export\s*\{[^}]*\}\s*from\s+|export\s+\*\s+from\s+)['"]([^'"]+)['"]/g;
// 动态 import('...')：任意位置（不要求行首/await），`import("x").catch(...)` 与 `await import("x")` 均覆盖。
// 前导排除标识符字符，避免误匹配（如 import.meta / 变量名含 import 前缀的写法）。
const DYNAMIC_IMPORT_RE = /(?:^|[^A-Za-z0-9_$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 剥离注释与模板字面量（空格等长替换，保持行结构/行号）。
 * 复用 check-layering.mjs stripNoise 的最小实现——该函数未导出，直接 import 需改动
 * check-layering 的模块接口，故复制而非跨脚本依赖（P2-1 code_review）。
 * 注释/模板字面量中的 import 形状文本若不剥离，会被 IMPORT_RE / DYNAMIC_IMPORT_RE
 * 误判为真实依赖边 → 幽灵环。
 */
function stripNoise(text) {
  return text
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(JSON_OUT ? JSON.stringify({ cycles: [], error: 'frontend/src 不存在' }) : 'frontend/src 目录不存在');
    process.exit(1);
  }

  const files = walk(SRC_DIR) as string[];
  const moduleSet = new Set(files);
  const graph = new Map<string, string[]>(files.map((f) => [f, []]));

  for (const f of files) {
    // 先剥离注释/模板字面量再提取 import——注释/字符串中的 import 文本不再被当依赖边
    const text = stripNoise(fs.readFileSync(f, 'utf-8'));
    const deps = new Set<string>();
    for (const m of text.matchAll(IMPORT_RE)) {
      // type-only import（`import type {...} from`）编译期擦除，不构成运行时依赖——
      // 计入会产生假阳性环（如 app-tree/events.ts `import type { AppTree }`）。
      // 内联 type 形式：`import { type X } from` / `export { type X } from`
      // （花括号内全部具名为 type 前缀 → 纯类型转发，code_review P2）。
      // 注意：`export type { A } from` 不匹配 IMPORT_RE（无对应备选分支），天然不构成边，
      // 无需在此跳过（code_review P3 不可达分支已清理）。
      const stmt = m[0];
      const braceM = stmt.match(/\{([^}]*)\}/);
      const allTypeNamed = braceM
        ? braceM[1].split(',').map((s) => s.trim()).filter(Boolean).length > 0 &&
          braceM[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => /^type\s+/.test(s))
        : false;
      // 默认导入（`import store, { type State }`）是运行时值依赖，即使花括号全 type
      // 也不能跳过——否则丢失 f→./store 依赖边造成假阴性环（code_review P3）。
      const hasRuntimeDefault = /^import\s+[A-Za-z_$][\w$]*\s*,/.test(stmt);
      if (/^\s*import\s+type\b/.test(stmt) || (allTypeNamed && !hasRuntimeDefault)) continue;
      const target = resolveImport(f, m[1], moduleSet);
      if (target && target !== f) deps.add(target);
    }
    // 动态 import('...') 同样构成运行时依赖（加载即执行模块副作用）
    for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) {
      const target = resolveImport(f, m[1], moduleSet);
      if (target && target !== f) deps.add(target);
    }
    graph.set(f, [...deps]);
  }

  const { cycles } = findCycles(graph);
  const cyclesRel = cycles.map((cyc) => cyc.map((p) => relPosix(p)));

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { modules: files.length, cycles: cyclesRel.length }, modules: files.length, cycles: cyclesRel }, null, 2));
    process.exit(cyclesRel.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 循环依赖检查 (check-circular)');
  console.log('══════════════════════════════════════');
  console.log(`扫描模块 : ${files.length}`);
  console.log(`循环     : ${cyclesRel.length}`);
  console.log('──────────────────────────────────────');

  if (!cyclesRel.length) {
    console.log('✅ 未发现循环依赖。');
    return;
  }
  cyclesRel.forEach((c, i) => {
    console.log(`\n🔴 环 ${i + 1}（${c.length} 个模块）：`);
    for (const m of c) console.log(`   ${m}`);
  });
  console.log('\n退出码 1（可接 CI 卡点）。');
  console.log('→ 修复: 检查环中模块的 import 链，拆分或重构打破循环依赖');
  process.exit(1);
}

main();
