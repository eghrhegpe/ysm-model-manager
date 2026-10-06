#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// 5.10 契约：frontmatter 人工策展字段（quick_risk_lines/pitfalls/use_when）的行号/行数/计数
// 引用 WARN。隔离策略同 body-line-refs：临时卡 + --kc-dir。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-fmref-contract-"));
const TMP_CARD = path.join(TMP_DIR, "zzz-fm-line-refs-tmp.md");
const CARD_STEM = "zzz-fm-line-refs-tmp";

function writeTmpCard(fmExtraLines: string[] = [], affectedFalse = false) {
  const fm = [
    "---",
    `kind: ${CARD_STEM}`,
    "name: frontmatter 行号引用契约测试临时卡",
    "tier: leaf",
    "category: utils",
    "source_files:",
    "  - frontend/src/utils/base/pure/array.ts",
    ...(affectedFalse ? ["affected: false"] : []),
    "use_when:",
    "  - 临时测试",
    ...fmExtraLines,
    "---",
    "",
    `# frontmatter 行号引用契约测试临时卡`,
    "",
    "## 概览",
    "",
    "契约测试用临时卡，测完即删。",
    "",
  ].join("\r\n");
  fs.writeFileSync(TMP_CARD, fm, "utf8");
}

function runDrift() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log("=== 知识卡 frontmatter 人工字段行号/行数/计数引用契约（检查 5.10）===");

try {
  // 1. quick_risk_lines 含行号区间 → WARN 且注明 frontmatter
  writeTmpCard(["quick_risk_lines:", "  - mount3D 本体 527 行（L351-877，预置顶复核节实测）"]);
  let { status, out } = runDrift();
  const w = out.warns.find((x) => x.includes(CARD_STEM)) || "";
  ok(
    "quick_risk_lines 行号 → WARN 且注明 frontmatter",
    w.includes("frontmatter") && w.includes("527 行"),
    `期望 frontmatter WARN: ${w.slice(0, 300)}`,
  );
  ok("WARN 级不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 2. pitfalls 计数引用「8 个能力」→ WARN
  writeTmpCard(["pitfalls:", "  - createAll 创建 8 个能力（天空/地面/水面）。"]);
  ({ status, out } = runDrift());
  ok(
    "pitfalls 计数引用 → WARN",
    out.warns.some((x) => x.includes(CARD_STEM) && x.includes("8 个能力")),
    `期望 pitfalls WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 3. 定性描述（100 行红线豁免 + 无行号）→ 不误报
  writeTmpCard(["quick_risk_lines:", "  - 仍超 100 行红线，勿写死行号"]);
  ({ status, out } = runDrift());
  ok(
    "定性描述不误报（100 行红线豁免）",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `定性描述不应触发 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 4. 快照卡（affected: false）豁免——行号是「当时」事实记录
  writeTmpCard(["quick_risk_lines:", "  - 旧快照 527 行（L351-877，当时实测）"], true);
  ({ status, out } = runDrift());
  ok(
    "affected:false 快照卡 frontmatter 行号豁免",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `快照卡不应触发 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 5. 干净 frontmatter → 无 WARN
  writeTmpCard([]);
  ({ status, out } = runDrift());
  ok(
    "干净 frontmatter 无 WARN",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `不应出现 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );
  ok("干净卡退出码 0", status === 0, `status=${status}`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡 frontmatter 人工字段行号引用契约全过");
