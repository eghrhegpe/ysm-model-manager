#!/usr/bin/env node
/**
 * check-vitest-assert-quality.ts — 前端 vitest「失败失语」防回退闸（ADR-202 刀5 的前端对照物）。
 *
 * 设计意图：Go 侧的裸断言债（`t.Fatal(err)` 无消息，失败输出无 diff）2026-10-24 已清零，
 * 账本见 scripts/baseline/go-bare-assert-baseline.json。前端**没有**「裸 t.Fatal」对应物
 * （vitest 的每个 matcher 失败都打印 expected/received diff）——但有一处精确的例外：
 *
 *   `expect(<含顶层 && / || 的表达式>).toBe(true)`
 *
 * 失败时输出只有 `expected false to be true`——**没有任何 diff**。合取项是三个还是五个、
 * 崩的是哪一个，输出里一个字都没有，必须回读测试源码才知道。这与裸 `t.Fatal(err)` 同等
 * 失语，是本仓 Go 侧那场战役在前端的唯一真同类面。实测 14 处，其中 5 处连消息都没有。
 *
 * ── 判据边界（为什么只收这一条）────────────────────────────────
 * 曾考虑把 check-e2e-hygiene 的 R2（`.toBeGreaterThan(0)` 存在性稀释）一并搬到前端，
 * 实测 111 处——但**静态不可判**：`expect(errors.length).toBeGreaterThan(0)` 在
 * 「应当报错」的测试里是正确断言，在「应当报 3 条错」的测试里才是稀释。同一形态两种语义，
 * 正则分不开。把 111 条塞进基线 = 造一本没人会还的债账，正是本仓吃过的
 * 「软告警 15 条无人拆」老路。故 R2 在前端**刻意不立闸**，只做**非阻断普查**（见下方
 * census 段）：给出数量与分布供排期，不进基线、不阻断。
 * 误报处置策略即此：**判据不可静态判定的，宁可不立闸，也不立一个靠人肉豁免维持的闸。**
 *
 * 另两条刻意排除的形态：
 *   - `expect(x, "msg").toBe(true)`（带消息的复合布尔，9 处）——消息已指明期望与主体
 *     （如 `${i.id} 缺渲染通道`），失语问题已被缓解，不强制拆分。
 *   - 嵌套在函数调用内的合取（`.some(x => x.a && x.b)`）——那是业务短路语义，不是断言结构。
 *
 * 豁免：语句所在行含 `// assert-quality-allow: <非空理由>` 即放行（复合条件本身即被测
 * 语义时，如「A 或 B 任一成立即合规」），但必须写下理由。
 *
 * 基线 docs/.vitest-assert-quality-baseline.json：key = 文件 × 规则 → **命中数**
 * （非行号——行号随编辑漂移会制造假回归，计数制只问「这个文件这类债有没有变多」）。
 * 只许减少；--update 收紧，新增需 --force（照 check-menu-test-layout / ADR-311 D3 范式）。
 * 空域 fail-loud（0 个测试文件即 exit 2，check-ctx-menu-i18n 假绿教训）。
 *
 * 退出条件（新增门禁准入声明，见知识卡 vitest-assert-quality.md）：
 *   判据是确定性的（词法扫描 + 顶层逻辑运算符 + 无第二实参），误报面为零 →
 *   存量 5 处清完即把 blockPolicy 由 debt 升 hard，成为纯防回归锁。这是本闸的
 *   「何时退役」判据：升 hard 后它不再有债可管，只剩拦截新写。
 *
 * 用法：
 *   node scripts/check-vitest-assert-quality.ts            # 基线比对，超线退 1
 *   node scripts/check-vitest-assert-quality.ts --json     # JSON（pre-push-gate 消费，_summary.ok）
 *   node scripts/check-vitest-assert-quality.ts --update   # 收紧基线（只许减；--force 才可增/重建）
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
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".vitest-assert-quality-baseline.json");

/** 进基线的规则（只许减）。 */
const RULES = ["compound-no-message"] as const;
type Rule = (typeof RULES)[number];

export interface AssertHit {
  /** 相对仓库根 POSIX 路径 */
  file: string;
  line: number;
  rule: Rule;
  detail: string;
}

/* ── 词法辅助：跳过字符串 / 模板 / 注释，避免在字面量里误判 ── */

/** i 指向引号（'"' / "'" / '\`'），返回闭合引号之后的下标。未闭合则返回末尾。 */
function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === quote) return j + 1;
    j++;
  }
  return j;
}

/** openIdx 指向 '('，返回与之配对的 ')' 下标；未配对返回 -1。 */
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** 在 [from, to) 内按顶层逗号切分实参（跳过字符串 / 注释 / 嵌套括号）。 */
function splitTopLevelArgs(text: string, from: number, to: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = from;
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < to && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < to && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  args.push(text.slice(start, to));
  return args;
}

