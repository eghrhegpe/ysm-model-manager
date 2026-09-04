#!/usr/bin/env node
/**
 * check-biome-lines.ts — Biome 行级增量闸(2026-09-04,A4 落地)。
 *
 * 为何存在(补 check-biome.ts 的结构性盲区):
 *   - check-biome.ts 默认走 `biome check --changed`,基准 = vcs.defaultBranch(main);
 *   - 本仓库「main 直提」工作流下,相对 main 的已提交差异恒空 → 该闸恒绿(实测 2026-09);
 *   - 基准换 origin/main 亦不可行:仓库 59 commits 未 push,存量 lint 债 885 条(299w+586i),
 *     而 Biome 是文件级增量 → 上线即全量红灯,阻塞全体 push。
 *   结论:文件级增量闸在 main 直提 + 存量债堆积的仓库里必然二选一(恒空 or 全炸)。
 *   唯一精确出路 = 行级:拦「本次提交真正新增的违规行」,存量债永不误伤。
 *
 * 本脚本实现行级闸(挂在 pre-commit,见 .githooks/pre-commit):
 *   1. staged 的 frontend TS/TSX(与 gofmt/biome --write 段同 pathspec);
 *   2. 守卫:跳过含未暂存编辑的文件(未暂存编辑会污染 staged diff 行号对应关系);
 *   3. 逐文件 `git diff --cached --unified=0` 取「新增行号集合」(git-hunks.ts);
 *   4. `biome check --reporter=json --diagnostic-level=warn` 取违规 {file, line};
 *   5. 交集非空 = 本次提交引入了违规 → 阻断(exit 1);否则通过(存量债不拦)。
 *
 * 阈值说明:--diagnostic-level=warn → info 级不拦(noExplicitAny 等存量 info 债不烦人);
 *   若将来要收紧,加 flag 下探 info 级即可。
 *
 * 用法:
 *   node scripts/check-biome-lines.ts            # 检 staged 前端 TS;有新增违规 exit 1(pre-commit 接线)
 *
 * 退出码:0 = 通过(无 staged 前端文件 / 无新增违规);1 = 本次提交新增违规,已列出。
 *   解析失败(biome json 异常)按 exit 2 拦截——宁可显式失败,不静默绿灯。
 *
 * 逃生阀:YSM_SKIP_BIOME_LINES=1(pre-commit 段处理)。
 */
import fs from "node:fs";
import path from "node:path";
import { addedLinesFromDiff } from "./_lib/git-hunks.ts";
import { run } from "./_lib/proc.ts";
import { ROOT } from "./_lib/scan-files.ts";

const isWin = process.platform === "win32";
const FRONTEND_DIR = path.join(ROOT, "frontend");

/** staged frontend TS/TSX 文件(相对仓库根,如 frontend/src/views/a.ts)。 */
function stagedFrontendFiles(): string[] {
  const r = run(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM", "--", "*.ts", "*.tsx"],
    {
      cwd: ROOT,
      timeout: 15_000,
    },
  );
  if (!r.ok) {
    console.error(`[check-biome-lines] git diff --cached 失败: ${r.err}`);
    process.exit(2);
  }
  return r.out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("frontend/") && /\.tsx?$/.test(s));
}

/** 守卫:仅保留「无未暂存编辑」的干净文件(与 pre-commit --write 段同逻辑)。 */
function filterClean(files: string[]): { clean: string[]; skipped: string[] } {
  const clean: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const r = run("git", ["diff", "--quiet", "--", f], { cwd: ROOT, timeout: 15_000 });
    if (r.ok) clean.push(f);
    else skipped.push(f);
  }
  return { clean, skipped };
}

/** 逐文件取 staged 新增行号集合。 */
function stagedAddedLines(files: string[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const f of files) {
    const r = run("git", ["diff", "--cached", "--unified=0", "--", f], {
      cwd: ROOT,
      timeout: 15_000,
    });
    map.set(f, r.ok ? addedLinesFromDiff(r.out) : new Set());
  }
  return map;
}

