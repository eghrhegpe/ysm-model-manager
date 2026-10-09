#!/usr/bin/env node
/**
 * audit-freshness.ts — 审计 finding 时效判定（审查器降噪的执行工具，只读）。
 *
 * 设计意图（2026-10-09 审核体系锐评 · 第四刀）：
 *   AI 审查器的系统性假阳性第一名（知识卡 ai-review-pitfalls「孤立 commit 快照」，9 轮实战
 *   ~57 条 finding 中假阳性/已覆盖 ~31 条 ≈54% 的主因之一）：finding 基于审计基线 commit
 *   时的代码，而**基线之后已有同源提交把问题修掉**——逐条人工复核的成本正是从这来。
 *   卡里写的方法论「审计前先 git log 看基线之后有没有同源后续提交」此前只是散文；
 *   本脚本把它变成一条口令：输入基线 + finding 涉及的文件清单，输出每个文件的
 *   「基线以来是否被改写」判定与被哪些提交改写过——**改写过的 finding 组直接降权**，
 *   没改写的才值得逐条实证。
 *
 * 与相邻工具的边界：audit-split（审一次 refactor 提交的内部结构）/ rollback-impact
 *   （revert 影响面）都是**审提交本身**；本工具审的是**时间差**——finding 的快照与现状
 *   之间隔了什么。情报型，不阻断任何流程。
 *
 * 依赖：node:child_process（git 只读子命令）/ node:fs / ./_lib/proc.ts /
 *       ./_lib/parse-args.ts / ./_lib/scan-files.ts。零外部依赖。
 *
 * 用法（仓库根运行）：
 *   node scripts/audit-freshness.ts --base <ref> --files <a.ts,b.go>     # 逗号分隔（脚本输出友好）
 *   node scripts/audit-freshness.ts --base <ref> --files-file <path>     # 文件里换行分隔（大批量）
 *   node scripts/audit-freshness.ts --base <ref> --files <…> --json      # 机读（子代理消费）
 *   缺 --files 时只报基线以来全仓改了哪些文件（无 finding 清单的粗筛）。
 * 退出码：0 恒（情报型）；2 = 用法错误 / 基线不可解析（fail-closed——判不了时效绝不能
 *   装作「全部 stable」放行，那是假绿的另一个面）。
 * 设计意图（一句话）：让「假阳性降权」从记忆动作变成一条命令。
 */
import { existsSync, readFileSync } from "node:fs";
import { toPosix } from "./_lib/to-posix.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { run } from "./_lib/proc.ts";
import { ROOT } from "./_lib/scan-files.ts";

/** 单文件时效判定。 */
export interface FileVerdict {
  file: string;
  /** stable = 基线以来未被改写（finding 可信，值得逐条实证）；rewritten = 已被改写（降权）。 */
  verdict: "stable" | "rewritten" | "deleted";
  /** 基线以来改动过该文件的提交（短哈希 + 主题，至多 8 条）。 */
  laterCommits: string[];
}

function git(args: string[]): { ok: boolean; out: string } {
  const r = run("git", ["-c", "core.quotepath=false", ...args], { cwd: ROOT });
  return { ok: r.ok, out: (r.out || r.err || "").trim() };
}

/**
 * 基线以来（base..HEAD）改动过的文件集合。null = 解析失败（调用方 fail-closed）。
 * 纯集合语义：merge-base 三点式（`base...HEAD`）与门禁 diff 口径一致——审的是「基线之后
 * 新增的改动」，不混入「基线之后远端别人的历史」。
 */
export function changedSinceBase(base: string): Set<string> | null {
  const mb = git(["merge-base", base, "HEAD"]);
  if (!mb.ok) return null;
  const r = git(["diff", "--name-only", `${mb.out}..HEAD`]);
  if (!r.ok) return null;
  return new Set(r.out.split("\n").filter(Boolean));
}

/** 基线以来改动过指定文件的提交列表。 */
export function commitsTouching(base: string, file: string): string[] {
  const mb = git(["merge-base", base, "HEAD"]);
  if (!mb.ok) return [];
  const r = git(["log", "--format=%h %s", "-8", `${mb.out}..HEAD`, "--", file]);
  return r.ok && r.out ? r.out.split("\n").filter(Boolean) : [];
}

