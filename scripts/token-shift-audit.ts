#!/usr/bin/env node
/**
 * token-shift-audit.ts — 设计令牌门禁「行号位移幻影」与「真行级判定」的对比审计（只读报告型）。
 *
 * 依赖：node:path / node:url + 共享层 ./_lib/{proc.ts（统一子进程，禁直调 execFileSync）,
 *       git-hunks.ts（新增行解析）, design-tokens.ts（逐行判定纯函数）, parse-args.ts,
 *       scan-files.ts（ROOT / readText）}；运行时需 git 可执行（只读：log / diff / show）。
 *       零 npm 依赖。
 *
 * 为什么需要这个工具（把一次性的「探针」固化为可复查指标）：
 *   `scripts/check-design-tokens.ts --baseline` 用**基线文件级判定**：基线键 = `file:line:kind`，
 *   判据是「当前违规键 − 基线键 = 新增」。实测发现它**双向失效**：
 *     - 幻影（误伤）：同文件任意行位移都会让下方存量违规换行号 → 键变了 → 判成「新增」。
 *       历史采样里 baseline 报出的「新增」绝大多数是位移幻影，不是真新增。
 *     - 盲区（漏检）：新增违规恰好落在旧违规的行号上 → 键相同 → 判成「不是新增」。
 *   两条失效方向相反、互相掩盖，靠读代码看不出来，**必须跨提交统计**才能看见。
 *   替代方案是「真行级判定」：只判 `git diff` 新增行上的违规（复用 _lib/git-hunks.ts 的
 *   addedLinesFromDiff）。本工具把两个判据在同一批提交上算出可复查的数字，供 ADR / 决策复查
 *   引用——「95% 是幻影」这类结论不该只活在某次会话的终端里。
 *
 * 两条判据（同一批提交、同一套逐行判定函数，只有「判哪些键」不同）：
 *   判据 A（baseline 规则代理）：`added = 当前键集 − 父版本键集`。
 *       对每条 added 键，若父版本存在**同 kind 且行号差 ≤ --match-window** 的违规 →
 *       判为**位移幻影**（该违规本就存在，只是被上方编辑推着走）；找不到 → 真新增候选。
 *       ⚠️ 窗口匹配是**代理**：新增一条与父侧同类违规相距很近的真新增也会被算作幻影。
 *       这正是「代理」二字的含义——A 只能给上界，真值由判据 B 给。
 *   判据 B（真行级规则）：`git diff --unified=0 -M <c>^ <c>` 的**新增行号**上跑同两个判定
 *       函数 → 行级命中数。违规行本身没被本次提交改动就不算，行号位移天然免疫。
 *
 * 只读保证（硬约束）：本工具**永不写盘、永不改动 git 状态**——只跑 `git log / diff / show`
 *   三个只读命令，不建索引、不 fetch、不 checkout。任何「顺手修一下」都不属于本工具。
 *
 * 用法：
 *   node scripts/token-shift-audit.ts                      # 默认窗口 120（约 1~2 分钟）
 *   node scripts/token-shift-audit.ts --window 40          # 小窗口快速自查
 *   node scripts/token-shift-audit.ts --json               # 结构化 { _summary, topPhantom, topReal }
 *   node scripts/token-shift-audit.ts --match-window 40    # 收紧位移匹配窗口（更严的幻影口径）
 *   node scripts/token-shift-audit.ts --top 20             # 榜单条数
 *   node scripts/token-shift-audit.ts --help
 *
 * 参数口径（非正数一律回退默认值，见 resolvePositiveInt）：
 *   --window <N>        采样最近 N 个触碰设计令牌域（frontend/src|frontend/css）的提交，默认 120
 *   --match-window <行> 位移近邻匹配窗口，默认 80（行差 ≤ 该值即判位移）
 *   --top <N>           Top N 榜单条数，默认 10
 *
 * 退出码：0 = 正常完成（只读报告，**无论幻影率多少都不阻断**）；
 *          2 = 参数非法（未知参数）/ git 不可用或 git log 判定失败（fail-closed）。
 *          窗口内无本域提交不是失败（样本 0，仍退 0）。
 *
 * 判定域：`frontend/src/**.ts`（排除 `*.test.ts` / `*.spec.ts`）与 `frontend/css/**.css`
 *   ——与 check-design-tokens.ts 的扫描域对齐，否则两个判据比的不是同一批违规。
 *   文件名筛选口径是**文件级**（域）与**键级**（`rel:line:kind`）双层，逐行判定则完全复用
 *   design-tokens.ts 的 findStyleAttrViolations + findEmojiIconViolations（不自造规则）。
 *
 * 确定性：全程串行、无并发、无时间戳、无环境相关输出；排序都带 hash 兜底比较键。
 *   同一仓库状态下两次运行结果逐字节一致（这是「可复查」的前提）。
 *
 * 设计意图：把「门禁判据选得对不对」从口头论证变成可复查的数字，并为 ADR 提供可复算证据。
 *   适用场景：门禁判据选型（baseline 键差 vs 真行级）的决策复查、量化某个窗口内的误伤/漏检规模、
 *   排查「某次提交被门禁拦下到底是真债还是位移」、门禁口径改动前后的对照。
 *   ⚠️ 本工具**不是门禁**：它只读历史、只出报告，不阻断任何提交，也不写任何基线。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  findEmojiIconViolations,
  findStyleAttrViolations,
  parseTokenMap,
  type TokenRawMap,
} from "./_lib/design-tokens.ts";
import { addedLinesFromDiff } from "./_lib/git-hunks.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { run } from "./_lib/proc.ts";
import { readText, ROOT } from "./_lib/scan-files.ts";

// ── 常量 ──────────────────────────────────────────────

/** 判定域（与 check-design-tokens.ts 一致）：前端生产 TS + 文档层 CSS。 */
export const DOMAIN_PATHS: readonly string[] = ["frontend/src", "frontend/css"];

