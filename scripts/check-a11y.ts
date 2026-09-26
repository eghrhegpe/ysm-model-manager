#!/usr/bin/env node
/**
 * check-a11y.ts — 前端 a11y 覆盖基线守卫（ADR-308 D3 落地）。
 *
 * 设计意图：把「a11y 覆盖只增不减 / 键盘散点只减不增」固化为 CI 可执行基线，
 * 防「收敛成果」静默退化。与 check-layering 同范式（docs/.a11y-baseline.json，
 * 仅允许收紧），但方向相反：layering 管违规清单（只减），本闸管覆盖计数（只增）。
 *
 * 明确不做（ADR-308 D3 拒绝项）：ARIA 启发式扫描自动挂 role/aria + 键盘 handler——
 * 与「a11y 属性只经模板产出 + 键盘语义单点委托」纪律冲突、误报风险高。
 * 「自动化生成按键操作」的正确形态 = bindRoving(spec) / registerShortcut(spec)
 * 的 spec 驱动生成，不是运行时推导。
 *
 * 指标（扫 frontend/src 生产 .ts，测试文件豁免）：
 *   coverage（floor 只增不减）：aria-* 按属性名 / role / tabindex /
 *     prefers-reduced-motion 出现次数。剥注释后计数（注释示例虚高会掩盖真退化），
 *     字符串/模板串内容保留——aria 属性主产地正是模板串。
 *   scatter（ceiling 只减不增）：document 级 keydown 散点（文件 → 次数）。
 *     唯一合法分发出口 = utils/dom/key-router.ts（ADR-308 D1 立法），豁免不入册；
 *     其余在册文件即「有意维持现状的已知散点」（豁免理由见 key-router.ts 头注）。
 *     新增散点即红：新组合键必须走 registerShortcut，新散点须先改本闸基线留痕。
 *
 * 结构：纯核（剥噪/计数/比较，导出供契约测试直测防空转假绿）+ main 编排层。
 *
 * 用法：
 *   node scripts/check-a11y.ts            # 守卫：coverage 缺口或 scatter 回归则退 1
 *   node scripts/check-a11y.ts --json     # JSON（CI / 契约测试消费）
 *   node scripts/check-a11y.ts --update   # 收紧基线（coverage 只许升 / scatter 只许降）
 *   node scripts/check-a11y.ts --update --force   # 放松覆盖（有意迁移/删除时留痕覆盖）
 *
 * 退出码：0 通过 / 1 违规。
 * 依赖：node:fs / node:path / node:url / 本地模块（_lib/scan-files、_lib/parse-args）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { toPosix, walk } from "./_lib/scan-files.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SRC_ROOT = resolve(REPO_ROOT, "frontend", "src");
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".a11y-baseline.json");

/** scatter 豁免名单（相对 src 正斜杠路径）：ADR-308 D1 立法的键盘语义唯一出口 */
const SCATTER_EXEMPT = ["utils/dom/key-router.ts"];

/** 写入 baseline 的说明头（人读入口：双向语义 + 收紧/放松命令） */
const BASELINE_COMMENT =
  "a11y 覆盖基线（ADR-308 D3）：coverage=各指标出现次数下限（只增不减），scatter=document 级 keydown 散点文件→次数上限（只减不增；utils/dom/key-router.ts 为唯一合法出口已豁免不入册，在册文件=有意维持现状的已知散点，豁免理由见 key-router.ts 头注）。收紧: node scripts/check-a11y.ts --update；放松需 --force 并在提交说明附理由。";

/* ---------- 类型 ---------- */
/** coverage 计数：键 = aria 属性名 + role/tabindex/prefers-reduced-motion，值 = 全仓出现次数 */
type CoverageMap = Record<string, number>;
/** scatter 明细：键 = 相对 src 路径，值 = 命中行号（1-based） */
type ScatterDetail = Record<string, number[]>;
/** scatter 计数（baseline 存储形态）：键 = 相对 src 路径，值 = 该文件散点数 */
type ScatterCounts = Record<string, number>;

interface A11yBaseline {
  _comment: string;
  generatedAt: string;
  coverage: CoverageMap;
  scatter: ScatterCounts;
}

interface ScanResult {
  coverage: CoverageMap;
  scatter: ScatterDetail;
  fileCount: number;
}

