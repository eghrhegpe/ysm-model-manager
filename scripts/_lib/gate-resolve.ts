/**
 * gate-resolve.ts — 基线 rev 解析共享层（无副作用纯模块）。
 *
 * 背景：resolveBaseRev / fallbackBranchRevs 原定义在 pre-push-gate.ts 内（因它的
 * `git()` helper 依赖）。但 pre-push-gate.ts 顶层会 `main()`（读 stdin），
 * 契约测试若 import 它会被顶层副作用污染（读 stdin 打印 usage）。故把这些
 * 纯逻辑抽到本模块，pre-push-gate 与契约测试都从本模块 import（单一事实源）。
 *
 * 依赖：node:child_process（自建 git()，语义逢 {rc,out} 或抛错）
 */
import { execFileSync } from "node:child_process";
import { getRoot } from "./scan-files.ts";

/** git 命令 → { rc, out }；失败（非零/不存在）rc 非 0，out 尽力取 stderr。 */
function git(args: string[]): { rc: number; out: string } {
  try {
    const out = execFileSync("git", args, { cwd: getRoot(), encoding: "utf-8" });
    return { rc: 0, out: out.trim() };
  } catch (e) {
    const err = e as Error & { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? 1, out: (err.stdout || "").trim() || (err.stderr || "").trim() };
  }
}

/**
 * fallback 远端分支候选（单一事实源，供 resolveChanges / resolveBaseRev 共用）。
 * 顺序即优先级：origin/<分支名> → origin/HEAD → origin/main → origin/master。
 * 非 refs/heads/ 前缀（如纯本地/unknown）跳过首项。
 */
export function fallbackBranchRevs(localRef: string): string[] {
  const branchName = localRef.startsWith("refs/heads/")
    ? localRef.slice("refs/heads/".length)
    : null;
  return [
    ...(branchName ? [`origin/${branchName}`] : []),
    "origin/HEAD",
    "origin/main",
    "origin/master",
  ];
}

/**
 * 解析「比对基线 rev」——远端 oid 权威优先，否则走 fallback 候选 merge-base。
 *
 * 语义（2026-09-08 锐评 R4，从 pre-push-gate 迁来）：
 *   1. 已存在远端分支且非同源：remoteOid 即权威基线；
 *   2. 否则对 fallbackBranchRevs(localRef) 逐项 `git merge-base <localOid> <ref>`，
 *      首个成功即基线；
 *   3. 全失败返回 ""（孤儿分支 / 无远端），由调用方降级。
 *
 * @returns 基线 rev；取不到返回 ""。
 */
export function resolveBaseRev(localOid: string, remoteOid: string, localRef: string): string {
  if (!/^0+$/.test(remoteOid || "") && remoteOid !== localOid) return remoteOid;
  for (const ref of fallbackBranchRevs(localRef)) {
    const r = git(["merge-base", localOid, ref]);
    const mb = r.rc === 0 ? r.out.trim() : "";
    if (mb) return mb;
  }
  return "";
}

/**
 * 计算本次 push 的变更文件集（ADR-206 阶段 1：从 pre-push-gate 迁入）。
 * 相对被推送的 localOid（而非当前检出 HEAD——推非当前分支时 HEAD 与推送对象不一致）。
 *   remoteOid 全 0（新分支/新仓库）→ 回退合并基点或最近提交；
 *   无祖先提交 → 首个提交的完整文件清单。
 * 返回文件数组；解析彻底失败（git diff/show 均不可用）返回 null，由调用方阻断推送
 * （fail-closed，不静默空跑放行）。
 */
export function resolveChanges(localRef: string, localOid: string, remoteOid: string): string[] | null {
  const isNew = /^0+$/.test(remoteOid || "");
  if (!isNew && remoteOid !== localOid) {
    const { rc, out } = git(["diff", "--name-only", `${remoteOid}..${localOid}`]);
    if (rc === 0) return out.trim().split("\n").filter(Boolean); // 权威答案（空 = 本次无变更）
  }
  // 新分支：优先合并基点（有远端追踪分支时），否则 fallback 链 -> 最近提交
  for (const ref of fallbackBranchRevs(localRef)) {
    const r = git(["merge-base", localOid, ref]);
    const mb = r.rc === 0 ? r.out.trim() : "";
    if (!mb) continue;
    const { rc, out } = git(["diff", "--name-only", `${mb}..${localOid}`]);
    if (rc === 0) return out.trim().split("\n").filter(Boolean);
  }
  const { rc, out } = git(["diff", "--name-only", `${localOid}~1..${localOid}`]);
  if (rc === 0) return out.trim().split("\n").filter(Boolean);
  // 首个提交（diff-tree 对 root commit 默认忽略，须用 git show）
  const t = git(["show", "--name-only", "--format=", localOid]);
  return t.rc === 0 && t.out.trim() ? t.out.trim().split("\n").filter(Boolean) : null;
}