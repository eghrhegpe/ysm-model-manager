#!/usr/bin/env node
/**
 * check-orphan-exports.ts — 孤儿导出检测（零消费者符号审计）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/src/ 下所有 .js/.ts（ADR-014 后 TS 与 JS 并存）：
 *   1. 提取每个模块的导出符号（export const/function/class/export { a, b }）
 *   2. 解析跨文件 import 消费（import { a } from / import a from）
 *   3. 统计每个导出符号的消费者数量
 *   4. 输出孤儿导出（0 消费者，WARN）+ 高频消费者 TOP
 *
 * 排除：export default（匿名单例惯用）、export ... from（re-export）。
 * 命名空间导入 import * as：按 ns.<symbol> 用法对齐具体符号（不排除）。
 * 消费者覆盖三类真实用法（避免活代码误判孤儿，ADR-043 扫描完整性）：
 *   - 跨文件 import { a } / 动态 import 解构 / import * as ns 取属性；
 *   - 动态 import 先存命名空间别名后取属性：const mod = await import("./x"); mod.foo
 *     （download-queue.test.ts 第 78-83 行真实写法，文本解析盲区已补）；
 *   - 同文件内部自调用（如 download-queue.ts 第 735/738/777/792 行 subscribe/resume/
 *     enqueueDownloads/cancelDownloads 自引用），按自引用计数并入消费者（排除 export 声明行）。
 *
 * 注：与联邦 MikuMikuAR 的 check-consumers（符号反向查询 / 重构影响面）同名异实，
 * 故独立命名为 check-orphan-exports 以消除歧义（ADR-241 §Phase 2）。
 *
 * 用法：
 *   node scripts/check-orphan-exports.ts                     # 文本报告
 *   node scripts/check-orphan-exports.ts --json              # JSON（CI 用）
 *   node scripts/check-orphan-exports.ts --strict            # 孤儿 > 0 → 退出 1
 *   node scripts/check-orphan-exports.ts --min-consumers 3   # 只报消费者 ≤3 的符号
 *
 * 退出码：默认审计模式 rc=0（孤儿仅报告，供 doctor 审计不阻断）；
 *         --strict 下孤儿/低消费 > 0 → rc=1（--min-consumers 过滤后同规则）。
 * 设计意图：孤儿导出检测（0 消费者的导出符号）
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { relPosix, resolveImport, SRC_DIR, walk } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict"],
  strings: ["min-consumers"],
  defaults: { "min-consumers": "0" },
});
if (args.unknown.length) console.warn(`忽略未知参数: ${args.unknown.join(", ")}`);
const JSON_OUT = args.json as boolean;
const STRICT = args.strict as boolean;
const MIN_CONSUMERS = parseInt(args["min-consumers"] as string, 10) || 0;

// ── 导出/导入解析 ─────────────────────────────────────

const EXPORT_NAMED_RE =
  /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const IMPORT_RE =
  /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;

/** 提取模块导出符号（含行号）。 */
function extractExports(file: string, text: string) {
  const out: any[] = [];
  for (const m of text.matchAll(EXPORT_NAMED_RE)) {
    const line = text.slice(0, m.index).split("\n").length;
    out.push({ name: m[1], line });
  }
  for (const m of text.matchAll(EXPORT_BLOCK_RE)) {
    const line = text.slice(0, m.index).split("\n").length;
    for (const raw of m[1]!.split(",")) {
      const n = raw.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) out.push({ name: n[1], line });
    }
  }
  return out;
}

// 动态导入：await import("...") 的两种命名解构形式
const DYN_DESTRUCT_RE =
  /(?:const|let|var)\s*\{\s*([^}]*?)\s*\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