/* ---------- 纯核：剥噪（注释置空格、字符串/模板串保留、行号不变） ---------- */
/**
 * 词法态机剥离注释（行/块），字符串与模板字面量体原样保留（含 ${} 插值递归）。
 * 返回与输入等长文本（被剥字符 → 空格、换行保留）——行号在剥噪前后一致，
 * scatter 行定位与 coverage 计数共用同一份剥噪产物（单一事实源）。
 * 病态输入（未闭合引号）按 JS 语义防御：单双引号串不跨行，行尾强制回 code 帧。
 * 导出纯函数供契约测试直测（防「真实树碰巧绿」空转假绿，同 check-layering 惯例）。
 */
export function stripA11yNoise(text: string): string {
  const chars = text.split("");
  type Frame = "code" | "sq" | "dq" | "tpl";
  const stack: Frame[] = ["code"];
  const n = text.length;
  let i = 0;
  while (i < n) {
    // stack 底恒为 code（pop 只发生在非 code 帧），?? 兜底防病态输入
    const top = stack[stack.length - 1] ?? "code";
    const c = text.charAt(i);
    const next = i + 1 < n ? text.charAt(i + 1) : "";
    if (top === "code") {
      if (c === "/" && next === "/") {
        while (i < n && text.charAt(i) !== "\n") chars[i++] = " ";
        continue;
      }
      if (c === "/" && next === "*") {
        chars[i++] = " ";
        chars[i++] = " ";
        while (i < n && !(text.charAt(i) === "*" && text.charAt(i + 1) === "/")) {
          if (text.charAt(i) !== "\n") chars[i] = " ";
          i++;
        }
        if (i < n) {
          chars[i++] = " ";
          chars[i++] = " ";
        }
        continue;
      }
      if (c === "'") stack.push("sq");
      else if (c === '"') stack.push("dq");
      else if (c === "`") stack.push("tpl");
      i++;
      continue;
    }
    if (top === "sq" || top === "dq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      // 单双引号串不跨行（JS 语义）：未闭合引号到行尾强制终止，防吞全文
      if (c === "\n") {
        stack.pop();
        i++;
        continue;
      }
      if ((top === "sq" && c === "'") || (top === "dq" && c === '"')) stack.pop();
      i++;
      continue;
    }
    // tpl：模板字面量体（可跨行），${} 回 code 帧
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      stack.pop();
      i++;
      continue;
    }
    if (c === "$" && next === "{") {
      stack.push("code");
      i += 2;
      continue;
    }
    i++;
  }
  return chars.join("");
}