/** 默认采样窗口（提交数）。 */
export const DEFAULT_WINDOW = 120;
/** 默认位移近邻匹配窗口（行）。 */
export const DEFAULT_MATCH_WINDOW = 80;
/** 默认榜单条数。 */
export const DEFAULT_TOP = 10;

/** git 单次调用超时：大提交的 `git show` 全文可能较慢，故高于 proc.ts 的 30s 默认。 */
const GIT_TIMEOUT = 120_000;
/** 大输出缓冲 128MB（diff 全文 + 文件全文，默认 64MB 在多文件提交上有风险）。 */
const MAX_BUFFER = 128 * 1024 * 1024;

const VARIABLES_CSS = path.join(ROOT, "frontend/css/variables.css");

const USAGE = `设计令牌行号位移审计（token-shift-audit，只读报告型）

用法：
  node scripts/token-shift-audit.ts [选项]

选项：
  --window <N>         采样最近 N 个触碰设计令牌域的提交（默认 120）
  --match-window <行>  位移幻影的父侧近邻匹配窗口（行差 ≤ 该值即判位移，默认 80）
  --top <N>            Top N 榜单条数（默认 10）
  --json               JSON 输出（stdout 只放 JSON）
  --help               显示本帮助

参数口径：非数字 / 负数 / 0 / 小数一律回退默认值（手滑不炸工具，见 resolvePositiveInt）。

退出码：0 = 正常完成（无论幻影率多少都不阻断）；2 = 参数非法 / git 不可用等判定失败。
`;

// ── 纯函数层（测试与 CLI 共用；零 IO）──────────────────

/** 一条违规的最小标识：行号 + 种类（同 baseline 键的后两段）。 */
export interface DesignPoint {
  /** 1-based 行号。 */
  line: number;
  /** 违规种类（DesignViolationKind 的稳定标识）。 */
  kind: string;
}

/** 一个文件对的判定结果。 */
export interface FileAuditResult {
  /** 仓库根相对的正斜杠路径（判据键的前缀）。 */
  rel: string;
  /** 当前版本键集（`rel:line:kind`）。 */
  curKeys: string[];
  /** 判据 A 的输入：`curKeys − parentKeys`（保序去重）。 */
  addedKeys: string[];
  /** 判据 A 判定为「位移幻影」的键。 */
  shift: string[];
  /** 判据 A 判定为「真新增候选」的键。 */
  real: string[];
  /** 判据 B 的命中数：落在本次 diff 新增行上的键数。 */
  lineHits: number;
  /** 判据 B 的命中清单（供审计逐条复查）。 */
  lineHitKeys: string[];
}

