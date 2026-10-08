#!/usr/bin/env node
/**
 * check-singleton-hygiene.ts — preview-3d 模块级可变单例「复位出口」卫生闸。
 *
 * 设计意图（2026-10-08 3D 预览环境耦合度锐评 P2-b）：
 * preview-3d 有 77 处模块级 `let/const` 常驻态。其中「有上限淘汰」那类防的是**内存**
 * （warnedPaths 200、model-cache FIFO 50），防不了**测试串味**——`let` 重绑定态一旦
 * 跨用例累积，就会制造顺序依赖的 flaky。现状是「reset 纪律靠人自觉」：全仓仅约 7 个
 * 模块导出 `__reset*ForTest`，其余靠各测试 `vi.resetModules()` 或不测隔离。
 * 本闸把该约定变成机械闸：**新增**模块级可变态必须给出复位出口或显式豁免。
 *
 * 射程（刻意收窄，泛化即噪音——同 check-menu-test-layout ADR-311 已知限制）：
 *   frontend/src/preview-3d/**  生产文件（.test./.spec./.d. 豁免；.worker. 在射程内）
 * 只测**顶层 `let`**（模块级可重绑定态）。`const` 容器（Map/Set 缓存）不测——它们
 * 属「有界缓存」范式，语义与重绑定态不同，纳入即噪音（分开立法另议）。
 *
 * 判定（S1 unmanaged-let）：
 *   一条顶层 `let` 命中 = 该文件「未被复位出口管理」且「未显式豁免」。
 *   合规三路（任一即放行）：
 *     a. 文件级复位出口：导出 `__reset*` / `reset*` / `clear*` 函数，或导出形参含
 *        `null` 的 `set*` 注入 setter（ADR-168 注入范式，传 null 即复位；形参类型经
 *        本地 `type X = … | null` 别名间接含 null 的也算——见 nullIncludingAliases）——
 *        文件级粒度：有出口即整文件受管（reset 函数通常整体复位，逐变量对账
 *        需跨行数据流分析，启发式不做，漏报接受）。
 *     b. 行级豁免：声明行或其前 3 行内注 `// singleton-allow: <非空理由>`
 *        （对齐仓内 `layering-allow: html` / `layout-assert:` 文化）。
 *     c. 入基线：存量债登记 docs/.singleton-hygiene-baseline.json（file→count 计数制，
 *        行号会随编辑漂移制造假回归，计数只问「这个文件的这类债有没有变多」）。
 *        只许减少；--update 收紧，新增需 --force。
 *
 * 启发式已知局限（不追求穷举，与 check-menu-test-layout 同口径）：
 *   - 多声明一行（`let a = 1, b = 2;`）只记首个标识符——仓内 biome 单行单声明，实际不发生。
 *   - stripNoise 不解析嵌套模板 / `${}` 插值内的反引号——与 check-layering 同源局限。
 *   - 顶层块（`if (x) { let y }`，无缩进不可能出现）不计：正则行首锚定天然排除。
 *
 * 空域 fail-loud（check-ctx-menu-i18n 假绿教训）：扫描到 0 个生产文件即 exit 2，拒绝报绿。
 *
 * 用法：
 *   node scripts/check-singleton-hygiene.ts            # 基线比对，超线退 1
 *   node scripts/check-singleton-hygiene.ts --json     # JSON（pre-push-gate 消费，_summary.ok）
 *   node scripts/check-singleton-hygiene.ts --update   # 收紧基线（只许减；--force 才可增/重建）
 *   node scripts/check-singleton-hygiene.ts --help
 * 退出码：0 通过 / 1 回归（超基线）/ 2 用法或扫描域异常。
 * 依赖：node:fs / node:path / node:url / _lib(parse-args, scan-files)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { SRC_DIR, toPosix, walk } from "./_lib/scan-files.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".singleton-hygiene-baseline.json");

/** 扫描域（相对 frontend/src，POSIX）。刻意只覆盖 3D 渲染域——
 *  锐评的 77 处常驻态集中于此；全仓泛化会把 views 组件级单例一并卷进来，噪音压过信号。 */
