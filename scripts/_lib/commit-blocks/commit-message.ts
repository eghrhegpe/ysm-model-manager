#!/usr/bin/env node
/**
 * commit-blocks/commit-message.ts — 提交信息减负闸的**纯判定层**（ADR-338-d1）。
 *
 * 职责边界：只做「一段 message 文本 → 违规清单」的判定与渲染，**不碰 git、不碰文件**。
 * git 取数（--file / --range / --replay）一律在 CLI 侧 `scripts/check-commit-message.ts`
 * （对齐 ADR-323「判定与渲染分离」判据①：判定可单测是本块的硬要求）。
 *
 * 三层判据（ADR-338-d1 D2）：
 *   结构 hard —— subject 非空 / ≤72 码点 / 常规前缀 / 单主题（` + ` ≥2 判并联）/ 正文单行 ≤120
 *   台账 warn —— 验证报告腔 · 逃生键名 · 「并行会话」归属写进正文；body >20 行
 *   豁免     —— Merge / Revert / fixup! / squash! / amend! / initial commit 直放
 *
 * 「阻断与否」不由本块决定：本块只标注每条违规的**固有档位**（intrinsic severity），
 * 是否据此阻断由调用方 `mode`（warn 采集 ｜ hard 阻断）决定——
 * ADR-338-d1 D3 两步走「只翻开关、不改规则」的结构前提。
 *
 * 计量口径（写死在此，勿在别处复制）：
 *   subject 长度 = **码点数**（Array.from 计），CJK 一字一字符。
 *   不用 String.length（UTF-16 代理对会把 emoji 算 2）、不用字节数（UTF-8 中文算 3）。
 *   依据：闸门要治的是「一句话说几件事」，与字节编码无关；实测口径见
 *   `docs/knowledge/commit-message-gate.md` §测量。
 */

// ── 类型 ────────────────────────────────────────────────

/** 违规档位（固有）：hard = 结构病；warn = 形式病（观察期只采集）。 */
export type Severity = "hard" | "warn";

/** 规则 id：机读稳定标识，转 hard 集与 replay 统计都按此聚合，勿改文案当键。 */
export type RuleId =
  | "subject-empty"
  | "subject-length"
  | "subject-prefix"
  | "subject-multi-topic"
  | "body-line-length"
  | "body-length"
  | "ledger-verification"
  | "ledger-skipvalve"
  | "ledger-parallel"
  | "trailer-unknown-key"
  | "trailer-not-single-line";

export interface Violation {
  rule: RuleId;
  severity: Severity;
  /** 违规定位到的原文片段（截断展示用）。 */
  found: string;
  /** 修法提示（指向 trailer/拆分，不是复述规则）。 */
  hint: string;
}

export interface Trailer {
  key: string;
  value: string;
  line: string;
}

export interface ParsedMsg {
  subject: string;
  /** 正文行（不含 subject、不含 trailer 段、不含被剥离的注释/剪贴线以下）。 */
  bodyLines: string[];
  trailers: Trailer[];
  /** 豁免命中的形态名（"merge" 等）；null = 不豁免，正常判定。 */
  exempt: string | null;
}

export interface EvaluateOptions {
  subjectLimit?: number;
  bodyLineLimit?: number;
  bodyLinesWarn?: number;
}

/**
 * replay 输入行（CLI 侧逐提交构造）。
 * `subjectLen` 显式入列而非从 violations 反推——校准看的是「长度分位落在哪」，
 * 与是否违规（阈值可能改）解耦；`exempt` 让 Merge/Revert 行不进分位统计。
 */
export interface ReplayRow {
  oid: string;
  subjectLen: number;
  exempt: boolean;
  violations: Violation[];
}

// ── 常量（口径单一事实源） ──────────────────────────────

export const SUBJECT_LIMIT = 72;
export const BODY_LINE_LIMIT = 120;
export const BODY_LINES_WARN = 20;

/** Conventional type 集（CONTRIBUTING.md §提交规范 type 表的超集，含 git 惯用扩展）。 */
const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "perf",
  "build",
  "ci",
  "style",
  "revert",
];

const PREFIX_RE = new RegExp(`^(?:${CONVENTIONAL_TYPES.join("|")})(?:\\([^)]{1,40}\\))?!?: \\S`);