/* ---------- 纯核：coverage 指标 ---------- */
// lookbehind 排除 data-role / x-aria / .role（属性访问赋值）等前缀误命中
const ARIA_RE = /(?<![-\w])aria-[a-z]+(?:-[a-z]+)*\b/g;
const ROLE_RE = /(?<![\w\-.])role\s*[=:]\s*["'`]/g;
const TABINDEX_RE = /(?<![-\w])tab[iI]ndex\b/g;
const RM_RE = /prefers-reduced-motion/g;

/** 指标名（baseline JSON 键）：aria 属性按命中名分组 + 三个汇总指标 */
export function countCoverage(text: string): CoverageMap {
  const clean = stripA11yNoise(text);
  const counts: CoverageMap = {};
  const bump = (key: string, hits: number) => {
    if (hits > 0) counts[key] = (counts[key] ?? 0) + hits;
  };
  for (const m of clean.matchAll(ARIA_RE)) bump(m[0], 1);
  bump("role", [...clean.matchAll(ROLE_RE)].length);
  bump("tabindex", [...clean.matchAll(TABINDEX_RE)].length);
  bump("prefers-reduced-motion", [...clean.matchAll(RM_RE)].length);
  return counts;
}

/* ---------- 纯核：scatter 指标 ---------- */
const DOC_KEYDOWN_RE = /document\s*\.\s*addEventListener\s*\(\s*["'`]keydown["'`]/;

/** 返回命中 document 级 keydown 的行号列表（1-based，剥噪后文本保证行号一致） */
export function scatterHits(text: string): number[] {
  const clean = stripA11yNoise(text);
  const out: number[] = [];
  clean.split("\n").forEach((line, idx) => {
    if (DOC_KEYDOWN_RE.test(line)) out.push(idx + 1);
  });
  return out;
}

/* ---------- 纯核：基线比较内核（导出供契约测试直测） ---------- */

/** coverage 缺口：current < baseline（按指标名），键消失 = 降为 0 同判 */
export function coverageDeficits(
  baseline: CoverageMap,
  current: CoverageMap,
): Array<{ key: string; baseline: number; current: number }> {
  const out: Array<{ key: string; baseline: number; current: number }> = [];
  for (const [key, want] of Object.entries(baseline)) {
    const got = current[key] ?? 0;
    if (got < want) out.push({ key, baseline: want, current: got });
  }
  return out;
}

/** scatter 回归：某文件散点数 > baseline（新增文件即从 0 回归） */
export function scatterRegressions(
  baseline: ScatterCounts,
  current: ScatterCounts,
): Array<{ file: string; baseline: number; current: number }> {
  const out: Array<{ file: string; baseline: number; current: number }> = [];
  for (const [file, want] of Object.entries(current)) {
    const allow = baseline[file] ?? 0;
    if (want > allow) out.push({ file, baseline: allow, current: want });
  }
  return out;
}

/** --update 收紧判定：coverage 全不降 且 scatter 全不升（放松需 --force） */
export function isTightening(
  prev: A11yBaseline,
  next: { coverage: CoverageMap; scatter: ScatterCounts },
): boolean {
  if (coverageDeficits(prev.coverage, next.coverage).length > 0) return false;
  if (scatterRegressions(prev.scatter, next.scatter).length > 0) return false;
  return true;
}

/* ---------- 扫描 ---------- */
const SCAN_OPTS = {
  exts: [".ts"],
  skipDir: (n: string) =>
    n.startsWith(".") || n === "node_modules" || n === "__tests__" || n === "test-utils",
  skipFile: /\.(d|test|spec)\.ts$/,
};

/** ScatterDetail → ScatterCounts（baseline 存储与守卫判定用计数形态） */
function scatterToCounts(scatter: ScatterDetail): ScatterCounts {
  return Object.fromEntries(Object.entries(scatter).map(([f, v]) => [f, v.length]));
}

function scan(): ScanResult {
  const coverage: CoverageMap = {};
  const scatter: ScatterDetail = {};
  let fileCount = 0;
  for (const abs of walk(SRC_ROOT, SCAN_OPTS) as string[]) {
    const rel = toPosix(relative(SRC_ROOT, abs));
    fileCount++;
    const text = readFileSync(abs, "utf8");
    for (const [k, v] of Object.entries(countCoverage(text))) {
      coverage[k] = (coverage[k] ?? 0) + v;
    }
    if (SCATTER_EXEMPT.includes(rel)) continue;
    const lines = scatterHits(text);
    if (lines.length > 0) scatter[rel] = lines;
  }
  return { coverage, scatter, fileCount };
}

/* ---------- main 编排层辅助 ---------- */
function loadBaseline(): { baseline: A11yBaseline; exists: boolean } {
  if (!existsSync(BASELINE_FILE)) {
    return {
      baseline: { _comment: "", generatedAt: "", coverage: {}, scatter: {} },
      exists: false,
    };
  }
  return { baseline: JSON.parse(readFileSync(BASELINE_FILE, "utf8")), exists: true };
}

function buildJsonReport(
  result: ScanResult,
  deficits: Array<{ key: string; baseline: number; current: number }>,
  regressions: Array<{ file: string; baseline: number; current: number }>,
  scatterTotal: number,
): Record<string, unknown> {
  return {
    _summary: {
      files: result.fileCount,
      coverageTotal: Object.values(result.coverage).reduce((a, b) => a + b, 0),
      coverageKeys: Object.keys(result.coverage).length,
      scatterTotal,
      deficits: deficits.length,
      regressions: regressions.length,
    },
    coverage: result.coverage,
    scatter: Object.fromEntries(Object.entries(result.scatter).map(([f, v]) => [f, v.length])),
    scatter_detail: result.scatter,
    coverage_deficits: deficits,
    scatter_regressions: regressions,
  };
}

function printHumanReport(result: ScanResult, scatterTotal: number): void {
  console.log(`[check-a11y] 扫描 ${result.fileCount} 个生产 .ts`);
  const coverageSummary = Object.entries(result.coverage)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(`  coverage: ${coverageSummary}`);
  const fileCount = Object.keys(result.scatter).length;
  console.log(
    `  scatter（document 级 keydown 散点，key-router.ts 豁免）: 共 ${scatterTotal} 处 / ${fileCount} 文件`,
  );
  for (const [f, lines] of Object.entries(result.scatter)) {
    console.log(`    ${f}:${lines.join(",")}`);
  }
}

/** --update 分支：写基线（只许收紧；放松需 --force 留痕），成功后退出 */
function updateBaseline(
  baseline: A11yBaseline,
  exists: boolean,
  force: boolean,
  coverage: CoverageMap,
  scatterCounts: ScatterCounts,
  scatterTotal: number,
): void {
  if (exists && !force && !isTightening(baseline, { coverage, scatter: scatterCounts })) {
    console.error(
      "[基线守卫] 本次更新含放松（coverage 下降或 scatter 上升），拒绝写入——确属有意迁移/删除时加 --force 覆盖并在提交说明附理由",
    );
    process.exit(1);
  }
  const doc: A11yBaseline = {
    _comment: BASELINE_COMMENT,
    generatedAt: new Date().toISOString().slice(0, 10),
    coverage,
    scatter: scatterCounts,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `[check-a11y] 基线已更新: ${relative(REPO_ROOT, BASELINE_FILE)}（coverage ${Object.keys(coverage).length} 键 / scatter ${scatterTotal} 处）${force ? "（--force 放松留痕）" : ""}`,
  );
  process.exit(0);
}

/** 守卫判定输出：coverage 缺口 / scatter 回归明细 + 逃生阀提示，违规退出 1。
 *  成功行仅人读模式打印——stdout 在 --json 下必须是无前缀的纯 JSON。 */
function reportGuardResult(
  deficits: Array<{ key: string; baseline: number; current: number }>,
  regressions: Array<{ file: string; baseline: number; current: number }>,
  jsonMode: boolean,
): void {
  let fail = false;
  if (deficits.length > 0) {
    fail = true;
    console.error(`\n❌ coverage 退化 ${deficits.length} 项（下限守卫，只增不减）:`);
    for (const d of deficits) {
      console.error(`  ${d.key}: ${d.current} < 基线 ${d.baseline}`);
    }
  }
  if (regressions.length > 0) {
    fail = true;
    console.error(
      `\n❌ scatter 回归 ${regressions.length} 项（新散点必须走 key-router.registerShortcut）:`,
    );
    for (const r of regressions) {
      console.error(`  ${r.file}: ${r.current} > 基线 ${r.baseline}`);
    }
  }
  if (fail) {
    console.error(
      "\n  确属有意调整 → node scripts/check-a11y.ts --update --force（放松需附理由；收紧直接 --update）",
    );
    process.exit(1);
  }
  if (!jsonMode) console.log("✅ a11y 基线守卫通过");
  process.exit(0);
}

/* ---------- main ---------- */
function main() {
  const parsed = parseArgs(process.argv.slice(2), { bools: ["json", "update", "force"] });
  if (parsed.unknown.length > 0) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(", ")}（支持 --json / --update / --force）`);
    process.exit(1);
  }
  const force = parsed.force === true;

  const result = scan();
  const scatterCounts = scatterToCounts(result.scatter);
  const scatterTotal = Object.values(scatterCounts).reduce((a, b) => a + b, 0);
  const { baseline, exists } = loadBaseline();
  const deficits = coverageDeficits(baseline.coverage ?? {}, result.coverage);
  const regressions = scatterRegressions(baseline.scatter ?? {}, scatterCounts);

  if (parsed.json) {
    console.log(
      JSON.stringify(buildJsonReport(result, deficits, regressions, scatterTotal), null, 2),
    );
  } else {
    printHumanReport(result, scatterTotal);
  }

  if (parsed.update)
    return updateBaseline(baseline, exists, force, result.coverage, scatterCounts, scatterTotal);
  if (!exists) {
    console.error(
      `\n❌ 基线不存在: ${relative(REPO_ROOT, BASELINE_FILE)}——先跑 node scripts/check-a11y.ts --update 初始化`,
    );
    process.exit(1);
  }
  reportGuardResult(deficits, regressions, parsed.json === true);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