/** 表达式内是否存在**顶层** && / ||（括号深度 0）。 */
function hasTopLevelLogical(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "\`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0) {
      if ((ch === "&" && text[i + 1] === "&") || (ch === "|" && text[i + 1] === "|")) return true;
    }
    i++;
  }
  return false;
}

/** expect(...) 之后紧跟的断言链——只认「布尔化」收尾（复合表达式被压成一个真/假）。 */
const TAIL_RE = /^\s*\.\s*(?:not\s*\.\s*)?(toBe\(\s*(?:true|false)\s*\)|toBeTruthy\(\)|toBeFalsy\(\))/;

/** 豁免注释：`assert-quality-allow: <非空理由>` */
const ESCAPE_RE = /assert-quality-allow:\s*\S+/;

/** 非阻断普查规则：尺寸稀释（不进基线，只报数量供排期）。 */
const SIZE_SUBJECT_RE = /(?:\?\?\.|!?\.)?(?:length|childElementCount|size)\s*$/;
const SIZE_TAIL_RE =
  /^\s*\.\s*(?:not\s*\.\s*)?(toBeGreaterThan\(\s*0\s*\)|toBeGreaterThanOrEqual\(\s*1\s*\))/;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

export interface ScanResult {
  /** 进基线的命中 */
  hits: AssertHit[];
  /** 非阻断普查计数（不进基线） */
  census: { sizeDiluted: number; compoundWithMessage: number };
}