const SCAN_AREA = "preview-3d";

const RULES = ["unmanaged-let"] as const;
type Rule = (typeof RULES)[number];

/** 行级豁免标记（理由非空才算，防空注滥用） */
export const SINGLETON_ALLOW_RE = /singleton-allow:\s*\S+/;
/** 豁免注回溯窗口：声明行 + 前 3 行（容 JSDoc 块尾行或紧邻单行注） */
const ALLOW_LOOKBACK = 3;

export interface HygieneHit {
  /** 相对仓库根 POSIX 路径 */
  file: string;
  line: number;
  ident: string;
  rule: Rule;
}

/**
 * 剥离注释与模板字面量（空格等长替换，保持行结构/行号）。
 * 复用 check-layering 同款最小实现——该函数未导出，跨脚本 import 需改其模块接口，
 * 故复制而非依赖（同 check-circular P2-1 code_review 处置）。
 */
function stripNoise(text: string): string {
  return text
    .replace(/`(?:\\.|[^`\\])*`/g, (m: string) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, (m: string) => m.replace(/[^\n]/g, " "));
}

/** 顶层 `let` 声明（行首锚定 = 模块级；函数体内的缩进 let 不匹配）。 */
const MODULE_LET_RE = /^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)/gm;

export function moduleLevelLets(text: string): Array<{ ident: string; line: number }> {
  const clean = stripNoise(text);
  const out: Array<{ ident: string; line: number }> = [];
  for (const m of clean.matchAll(MODULE_LET_RE)) {
    out.push({ ident: m[1]!, line: clean.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** 从 `(` 位置读平衡括号内的形参文本（含嵌套括号）；不平衡返回 null。 */
function readParens(text: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** 复位出口：`__reset*` / `reset*` / `clear*` 导出函数（整体复位语义）。 */
const RESET_FN_RE = /export\s+function\s+(?:__reset\w*|reset\w*|clear\w*)\s*\(/;

/** 本地 `type X = … | null;` 别名集合——注入 setter 常把「可传 null」藏在别名里
 *  （实证 overlay-style-bridge：`OverlayStyleTarget = HTMLElement | ShadowRoot | null`，
 *  字面量判据漏检）。已知局限：非贪婪匹配到首个 `;`，对象类型字面量内的 `;` 会截断定义。 */
function nullIncludingAliases(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /^[ \t]*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/gm,
  )) {
    if (/\bnull\b/.test(m[2]!)) out.add(m[1]!);
  }
  return out;
}

/** 文件级「受复位出口管理」判定：整体复位函数 或 可传 null 的注入 setter（ADR-168）。
 *  setter 判据：形参文本含 `null` 字面量，或其类型引用了含 null 的本地别名。 */
export function hasResetChannel(text: string): boolean {
  const clean = stripNoise(text);
  if (RESET_FN_RE.test(clean)) return true;
  const nullAliases = nullIncludingAliases(clean);
  for (const m of clean.matchAll(/export\s+function\s+set\w*\s*\(/g)) {
    const params = readParens(clean, m.index + m[0].length - 1);
    if (params === null) continue;
    if (/\bnull\b/.test(params)) return true;
    for (const alias of nullAliases) {
      if (new RegExp(`\\b${alias}\\b`).test(params)) return true;
    }
  }
  return false;
}

/** 声明行或其前 ALLOW_LOOKBACK 行内是否带豁免注（查原文——stripNoise 已把注释抹成空格）。 */
function hasAllowMarker(lines: string[], line: number): boolean {
  const idx = line - 1;
  for (let i = Math.max(0, idx - ALLOW_LOOKBACK); i <= idx; i++) {
    if (SINGLETON_ALLOW_RE.test(lines[i] ?? "")) return true;
  }
  return false;
}

/** 纯函数内核：单文件 → 未受管顶层 let 命中（契约测试直测此函数，防真实树碰巧绿时空转）。 */
export function scanText(file: string, text: string): HygieneHit[] {
  const lets = moduleLevelLets(text);
  if (!lets.length) return [];
  // 文件级出口判定前置：有出口即整文件受管（见头注释 a 路）
  if (hasResetChannel(text)) return [];
  const lines = text.split("\n");
  const hits: HygieneHit[] = [];
  for (const { ident, line } of lets) {
    if (hasAllowMarker(lines, line)) continue;
    hits.push({ file, line, ident, rule: "unmanaged-let" });
  }
  return hits;
}

/** 扫描域内生产文件（.test./.spec./.d. 豁免；.worker. 在射程内）。 */
export function collectProductionFiles(): string[] {
  const dir = resolve(SRC_DIR, SCAN_AREA);
  if (!existsSync(dir)) {
    throw new Error(`check-singleton-hygiene: 扫描域不存在（重构后请更新 SCAN_AREA）: ${SCAN_AREA}`);
  }
  return walk(dir, {
    exts: [".ts", ".tsx"],
    skipFile: (n: string) => /\.(test|spec)\.tsx?$/.test(n) || /\.d\.ts$/.test(n),
  }) as string[];
}

export function scanAll(): HygieneHit[] {
  const hits: HygieneHit[] = [];
  for (const abs of collectProductionFiles()) {
    const rel = toPosix(relative(REPO_ROOT, abs));
    hits.push(...scanText(rel, readFileSync(abs, "utf8")));
  }
  return hits;
}

/* ── 计数基线：file → rule → count ── */
type Counts = Record<string, Partial<Record<Rule, number>>>;

function toCounts(hits: HygieneHit[]): Counts {
  const c: Counts = {};
  for (const h of hits) {
    let bucket = c[h.file];
    if (bucket === undefined) {
      bucket = {};
      c[h.file] = bucket;
    }
    bucket[h.rule] = (bucket[h.rule] ?? 0) + 1;
  }
  return c;
}

function loadBaseline(): { exists: boolean; counts: Counts } {
  if (!existsSync(BASELINE_FILE)) return { exists: false, counts: {} };
  const data = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  return { exists: true, counts: (data.counts ?? {}) as Counts };
}

/** 回归 = 基线外文件 或 文件×规则计数超基线；fixed = 基线内有计数但现状更低/消失 */
export function diffBaseline(
  current: Counts,
  baseline: Counts,
): { regressions: string[]; fixed: string[] } {
  const regressions: string[] = [];
  const fixed: string[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    for (const rule of RULES) {
      const now = current[file]?.[rule] ?? 0;
      const allowed = baseline[file]?.[rule] ?? 0;
      if (now > allowed) regressions.push(`${file} [${rule}] ${allowed} → ${now}`);
      else if (now < allowed) fixed.push(`${file} [${rule}] ${allowed} → ${now}`);
    }
  }
  return { regressions, fixed };
}

function writeBaseline(counts: Counts, note: string): void {
  const data = {
    _comment:
      "preview-3d 模块级可变单例（顶层 let）未受复位出口管理的债务基线（key=文件，值=规则→命中数）。仅允许减少，不允许增加。更新: node scripts/check-singleton-hygiene.ts --update（新增需 --force）",
    note,
    generatedAt: new Date().toISOString().slice(0, 10),
    counts,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2), {
    bools: ["json", "update", "force", "help"],
  });
  if (parsed.help) {
    console.log(
      "用法: node scripts/check-singleton-hygiene.ts [--json] [--update] [--force]\n" +
        "  --update 收紧基线（只许减；新增需 --force）  --json 供 pre-push-gate 消费",
    );
    process.exit(0);
  }
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(", ")}（--help 查看用法）`);
    process.exit(2);
  }

  let files: string[];
  let hits: HygieneHit[];
  try {
    files = collectProductionFiles();
    hits = scanAll();
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(2);
  }
  // 空域 fail-loud（check-ctx-menu-i18n 假绿教训：0 文件 = 扫描失效，非全绿）
  if (files.length === 0) {
    console.error(`❌ 扫描域内 0 个生产文件——SCAN_AREA 指向失效？拒绝报绿`);
    process.exit(2);
  }

  const current = toCounts(hits);
  const filesScanned = files.length;
  const bl = loadBaseline();

  if (parsed.update) {
    if (bl.exists && !parsed.force) {
      const { regressions } = diffBaseline(current, bl.counts);
      if (regressions.length) {
        console.log(
          `[基线守卫] 新增 ${regressions.length} 处未受管模块级 let（超基线），拒绝更新——确认属实请加 --force`,
        );
        for (const r of regressions.slice(0, 10)) console.log(`   ${r}`);
        process.exit(1);
      }
    }
    // 键排序稳定：避免无实质变化时 generatedAt 之外的 churn
    const prevJson = JSON.stringify(bl.counts, Object.keys(bl.counts).sort());
    const newJson = JSON.stringify(current, Object.keys(current).sort());
    if (bl.exists && prevJson === newJson) {
      console.log(`[singleton-hygiene] 基线无变化（${hits.length} 处债务），跳过写入`);
      process.exit(0);
    }
    writeBaseline(current, parsed.force ? "（--force 覆盖写入）" : "（--update 收紧）");
    console.log(
      `[singleton-hygiene] 基线已写入: ${relative(REPO_ROOT, BASELINE_FILE)}（${hits.length} 处债务 / ${Object.keys(current).length} 文件）`,
    );
    process.exit(0);
  }

  if (!bl.exists) {
    // 无基线 = 门禁接线尚未初始化：报 degraded 红，禁止「缺失即全绿」
    console.error(
      "❌ 基线不存在（docs/.singleton-hygiene-baseline.json）——先跑 --update 初始化",
    );
    process.exit(1);
  }

  const { regressions, fixed } = diffBaseline(current, bl.counts);
  const ok = regressions.length === 0;
  const baselineTotal = Object.values(bl.counts).reduce(
    (s, r) => s + Object.values(r).reduce((a, b) => a + (b ?? 0), 0),
    0,
  );

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            ok,
            total: hits.length,
            files: Object.keys(current).length,
            scannedFiles: filesScanned,
            baseline: baselineTotal,
            regressions: regressions.length,
            fixed: fixed.length,
            warns_list: regressions,
          },
          hits,
          regressions,
          fixed,
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  }

  console.log("=== preview-3d 模块级可变单例卫生检查（复位出口/豁免/基线）===");
  console.log(
    `扫描: ${filesScanned} 个生产文件 / 命中 ${hits.length} 处未受管顶层 let（${Object.keys(current).length} 文件承载债务）`,
  );
  if (regressions.length) {
    console.error(`❌ 新增/超出基线 ${regressions.length} 处（只减不增）：`);
    for (const r of regressions) console.error(`   ${r}`);
    console.error(
      "   → 修复: 给该模块补复位出口（export function __resetXxxForTest / resetXxx / 可传 null 的 setXxx），" +
        "或行内注 `// singleton-allow: <理由>` 说明为何无常驻污染",
    );
  }
  if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 处债务计数（低于基线）：`);
    for (const f of fixed.slice(0, 8)) console.log(`   ${f}`);
    console.log("   运行 `node scripts/check-singleton-hygiene.ts --update` 收紧基线");
  }
  console.log(ok ? "\n✅ 单例卫生闸通过（存量在基线内）" : "\n❌ 单例卫生闸未通过");
  process.exit(ok ? 0 : 1);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
