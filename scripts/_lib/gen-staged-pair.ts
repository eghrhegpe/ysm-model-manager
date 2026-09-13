#!/usr/bin/env node
/**
 * gen-staged-pair.ts — 生成物清单按 commit 配对（ADR-232 D1：并发竞态根治）。
 *
 * 背景：旧版 pre-commit 写 `.git/ysm_gen_staged`（无 oid 单文件，last-writer-wins）→
 * post-commit 消费同一文件。并发两次 commit 时 B 覆盖 A 的清单，A 的生成物残留
 * 被 B 误清（或 B 的残留滞留）。/tmp/ysm_gen_to_stage.txt 亦无进程后缀，并发互踩。
 *
 * 根治：清单按 commit 父 oid 配对。
 *   - pre-commit 写 `.git/ysm_gen_staged_<parentOid>`（commit 时 HEAD = 本次 commit 的
 *     父 oid，git 语义保证；两并发会话父 oid 不同天然互不覆盖）。
 *   - post-commit 读 `.git/ysm_gen_staged_<HEAD~1>`（本次 commit 的父 oid，精确定位
 *     本会话清单），清完删除；并顺带回收超过 maxAgeMs 的孤儿清单（并发中途崩溃遗留）。
 *   - 判定锚点换 commit 对象：比 `HEAD~1..HEAD` 而非「HEAD 此刻」（commit 不可变对象
 *     永在，P2-4 根治）。
 *
 * 可测性：全部函数纯逻辑（读目录 fs、路径拼接、TTL 判定），git 子进程由调用方
 * （.githooks 薄壳 / CLI）注入或单独执行，模块自身零 child_process 依赖。
 *
 * 依赖：node:fs / node:path
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** 生成物清单文件名前缀（不含 oid 后缀）。 */
export const GEN_STAGED_PREFIX = "ysm_gen_staged";

/** 孤儿清单 TTL：超过即被 post-commit 顺带回收（默认 48h）。 */
export const ORPHAN_TTL_MS = 48 * 3600_000;

/** 拼接某 commit 父 oid 对应的清单路径。 */
export function pairListPath(gitDir: string, parentOid: string): string {
  return path.join(gitDir, `${GEN_STAGED_PREFIX}_${parentOid.slice(0, 12)}`);
}

/** 写某 commit 父 oid 的生成物清单（pre-commit 调用；覆盖同 oid 既有清单 = 幂等重写）。 */
export function writePairList(gitDir: string, parentOid: string, files: string[]): void {
  const p = pairListPath(gitDir, parentOid);
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(p, files.map((f) => f.trim()).filter(Boolean).join("\n") + (files.length ? "\n" : ""), "utf-8");
}

/** 读某 commit 父 oid 的生成物清单（post-commit 调用；不存在返回 []）。 */
export function readPairList(gitDir: string, parentOid: string): string[] {
  const p = pairListPath(gitDir, parentOid);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean);
}

/** 删除某 commit 父 oid 的生成物清单（post-commit 清完即删，不留孤儿）。 */
export function deletePairList(gitDir: string, parentOid: string): boolean {
  const p = pairListPath(gitDir, parentOid);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { force: true });
  return true;
}

/**
 * 回收超过 TTL 的孤儿清单（并发中途崩溃 / 旧 commit 遗留）。
 * 只碰 `${GEN_STAGED_PREFIX}_*` 前缀文件，不碰单文件遗留 `ysm_gen_staged`（无下划线 oid 段，
 * 名字不匹配 → 永不被本函数误删，需一次性手工清）。
 * 返回被删清单路径（供 stderr 可见提示）。
 */
export function sweepOrphanPairs(gitDir: string, maxAgeMs = ORPHAN_TTL_MS, now = Date.now()): string[] {
  if (!fs.existsSync(gitDir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(gitDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`${GEN_STAGED_PREFIX}_`)) continue;
    const full = path.join(gitDir, entry.name);
    const mtime = fs.statSync(full).mtimeMs;
    if (now - mtime > maxAgeMs) {
      fs.rmSync(full, { force: true });
      removed.push(full);
    }
  }
  return removed;
}

/**
 * CLI（sh 侧消费，ADR-232 D1 接线）：
 *   node scripts/_lib/gen-staged-pair.ts write <parentOid>  < /tmp/ysm_gen_to_stage_$$.txt
 *     读 stdin 逐行（生成物清单）→ 写 `.git/ysm_gen_staged_<parentOid12>`
 *   node scripts/_lib/gen-staged-pair.ts read <parentOid>
 *     读 `.git/ysm_gen_staged_<parentOid12>` → stdout 逐行（不存在则空）
 *   node scripts/_lib/gen-staged-pair.ts delete <parentOid>
 *     删除本 commit 父 oid 清单（post-commit 清完即删）
 *   node scripts/_lib/gen-staged-pair.ts sweep [maxAgeMs]
 *     回收超过 TTL 的孤儿清单（默认 48h；stderr 打每条被删路径）
 * 退出码：0 成功；1 用法错误。
 */
function mainCli(): void {
  const [, , cmd, ...rest] = process.argv;
  const gitDir = (() => {
    // 定位 .git 目录（sh 调用侧未注入，自行 git rev-parse 一次）
    try {
      return execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf-8" }).trim();
    } catch {
      process.stderr.write("[gen-staged-pair] 无法定位 .git 目录\n");
      process.exit(1);
    }
  })();
  switch (cmd) {
    case "write": {
      const oid = rest[0] ?? "";
      if (!oid) {
        process.stderr.write("用法: gen-staged-pair.ts write <parentOid> < files\n");
        process.exit(1);
      }
      const stdin = fs.readFileSync(0, "utf-8");
      const files = stdin.split("\n").map((s) => s.trim()).filter(Boolean);
      writePairList(gitDir, oid, files);
      break;
    }
    case "read": {
      const oid = rest[0] ?? "";
      if (!oid) {
        process.stderr.write("用法: gen-staged-pair.ts read <parentOid>\n");
        process.exit(1);
      }
      for (const f of readPairList(gitDir, oid)) process.stdout.write(`${f}\n`);
      break;
    }
    case "delete": {
      const oid = rest[0] ?? "";
      if (!oid) {
        process.stderr.write("用法: gen-staged-pair.ts delete <parentOid>\n");
        process.exit(1);
      }
      deletePairList(gitDir, oid);
      break;
    }
    case "sweep": {
      const maxAge = rest[0] ? Number(rest[0]) : ORPHAN_TTL_MS;
      const removed = sweepOrphanPairs(gitDir, maxAge);
      for (const p of removed) process.stderr.write(`[gen-staged-pair] 回收孤儿清单: ${p}\n`);
      break;
    }
    default:
      process.stderr.write(
        "用法: gen-staged-pair.ts <write|read|delete|sweep> <parentOid?> [maxAgeMs?]\n",
      );
      process.exit(1);
  }
}

// CLI 仅当直接执行（sh 侧 node scripts/_lib/gen-staged-pair.ts …）时触发；
// 被 import 时非 entry 模块 → 不跑，契约测试可安全直达纯函数。
// 检测方式：argv[1] 即本文件路径时判定为 CLI 直执（node 直接运行 TS 的入口特征）。
const isCliEntry =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /gen-staged-pair\.ts$/.test(process.argv[1]);
if (isCliEntry) {
  mainCli();
}