/** 单个提交的判定汇总（subject 由主流程按需补齐）。 */
export interface CommitAudit {
  hash: string;
  subject: string;
  /** 判据 A：`cur − parent` 键数（baseline 会据此阻断）。 */
  added: number;
  /** 判据 A：位移幻影数。 */
  shift: number;
  /** 判据 A：真新增候选数。 */
  real: number;
  /** 判据 B：行级命中数（真行级规则会据此阻断）。 */
  lineHits: number;
}

/** 汇总指标（纯函数输出，JSON 与文本共用）。 */
export interface AuditSummary {
  /** 样本提交数（窗口内确实含本域文件、且成功算出 diff 的提交）。 */
  commits: number;
  /** 判据 A：added 总数。 */
  added: number;
  /** 判据 A：位移幻影数。 */
  shift: number;
  /** 幻影占比（%，对 added 取百分比；added=0 时为 0）。 */
  shiftPct: number;
  /** 判据 A：真新增候选数。 */
  real: number;
  /** 判据 B：行级命中总数。 */
  lineHits: number;
  /** baseline 会阻断的提交数（added > 0）。 */
  baselineBlocked: number;
  /** 真行级规则会阻断的提交数（行级命中 > 0）。 */
  lineBlocked: number;
  /** 纯幻影提交数（added > 0 且行级命中 = 0）——baseline 唯一会「凭空」拦下的那类。 */
  purePhantom: number;
  /** 两规则都拦的提交数（added > 0 且行级命中 > 0）。 */
  bothBlocked: number;
  /** 两规则都拦时，条数比（baseline 条数 / 行级条数）的中位数。 */
  medianMultiplier: number;
  /** 同上，算术平均。 */
  meanMultiplier: number;
}

/** git `--name-status` 的一个文件项（rename 取新旧双路径）。 */
export interface FileUnit {
  /** 当前版本路径（判据键前缀、`git show <c>:<rel>` 用）。 */
  rel: string;
  /** 父版本路径（`git show <c>^:<parentRel>` 用）；非 rename 时与 rel 相同。 */
  parentRel: string;
  /** git 状态码原文（`M` / `A` / `R100` …）。 */
  status: string;
}

/** 两位小数（JSON 可读性；确定性不受影响）。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 一位小数（占比）。 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 正整数参数解析：**非数字 / 负数 / 0 / 小数 一律回退默认值**。
 *
 * 为什么是「回退」而不是「报错」：三个参数都是**采样口径**而非判定开关——窗口填错只会让样本
 * 变大变小，不会让结论反向；报错退 2 反而会让「--window 0 想看全量」这类手滑变成硬失败。
 * 反过来说，参数**拼错**（`--windw`）依然由 parseArgs 的 unknown 白名单拦截退 2，不受本函数影响。
 * 用 `/^\d+$/` 而非 Number()：`Number(" ")` 是 0、`Number("0x10")` 是 16、`Number("1e3")` 是 1000，
 * 都会把「看起来不像数字」的输入悄悄放行——口径要窄且可解释。
 */
export function resolvePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return fallback;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return fallback;
  return n;
}

/**
 * 是否落在设计令牌判定域内。
 *
 * 与 check-design-tokens.ts 的扫描域对齐（否则两个判据比的不是同一批违规）：
 * `frontend/src/**.ts` 排除 `*.test.ts` / `*.spec.ts`（测试文件里的样式样本不是产品 UI），
 * 以及 `frontend/css/**.css`。路径一律仓库根相对、正斜杠（git 的 `--name-status` 输出）。
 */
export function inTokenDomain(rel: string): boolean {
  if (rel.startsWith("frontend/src/")) {
    if (!rel.endsWith(".ts")) return false;
    return !/\.(test|spec)\.ts$/.test(rel);
  }
  if (rel.startsWith("frontend/css/")) return rel.endsWith(".css");
  return false;
}

/**
 * 逐行扫描一段全文 → 违规点列表（纯函数，不碰 git / 磁盘 / 时钟）。
 *
 * 判定完全复用 design-tokens.ts 的两个判定函数，**不自造规则**——本工具的可信度全部来自
 * 「与门禁同一套判定」，任何本地化的「顺手多报一条」都会让对照失去意义。
 *
 * 键级去重（同一行同类多处只留一条）：baseline 键是 `rel:line:kind`，同一行两个 `font-size:13px`
 * 去重后只有一个键。若此处不去重，判据 A（键集差）与判据 B（逐条计数）会一个按键、一个按条，
 * 两边数字天然不可比。
 */
