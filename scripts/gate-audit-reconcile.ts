#!/usr/bin/env node
/**
 * gate-audit-reconcile.ts — 门禁审计对账（2026-09-13 锐评 P1 #6：逃生审计链的「读」侧）。
 *
 * 背景：`.git/gate-audit.log` 的 PUSH/SKIPPED 行构成连续审计流，但「留痕了没人查」——
 * 「这次推送没有对应 gate 记录」此前只是理论可回溯。本工具把回溯变成一条命令：
 * 以远端跟踪分支 reflog 中的 `update by push` 条目为推送事件锚点（fetch/pull 更新的
 * 消息不同，天然排除），逐条对照审计日志的 PUSH/SKIPPED 行 oid——缺口即
 * `git push --no-verify` 或审计写入失败的候选痕迹。
 *
 * 口径与边界（诚实声明）：
 *   - 审计行 oid 取前 12 位，对账按 12 位前缀匹配
 *   - PUSH 行（gate 判定）与 SKIPPED 行（YSM_SKIP_GATE 留痕逃生）都算「已审计」——
 *     两者都是**留痕逃生**；唯一缺口 = 钩子完全未执行（--no-verify）或写入失败
 *   - 审计日志随 .git 生命周期（clone 不带、rm -rf 全没）——换机/重 clone 的历史不可对账
 *   - reflog 随 git 过期策略（默认 90 天）衰减，--days 窗口超过 reflog 覆盖时结果不完整
 *
 * 用法：
 *   node scripts/gate-audit-reconcile.ts [--days 30] [--json]
 *
 * 退出码：0 = 窗口内无缺口（或无推送记录）；1 = 存在未对账推送（供 doctor/CI 消费）；2 = 用法错误。
 *
 * 依赖：node:fs / node:path / node:child_process / _lib/proc / _lib/scan-files
 */
import fs from "node:fs";
import { auditFilePath } from "./_lib/gate-audit.ts";
import { run as procRun } from "./_lib/proc.ts";
import { ROOT } from "./_lib/scan-files.ts";

const args = process.argv.slice(2);
const daysArgIdx = args.indexOf("--days");
const days = daysArgIdx >= 0 ? Number(args[daysArgIdx + 1]) : 30;
const jsonMode = args.includes("--json");
if (
  !Number.isFinite(days) ||
  days <= 0 ||
  args.some((a) => a !== "--json" && a !== "--days" && a !== String(days))
) {
  console.log("用法: node scripts/gate-audit-reconcile.ts [--days 30] [--json]");
  process.exit(2);
}

// ── 1. 推送事件锚点：远端跟踪分支 reflog 的 update by push 条目（窗口内） ──
const refOutput = procRun("git", ["for-each-ref", "--format=%(refname)", "refs/remotes"], {
  cwd: ROOT,
});
if (!refOutput.ok) {
  console.error("[reconcile] 无法枚举 refs/remotes（git 不可用？）:", refOutput.err);
  process.exit(1);
}
const pushEvents: { oid: string; ref: string; at: string }[] = [];
const since = new Date(Date.now() - days * 86_400_000);
for (const ref of refOutput.out
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)) {
  if (ref.endsWith("/HEAD")) continue;
  const rl = procRun("git", ["reflog", "show", ref, "--date=iso-strict", "--format=%H|%gd|%gs"], {
    cwd: ROOT,
  });
  if (!rl.ok) continue;
  for (const line of rl.out.split("\n").filter(Boolean)) {
    // %gd 形如 origin/main@{2026-09-12T19:46:50+08:00}（--date=iso-strict）；%gs 只是消息
    const [oid, gd, msg] = line.split("|");
    if (!oid || !msg || !msg.includes("update by push")) continue;
    const tsMatch = (gd ?? "").match(/@\{([^}]+)\}/);
    const at = tsMatch ? new Date(tsMatch[1]!) : null;
    if (!at || Number.isNaN(at.getTime()) || at < since) continue;
    pushEvents.push({ oid: oid.slice(0, 12), ref, at: at.toISOString() });
  }
}

// ── 2. 审计日志已覆盖 oid 集（PUSH + SKIPPED 都算留痕） ──
const auditFile = auditFilePath();
const audited = new Set<string>();
const skippedAt: number[] = [];
if (fs.existsSync(auditFile)) {
  for (const line of fs.readFileSync(auditFile, "utf-8").split("\n").filter(Boolean)) {
    // 格式: <UTC ISO> <PUSH|SKIPPED> <oid12|none> <verdict> <counts> <remote>
    // 三锐评 #四1：oid 位（parts[2]）可能为 "none"（formatEntry 对空 localOid 兜底），
    // "none" 不是真实提交，不得计入已审计集
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !parts[2] || parts[2] === "none") continue;
    audited.add(parts[2]);
    if (parts[1] === "SKIPPED") skippedAt.push(Date.parse(parts[0] ?? "") || 0);
  }
}

// ── 3. 缺口 = 有推送事件、无审计记录 ──
// 四锐评 #2（SKIPPED oid 假阳性容差）：SKIPPED 行记的是钩子触发时刻的 HEAD 快照 oid，
// SKIP 逃生后用户仍可 commit 再推——最终推送的 oid 与 SKIPPED 行不一致是**正常时序**，
// 不应报缺口。容差：SKIPPED 行时间戳与推送事件相差 <10 分钟即视为同一次推送会话的留痕。
const SKIP_WINDOW_MS = 10 * 60_000;
const missing = pushEvents.filter((e) => {
  if (audited.has(e.oid)) return false;
  const evAt = Date.parse(e.at);
  return !skippedAt.some((t) => Math.abs(evAt - t) < SKIP_WINDOW_MS);
});

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        days,
        pushEvents: pushEvents.length,
        auditedOids: audited.size,
        missing: missing.map((m) => ({ oid: m.oid, ref: m.ref, at: m.at })),
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `审计对账（窗口 ${days} 天）：推送事件 ${pushEvents.length} 次，审计 oid ${audited.size} 个`,
  );
  if (missing.length === 0) {
    console.log("[OK] 无缺口——窗口内全部本地推送均有审计记录（PUSH 或 SKIPPED）");
  } else {
    console.log(`[FAIL] ${missing.length} 次推送无审计记录（--no-verify 或审计写入失败候选）:`);
    for (const m of missing) console.log(`  ${m.at} ${m.oid} → ${m.ref}`);
    console.log("处置: 核实是否本人 --no-verify 推送；无法解释时检查 CI gate 互证记录");
  }
}
process.exit(missing.length > 0 ? 1 : 0);