/** git 自动生成的形态：不属人写台账，整条豁免（含 rebase/merge 序言）。 */
const EXEMPT_RES: ReadonlyArray<readonly [string, RegExp]> = [
  ["merge", /^Merge (branch|remote-tracking|pull request|commit|refs)\b/],
  ["revert", /^Revert "/],
  ["fixup", /^(?:fixup|squash|amend)! /],
];

/**
 * 剪贴线（`git commit --verbose` 的分隔行）：以下全部是 diff 输出，非 message。
 * 实际形态两侧都带横线（`---... >8 ---...`），早期还有 `8<` 变体——只写 `$` 结尾
 * 的正则匹配不到真实 git 输出（契约测试实证，勿回退成窄式）。
 */
const SCISSORS = /^-{2,} (?:>8|8<) -{2,}$/;

/**
 * 验证报告腔（ADR-338-d1 D5：这类内容走 `Verification:` trailer，不走正文散文）。
 * 刻意收紧到「报告句式」而非工具名——`fix: 修 biome 格式化` 里的 biome 是改动对象，不是留痕。
 */
const VERIFICATION_SMELL: readonly RegExp[] = [
  /验证\s*[:：]/,
  /[全]?绿\b(?=[^]{0,12}(?:单测|测试|用例|例|e2e|vitest|typecheck|build|biome|doctor|契约|门禁))/,
  /(?:单测|测试|用例|例|spec|e2e|vitest|contract-tests|doctor|typecheck|tsc|build|biome)[^]{0,16}(?:全绿|跑绿|转绿|零红|全过|通过|无错|干净|PASS)/,
  /\d+\s*\/\s*\d+\s*(?:通过|全绿|PASS|绿)/,
  /(?:\d+|[一二三四五六七八九十]+)\s*(?:单测|测试|用例|例)(?:\s*(?:全绿|全过|通过|绿|失败|红))?/,
  /零?(?:残留|红灯)[^]{0,8}(?:绿|通过|已修)/,
];

/** 逃生键名进 message（应走 Skip-Evidence trailer，见 D5）。 */
const SKIPVALVE_RE = /YSM_SKIP_[A-Z0-9_]+|--no-verify\b/;

/** 并发归属说明进正文（应走 Parallel-Scope trailer，ADR-151 语境）。 */
const PARALLEL_RE = /并行会话|归属彼处|他人(?:在途|未提交|半成品)|在途(?:改动|中间态)/;

/** trailer 白名单（ADR-338-d1 D5）。 */
export const TRAILER_KEYS: readonly string[] = [
  "Verification",
  "Refs",
  "Knowledge",
  "Skip-Evidence",
  "Parallel-Scope",
];

const TRAILER_LINE_RE = /^([A-Za-z][A-Za-z0-9-]*): (.*)$/;

// ── 计量 ────────────────────────────────────────────────

/** subject 长度 = 码点数（口径注释见文件头）。 */
export function measureSubjectLen(s: string): number {
  return Array.from(s).length;
}

function countNeedle(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

function clip(s: string, max = 60): string {
  const t = s.trim();
  return Array.from(t).length <= max ? t : `${Array.from(t).slice(0, max).join("")}…`;
}

// ── 解析 ────────────────────────────────────────────────

/**
 * 解析 git 传入的 message 文本。
 *
 * 三道剥离（缺一不可，全是真实形态）：
 *   1. `#` 注释行——`git commit -m` 也带钩子提示与 status 注释；
 *   2. 剪贴线以下——`--verbose` 时 diff 全文跟在后面，不剥会把 diff 当正文判台账腔；
 *   3. trailer 段——白名单区不得再被台账规则二次判（`Skip-Evidence: YSM_SKIP_X` 天然含键名）。
 */
export function parseCommitMessage(raw: string): ParsedMsg {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const l of lines) {
    if (SCISSORS.test(l)) break;
    if (l.startsWith("#")) continue;
    kept.push(l);
  }
  while (kept.length && kept[kept.length - 1]!.trim() === "") kept.pop();
  while (kept.length && kept[0]!.trim() === "") kept.shift();

  const subject = kept.length ? kept[0]!.trimEnd() : "";
  const rest = kept.slice(1);

  // trailer 段 = 尾部连续的「Key: value」块，且与正文之间隔一个空行（git trailer 约定）
  let trailerStart = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    const l = rest[i]!;
    if (l.trim() === "") {
      // 空行：若已收进 trailer 则段边界到此；否则继续上溯（正文内空行）
      if (trailerStart !== -1) break;
      continue;
    }
    if (TRAILER_LINE_RE.test(l) || (trailerStart !== -1 && /^\s+\S/.test(l))) {
      trailerStart = i;
      continue;
    }
    break;
  }
  // 边界修正：trailer 段必须紧跟一个空行才算独立段（否则是正文里的一句 "Refs: x"）
  let trailers: Trailer[] = [];
  let bodyLines = rest;
  if (trailerStart !== -1) {
    const precededByBlank = trailerStart === 0 || rest[trailerStart - 1]!.trim() === "";
    if (precededByBlank) {
      bodyLines = rest.slice(0, trailerStart === 0 ? 0 : trailerStart - 1);
      const block = rest.slice(trailerStart);
      let contOf = "";
      for (const l of block) {
        const m = TRAILER_LINE_RE.exec(l);
        if (m) {
          contOf = m[1]!;
          trailers.push({ key: m[1]!, value: m[2] ?? "", line: l });
        } else if (/^\s+\S/.test(l) && contOf) {
          // 折行续写：记在首键上但标记为「非单行」违规源
          trailers.push({ key: contOf, value: l.trim(), line: l });
        }
      }
    }
  }

  let exempt: string | null = null;
  for (const [name, re] of EXEMPT_RES) {
    if (re.test(subject)) {
      exempt = name;
      break;
    }
  }

  // 正文 = **内容行**：空行是段落分隔，不得计入「正文 >20 行」这类计数判据
  //（否则一份四段式正文被数成 7 行，观察期噪声自造）。
  return {
    subject,
    bodyLines: bodyLines.filter((l) => l.trim() !== ""),
    trailers,
    exempt,
  };
}