const THEN_DESTRUCT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)\.then\(\s*\(\s*\{\s*([^}]*?)\s*\}\s*\)/g;
// 动态导入：先存命名空间别名、后取属性（download-queue.test.ts 第 78-83 行真实用法）
//   const mod = await import("./x.ts");  mod.foo;  mod.bar();
//   import("./x.ts").then((mod) => { mod.foo });
const DYN_NS_ALIAS_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
const THEN_NS_ALIAS_RE = /import\(\s*['"]([^'"]+)['"]\s*\)\.then\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

/**
 * 解析动态导入规格（同 resolveImport，多一次 .js → .ts 回退）。
 * TS 源文件常被 `import("./x.js")` 引用（binding 的 .js 风格），磁盘是 .ts。
 */
function resolveDynImport(file: string, spec: string, moduleSet: Set<string>) {
  let target = resolveImport(file, spec, moduleSet);
  if (!target && spec.endsWith(".js")) {
    target = resolveImport(file, spec.slice(0, -3) + ".ts", moduleSet);
  }
  return target;
}

/** 提取模块消费的符号（跨文件，返回 [目标模块, 符号名] 列表）。 */
function extractImports(file: string, text: string, moduleSet: Set<string>) {
  const out: any[] = [];
  const pushNamed = (target: string, rawList: string) => {
    for (const raw of rawList.split(",")) {
      const sym = raw.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (sym) out.push([target, sym[1]]);
    }
  };
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[3]!, moduleSet);
    if (!target || target === file) continue;
    if (m[2]) pushNamed(target, m[2]);
  }
  // 重导出 `export { a, b } from "./y"`：转发即消费（桶文件链），否则仅经桶文件
  // 转发消费的符号会被误报孤儿（code_review P2，实证 test-utils/index.ts）。
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveImport(file, m[2]!, moduleSet);
    if (!target || target === file) continue;
    pushNamed(target, m[1]!);
  }
  // 动态导入：const { a, b } = await import("spec")
  for (const m of text.matchAll(DYN_DESTRUCT_RE)) {
    const target = resolveDynImport(file, m[2]!, moduleSet);
    if (!target || target === file) continue;
    pushNamed(target, m[1]!);
  }
  // 动态导入：import("spec").then(({ a, b }) => ...)
  for (const m of text.matchAll(THEN_DESTRUCT_RE)) {
    const target = resolveDynImport(file, m[1]!, moduleSet);
    if (!target || target === file) continue;
    pushNamed(target, m[2]!);
  }
  // 动态导入：先存命名空间别名、后取属性（如 download-queue.test.ts 第 78-83 行）
  //   const mod = await import("./x.ts");  mod.foo;  mod.bar();
  const nsAliases: any[] = []; // [alias, target]
  for (const m of text.matchAll(DYN_NS_ALIAS_RE)) {
    const target = resolveDynImport(file, m[2]!, moduleSet);
    if (!target) continue;
    nsAliases.push([m[1], target]);
  }
  for (const m of text.matchAll(THEN_NS_ALIAS_RE)) {
    const target = resolveDynImport(file, m[1]!, moduleSet);
    if (!target) continue;
    nsAliases.push([m[2], target]);
  }
  for (const [alias, target] of nsAliases) {
    const useRe = new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)\\b`, "g");
    for (const u of text.matchAll(useRe)) {
      if (u[1] === "default") continue;
      out.push([target, u[1]]);
    }
  }
  // 转发别名盲区修复（ADR-241 实证）：const x = mod.foo 把 foo 赋给局部变量 x 后，
  // 下游 x() / x.zzz 调用无法回溯到 mod.foo 所属模块的符号，导致活代码误判孤儿
  // （download-queue.ts 的 subscribe/getState/resume/... 即此情形）。
  // 修复：记录 x→{target,foo}，再全文扫 x 的用法计入 foo 消费（排除定义行自身）。
  for (const [alias, target] of nsAliases) {
    if (!moduleSet.has(target)) continue;
    const fwdDefRe = new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${alias}\\.([A-Za-z_$][\\w$]*)`,
      "g",
    );
    for (const fm of text.matchAll(fwdDefRe)) {
      const x = fm[1];
      const foo = fm[2];
      const defLine = text.slice(0, fm.index ?? 0).split("\n").length;
      const xUseRe = new RegExp(`\\b${x}\\b`, "g");
      for (const xm of text.matchAll(xUseRe)) {
        const useLine = text.slice(0, xm.index ?? 0).split("\n").length;
        if (useLine === defLine) continue; // 跳过 const x = ... 定义行本身
        out.push([target, foo]);
      }
    }
  }
  // 命名空间导入 import * as ns：扫描 ns.<symbol> 用法对齐具体符号
  for (const m of text.matchAll(
    /\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    const target = resolveImport(file, m[2]!, moduleSet);
    if (!target || target === file) continue;
    const ns = m[1];
    const useRe = new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)\\b`, "g");
    for (const u of text.matchAll(useRe)) {
      if (u[1] === "default") continue;
      out.push([target, u[1]]);
    }
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────

// 孤儿豁免规则（2026-09-08 门禁鸡肋审查）：设计产物 / 生成物 / 重构中间态不该被 flag。
// 三层匹配：
//   symbol     —— 符号名精确匹配
//   symbolGlob —— 符号名 glob（DEFAULT_*_PARAMS 等）
//   pathGlob   —— 相对路径 glob（Emscripten 产物 wasm/*.js 等）
// 规则的 reason 注明来源（ADR/commit/设计产物），供维护者追责。
// export：契约测试 tests/test_orphan_exports_smart.ts import 校验（单一事实源）。
export const ORPHAN_EXEMPT_RULES = [
  // 规则 1：模板共享空导出 VIEW_TESTIDS —— 设计产物（所有 tpl.ts 的清一色 testid 集合）
  {
    type: "symbol",
    pattern: "VIEW_TESTIDS",
    reason: "模板共享空导出（所有 tpl.ts 都有，供测试 query）",
  },
  // 规则 2：caps 默认参数/类型枚举 —— ADR-196 统一数据源暂存
  { type: "symbolGlob", pattern: "DEFAULT_*_PARAMS", reason: "ADR-196 caps 统一数据源暂存" },
  { type: "symbolGlob", pattern: "*_TYPES", reason: "caps 类型枚举导出" },
  // 规则 3：Emscripten 产物路径（wasm/ 下的 .js/.d.ts）
  { type: "pathGlob", pattern: "**/wasm/*.js", reason: "Emscripten 自动生成产物" },
  { type: "pathGlob", pattern: "**/wasm/*.d.ts", reason: "Emscripten 自动生成产物" },
  // 规则 4：wasm glue 符号前缀
  { type: "symbolGlob", pattern: "_getWasmBinary*", reason: "Emscripten glue code" },
  { type: "symbolGlob", pattern: "_getGlueCode*", reason: "Emscripten glue code" },
  // 规则 5：ADR-196 env-state/light 统一数据源 refactor 中间态 getter
  {
    type: "symbolGlob",
    pattern: "get*Value",
    reason: "ADR-196 env-state 统一数据源 refactor 中间态",
  },
  {
    type: "symbolGlob",
    pattern: "set*Value",
    reason: "ADR-196 env-state 统一数据源 refactor 中间态",
  },
  {
    type: "symbol",
    pattern: "getPresetKeys",
    reason: "ADR-196 env-state 统一数据源 refactor 中间态",
  },
  {
    type: "symbol",
    pattern: "getEnvCallbackCount",
    reason: "ADR-196 env-state 统一数据源 refactor 中间态",
  },
  {
    type: "symbol",
    pattern: "deepMergeLightParams",
    reason: "ADR-196 light-capability 统一数据源 refactor 中间态",
  },
];

/** 简化 glob 匹配：** = 任意（含 /）跨目录，* = 不含 /；其余正则特殊字符转义。 */
function orphanGlob(pattern: string, target: string): boolean {
  const DS = "\u0000DS\u0000";
  const SS = "\u0000SS\u0000";
  let s = pattern.replace(/\*\*/g, DS).replace(/\*/g, SS);
  s = s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  s = s.split(DS).join(".*").split(SS).join("[^/]*");
  return new RegExp("^" + s + "$").test(target);
}

/** 判定孤儿是否应豁免（设计/生成/重构中间态）。返回 null = 不豁免。 */
export function isOrphanExempt(symbol: string, relFile: string): string | null {
  const posix = relFile.replace(/\\/g, "/");
  const baseFile = posix.split("/").pop() || posix;
  for (const rule of ORPHAN_EXEMPT_RULES) {
    switch (rule.type) {
      case "symbol":
        if (symbol === rule.pattern) return rule.reason;
        break;
      case "symbolGlob":
        if (orphanGlob(rule.pattern, symbol)) return rule.reason;
        break;
      case "pathGlob":
        if (orphanGlob(rule.pattern, posix) || orphanGlob(rule.pattern, baseFile))
          return rule.reason;
        break;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(
      JSON_OUT
        ? JSON.stringify({ orphan: [], error: "frontend/src 不存在" })
        : "frontend/src 目录不存在",
    );
    process.exit(1);
  }

  const files = walk(SRC_DIR);
  const moduleSet = new Set(files as string[]);

  // 符号 → 导出文件映射
  const symbolOwners = new Map(); // symbol → [{file, line}]
  for (const f of files) {
    const text = fs.readFileSync(f as string, "utf-8");
    for (const exp of extractExports(f as string, text)) {
      if (!symbolOwners.has(exp.name)) symbolOwners.set(exp.name, []);
      symbolOwners.get(exp.name).push({ file: f, line: exp.line });
    }
  }

  // 消费者计数
  const consumed = new Map(); // `${symbol}@${file}` → 消费次数
  for (const f of files) {
    const text = fs.readFileSync(f as string, "utf-8");
    for (const [target, sym] of extractImports(f as string, text, moduleSet)) {
      const key = `${sym}@${target}`;
      consumed.set(key, (consumed.get(key) || 0) + 1);
    }
  }

  // 同文件自引用计数：导出符号在自身文件内被调用/引用（非 export 声明行）。
  // 例：download-queue.ts 第 735 行 subscribe(handleStateChange)、738 void resume()
  // 等内部自调用——脚本仅扫 import 语句会漏掉，导致活代码被误判孤儿（ADR-241 实证）。
  for (const [sym, owners] of symbolOwners) {
    for (const { file, line } of owners) {
      const text = fs.readFileSync(file, "utf-8");
      const lines = text.split("\n");
      let selfCount = 0;
      const useRe = new RegExp(`\\b${sym}\\b`, "g");
      const namedRe = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
      const blockRe = /export\s*\{([^}]*)\}(?!\s*from)/;
      for (let i = 0; i < lines.length; i++) {
        if (i + 1 === line) continue; // 跳过 export 声明行本身
        const ln = lines[i]!;
        if (namedRe.test(ln) || blockRe.test(ln)) continue;
        if (useRe.test(ln)) selfCount++;
      }
      if (selfCount > 0) {
        const key = `${sym}@${file}`;
        consumed.set(key, (consumed.get(key) || 0) + selfCount);
      }
    }
  }

  // 汇总：每符号（按导出文件维度）消费者数
  const report: any[] = [];
  for (const [sym, owners] of symbolOwners) {
    for (const { file, line } of owners) {
      const consumers = consumed.get(`${sym}@${file}`) || 0;
      report.push({
        symbol: sym,
        file: relPosix(file),
        line,
        consumers,
      });
    }
  }
  const orphan = report.filter((r) => {
    if (r.consumers !== 0) return false;
    // 设计产物 / 生成物 / 重构中间态豁免（2026-09-08）：VIEW_TESTIDS / DEFAULT_*_PARAMS /
    // wasm glue / ADR-196 env-state getter 等不计入孤儿。豁免原因随 JSON 输出，供追责。
    return !isOrphanExempt(r.symbol, r.file);
  });
  // 豁免命中明细（JSON 输出 exempted 字段；文本模式给 open `⚠ 由 ...` 说明）
  const exempted = report
    .filter((r) => r.consumers === 0 && isOrphanExempt(r.symbol, r.file))
    .map((r) => ({ ...r, reason: isOrphanExempt(r.symbol, r.file) }));
  const threshold = report.filter((r) => r.consumers <= MIN_CONSUMERS);
  const top = [...report].sort((a, b) => b.consumers - a.consumers).slice(0, 10);
  const flagged = MIN_CONSUMERS > 0 ? threshold : orphan;
  const fail = STRICT && flagged.length > 0;

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            symbols: report.length,
            orphan: orphan.length,
            flagged: flagged.length,
            exempted: exempted.length,
          },
          symbols: report.length,
          orphan,
          top,
          exempted,
          minConsumers: MIN_CONSUMERS,
          flagged,
          strict: STRICT,
        },
        null,
        2,
      ),
    );
    process.exit(fail ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" 孤儿导出检测 (check-orphan-exports)");
  console.log("══════════════════════════════════════");
  console.log(`模块数   : ${files.length}`);
  console.log(`导出符号 : ${report.length}（含多文件同名导出）`);
  console.log(`孤儿导出 : ${orphan.length}`);
  console.log(
    `模式     : ${STRICT ? "STRICT（孤儿阻断）" : "审计（孤儿仅报告，加 --strict 阻断）"}`,
  );
  console.log("──────────────────────────────────────");

  if (orphan.length) {
    console.log("\n【孤儿导出（0 消费者）】");
    for (const r of orphan.slice(0, 40)) {
      console.log(`  ⚠ ${r.file}:${r.line}  ${r.symbol}`);
    }
    if (orphan.length > 40) console.log(`  … 其余 ${orphan.length - 40} 条（--json 全量）`);
  }

  if (exempted.length) {
    console.log(`\n【豁免孤儿（设计/生成/重构中间态，${exempted.length} 条，不计入）】`);
    const shown = new Set<string>();
    for (const e of exempted) {
      const k = `${e.symbol}@${e.reason}`;
      if (shown.has(k)) continue;
      shown.add(k);
      console.log(`  · ${e.symbol}（${e.reason}）`);
    }
    if (shown.size > 12) console.log(`  … 其余 ${shown.size - 12} 种符号（--json 全量）`);
  }

  if (top.length) {
    console.log("\n【TOP 消费者】");
    for (const r of top) {
      console.log(`  ${String(r.consumers).padStart(3)}  ${r.symbol}  ← ${r.file}`);
    }
  }

  if (fail) {
    console.log(
      `\n退出码 1（${flagged.length} 个符号消费者 ${MIN_CONSUMERS > 0 ? `≤ ${MIN_CONSUMERS}` : "= 0"}，--strict 阻断）。`,
    );
    console.log("→ 修复: 对每个 orphan 符号，删 export 或补充 import 方");
    process.exit(1);
  }
  console.log(
    flagged.length ? `\n（审计模式不阻断，--strict 可升级为 ERROR）` : "\n✅ 无孤儿导出。",
  );
}

// code_review cbd138f38 #2/#6/#8（P2）：main() 加直跑守卫——契约测试 import 本模块
// 取 isOrphanExempt 时不得触发全量扫描副作用（顶层 main 会三遍全仓扫描 + stdout
// 污染 + frontend/src 缺失时 process.exit(1) 杀死测试进程）；对齐仓内先例
// （check-ctx-menu-i18n / check-layering 的 pathToFileURL 守卫模式）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
