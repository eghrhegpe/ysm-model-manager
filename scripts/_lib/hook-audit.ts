#!/usr/bin/env node
/**
 * hook-audit.ts — pre-commit 逃生键留痕（ADR-232 D2：逃生必须留痕）。
 *
 * 设计意图：`YSM_SKIP_BIOME_LINES` / `YSM_SKIP_ANDROID` 等 pre-commit 逃生键命中时，
 * 钩子**仍执行**（与 `--no-verify` 整钩不跑不同）→ 留痕必然发生，不留死区。
 * 追加 `.git/gate-audit.log` 的 `SKIPPED_PRECOMMIT` 行，与 PUSH/SKIPPED 同 6 列格式
 * （可 grep、可 reconcile 消费）。reconcile 侧把 SKIPPED_PRECOMMIT 纳入「已审计」口径。
 *
 * 可测性：`appendHookAudit(file, entry)` 落盘路径由调用方注入（pre-commit 传真实
 * `.git/gate-audit.log`，测试传临时路径），模块自身零 git 依赖（oid 由调用方
 * `git rev-parse HEAD` 取，传入 entry.parentOid）。
 *
 * 行格式（单行，空格分隔，机器可 grep）：
 *   <UTC ISO 时间> <SKIPPED_PRECOMMIT> <parentOid 前 12 位|none> <skipKey> <verdict> <counts>
 *   - parentOid：commit 时 HEAD（= 本次 commit 的父 oid），前 12 位；未知传 "none"
 *   - skipKey：命中的逃生键名（如 YSM_SKIP_BIOME_LINES）
 *   - verdict/counts：固定 "SKIP" / "SKIP/SKIP"（留痕行无判定语义，占位保持列对齐）
 *
 * 失败语义：fail-open（审计是增强，不阻断 commit）；但写失败打一行 stderr 可见
 * （零感知丢失的审计 ≈ 没有审计，ADR-232 D2）。
 *
 * 依赖：node:fs / node:path
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** SKIPPED_PRECOMMIT 行字段（gate-audit.log 第 2 列 kind 固定为 "SKIPPED_PRECOMMIT"）。 */
export interface HookAuditEntry {
  /** commit 时 HEAD（父 oid），前 12 位即可定位；未知传 "" 或 "none"。 */
  parentOid: string;
  /** 命中的逃生键名，如 "YSM_SKIP_BIOME_LINES"。 */
  skipKey: string;
  /** 判定占位，固定 "SKIP"（留痕行无判定语义）。 */
  verdict?: string;
  /** 计数占位，固定 "SKIP/SKIP"。 */
  counts?: string;
}

/** 默认审计日志路径（.git 目录，不受 gitignore 影响，不污染工作区）。 */
export function hookAuditFilePath(gitDir: string): string {
  return path.join(gitDir, "gate-audit.log");
}

function formatHookEntry(e: HookAuditEntry): string {
  const ts = new Date().toISOString();
  const oid = (e.parentOid || "").slice(0, 12) || "none";
  const verdict = e.verdict ?? "SKIP";
  const counts = e.counts ?? "SKIP/SKIP";
  return `${ts} SKIPPED_PRECOMMIT ${oid} ${e.skipKey} ${verdict} ${counts}`;
}

/** 追加一行 SKIPPED_PRECOMMIT；写失败打 stderr 不抛（fail-open，不阻断 commit）。 */
export function appendHookAudit(file: string, e: HookAuditEntry): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${formatHookEntry(e)}\n`, "utf-8");
  } catch (err) {
    console.error(`[hook-audit] 审计写入失败（不阻断 commit）: ${(err as Error).message}`);
  }
}

/**
 * CLI（sh 侧消费，ADR-232 D2 接线）：
 *   node scripts/_lib/hook-audit.ts write <parentOid> <skipKey>
 *     追加一行 SKIPPED_PRECOMMIT 到 .git/gate-audit.log（父 oid 未知传空串 → "none"）。
 * 退出码：0 成功 / 已 fail-open；非 0 仅参数错误。
 */
function mainCli(): void {
  const [, , cmd, oid, skipKey] = process.argv;
  if (cmd !== "write" || !skipKey) {
    process.stderr.write("用法: hook-audit.ts write <parentOid> <skipKey>\n");
    process.exit(1);
  }
  // 定位 .git 目录
  let gitDir: string;
  try {
    gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf-8" }).trim();
  } catch {
    process.stderr.write("[hook-audit] 无法定位 .git 目录\n");
    process.exit(0); // fail-open：定位失败也不阻断 commit
  }
  appendHookAudit(hookAuditFilePath(gitDir), { parentOid: oid ?? "", skipKey });
}

const isCliEntry =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /hook-audit\.ts$/.test(process.argv[1]);
if (isCliEntry) {
  mainCli();
}