/** 逐文件判定（纯函数，changed 集合与提交枚举注入可测）。 */
export function classifyFiles(
  files: readonly string[],
  changed: ReadonlySet<string>,
  touch: (f: string) => string[],
  existsAtHead: (f: string) => boolean = (f) => git(["cat-file", "-e", `HEAD:${f}`]).ok,
): FileVerdict[] {
  return files.map((f) => {
    if (!changed.has(f)) return { file: f, verdict: "stable" as const, laterCommits: [] };
    const laterCommits = touch(f);
    // changed 但 HEAD 里已不存在：文件被删/迁走——finding 同样失效，单独归类给读者
    const gone = !existsAtHead(f);
    return {
      file: f,
      verdict: gone ? ("deleted" as const) : ("rewritten" as const),
      laterCommits,
    };
  });
}

/** 汇总降权建议。 */
export function summarize(verdicts: readonly FileVerdict[]): {
  total: number;
  stable: number;
  demote: number;
} {
  const demote = verdicts.filter((v) => v.verdict !== "stable").length;
  return { total: verdicts.length, stable: verdicts.length - demote, demote };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["json"],
    strings: ["base", "files", "files-file"],
  });
  if (args.unknown.length) {
    console.error(`[audit-freshness] 未知参数: ${args.unknown.join(", ")}`);
    return 2;
  }
  const base = args.base as string | null;
  if (!base) {
    console.error("用法: node scripts/audit-freshness.ts --base <ref> [--files a,b | --files-file <path>] [--json]");
    return 2;
  }
  if (!git(["rev-parse", "--verify", `${base}^{commit}`]).ok) {
    // fail-closed：基线不可解析（浅克隆/拼错）时报错退出——绝不回落「全部 stable」假绿
    console.error(`[audit-freshness] 基线不可解析：${base}（浅克隆请先 git fetch --unshallow 或补 fetch）`);
    return 2;
  }
  const changed = changedSinceBase(base);
  if (changed === null) {
    console.error(`[audit-freshness] merge-base/diff 失败（git 环境异常），拒绝输出可信时效判定`);
    return 2;
  }

  let files: string[] = [];
  if (args.files) files = (args.files as string).split(",").map((s) => s.trim()).filter(Boolean);
  else if (args.filesFile) {
    const p = args.filesFile as string;
    if (!existsSync(p)) {
      console.error(`[audit-freshness] --files-file 不存在: ${p}`);
      return 2;
    }
    files = readFileSync(p, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  }

  const verdicts = files.length
    ? classifyFiles(files, changed, (f) => commitsTouching(base, f))
    : [];
  const sum = summarize(verdicts);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            ok: true,
            base,
            filesChangedSinceBase: changed.size,
            ...(files.length ? sum : {}),
          },
          ...(files.length ? { verdicts } : {}),
          changedSinceBase: files.length ? undefined : [...changed].sort(),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`基线 ${base} 以来全仓改动 ${changed.size} 个文件`);
  if (!files.length) {
    for (const f of [...changed].sort().slice(0, 60)) console.log(`  · ${f}`);
    if (changed.size > 60) console.log(`  … 其余 ${changed.size - 60} 个（--json 全量）`);
    console.log("\n（无 --files 时仅粗筛；给 finding 涉及文件清单才能逐条判「稳定/降权」）");
    return 0;
  }
  for (const v of verdicts) {
    const tag =
      v.verdict === "stable" ? "🟢 稳定（finding 可信）" : v.verdict === "deleted" ? "🗑 已删除/迁走（finding 失效）" : "🟠 基线后被改写（finding 降权）";
    console.log(`${tag}  ${v.file}`);
    for (const c of v.laterCommits) console.log(`      ↳ ${c}`);
  }
  console.log(
    `\n判定：${sum.stable}/${sum.total} 组 finding 的文件在基线后未动（值得逐条实证）；` +
      `${sum.demote} 组涉文件已被后续提交改写（先核现状再谈真伪——54% 假阳性的第一大来源）。`,
  );
  return 0;
}

if (process.argv[1] && toPosix(process.argv[1]).endsWith("scripts/audit-freshness.ts")) {
  process.exit(main());
}
