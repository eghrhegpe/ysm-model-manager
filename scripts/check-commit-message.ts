#!/usr/bin/env node
/**
 * check-commit-message.ts — 提交信息减负闸 CLI（ADR-338-d1）。
 *
 * 判定逻辑不在本文件（在 `_lib/commit-blocks/commit-message.ts`，纯函数可单测）；
 * 本文件只做「取数 → 调判定 → 渲染/落 JSON → 定退出码」。
 *
 * 用法：
 *   node scripts/check-commit-message.ts --file .git/COMMIT_EDITMSG   # 钩子入口（$1）
 *   node scripts/check-commit-message.ts --range origin/main..HEAD    # 双挂：逐提交复验（拦 --no-verify 绕过）
 *   node scripts/check-commit-message.ts --replay 300 [--limit N]     # 只读校准：历史命中分布（定 hard 集）
 *   node scripts/check-commit-message.ts --file x --strict            # hard 档生效（转档后由钩子带上）
 *   任意模式可加 --json                                               # _summary 机读
 *
 * 依赖声明: 零依赖（仅 node:child_process / node:fs + 仓内 _lib，无 npm 外部包）。
 *
 * 设计意图：commit-msg 钩子可被 `git commit --no-verify` 一条命令整钩绕过
 *   （零痕迹），而提交信息减负（ADR-338-d1）的价值恰在「每次提交都合规」。
 *   本脚本同时供**推送集复验**（--range auto，由 gate-config 双挂调用）兜住
 *   绕过路径；采集期（未 --strict）恒 exit 0，只把命中分布喂给 replay 校准。
 *
 * 退出码（**fail-closed 口径**：判不了绝不冒充通过）：
 *   0 — 合规；或采集期（未 --strict）无论违规与否都不阻断（ADR-338-d1 D3 刀1）
 *   1 — --strict 下存在固有 hard 档违规
 *   2 — 用法错误 / 取数失败（文件读不到、git 不可用、range 不可解析）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  evaluate,
  measureSubjectLen,
  parseCommitMessage,
  type ReplayRow,
  renderViolations,
  SUBJECT_LIMIT,
  summarizeReplay,
  type Violation,
} from "./_lib/commit-blocks/commit-message.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const parsed = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict", "help"],
  strings: ["file", "range", "replay", "limit"],
});

if (parsed.help) {
  console.log(
    "用法: node scripts/check-commit-message.ts --file <msg> | --range <rev> | --replay <n> [--limit N] [--strict] [--json]\n" +
      "  --file    校验单个 message 文件（commit-msg 钩子入口，收 git 的 $1）\n" +
      "  --range   逐提交复验一个推送集（gate-config 双挂用）\n" +
      "  --replay  只读校准：复算最近 n 条历史提交的命中分布（定 hard 集阈值）\n" +
      "  --limit   覆盖 subject 码点上限（仅 replay 试阈值用，默认 " +
      SUBJECT_LIMIT +
      "）\n" +
      "  --strict  hard 档生效（采集期不带此flag 时恒 exit 0）\n" +
      "  --json    输出 _summary 机读摘要",
  );
  process.exit(0);
}
if (parsed.unknown.length) {
  console.error(`[commit-msg] 未知参数: ${parsed.unknown.join(", ")}（--help 看用法）`);
  process.exit(2);
}

const mode: "warn" | "hard" = parsed.strict ? "hard" : "warn";
const jsonOut = Boolean(parsed.json);
const subjectLimit = parsed.limit ? Number.parseInt(String(parsed.limit), 10) : SUBJECT_LIMIT;
if (!Number.isFinite(subjectLimit) || subjectLimit <= 0) {
  console.error(`[commit-msg] --limit 须为正整数，收到「${parsed.limit}」`);
  process.exit(2);
}

/** git 取数（数组式调用，无 shell 拼接面；-c core.quotepath=false 防非 ASCII 转义）。 */
function gitText(args: string[]): string | null {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? (r.stdout ?? "") : null;
}

function judge(raw: string): Violation[] {
  return evaluate(parseCommitMessage(raw), { mode, subjectLimit });
}

/** 渲染一条提交的违规块。 */
function blockFor(label: string, vs: Violation[]): string[] {
  if (!vs.length) return [];
  return [`── ${label} ──`, ...renderViolations(vs, mode)];
}

// ── A. --file：钩子入口 ─────────────────────────────────
if (parsed.file) {
  const file = String(parsed.file);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (e) {
    const msg = `[commit-msg] 读不到 message 文件「${file}」: ${(e as Error).message}`;
    if (jsonOut) console.log(JSON.stringify({ _summary: { ok: false, error: msg } }));
    else console.error(`❌ ${msg}`);
    // fail-closed：判不了 ≠ 通过
    process.exit(mode === "hard" ? 2 : 0);
  }
  const vs = judge(raw);
  if (jsonOut) {
    console.log(
      JSON.stringify({
        _summary: {
          ok: vs.length === 0,
          mode,
          blocking: mode === "hard" && vs.some((v) => v.severity === "hard"),
          violations: vs.map((v) => v.rule),
          hard: vs.filter((v) => v.severity === "hard").length,
          warn: vs.filter((v) => v.severity === "warn").length,
        },
      }),
    );
  } else {
    for (const line of blockFor("(待提交 message)", vs)) console.error(line);
  }
  const blocked = mode === "hard" && vs.some((v) => v.severity === "hard");
  process.exit(blocked ? 1 : 0);
}

