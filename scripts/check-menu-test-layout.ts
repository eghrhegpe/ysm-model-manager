#!/usr/bin/env node
/**
 * check-menu-test-layout.ts — 菜单测试「布局快照断言」防回退闸（ADR-311 D3）。
 *
 * 设计意图：菜单区测试长期手写三类**布局快照**断言——有序 id/kind 清单 toEqual、
 * 精确 toHaveLength、`nodes[3]` 位置索引。菜单项增删/重排（改菜单的常态）会让他们
 * 全红陪葬（实证 5bc993c74：测试 churn 163 行 vs 生产 74 行）。本闸把三类形态登记
 * 进基线（只减不增），新增即红——逼迫新写菜单测试走 ADR-311 三分法：
 *   行为不变量硬断言 / 成员归属集合断言（childIds + sort-toEqual / toContain）/
 *   顺序仅产品决策（须行内 `// layout-assert: <理由>` 注记，闸豁免）。
 *
 * 扫描域（菜单专属，非全仓——泛化即噪音，ADR-311 已知限制）：
 *   frontend/src/{preview-3d/menu, preview-3d/caps, preview-3d/adapters,
 *                 preview-3d/state, views/app-preview, features/context-menu}
 *   下的 *.test.ts / *.spec.ts。
 *
 * 三类检测（启发式，防「新增时想起来」，不追求穷举——漏报接受，ADR-311 D3）：
 *   R-L1 ordered-snapshot  `map((x) => x.id|kind) … toEqual([字面量])` /
 *                          `childIds|nodeIds(…) … toEqual([字面量])`。
 *                          带 `.sort()`（仓内集合惯例）或 `expect.arrayContaining` 不匹配 = 合法。
 *   R-L2 exact-length      `…<菜单名词>….toHaveLength(<数字 ≥1>)`。
 *                          toHaveLength(0)（行为式"清空"）与 toHaveLength(x.length)
 *                          （规格驱动，context-menus.test 即范本）不匹配 = 合法。
 *   R-L3 index-access      `nodes|children|menuItems|items|roots|leaves|sliceItems [<数字>]`
 *                          （含 `!` 变体）与 `getMenuNodes()[<数字>]`。
 *                          → 替代方案：findNodeById（menu-test-helpers，ADR-311 D2）。
 *   豁免：匹配跨度内任一行含 `// layout-assert: <非空理由>`；纯注释行内命中不报。
 *
 * 基线 docs/.menu-test-layout-baseline.json：key = 文件 × 规则 → **命中数**（非行号——
 * 行号随编辑漂移会制造假回归，计数制只问「这个文件这类债有没有变多」）。
 * 只许减少；--update 收紧，新增需 --force（照 check-layering R3/R4/R8 范式）。
 * 空域 fail-loud（0 文件即 exit 2，check-ctx-menu-i18n 假绿教训）。
 *
 * 用法：
 *   node scripts/check-menu-test-layout.ts            # 基线比对，超线退 1
 *   node scripts/check-menu-test-layout.ts --json     # JSON（pre-push-gate 消费，_summary.ok）
 *   node scripts/check-menu-test-layout.ts --update   # 收紧基线（只许减；--force 才可增/重建）
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
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".menu-test-layout-baseline.json");

/** 菜单测试扫描域（相对 frontend/src，POSIX）。
 *  注：preview-3d/adapters/fbx 不在域内——其 `nodes[]` 是 FBX 场景图节点（几何解析测试），
 *  非 PreviewMenuNode，纳入即纯误报。 */
const SCAN_AREAS = [
  "preview-3d/menu",
  "preview-3d/caps",
  "preview-3d/adapters",
  "preview-3d/state",
  "views/app-preview",
  "features/context-menu",
];

/** 规则掩码：前缀 → 禁用规则集。
 *  menu/shell 与 menu/render 的 DOM 行序索引（rows[0]/children[1]）是**渲染器自身的
 *  输出契约**（folder 折叠体紧随 header 行、滑杆含 bar……位置即被测语义），属 ADR-311
 *  D1 第三档「产品决策顺序」的合法形态——index-access 在这两处不禁，其余两规则照常。 */
const RULE_MASKS: Array<{ prefix: string; disabled: Rule[] }> = [
  {
    prefix: "frontend/src/preview-3d/menu/shell/",
    disabled: ["index-access"],
  },
  {
    prefix: "frontend/src/preview-3d/menu/render/",
    disabled: ["index-access"],
  },
];

/** adapters/fbx 全目录排除（场景图节点测试，与菜单无关） */
const EXCLUDE_PREFIXES = ["frontend/src/preview-3d/adapters/fbx/"];

function maskedRulesFor(fileRel: string): Set<Rule> {
  const mask = RULE_MASKS.find((m) => fileRel.startsWith(m.prefix));
  if (!mask) return new Set(RULES);
  return new Set(RULES.filter((r) => !mask.disabled.includes(r)));
}

