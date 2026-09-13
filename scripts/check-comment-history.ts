#!/usr/bin/env node
/**
 * @file check-comment-history.ts — ADR-234 D1：注释考古门禁（观察期 WARN 非阻断）。
 *
 * 病灶：scripts/ 与 .githooks/ 内「锐评 #N / code_review #N / 缺陷#N」类裸评审引用，
 * 是「当次评审过程的 changelog」沉淀进代码——新读者无从知「锐评 #1」指哪次评审、为何重要，
 * 可读性随锐评次数单调递减。ADR 原则：代码记结论（ADR 锚点），不记过程（裸引用）。
 *
 * 判定：命中裸评审引用正则 `(锐评|重锐评|code_review|缺陷)\s*#` 且所在行**不含**
 * `ADR-\d+` 锚点 → 记为「考古引用」。
 *
 * 用法：
 *   node scripts/check-comment-history.ts            # WARN 汇总，exit 0（观察期）
 *   node scripts/check-comment-history.ts --json     # _summary 契约（gate/CI 消费）
 *   node scripts/check-comment-history.ts --strict   # 阻断模式：有考古引用 exit 1（升级路径）
 *
 * 设计意图：把「评审过程」挡在代码之外——注释应锚定 ADR（结论），而非裸引用当次评审编号
 * （过程）。本脚本是该约定的唯一自动执行者，故先以 WARN 观察期落地、不清零不阻断；
 * 待存量考古引用清零后转 --strict 硬门禁，届时新增裸引用即不可推送。
 *
 * 退出码：默认 0（仅 WARN）；--strict 时 1 = 存在考古引用。
 * 依赖：node:fs / node:path / _lib/parse-args.ts / _lib/scan-files.ts（零外部依赖）。
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot } from "./_lib/scan-files.ts";

const ROOT = getRoot();

// 裸评审引用正则（ADR-234 D1 治愈扩展，精确匹配避免整行吞并）：
// ① code_review <oid> #N：/code_review\s+[0-9a-f]{7,}\s*#[0-9一二三四五六七八九十①-⑳]+/
// ② 锐评/缺陷 + #N（不含 code_review）：/(锐评|缺陷)\s*#([0-9一二三四五六七八九十①-⑳]+)/
// 含「重锐评」（重 前缀被 锐评 捕获）。code_review 无 oid 形态（纯 code_review #N）也走 ② 不命中——
// 实务里 code_review 总是带 oid（评审会话的 commit 锚点），无 oid 的 code_review #N 若存在会漏判，
// 但 grep 实证全仓 46 处均带 oid，无此形态，暂不覆盖。
// 同行含 ADR 锚点 → 视为可追溯，不计考古引用。
const REF_RE = /code_review\s+[0-9a-f]{7,}\s*#[0-9一二三四五六七八九十①-⑳]+|(?:锐评|缺陷)\s*#[0-9一二三四五六七八九十①-⑳]+/;
// 同行含 ADR 锚点 → 视为可追溯，不计考古引用
const ADR_ANCHOR_RE = /ADR-\d+/;

const SCAN_DIRS = ["scripts", ".githooks"];

type Hit = { file: string; line: number; match: string };

function scanFile(rel: string): Hit[] {
  const abs = path.join(ROOT, rel);
  let text: string;
  try {
    text = fs.readFileSync(abs, "utf-8");
  } catch {
    return [];
  }
  const hits: Hit[] = [];
  const lines = text.split("\n");
  const isSelf = rel.endsWith("check-comment-history.ts"); // 门禁器自身文档注释不计
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined) continue; // noUncheckedIndexedAccess
    const m = ln.match(REF_RE);
    if (!m) continue;
    if (ADR_ANCHOR_RE.test(ln)) continue; // 有 ADR 锚点 → 可追溯，豁免
    if (isSelf) continue; // 自身文档注释（举例病灶形态）不计——门禁器不审自己
    hits.push({ file: rel, line: i + 1, match: m[0] });
  }
  return hits;
}

function scanDir(dir: string, exts: string[]): Hit[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: Hit[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scanDir(rel, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(...scanFile(rel));
  }
  return out;
}

const flags = parseArgs(process.argv.slice(2), { bools: ["json", "strict"] });
if (flags.unknown?.length) {
  console.error(`❌ 未知参数: ${flags.unknown.join(", ")}（--help 查看用法）`);
  process.exit(1);
}
const json = flags.json as boolean | undefined;
const strict = flags.strict as boolean | undefined;

const hits: Hit[] = [
  ...scanDir("scripts", [".ts"]),
  ...scanDir(".githooks", []),
].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

if (json) {
  console.log(
    JSON.stringify(
      {
        _summary: { scanDirs: SCAN_DIRS, hits: hits.length, mode: strict ? "strict" : "warn" },
        hits: hits.map((h) => ({ file: h.file, line: h.line, match: h.match })),
      },
      null,
      2,
    ),
  );
  process.exit(strict ? (hits.length ? 1 : 0) : 0);
}

if (!hits.length) {
  console.log("[check-comment-history] ✅ 无裸评审引用（scripts/ + .githooks/）");
  process.exit(0);
}
console.warn(
  `[check-comment-history] ⚠️  ${hits.length} 处裸评审引用（行内无 ADR 锚点）——可追溯性递减，建议改写为「ADR-NNN 理由」：`,
);
for (const h of hits) console.warn(`   ${h.file}:${h.line}  ${h.match}`);
if (strict) {
  console.error("[check-comment-history] --strict 阻断：裸评审引用须补 ADR 锚点或改写为决策结论");
  process.exit(1);
}
process.exit(0);