// ── 判定 ────────────────────────────────────────────────

function hitOne(text: string, res: readonly RegExp[]): string | null {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * 主判定。返回违规清单（空数组 = 合规）。
 * `mode` 不参与判定（档位是规则的固有属性），仅供调用方决定阻断——见文件头。
 */
export function evaluate(
  parsed: ParsedMsg,
  _opts: EvaluateOptions & { mode?: "warn" | "hard" } = {},
): Violation[] {
  const limit = _opts.subjectLimit ?? SUBJECT_LIMIT;
  const lineLimit = _opts.bodyLineLimit ?? BODY_LINE_LIMIT;
  const linesWarn = _opts.bodyLinesWarn ?? BODY_LINES_WARN;

  if (parsed.exempt) return [];

  const out: Violation[] = [];
  const { subject, bodyLines, trailers } = parsed;
  const bodyText = bodyLines.join("\n");
  const full = subject ? `${subject}\n${bodyText}` : bodyText;

  if (!subject) {
    out.push({
      rule: "subject-empty",
      severity: "hard",
      found: "",
      hint: "message 首行须是 `<type>(<scope>): <一句话>`；空 subject 多为编辑器误存",
    });
    return out;
  }

  const len = measureSubjectLen(subject);
  if (len > limit) {
    out.push({
      rule: "subject-length",
      severity: "hard",
      found: `${len} 字符`,
      hint: `subject 限 ${limit} 码点（实测仓内中位 71 可达标）。细节写正文一行或迁知识卡：${clip(subject, 40)}`,
    });
  }

  if (!PREFIX_RE.test(subject)) {
    out.push({
      rule: "subject-prefix",
      severity: "hard",
      found: clip(subject, 40),
      hint: `须以 <type>[(scope)][!]: 开头，type ∈ {${CONVENTIONAL_TYPES.join(", ")}}`,
    });
  }

  const plus = countNeedle(subject, " + ");
  if (plus >= 2) {
    out.push({
      rule: "subject-multi-topic",
      severity: "hard",
      found: `${plus} 处 " + "`,
      hint: "一句话一件事：` + ` 并联 ≥2 = 多主题台账塞进一行，按主题拆提交或只留主不变量",
    });
  }

  for (const l of bodyLines) {
    if (measureSubjectLen(l) > lineLimit) {
      out.push({
        rule: "body-line-length",
        severity: "hard",
        found: clip(l, 40),
        hint: `正文单行 ≤${lineLimit} 码点，超了在自然句处换行（git 折叠后不可读）`,
      });
    }
  }

  if (bodyLines.length > linesWarn) {
    out.push({
      rule: "body-length",
      severity: "warn",
      found: `${bodyLines.length} 行`,
      hint: `正文 >${linesWarn} 行：实施结论进知识卡、证据进 trailer，git log 只留决策要点`,
    });
  }

  const ver = hitOne(full, VERIFICATION_SMELL);
  if (ver) {
    out.push({
      rule: "ledger-verification",
      severity: "warn",
      found: clip(ver, 40),
      hint: "验证报告走 trailer：`Verification: 8358 unit + 6 e2e green`（ADR-338-d1 D5）",
    });
  }

  const skip = SKIPVALVE_RE.exec(full);
  if (skip) {
    out.push({
      rule: "ledger-skipvalve",
      severity: "warn",
      found: clip(skip[0], 40),
      hint: "逃生理由走 trailer：`Skip-Evidence: YSM_SKIP_X <一句依据>`",
    });
  }

  const par = PARALLEL_RE.exec(full);
  if (par) {
    out.push({
      rule: "ledger-parallel",
      severity: "warn",
      found: clip(par[0], 40),
      hint: "并发归属走 trailer：`Parallel-Scope: <哪些文件属他人会话>`",
    });
  }

  const seenKeys = new Set<string>();
  for (const t of trailers) {
    if (!TRAILER_KEYS.includes(t.key)) {
      if (!seenKeys.has(t.key)) {
        seenKeys.add(t.key);
        out.push({
          rule: "trailer-unknown-key",
          severity: "warn",
          found: `${t.key}:`,
          hint: `未知 trailer 键，白名单 = {${TRAILER_KEYS.join(", ")}}（新增键须改 ADR-338-d1 D5）`,
        });
      }
    }
  }
  const folded = trailers.filter(
    (t) => !TRAILER_LINE_RE.test(t.line) || measureSubjectLen(t.line) > lineLimit,
  );
  if (folded.length) {
    out.push({
      rule: "trailer-not-single-line",
      severity: "warn",
      found: clip(folded[0]!.line, 40),
      hint: "trailer 必须一行一字段（机器要聚合，折行即漏计）",
    });
  }

  return out;
}

// ── 渲染（与判定分离：文案改动不影响判据） ──────────────

const RULE_LABEL: Record<RuleId, string> = {
  "subject-empty": "空 subject",
  "subject-length": "subject 超长",
  "subject-prefix": "subject 缺常规前缀",
  "subject-multi-topic": "subject 并联多主题",
  "body-line-length": "正文单行超长",
  "body-length": "正文过长",
  "ledger-verification": "验证报告腔入正文",
  "ledger-skipvalve": "逃生键名入正文",
  "ledger-parallel": "并发归属入正文",
  "trailer-unknown-key": "未知 trailer 键",
  "trailer-not-single-line": "trailer 非单行",
};

/**
 * 渲染成人读区块。`mode` 只影响头行措辞与是否宣称阻断，不改变判定结果。
 */
export function renderViolations(vs: Violation[], mode: "warn" | "hard"): string[] {
  if (!vs.length) return [];
  const head =
    mode === "hard"
      ? "❌ [commit-msg] 提交信息不合格（ADR-338-d1）："
      : "⚠️  [commit-msg] 提交信息减负提示（采集期，不阻断）：";
  const lines = [head];
  for (const v of vs) {
    lines.push(`  · [${v.severity}] ${RULE_LABEL[v.rule]}${v.found ? ` — ${v.found}` : ""}`);
    lines.push(`      ${v.hint}`);
  }
  lines.push("  判据全文 → CONTRIBUTING.md §提交规范 / docs/knowledge/commit-message-gate.md");
  return lines;
}

// ── replay 聚合（纯函数，供 CLI 与契约测试共用） ────────

export interface ReplaySummary {
  total: number;
  compliant: number;
  exempt: number;
  /** 每条规则的命中提交数。 */
  byRule: Record<string, number>;
  /** 固有 hard 档命中的提交数（= 转 hard 后会被拒的数量）。 */
  hardHits: number;
  /** warn 档命中的提交数。 */
  warnHits: number;
  /** subject 码点数分位（校准阈值的直接依据）。 */
  subjectLen: { median: number; p90: number; p95: number; max: number; mean: number };
}

/**
 * 聚合 replay 结果。分位用最近秩法（下标 = ceil(q·n)-1），n=0 时全 0。
 * 不做插值——校准看的是「这条规则打到多少提交」，不是精确分布拟合。
 */
export function summarizeReplay(rows: ReplayRow[]): ReplaySummary {
  const byRule: Record<string, number> = {};
  let compliant = 0;
  let hardHits = 0;
  let warnHits = 0;
  let exemptCount = 0;
  const lens: number[] = [];
  for (const r of rows) {
    if (r.exempt) exemptCount++;
    else if (r.violations.length === 0) compliant++;
    if (r.violations.some((v) => v.severity === "hard")) hardHits++;
    if (r.violations.some((v) => v.severity === "warn")) warnHits++;
    for (const v of r.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
    lens.push(r.subjectLen);
  }
  const sorted = [...lens].sort((a, b) => a - b);
  const at = (q: number): number => {
    if (!sorted.length) return 0;
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
    return sorted[idx] ?? 0;
  };
  const mean = sorted.length
    ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10
    : 0;
  return {
    total: rows.length,
    compliant,
    exempt: exemptCount,
    byRule,
    hardHits,
    warnHits,
    subjectLen: { median: at(0.5), p90: at(0.9), p95: at(0.95), max: at(1), mean },
  };
}
