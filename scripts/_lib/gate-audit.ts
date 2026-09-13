/**
 * gate-audit.ts — 门禁审计日志（锐评 P1：逃生必须留痕）。
 *
 * 设计意图：pre-push-gate 长期把「紧急绕过: git push --no-verify」印在 FAIL 输出里，
 * 而 --no-verify 是**零痕迹绕过**（钩子不执行、无报告、无日志）——同一份体系一边教人
 * 逃生、一边警告别逃。本模块把绕过从「不可审计」降级为「可审计」：
 *   - gate 每次真实 push 运行都追加一行（oid + 判定 + 覆盖数）→ 审计日志成为连续流；
 *   - 钩子侧 YSM_SKIP_GATE=1 逃生路径同样追加 SKIPPED 行（见 .githooks/pre-push）；
 *   - --no-verify 客户端侧仍无法检测（钩子不执行是 git 语义边界，非本层能补），
 *     但审计日志的时间连续性使「这次推送没有对应 gate 记录」**事后可回溯定位**。
 *
 * 格式（单行，空格分隔，机器可 grep）：
 *   <UTC ISO 时间> <PUSH|SKIPPED> <localOid 前 12 位> <verdict: PASS|FAIL|SKIP> <passed/total> <remote>
 *
 * 可测性：appendGateAudit(file, entry) 的落盘路径由调用方注入（pre-push-gate 传真实
 * 路径，测试传临时路径），模块自身零进程依赖。
 *
 * 依赖：node:fs / node:path
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./scan-files.ts";

export interface GateAuditEntry {
  kind: "PUSH" | "SKIPPED";
  /** 本地 oid（前 12 位即可定位提交）；无 ref 时 "none" */
  localOid: string;
  /** 判定：PASS / FAIL / SKIP */
  verdict: string;
  /** 「通过/总数」计数文本，如 29/31 */
  counts: string;
  /** 远端标识（remote name 或 url） */
  remote: string;
}

export function auditFilePath(): string {
  // .git 目录由 git 自动维护（不受 gitignore 影响），审计日志放这里不污染工作区
  return path.join(ROOT, ".git", "gate-audit.log");
}

function formatEntry(e: GateAuditEntry): string {
  const ts = new Date().toISOString();
  return `${ts} ${e.kind} ${e.localOid || "none"} ${e.verdict} ${e.counts} ${e.remote}`;
}

/** 追加一行审计记录；写入失败打一行 stderr 但不阻断（审计是增强，不是门禁判定的一部分，
 * 不因日志权限问题阻断推送——但「零感知丢失的审计日志 ≈ 没有审计日志」，失败必须可见，
 * 2026-09-13 锐评 P3 #7） */
export function appendGateAudit(file: string, e: GateAuditEntry): void {
  try {
    fs.appendFileSync(file, `${formatEntry(e)}\n`, "utf-8");
  } catch (err) {
    console.error(`[gate-audit] 审计写入失败（不阻断推送）: ${(err as Error).message}`);
  }
}