export function scanTextPoints(text: string, tokenMap?: TokenRawMap | null): DesignPoint[] {
  const out: DesignPoint[] = [];
  if (!text) return out;
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    const hits = [
      ...findStyleAttrViolations(line, lineNo, tokenMap ?? null),
      ...findEmojiIconViolations(line, lineNo),
    ];
    for (const v of hits) {
      const k = `${v.line}:${v.kind}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ line: v.line, kind: v.kind });
    }
  }
  return out;
}

/** 违规点 → baseline 键（`rel:line:kind`，与 check-design-tokens 的键格式逐字一致）。 */
export function violationKeys(rel: string, points: readonly DesignPoint[]): string[] {
  return points.map((p) => `${rel}:${p.line}:${p.kind}`);
}

/**
 * 键 → `{ rel, line, kind }`；畸形键返回 null。
 *
 * 用贪婪前缀 + 末两段解析：kind 里不含 `:`，行号是纯数字，故「最后一个 `:` 前是 kind、
 * 再往前是行号」是唯一的合法切法（rel 里即使含 `:` 也不会误切，因为要从右往左锚定）。
 */
export function parseViolationKey(key: string): { rel: string; line: number; kind: string } | null {
  const m = /^(.*):(\d+):([a-z][a-z0-9-]*)$/.exec(key);
  if (!m) return null;
  const rel = m[1] ?? "";
  const lineStr = m[2] ?? "";
  const kind = m[3] ?? "";
  if (!rel || !kind) return null;
  return { rel, line: Number(lineStr), kind };
}

/** 集合差 `curKeys − parentKeys`（保持 cur 顺序、已去重；判据 A 的 `added`）。 */
export function diffKeys(curKeys: readonly string[], parentKeys: readonly string[]): string[] {
  const parent = new Set(parentKeys);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of curKeys) {
    if (parent.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * 把 added 键二分：位移幻影 / 真新增候选（判据 A 的核心，**纯函数**）。
 *
 * 判定：父版本存在**同 kind 且 |行号差| ≤ matchWindow** 的违规 → 幻影（违规本就存在，只是被
 * 上方编辑推着走）；否则 → 真新增候选。
 *
 * 精确定义的三条细节（都是「不给错答案」的取舍）：
 *   1. **同 kind 才配对**：`css-font-size:10` 与 `css-radius:14` 行号再近也无关——它们是两笔债。
 *   2. **一条 added 键最多算一次幻影**：父侧同 kind 有两条近邻也只计一次（本函数逐 added 键配对，
 *      不是逐父侧违规配对）；否则「父侧 2 条近邻」会把 1 条子侧违规膨胀成 2 条幻影，占比失真。
 *   3. **畸形键归「真新增候选」**：本工具自产的键不会畸形，真出现时宁可保守报真新增（会推高
 *      baseline 误伤统计），也不静默吞掉——吞掉会让数字偏低而无人察觉。
 *
 * ⚠️ 这是**代理**口径，不是真值：新增一条与父侧同类违规相距 ≤ 窗口 的真新增同样会被判成幻影。
 * 真值由判据 B（只判 diff 新增行）给出，两者之差本身就是「代理有多保守」的度量。
 */
export function classifyAddedKeys(
  addedKeys: readonly string[],
  parentPoints: readonly DesignPoint[],
  matchWindow: number,
): { shift: string[]; real: string[] } {
  const shift: string[] = [];
  const real: string[] = [];
  for (const key of addedKeys) {
    const p = parseViolationKey(key);
    if (!p) {
      real.push(key);
      continue;
    }
    const matched = parentPoints.some(
      (q) => q.kind === p.kind && Math.abs(q.line - p.line) <= matchWindow,
    );
    (matched ? shift : real).push(key);
  }
  return { shift, real };
}

/**
 * 文件级判定：父/子全文 + 本次新增行号 → 两条判据的全部指标（**唯一不碰 git 的入口**）。
 *
 * 这是本工具可测性的核心：主流程只负责「把 git 里的三样东西取出来」（当前全文、父全文、
 * 新增行号集合），判定逻辑全部落在本函数里，于是契约测试可以用字符串造场景，不必造 git 仓库。
 *
 * @param input.rel         仓库根相对路径（判据键前缀；rename 时用**新**路径，两版本共用同一前缀，
 *                          否则改名会让整文件键集错位、全部判成新增）
 * @param input.curText     当前版本全文（`git show <c>:<rel>`）
 * @param input.parentText  父版本全文（`git show <c>^:<parentRel>`）；父侧不存在 = 空串 = 新文件
 * @param input.addedLines  本次 diff 的新增行号集合（`addedLinesFromDiff`）；空集 = 该文件无新增行
 */
export function analyzeFilePair(input: {
  rel: string;
  curText: string;
  parentText: string;
  matchWindow: number;
  addedLines: ReadonlySet<number>;
  tokenMap?: TokenRawMap | null;
}): FileAuditResult {
  const { rel, curText, parentText, matchWindow, addedLines, tokenMap = null } = input;
  const curPoints = scanTextPoints(curText, tokenMap);
  const parentPoints = scanTextPoints(parentText, tokenMap);
  const curKeys = violationKeys(rel, curPoints);
  const parentKeys = violationKeys(rel, parentPoints);
  const addedKeys = diffKeys(curKeys, parentKeys);
  const { shift, real } = classifyAddedKeys(addedKeys, parentPoints, matchWindow);
  const lineHitKeys = curKeys.filter((k) => {
    const p = parseViolationKey(k);
    return p !== null && addedLines.has(p.line);
  });
  return { rel, curKeys, addedKeys, shift, real, lineHits: lineHitKeys.length, lineHitKeys };
}

/**
 * 解析 `git diff --name-status -M` 的 stdout → 文件项列表（纯函数）。
 *
 * rename（`R100\t旧\t新`）取新旧双路径：旧路径用于取父侧内容（否则改名文件会被当成全新文件，
 * 整文件违规都算「新增」——这正是 check-biome-lines / diff-source.ts 都踩过的坑）。
 * copy（`C100\t源\t目标`）刻意**不**取源路径当父侧：目标的父版本确实不存在，语义等同新增文件。
 */
export function parseNameStatus(stdout: string): FileUnit[] {
  const out: FileUnit[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (!status) continue;
    if (/^R\d*/.test(status)) {
      const from = parts[1];
      const to = parts[2];
      if (from && to) out.push({ rel: to, parentRel: from, status });
      continue;
    }
    // A / M / C：目标路径恒为最后一段（C 的父侧同样不存在 → parentRel = rel，查不到即为空）
    const p = parts[parts.length - 1] ?? "";
    if (p) out.push({ rel: p, parentRel: p, status });
  }
  return out;
}

/** 中位数（空数组 → 0；偶数个取中间两个的均值）。 */
export function median(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? 0;
  if (s.length % 2 === 1) return hi;
  const lo = s[mid - 1] ?? 0;
  return (lo + hi) / 2;
}

/**
 * 把逐提交判定汇总成报告指标（纯函数）。
 *
 * 「两规则都拦时的倍数」只在 added>0 且行级命中>0 的提交上取比值——分母为 0 的提交（纯幻影）
 * 若混进来，倍数会变成除零/无穷，把最有信息量的那个数字毁掉；纯幻影提交单独用一个计数表达。
 */
export function summarizeCommits(commits: readonly CommitAudit[]): AuditSummary {
  let added = 0;
  let shift = 0;
  let real = 0;
  let lineHits = 0;
  let baselineBlocked = 0;
  let lineBlocked = 0;
  let purePhantom = 0;
  const ratios: number[] = [];
  for (const c of commits) {
    added += c.added;
    shift += c.shift;
    real += c.real;
    lineHits += c.lineHits;
    if (c.added > 0) baselineBlocked++;
    if (c.lineHits > 0) lineBlocked++;
    if (c.added > 0 && c.lineHits === 0) purePhantom++;
    if (c.added > 0 && c.lineHits > 0) ratios.push(c.added / c.lineHits);
  }
  const mean = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return {
    commits: commits.length,
    added,
    shift,
    real,
    shiftPct: added > 0 ? round1((shift / added) * 100) : 0,
    lineHits,
    baselineBlocked,
    lineBlocked,
    purePhantom,
    bothBlocked: ratios.length,
    medianMultiplier: round2(median(ratios)),
    meanMultiplier: round2(mean),
  };
}

// ── git 访问层（只读；子进程一律走 _lib/proc.ts）────────

interface GitResult {
  ok: boolean;
  out: string;
  err: string | undefined;
}

/**
 * 只读 git 调用。一律带 `-c core.quotepath=false`（否则非 ASCII 路径被八进制转义，路径匹配全错），
 * 输出归一化 CRLF→LF（判定层逐行扫，`\r` 残留会让行尾正则的边界行为随平台漂移）。
 */
function gitOut(args: string[]): GitResult {
  const r = run("git", ["-c", "core.quotepath=false", ...args], {
    cwd: ROOT,
    timeout: GIT_TIMEOUT,
    maxBuffer: MAX_BUFFER,
  });
  return { ok: r.ok, out: (r.out ?? "").replace(/\r\n/g, "\n"), err: r.err };
}

/** `git show <rev>:<rel>`；读不到（该 revision 无此文件 / 失败）→ null。 */
function gitShow(rev: string, rel: string): string | null {
  const r = gitOut(["show", `${rev}:${rel}`]);
  return r.ok ? r.out : null;
}

/** `git log -1 --format=%s <hash>`；取不到 → 占位文案（不致命）。 */
function commitSubject(hash: string): string {
  const r = gitOut(["log", "-1", "--format=%s", hash]);
  const s = r.ok ? r.out.trim() : "";
  return s || "(取不到提交标题)";
}

// ── 主流程 ────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["json"],
    strings: ["window", "match-window", "top"],
  });
  const JSON_OUT = Boolean(args.json);
  // 判定失败一律 fail-closed（退 2）；--json 时 stdout 只放结构化错误，人读信息走 stderr
  const fail = (msg: string): void => {
    if (JSON_OUT) console.log(JSON.stringify({ _summary: { ok: false, error: msg } }, null, 2));
    else console.error(`❌ ${msg}`);
    process.exitCode = 2;
  };

  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.unknown.length > 0) {
    fail(`未知参数: ${args.unknown.join(", ")}（--help 查看用法）`);
    return;
  }

  const windowSize = resolvePositiveInt(args.window, DEFAULT_WINDOW);
  const matchWindow = resolvePositiveInt(args["match-window"], DEFAULT_MATCH_WINDOW);
  const topN = resolvePositiveInt(args.top, DEFAULT_TOP);

  // 令牌表（只读一次，供令牌建议；判定本身不依赖它）——读不到不致命，但必须显式告警，
  // 防「悄悄没建议」被读成「没有可映射的令牌」。
  let tokenMap: TokenRawMap | null = null;
  try {
    tokenMap = parseTokenMap(readText(VARIABLES_CSS));
  } catch (e) {
    console.error(
      `[token-shift-audit] ⚠️ 无法读取 frontend/css/variables.css（${String(e)}）——判定不受影响，仅令牌建议不可用`,
    );
  }

  // ── 采样：最近 N 个触碰判定域的提交（--no-merges：合并提交的「父版本」不唯一，口径会漂）──
  const logRes = gitOut([
    "log",
    `-n${windowSize}`,
    "--no-merges",
    "--format=%H",
    "--",
    ...DOMAIN_PATHS,
  ]);
  if (!logRes.ok) {
    fail(
      `git log 不可用或判定失败（${logRes.err ?? "未知失败"}）——本工具依赖 git 历史，无法给出结论（fail-closed）`,
    );
    return;
  }
  const hashes = logRes.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const commits: CommitAudit[] = [];
  let skipped = 0;
  let filesScanned = 0;
  let filesSkipped = 0;
  let diffFailed = 0;

  for (const hash of hashes) {
    // ① 本提交在本域内的文件（rename 取新旧双路径）；根提交无父 → 该命令失败 → 整提交跳过
    const ns = gitOut([
      "diff",
      "--name-status",
      "-M",
      "--diff-filter=ACMR",
      `${hash}^`,
      hash,
      "--",
      ...DOMAIN_PATHS,
    ]);
    if (!ns.ok) {
      skipped++;
      continue;
    }
    const units = parseNameStatus(ns.out).filter((u) => inTokenDomain(u.rel));
    if (units.length === 0) continue;

    let added = 0;
    let shift = 0;
    let real = 0;
    let lineHits = 0;
    for (const u of units) {
      // ② 两个版本的提交侧内容（git show 读的是 object store，与工作区脏不脏无关——
      //    并行会话改了同一文件也不会污染本审计）
      const curText = gitShow(hash, u.rel);
      if (curText === null) {
        filesSkipped++;
        continue; // 读不到当前内容 → 跳过该文件（不计入样本，也不静默当零违规）
      }
      // 父侧内容：A/C 的路径**在父树中定义上不存在**（git 的 A/C 状态即「新树有、旧树无」），
      // 直接取空串即可——去探测必然失败，且 execFileSync 默认把子进程 stderr 透传给父进程，
      // 会把 `fatal: path ... exists on disk, but not in <rev>` 刷到本工具的 stderr，
      // 让人误读成「工具坏了」（实测 40 提交窗口刷 9 行）。
      // M/R 必须真查：rename 的旧路径可能在判定域外，用「域内路径集」判定会漏。
      const parentText = /^[AC]/.test(u.status) ? "" : (gitShow(`${hash}^`, u.parentRel) ?? "");

      // ③ 判据 B 的输入：本次 diff 的新增行号（rename 须同时给旧路径，否则 git 不配对旧侧）
      const diffArgs = ["diff", "--unified=0", "-M", `${hash}^`, hash, "--", u.rel];
      if (u.parentRel !== u.rel) diffArgs.push(u.parentRel);
      const d = gitOut(diffArgs);
      if (!d.ok) diffFailed++;
      const addedLines = d.ok ? addedLinesFromDiff(d.out) : new Set<number>();

      const r = analyzeFilePair({ rel: u.rel, curText, parentText, matchWindow, addedLines, tokenMap });
      added += r.addedKeys.length;
      shift += r.shift.length;
      real += r.real.length;
      lineHits += r.lineHits;
      filesScanned++;
    }
    commits.push({ hash, subject: "", added, shift, real, lineHits });
  }

  if (diffFailed > 0) {
    console.error(
      `[token-shift-audit] ⚠️ ${diffFailed} 个文件的 diff 取不到——其行级判据按「无新增行」计，行级命中数偏低`,
    );
  }

  // 榜单只收**有信号**的提交（全零行不占位）：否则 Top N 里一堆 0，读者会误以为它们
  // 与结论有关；真实命中数在文本报告里显式给出。排序带 hash 兜底 → 同状态顺序确定。
  const byHash = (a: CommitAudit, b: CommitAudit): number => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  const topPhantomCommits = commits
    .filter((c) => c.shift > 0)
    .sort((a, b) => b.shift - a.shift || b.added - a.added || byHash(a, b))
    .slice(0, topN);
  const topRealCommits = commits
    .filter((c) => c.lineHits > 0)
    .sort((a, b) => b.lineHits - a.lineHits || b.real - a.real || byHash(a, b))
    .slice(0, topN);
  const withSubject = (c: CommitAudit): CommitAudit => ({ ...c, subject: commitSubject(c.hash) });
  const topPhantom = topPhantomCommits.map(withSubject);
  const topReal = topRealCommits.map(withSubject);

  const core = summarizeCommits(commits);
  const summary = {
    window: windowSize,
    matchWindow,
    top: topN,
    /** 窗口内（git log -nN）拿到的提交数。 */
    commitsFromLog: hashes.length,
    /** 样本提交数：确实含本域文件且成功取到 diff 的提交。 */
    sampled: core.commits,
    /** 跳过提交数：无父提交（根提交）或 name-status 取不到的提交。 */
    skipped,
    filesScanned,
    /** 当前版本内容取不到而跳过的文件数。 */
    filesSkipped,
    /** diff 取不到的文件数（行级判据按无新增行计，会使行级命中偏低）。 */
    diffFailed,
    added: core.added,
    shift: core.shift,
    shiftPct: core.shiftPct,
    real: core.real,
    lineHits: core.lineHits,
    baselineBlocked: core.baselineBlocked,
    lineBlocked: core.lineBlocked,
    purePhantom: core.purePhantom,
    bothBlocked: core.bothBlocked,
    medianMultiplier: core.medianMultiplier,
    meanMultiplier: core.meanMultiplier,
    ok: true,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: summary, topPhantom, topReal }, null, 2));
    process.exitCode = 0;
    return;
  }

  if (hashes.length === 0) {
    console.log(
      `[token-shift-audit] 窗口 --window ${windowSize} 内没有触碰设计令牌域（${DOMAIN_PATHS.join(" / ")}）的提交——样本 0，无结论 ✅`,
    );
    return;
  }

  // ── 人类可读报告 ──
  const row = (c: CommitAudit): string =>
    `   ${String(c.shift).padStart(4)} ${String(c.added).padStart(5)} ${String(c.real).padStart(5)} ` +
    `${String(c.lineHits).padStart(5)}  ${c.hash.slice(0, 8)}  ${c.subject}`;
  console.log("══════════════════════════════════════════════════");
  console.log(" 设计令牌行号位移审计 (token-shift-audit，只读)");
  console.log("══════════════════════════════════════════════════");
  console.log(`参数        : --window ${windowSize} / --match-window ${matchWindow} / --top ${topN}`);
  console.log(`判定域      : ${DOMAIN_PATHS.join(" / ")}（.ts 排除 .test/.spec；.css）`);
  console.log(`窗口提交数  : ${hashes.length}（--no-merges）`);
  console.log(`样本提交数  : ${core.commits}${skipped > 0 ? `（跳过 ${skipped}：无父提交 / 取不到 name-status）` : ""}`);
  console.log(
    `扫描文件数  : ${filesScanned}${filesSkipped > 0 ? `（跳过 ${filesSkipped}：取不到当前内容）` : ""}` +
      `${diffFailed > 0 ? `（${diffFailed} 文件 diff 取不到）` : ""}`,
  );
  console.log("──────────────────────────────────────────────────");
  console.log(" 判据 A（baseline 代理：键集差 cur − parent）");
  console.log(`   added 总数    : ${core.added}`);
  console.log(`   幻影（位移）  : ${core.shift}  （${core.shiftPct}%）`);
  console.log(`   真新增候选    : ${core.real}`);
  console.log(" 判据 B（真行级：只判本次 diff 的新增行）");
  console.log(`   行级命中      : ${core.lineHits}`);
  console.log("──────────────────────────────────────────────────");
  console.log(`baseline 会阻断 : ${core.baselineBlocked} 个提交（added > 0）`);
  console.log(`行级会阻断      : ${core.lineBlocked} 个提交（行级命中 > 0）`);
  console.log(`纯幻影提交      : ${core.purePhantom} 个（added > 0 且行级命中 = 0）`);
  if (core.bothBlocked > 0) {
    console.log(
      `两规则都拦      : ${core.bothBlocked} 个提交；条数比 baseline/行级 = ` +
        `median ${core.medianMultiplier} / mean ${core.meanMultiplier}`,
    );
  } else {
    console.log("两规则都拦      : 0 个提交（无同时被两规则拦下的样本，倍数无定义）");
  }
  console.log("──────────────────────────────────────────────────");
  console.log(`Top ${topN} 幻影提交（按幻影数；窗口内命中 ${topPhantomCommits.length} 个；列：幻影 / added / 真候选 / 行级）：`);
  for (const c of topPhantom) console.log(row(c));
  console.log("──────────────────────────────────────────────────");
  console.log(`Top ${topN} 真新增提交（按行级命中数；窗口内命中 ${topRealCommits.length} 个；列：幻影 / added / 真候选 / 行级）：`);
  for (const c of topReal) console.log(row(c));
  console.log("──────────────────────────────────────────────────");
  console.log("判据 A = baseline 规则代理（键集差 + 同 kind 近邻匹配窗口）；判据 B = 真行级（diff 新增行）。");
  console.log("本工具只读：不写盘、不改 git 状态、不阻断任何提交（退出码 0）。");
  console.log("复算：node scripts/token-shift-audit.ts --json（结构化 _summary / topPhantom / topReal）");
}

// 直接 node 运行本文件时执行；被契约测试 import 时只暴露具名导出（契约定点，与
// check-layering / check-menu-health / check-go-coverage-threshold 同惯例）。
// ⚠️ 退出码一律走 process.exitCode + 自然返回，不用 process.exit(N)：具名导出使本模块可被
// 测试 import，Windows 上 exit() 会在句柄清理阶段触发 libuv 断言（同 check-go-coverage-threshold）。
const isMain =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1] as string).href === import.meta.url;
if (isMain) main();