const RULES = ["ordered-snapshot", "exact-length", "index-access"] as const;
type Rule = (typeof RULES)[number];

export interface LayoutHit {
  /** 相对仓库根 POSIX 路径 */
  file: string;
  line: number;
  rule: Rule;
  detail: string;
}

/* ── 行跨度辅助：match index → 1-based 行号 ── */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}
function lineOf(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // starts 下标恒在界内（二分收敛）；无 noUncheckedIndexedAccess，直接读
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/** 豁免注释：`layout-assert: <非空理由>`（ADR-311 D1 第三档合法形态的执法载体） */
const ESCAPE_RE = /layout-assert:\s*\S+/;

/** 纯注释行（命中在此行则不报——注释里引述断言形态是文档常态） */
function isCommentLine(rawLine: string): boolean {
  return /^\s*(?:\/\/|\*|\/\*)/.test(rawLine);
}

interface PatternSpec {
  rule: Rule;
  re: RegExp;
  /** 二次过滤：匹配文本满足谓词才计违规（如窗口含 sort 即集合惯例 → 放行） */
  accept: (m: RegExpMatchArray) => boolean;
}

const PATTERNS: PatternSpec[] = [
  {
    // map((c) => c.id|kind) [窗口 ≤80 字符非分号] .toEqual([字面量]
    // 窗口含 .sort( → 仓内集合惯例（`.sort()).toEqual([...].sort())`）→ 放行
    rule: "ordered-snapshot",
    re: /map\s*\(\s*\([^)]*\)\s*=>\s*[^)]+\.(?:id|kind)\s*\)([^;]{0,80}?)\.to(?:Equal|Strict\w*)\s*\(\s*\[/gs,
    accept: (m) => !(m[1] ?? "").includes("sort("),
  },
  {
    // childIds(...)/nodeIds(...) [窗口 ≤40] .toEqual([字面量] —— helper 版有序快照
    rule: "ordered-snapshot",
    re: /\b(?:childIds|nodeIds)\s*\((?:[^()]|\([^()]*\))*\)([^;]{0,40}?)\.to(?:Equal|Strict\w*)\s*\(\s*\[/gs,
    accept: (m) => !(m[1] ?? "").includes("sort("),
  },
  {
    // 菜单名词接收者的精确长度断言；toHaveLength(0)（行为式）与 .length 参数（规格驱动）天然不匹配
    rule: "exact-length",
    re: /((?:nodes|children|menuItems|items|controls|options|rows|leaves|sliceItems)\b[^;\n]{0,80}?)\.toHaveLength\(\s*([1-9]\d*)\s*\)/gs,
    accept: (m) => !/\.length\b/.test(m[1] ?? ""),
  },
  {
    rule: "index-access",
    re: /\b(?:nodes|children|menuItems|items|roots|leaves|sliceItems)\s*!?\s*(?:\?\.)?\s*\[\s*\d+\s*\]/gs,
    accept: () => true,
  },
  {
    rule: "index-access",
    re: /getMenuNodes\(\)\s*!?\s*\[\s*\d+\s*\]/gs,
    accept: () => true,
  },
];

/** 扫描单文件文本，返回布局快照命中（导出供契约测试直喂夹具）。 */
export function scanText(relFromRoot: string, text: string): LayoutHit[] {
  const starts = lineStarts(text);
  const rawLines = text.split(/\r?\n/);
  const hits: LayoutHit[] = [];
  const allowedRules = maskedRulesFor(relFromRoot);
  for (const { rule, re, accept } of PATTERNS) {
    if (!allowedRules.has(rule)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (true) {
      m = re.exec(text);
      if (m === null) break;
      if (!accept(m)) continue;
      const startLine = lineOf(starts, m.index);
      const endLine = lineOf(starts, m.index + m[0].length);
      const raw = rawLines[startLine - 1] ?? "";
      if (isCommentLine(raw)) continue;
      // 跨度内任一行带豁免注记即放行
      let escaped = false;
      for (let l = startLine; l <= endLine; l++) {
        if (ESCAPE_RE.test(rawLines[l - 1] ?? "")) {
          escaped = true;
          break;
        }
      }
      if (escaped) continue;
      hits.push({
        file: relFromRoot,
        line: startLine,
        rule,
        detail: raw.trim().slice(0, 100),
      });
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/* ── 文件收集 ── */
function collectTestFiles(): string[] {
  const out: string[] = [];
  for (const area of SCAN_AREAS) {
    const dir = resolve(SRC_DIR, area);
    if (!existsSync(dir)) {
      throw new Error(`check-menu-test-layout: 扫描域不存在（重构后请更新 SCAN_AREAS）: ${area}`);
    }
    for (const abs of walk(dir, {
      exts: [".ts"],
      skipFile: (n: string) => !/\.(test|spec)\.ts$/.test(n),
    }) as string[]) {
      const rel = toPosix(relative(REPO_ROOT, abs));
      if (EXCLUDE_PREFIXES.some((p) => rel.startsWith(p))) continue;
      out.push(abs);
    }
  }
  return out;
}

export function scanAll(): LayoutHit[] {
  const hits: LayoutHit[] = [];
  for (const abs of collectTestFiles()) {
    const rel = toPosix(relative(REPO_ROOT, abs));
    hits.push(...scanText(rel, readFileSync(abs, "utf8")));
  }
  return hits;
}

/* ── 计数基线：file → rule → count ── */
type Counts = Record<string, Partial<Record<Rule, number>>>;

function toCounts(hits: LayoutHit[]): Counts {
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
): {
  regressions: string[];
  fixed: string[];
} {
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
      "菜单测试布局快照断言债务基线（ADR-311 D3，key=文件，值=规则→命中数）。仅允许减少，不允许增加。更新: node scripts/check-menu-test-layout.ts --update（新增需 --force）",
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
      "用法: node scripts/check-menu-test-layout.ts [--json] [--update] [--force]\n" +
        "  --update 收紧基线（只许减；新增需 --force）  --json 供 pre-push-gate 消费",
    );
    process.exit(0);
  }
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(", ")}（--help 查看用法）`);
    process.exit(2);
  }

  let hits: LayoutHit[];
  try {
    hits = scanAll();
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(2);
  }

  const current = toCounts(hits);
  const filesScanned = new Set(hits.map((h) => h.file)).size;
  const totalTestFiles = collectTestFiles().length;
  // 空域 fail-loud（check-ctx-menu-i18n 假绿教训：0 测试文件 = 扫描失效，非全绿）
  if (totalTestFiles === 0) {
    console.error("❌ 扫描域内 0 个测试文件——SCAN_AREAS 指向失效？拒绝报绿");
    process.exit(2);
  }

  const bl = loadBaseline();

  if (parsed.update) {
    if (bl.exists && !parsed.force) {
      const { regressions } = diffBaseline(current, bl.counts);
      if (regressions.length) {
        console.log(
          `[基线守卫] 新增 ${regressions.length} 处布局快照断言（超基线），拒绝更新——确认属实请加 --force`,
        );
        for (const r of regressions.slice(0, 10)) console.log(`   ${r}`);
        process.exit(1);
      }
    }
    // 仅存非零计数，键排序稳定（避免无变化时 generatedAt 之外的 churn）
    const prevJson = JSON.stringify(bl.counts, Object.keys(bl.counts).sort());
    const newJson = JSON.stringify(current, Object.keys(current).sort());
    if (bl.exists && prevJson === newJson) {
      console.log(`[menu-test-layout] 基线无变化（${hits.length} 处债务），跳过写入`);
      process.exit(0);
    }
    writeBaseline(current, parsed.force ? "（--force 覆盖写入）" : "（--update 收紧）");
    console.log(
      `[menu-test-layout] 基线已写入: ${relative(REPO_ROOT, BASELINE_FILE)}（${hits.length} 处债务 / ${Object.keys(current).length} 文件）`,
    );
    process.exit(0);
  }

  const { regressions, fixed } = diffBaseline(current, bl.counts);

  if (!bl.exists) {
    // 无基线文件 = 门禁接线尚未初始化：报 degraded 红，禁止「缺失即全绿」
    console.error("❌ 基线不存在（docs/.menu-test-layout-baseline.json）——先跑 --update 初始化");
    process.exit(1);
  }

  const ok = regressions.length === 0;

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            ok,
            total: hits.length,
            files: filesScanned,
            scannedTestFiles: totalTestFiles,
            baseline: Object.values(bl.counts).reduce(
              (s, r) => s + Object.values(r).reduce((a, b) => a + (b ?? 0), 0),
              0,
            ),
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

  console.log("=== 菜单测试布局快照断言检查（ADR-311 三分法执法）===");
  console.log(
    `扫描: ${totalTestFiles} 个菜单区测试文件 / 命中 ${hits.length} 处布局快照形态（${filesScanned} 文件承载债务）`,
  );
  if (regressions.length) {
    console.error(`❌ 新增/超出基线 ${regressions.length} 处（只减不增）：`);
    for (const r of regressions) console.error(`   ${r}`);
    console.error(
      "   → 修复: 新写断言按 ADR-311 D1——归属用 childIds+集合 matcher、定位用 findNodeById；确属产品级顺序决策则行尾加 `// layout-assert: <理由>`",
    );
  }
  if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 处债务计数（低于基线）：`);
    for (const f of fixed.slice(0, 8)) console.log(`   ${f}`);
    console.log("   运行 `node scripts/check-menu-test-layout.ts --update` 收紧基线");
  }
  console.log(ok ? "\n✅ 布局快照闸通过（存量在基线内）" : "\n❌ 布局快照闸未通过");
  process.exit(ok ? 0 : 1);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