/** Biome diagnostics 解析(2.5.x --reporter=json):统一 path 为正斜杠、与入参(cwd=frontend 相对)对齐。 */
interface BiomeDiag {
  file: string;
  line: number;
  category: string;
  severity: string;
  message: string;
}
function parseBiomeDiags(jsonText: string): BiomeDiag[] {
  let j: {
    diagnostics?: Array<{
      severity?: string;
      message?: { summary?: string } | string;
      category?: string;
      location?: { path?: string; start?: { line?: number } };
    }>;
  };
  try {
    j = JSON.parse(jsonText) as typeof j;
  } catch (e) {
    console.error(`[check-biome-lines] biome --reporter=json 输出解析失败(非 JSON?): ${String(e)}`);
    process.exit(2);
  }
  const out: BiomeDiag[] = [];
  for (const d of j.diagnostics ?? []) {
    const line = d.location?.start?.line;
    if (!line || !d.location?.path) continue; // 无行号定位的诊断(如项目级错误)不参与行级判定
    out.push({
      file: d.location.path.replace(/\\/g, "/"),
      line,
      category: d.category ?? "unknown",
      severity: d.severity ?? "unknown",
      message: typeof d.message === "string" ? d.message : (d.message?.summary ?? ""),
    });
  }
  return out;
}

const staged = stagedFrontendFiles();
if (staged.length === 0) {
  console.log("[check-biome-lines] 无 staged frontend TS/TSX,行级闸跳过 ✅");
  process.exit(0);
}

const { clean, skipped } = filterClean(staged);
for (const f of skipped) {
  console.log(`  ⚠️ ${f} 含未暂存编辑,跳过行级闸(请手动 biome check 复查)`);
}
if (clean.length === 0) {
  console.log("[check-biome-lines] 无干净 staged 文件,行级闸跳过 ✅");
  process.exit(0);
}

const addedByFile = stagedAddedLines(clean);

// biome check:cwd=frontend,入参剥 frontend/ 前缀(与 check-biome.ts 同约定)
const relFiles = clean.map((f) => f.replace(/^frontend\//, ""));
const biomeBinCandidates = [
  path.join(ROOT, "node_modules", ".bin", isWin ? "biome.cmd" : "biome"),
  path.join(ROOT, "frontend", "node_modules", ".bin", isWin ? "biome.cmd" : "biome"),
];
const biomeBin = biomeBinCandidates.find((p) => fs.existsSync(p));
if (!biomeBin) {
  console.error("[check-biome-lines] biome 未安装(node_modules 缺失)——行级闸无法判定,显式拦截");
  process.exit(2);
}
const b = run(biomeBin, ["check", ...relFiles, "--reporter=json", "--diagnostic-level=warn"], {
  cwd: FRONTEND_DIR,
  timeout: 60_000,
  shell: true, // .cmd 包装需 shell(biome.cmd)
  mergeStderr: false, // JSON 消费方:out 仅 stdout;stderr 的人类横幅/experimental 提示不得污染 parse
});
// 注意:不依赖 biome 退出码(违规即非 0?);解析 json 后按「新增行 ∩ 违规行」自判。

const diags = parseBiomeDiags(b.out);
const addedViolations: Array<BiomeDiag & { rel: string }> = [];
for (const d of diags) {
  const added = addedByFile.get(`frontend/${d.file}`); // biome path 相对 frontend
  if (added?.has(d.line)) {
    addedViolations.push({ ...d, rel: `frontend/${d.file}` });
  }
}

if (addedViolations.length > 0) {
  const byFile = new Map<string, BiomeDiag[]>();
  for (const v of addedViolations) {
    const list = byFile.get(v.rel) ?? [];
    list.push(v);
    byFile.set(v.rel, list);
  }
  console.error("");
  console.error(
    `[check-biome-lines] ❌ 本次提交新增 ${addedViolations.length} 处 biome 违规(行级判定,存量债不拦):`,
  );
  for (const [file, list] of byFile) {
    for (const v of list) {
      console.error(`  ${file}:${v.line}  ${v.severity} ${v.category} — ${v.message}`);
    }
  }
  console.error("");
  console.error(
    "  请修复上述行(或 git add 前手动 biome check --write);存量违规(非本次新增行)不受影响。",
  );
  console.error("  逃生阀:YSM_SKIP_BIOME_LINES=1 跳过本闸(慎用,绕过不留审计)");
  process.exit(1);
}

// 人类可读通过信息:顺带报告存量债规模(不阻断),让兄弟会话理解「为何没拦」。
const totalWarn = diags.filter((d) => d.severity === "warning").length;
const totalErr = diags.filter((d) => d.severity === "error").length;
console.log(
  `[check-biome-lines] ✅ 本次提交无新增违规(staged ${clean.length} 文件;` +
    (totalErr + totalWarn > 0
      ? `文件内存量债 ${totalErr + totalWarn} 处(非新增行,不拦)`
      : "无违规"),
  ")",
);
process.exit(0);