// ── B. --range / --replay：逐提交复验与只读校准 ─────────
// 记录分隔 0x1E、字段分隔 0x1F：\x01/\x02 在某些 shell/编码路径下会被吞（实测踩坑），
// 用记录/单元分隔符位最稳。
const REPLAY_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const pretty = `format:${REPLAY_SEP}%H${FIELD_SEP}%B`;

const isReplay = Boolean(parsed.replay);
const count = parsed.replay ? String(parsed.replay) : "";
let range = parsed.range ? String(parsed.range) : "";

/**
 * `--range auto`（gate-config 双挂入口用）：解析「本地领先远端」的推送集。
 *
 * ⚠️ 前置条件必须自证可达（pre-push-gate 卡记的浅克隆教训：兜底路径不先探可达，
 *    兜底失败会被上层读成主路径失败）：
 *    origin/main 不可解析 → 退 HEAD~1；HEAD~1 也不可解析（浅克隆/单提交仓）→ 返回 ""
 *    交由调用方判「无范围可查」，**绝不**把 `HEAD~1..HEAD` 丢给 git 让 git 报错冒充违规。
 */
function resolveAutoRange(): string {
  const revParse = (rev: string): boolean =>
    gitText(["rev-parse", "--verify", "--quiet", rev])?.trim() !== "";
  if (revParse("origin/main")) {
    const mb = gitText(["merge-base", "origin/main", "HEAD"])?.trim();
    if (mb) return `${mb}..HEAD`;
  }
  if (revParse("HEAD~1")) return "HEAD~1..HEAD";
  // 单提交仓（无父）：判定域 = 可达全集（就是这一笔），不是「解析失败」。
  // 对齐浅克隆教训：**空集与失败必须严格区分**，此处既非空集也非失败。
  return "HEAD";
}
if (range === "auto") range = resolveAutoRange();

let args: string[];
if (isReplay) {
  if (!/^\d{1,6}$/.test(count)) {
    console.error(`[commit-msg] --replay 须是 1-999999 的整数，收到「${count}」`);
    process.exit(2);
  }
  args = ["log", `-${count}`, "--no-merges", `--pretty=${pretty}`];
} else if (range) {
  if (!/^[A-Za-z0-9_./@^~:+-]+(\.\.[A-Za-z0-9_./@^~:+-]+)?$/.test(range)) {
    console.error(`[commit-msg] --range 形态不可解析「${range}」`);
    process.exit(2);
  }
  args = ["log", range, `--pretty=${pretty}`];
} else {
  console.error("用法错误：须给 --file / --range / --replay 之一（--help 看用法）");
  process.exit(2);
}

const out = gitText(args);
if (out === null) {
  const msg = `[commit-msg] git 取数失败（${isReplay ? `--replay ${count}` : `--range ${range}`}）——拒绝空跑放行`;
  if (jsonOut) console.log(JSON.stringify({ _summary: { ok: false, error: msg } }));
  else console.error(`❌ ${msg}`);
  process.exit(2);
}

const rows: ReplayRow[] = [];
const blocks: string[] = [];
for (const chunk of out.split(REPLAY_SEP)) {
  if (!chunk.includes(FIELD_SEP)) continue;
  const [oid, body] = chunk.split(FIELD_SEP, 2);
  if (!oid) continue;
  const raw = body ?? "";
  const p = parseCommitMessage(raw);
  const vs = evaluate(p, { mode, subjectLimit });
  rows.push({
    oid,
    subjectLen: measureSubjectLen(p.subject),
    exempt: p.exempt !== null,
    violations: vs,
  });
  for (const line of blockFor(oid.slice(0, 9), vs)) blocks.push(line);
}

const summary = summarizeReplay(rows);

if (jsonOut) {
  console.log(JSON.stringify({ _summary: { ok: summary.hardHits === 0, ...summary } }));
} else if (blocks.length) {
  for (const line of blocks) console.error(line);
  if (isReplay) {
    const pct = (n: number): string =>
      rows.length ? `${Math.round((n / rows.length) * 100)}%` : "0%";
    console.error("── replay 校准（ADR-338-d1 D3：hard 集由此定档）──");
    console.error(
      `  样本 ${rows.length} 条（--no-merges）  合规 ${summary.compliant}  豁免 ${summary.exempt}`,
    );
    console.error(
      `  subject 码点：中位 ${summary.subjectLen.median}  p90 ${summary.subjectLen.p90}  p95 ${summary.subjectLen.p95}  max ${summary.subjectLen.max}  均 ${summary.subjectLen.mean}`,
    );
    console.error(
      `  转 hard 后会被拒：${summary.hardHits} 条（${pct(summary.hardHits)}）  仅 warn 命中：${summary.warnHits} 条（${pct(summary.warnHits)}）`,
    );
    const entries = Object.entries(summary.byRule).sort((a, b) => b[1] - a[1]);
    for (const [rule, n] of entries) {
      console.error(`    · ${rule.padEnd(26)} ${String(n).padStart(4)}  ${pct(n)}`);
    }
    console.error(`  （本次判定的 subject 上限 = ${subjectLimit}，--limit 可试别档）`);
  }
} else {
  console.error("[commit-msg] 提交信息全部合规。");
}

process.exit(mode === "hard" && summary.hardHits > 0 ? 1 : 0);