/** 扫描单文件文本（导出供契约测试直喂夹具）。 */
export function scanTextFull(relFromRoot: string, text: string): ScanResult {
  const starts = lineStarts(text);
  const rawLines = text.split(/\r?\n/);
  const hits: AssertHit[] = [];
  const census = { sizeDiluted: 0, compoundWithMessage: 0 };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\`") {
      i = skipString(text, i);
      continue;
    }
    // expect( 前不得是标识符 / 成员访问（排除 myExpect( / x.expect( / fooexpect(）
    if (ch === "e" && text.startsWith("expect(", i) && !/[\w$.]/.test(text[i - 1] ?? "")) {
      const open = i + 6;
      const close = matchParen(text, open);
      if (close < 0) break;
      const args = splitTopLevelArgs(text, open + 1, close);
      const subject = (args[0] ?? "").trim();
      // 第二实参非空 = 带失败消息（vitest 会把它打进输出）
      const hasMessage = args.length > 1 && args.slice(1).join(",").trim().length > 0;
      const after = text.slice(close + 1, close + 120);
      const boolTail = TAIL_RE.exec(after)?.[1];
      const sizeTail = SIZE_TAIL_RE.exec(after)?.[1];
      const startLine = lineOf(starts, i);
      const endLine = lineOf(starts, close);
      const raw = rawLines[startLine - 1] ?? "";
      const isComment = /^\s*(?:\/\/|\*|\/\*)/.test(raw);
      let escaped = false;
      for (let l = startLine; l <= endLine; l++) {
        if (ESCAPE_RE.test(rawLines[l - 1] ?? "")) {
          escaped = true;
          break;
        }
      }
      if (subject.length > 0 && !isComment && !escaped) {
        if (boolTail !== undefined && hasTopLevelLogical(subject)) {
          if (hasMessage) census.compoundWithMessage++;
          else {
            hits.push({
              file: relFromRoot,
              line: startLine,
              rule: "compound-no-message",
              detail: raw.trim().slice(0, 110),
            });
          }
        } else if (sizeTail !== undefined && SIZE_SUBJECT_RE.test(subject)) {
          census.sizeDiluted++;
        }
      }
      i = close + 1;
      continue;
    }
    i++;
  }
  return {
    hits: hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    census,
  };
}

/** 兼容取命中（契约测试常用）。 */
export function scanText(relFromRoot: string, text: string): AssertHit[] {
  return scanTextFull(relFromRoot, text).hits;
}

/* ── 文件收集 ── */
export function collectTestFiles(): string[] {
  return walk(SRC_DIR, {
    exts: [".ts"],
    skipFile: (name: string) => !/\.test\.ts$/.test(name),
  }) as string[];
}

export function scanAll(): ScanResult & { scannedFiles: number } {
  const hits: AssertHit[] = [];
  const census = { sizeDiluted: 0, compoundWithMessage: 0 };
  let scannedFiles = 0;
  for (const abs of collectTestFiles()) {
    scannedFiles++;
    const rel = toPosix(relative(REPO_ROOT, abs));
    const r = scanTextFull(rel, readFileSync(abs, "utf8"));
    hits.push(...r.hits);
    census.sizeDiluted += r.census.sizeDiluted;
    census.compoundWithMessage += r.census.compoundWithMessage;
  }
  return { hits, census, scannedFiles };
}

/* ── 计数基线：file → rule → count ── */
export type Counts = Record<string, Partial<Record<Rule, number>>>;

export function toCounts(hits: AssertHit[]): Counts {
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

/** 回归 = 基线外文件 或 文件×规则计数超基线；fixed = 基线内有计数但现状更低/消失。 */
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
      "前端 vitest「失败失语」债务基线（key=文件，值=规则→命中数）。仅允许减少，不允许增加。更新: node scripts/check-vitest-assert-quality.ts --update（新增需 --force）",
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
      "用法: node scripts/check-vitest-assert-quality.ts [--json] [--update] [--force]\n" +
        "  --update 收紧基线（只许减；新增需 --force）  --json 供 pre-push-gate 消费",
    );
    process.exit(0);
  }
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(", ")}（--help 查看用法）`);
    process.exit(2);
  }

  let scanned: ReturnType<typeof scanAll>;
  try {
    scanned = scanAll();
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(2);
  }
  // 空域 fail-loud（check-ctx-menu-i18n 假绿教训：0 测试文件 = 扫描失效，非全绿）
  if (scanned.scannedFiles === 0) {
    console.error("❌ 扫描域 frontend/src 下 0 个 *.test.ts——目录改名？拒绝报绿");
    process.exit(2);
  }

  const { hits, census, scannedFiles } = scanned;
  const current = toCounts(hits);
  const bl = loadBaseline();

  if (parsed.update) {
    if (bl.exists && !parsed.force) {
      const { regressions } = diffBaseline(current, bl.counts);
      if (regressions.length) {
        console.log(
          `[基线守卫] 新增 ${regressions.length} 处失败失语断言（超基线），拒绝更新——确认属实请加 --force`,
        );
        for (const r of regressions.slice(0, 10)) console.log(`   ${r}`);
        process.exit(1);
      }
    }
    const prevJson = JSON.stringify(bl.counts, Object.keys(bl.counts).sort());
    const newJson = JSON.stringify(current, Object.keys(current).sort());
    if (bl.exists && prevJson === newJson) {
      console.log(`[vitest-assert-quality] 基线无变化（${hits.length} 处债务），跳过写入`);
      process.exit(0);
    }
    writeBaseline(current, parsed.force ? "（--force 覆盖写入）" : "（--update 收紧）");
    console.log(
      `[vitest-assert-quality] 基线已写入: ${toPosix(relative(REPO_ROOT, BASELINE_FILE))}（${hits.length} 处债务 / ${Object.keys(current).length} 文件）`,
    );
    process.exit(0);
  }

  if (!bl.exists) {
    // 无基线文件 = 门禁接线尚未初始化：报 degraded 红，禁止「缺失即全绿」
    console.error("❌ 基线不存在（docs/.vitest-assert-quality-baseline.json）——先跑 --update 初始化");
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
            scannedTestFiles: scannedFiles,
            baseline: baselineTotal,
            regressions: regressions.length,
            fixed: fixed.length,
            census_size_diluted: census.sizeDiluted,
            census_compound_with_message: census.compoundWithMessage,
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

  console.log("=== 前端 vitest「失败失语」检查（复合布尔断言无消息 → 失败无 diff）===");
  console.log(
    `扫描: ${scannedFiles} 个测试文件 / 命中 ${hits.length} 处（${Object.keys(current).length} 文件承载债务）`,
  );
  console.log(
    `普查（非阻断，不进基线）: 尺寸稀释 ${census.sizeDiluted} 处（存在性被 >0 稀释，静态不可判真伪）/ ` +
      `带消息复合布尔 ${census.compoundWithMessage} 处（消息已缓解失语）`,
  );
  if (regressions.length) {
    console.error(`❌ 新增/超出基线 ${regressions.length} 处（只减不增）：`);
    for (const r of regressions) console.error(`   ${r}`);
    console.error(
      "   → 修复: 拆成逐条 expect（失败即指名崩项），或补第二实参消息（vitest 会打进输出）；\n" +
        "     复合条件本身即被测语义则行尾加 `// assert-quality-allow: <理由>`",
    );
  }
  if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 处债务计数（低于基线）：`);
    for (const f of fixed.slice(0, 8)) console.log(`   ${f}`);
    console.log("   运行 `node scripts/check-vitest-assert-quality.ts --update` 收紧基线");
  }
  console.log(ok ? "\n✅ 断言诊断力闸通过（存量在基线内）" : "\n❌ 断言诊断力闸未通过");
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
