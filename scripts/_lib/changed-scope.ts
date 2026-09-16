/**
 * changed-scope.ts — 变更文件域过滤共享层（--files / --changed，scripts/_lib）。
 *
 * 解决什么问题：三个「档位扫描器」（check-complexity / check-params / check-type-safety）
 * 都是全库扫描 + 全库计数的情报型工具。一旦接门禁，未触碰文件里的存量债务会立刻让每次
 * 推送全红（实证：views 域 10 个 🟥 复杂度、54 处长参数），门禁只能被迫常关——本层把
 * 「命中收敛到本次变更文件」收敛为统一实现，与 check-redlines（--files，2026-08-26）
 * 及 check-doc-drift / check-knowledge-drift 同约定：
 *
 *   --files <换行分隔的相对路径>   门禁 / CI 侧显式传入（pre-push-gate 同款）
 *   --changed                     本地便利：相对默认分支基线自动解析变更文件
 *   --staged                      pre-commit 门禁：本次提交（暂存区）文件——git 已把裁剪后的
 *                                 索引（临时索引 / pathspec 提交）经 GIT_INDEX_FILE 交给钩子，
 *                                 故钩子自取 `git diff --cached` 即精确，无需知道调用方如何裁剪
 *
 * 语义要点（五条都是踩过的坑）：
 *   1. 路径口径 = 相对仓库根、正斜杠（与 pre-push-gate 的 --files 一致）；非 ASCII 路径
 *      靠 `-c core.quotepath=false` 拿原始 UTF-8，避免八进制转义后匹配不上。
 *   2. 重命名/删除的文件不会出现在扫描树里——静默忽略，**不报错**（--files 传的是
 *      「本次变更」而非「现存文件」，把删除项当错误会让每次重命名提交都红）。
 *   3. 两 flag 都缺 → scope=null = 全库，向后兼容既有行为。
 *   4. --files 给了但为空 / --changed 解析失败**或解析结果为空** → 返回 error，调用方
 *      **必须** fail-closed（不许静默退回全库）——同 gate-parse 第 4 条纪律：解析失败不得
 *      与「扫描通过」同形。空 diff 为何也算失败（2026-09-15 修）：CI 在 push 之后跑，
 *      origin/main 已推进到本次提交 → merge-base = HEAD → diff 必空；若把空结果当
 *      「合法空域」，三扫描器会扫 0 文件恒绿——正是本纪律要防的假绿形态。
 *      「合法空域」，三扫描器会扫 0 文件恒绿——正是本纪律要防的假绿形态。
 *   5. `--staged` 的空结果与 `--changed` **刻意不同**：git 的 rc 与空 stdout 可区分，故
 *      「空」只有一个含义（本次提交不含该域文件 = 合法空域），rc≠0 才是失败。若照抄第 4 条
 *      （空即 fail-closed），docs-only 提交会被整棵磁盘树的存量债阻断；若反过来把 `--changed`
 *      的空当合法，则假绿。两者只能各自守住自己的边界，见 parseNameOnlySet 的对照注释。
 * 依赖：node:child_process（自建 git()）+ ./to-posix.ts + ./scan-files.ts（ROOT）。
 *
 * 用法：
 *   import { resolveChangedScope, inChangedScope } from './_lib/changed-scope.ts';
 *   const { scope, error } = resolveChangedScope(raw.files, raw.changed);
 *   if (error) failClosed(error);
 *   const scanned = files.filter((f) => inChangedScope(relPosix(f), scope));
 *   // pre-commit 钩子（本次提交）
 *   const st = resolveStagedScope();          // 空集 = 合法空域；error 仅 git 失败
 *   const dirty = resolveUnstagedFiles();     // 磁盘 ≠ 提交（未暂存编辑）→ 调用方跳过该文件
 *
 * 退出码：本模块无独立 CLI（被三个扫描器 import）。
 */
import { execFileSync } from "node:child_process";
import { ROOT, toPosix } from "./scan-files.ts";

/** git 命令 → { rc, out }；失败 rc 非 0，out 尽力取 stderr（与 gate-resolve 同容错口径）。 */
function git(args: string[]): { rc: number; out: string } {
  try {
    const out = execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    return { rc: 0, out: out.trim() };
  } catch (e) {
    const err = e as Error & { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? 1, out: (err.stdout || "").trim() || (err.stderr || "").trim() };
  }
}

/**
 * 解析 `--files` 原值（换行分隔的相对路径列表）为集合；空 / 非字符串 → null。
 * 纯函数（契约测试锁定）：反斜杠归一化为正斜杠，空白项剔除。
 */
export function parseChangedFiles(raw: unknown): Set<string> | null {
  if (typeof raw !== "string") return null;
  const files = raw
    .split("\n")
    .map((f) => toPosix(f.trim()))
    .filter(Boolean);
  return files.length ? new Set(files) : null;
}

/**
 * 该文件是否落在变更域内。纯函数：scope 为 null/undefined（未启用过滤）→ 恒 true。
 * @param rel 仓库根相对的正斜杠路径（各扫描器的 relPosix / toPosix(rel) 产出）
 */
export function inChangedScope(rel: string, scope: Set<string> | null | undefined): boolean {
  if (!scope) return true;
  return scope.has(toPosix(rel));
}

/** 默认分支基线候选（顺序即优先级）：远端 HEAD → main/master → 本地 main/master。 */
const DEFAULT_BRANCH_REFS = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

/**
 * `git diff --name-only` 的 stdout → 变更文件数组；**空输出 → null**（2026-09-15）。
 *
 * 空输出有两类成因：① 确实无改动；② 基线已等于 HEAD（CI 在 push 之后跑——`origin/main`
 * 已推进到本次提交 → `merge-base` = HEAD → diff 必空）。两者在本层不可区分，而 ② 一旦被
 * 当成「合法空域」，`--changed` 就会产出空 scope → 三扫描器扫 0 文件恒绿（假绿）。
 * 故一律 null，由调用方 fail-closed。纯函数（契约测试锁定）。
 */
export function parseGitNameOnly(stdout: string): string[] | null {
  const files = stdout
    .split("\n")
    .map((f) => toPosix(f.trim()))
    .filter(Boolean);
  return files.length ? files : null;
}

/**
 * git `--name-only` 的 stdout → **相对路径集合**，空输出 = 空集（合法）。
 *
 * 与 parseGitNameOnly（→ 空即 null）刻意不同，服务对象不同：
 *   - parseGitNameOnly 服务 `--changed`：空结果**不可区分**「确实无变更」与「基线已等于
 *     HEAD」，故必须 null 由调用方 fail-closed（否则空 scope = 扫 0 文件假绿）。
 *   - 本函数服务 `--staged`：git 的**退出码**已经给出失败信号（rc≠0 由调用方转 error），
 *     故空 stdout 只剩一个含义：本次提交不含该域文件 = 合法空域。
 * 纯函数（契约测试锁定）。
 */
export function parseNameOnlySet(stdout: string): Set<string> {
  return new Set(
    stdout
      .split("\n")
      .map((f) => toPosix(f.trim()))
      .filter(Boolean),
  );
}

/**
 * `--changed` 本地解析：相对默认分支合并基线的变更文件（含已提交 + 工作区/暂存改动）。
 *
 * 口径 = `git merge-base HEAD <默认分支>` 后 `git diff --name-only <基线>`——即
 * 「我在本分支上改过的一切」，与 check-biome 的 `--changed`（vcs.defaultBranch 比对）同义。
 * 已知边界：**不含未跟踪文件**（`git diff` 天然不列），新文件请先 `git add` 或改传 `--files`。
 * @returns 变更文件相对路径数组；git 不可用 / 无任何默认分支基线 / **解析结果为空** → null
 *          （后一种即「无有效变更域」，调用方必须 fail-closed，见 parseGitNameOnly 注释）。
 */
export function resolveLocalChanged(): string[] | null {
  let base: string | null = null;
  for (const ref of DEFAULT_BRANCH_REFS) {
    const r = git(["merge-base", "HEAD", ref]);
    const mb = r.rc === 0 ? r.out.trim() : "";
    if (mb) {
      base = mb;
      break;
    }
  }
  if (!base) return null;
  const d = git(["diff", "--name-only", base]);
  if (d.rc !== 0) return null;
  return parseGitNameOnly(d.out);
}

/** 变更域解析结果：scope=null 表示未启用过滤（全库）。 */
export interface ChangedScopeResult {
  scope: Set<string> | null;
  /** 非空 = 解析失败，调用方必须 fail-closed（不得静默退回全库）。 */
  error?: string;
}

/**
 * `--staged` 门禁解析：本次提交（暂存区）的文件集。
 *
 * 为什么钩子侧拿到的就是「本次提交」：`git commit` 在 GIT_INDEX_FILE 注入（scripts/_lib/
 * commit-temp-index.ts 的临时索引白名单提交）与 pathspec 提交（`git commit -- <paths>`，
 * git 内部建 next-index 临时索引）两种场景下，**都把临时索引经 GIT_INDEX_FILE 交给 pre-commit
 * 钩子**，故钩子内 `git diff --cached` 天然只含本次提交的文件——钩子无需知道调用方怎么裁剪索引。
 *
 * fail-closed 边界：git 失败（rc≠0）→ error，调用方必须 exit 2；空输出 → 合法空集
 * （本次提交不含本域文件），**不得**当失败（与 --changed 的唯一差别，见 parseNameOnlySet）。
 * 返回的 scope 永不为 null（空集也是合法域）。
 */
export function resolveStagedScope(): ChangedScopeResult {
  const r = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (r.rc !== 0) {
    return { scope: null, error: `git diff --cached 解析失败（rc=${r.rc}）：${r.out || "无输出"}` };
  }
  return { scope: parseNameOnlySet(r.out) };
}

/**
 * 工作区相对暂存区的改动文件集（= 含「未暂存编辑」的文件）。git 失败 → null（调用方自决）。
 *
 * 用途：门禁必须对「提交内容」负责，而扫描器读的是**磁盘**内容——已 staged 又续改的文件
 * （`git status` 的 `MM`）或并行会话改了同一文件时，判定对象与提交对象错位：行号位移会被
 * `--baseline` 判成「新增」（误伤），内容差异又可能漏判。该集合即「磁盘 ≠ 提交」的文件，
 * 调用方据此跳过并告警（同 check-biome-lines.ts 的 filterClean 守卫）。
 */
export function resolveUnstagedFiles(): Set<string> | null {
  const r = git(["diff", "--name-only"]);
  return r.rc === 0 ? parseNameOnlySet(r.out) : null;
}

/** 按「是否含未暂存编辑」二分，保持输入顺序（纯函数，契约测试锁定）。 */
export function partitionByUnstaged(
  files: readonly string[],
  unstaged: ReadonlySet<string>,
): { clean: string[]; skipped: string[] } {
  const clean: string[] = [];
  const skipped: string[] = [];
  for (const f of files) (unstaged.has(toPosix(f)) ? skipped : clean).push(f);
  return { clean, skipped };
}
/**
 * 三个扫描器的统一入口：`--files`（显式，优先）→ `--changed`（git 自解析）→ 全库。
 *
 * 优先级：`--files` 给定时完全按它（不叠加 `--changed`）——门禁传的清单即权威事实源。
 * @param filesRaw `--files` 原值（parseArgs 的 strings 项；未传为 null）
 * @param changed  `--changed` 是否开启
 * @returns mode 由调用方按「哪个 flag 命中」自证（见各扫描器 _summary.scopeFilter）
 */
export function resolveChangedScope(filesRaw: unknown, changed: boolean): ChangedScopeResult {
  // ① 显式 --files：空列表是调用方 bug（把「传了但没内容」静默当全库 = 假绿）
  if (typeof filesRaw === "string") {
    const s = parseChangedFiles(filesRaw);
    if (!s) return { scope: null, error: "--files 未提供任何文件路径（空列表）" };
    return { scope: s };
  }
  // ② --changed：git 自解析失败 / 结果为空即 fail-closed（静默退回全库会让存量债淹没本次变更；
  //    空结果退化成空 scope 则扫 0 文件恒绿，两者都是假绿）
  if (changed) {
    const list = resolveLocalChanged();
    if (!list)
      return {
        scope: null,
        error:
          "--changed 解析不到任何变更文件（git 不可用 / 找不到默认分支基线 / 相对基线无差异或基线已等于 HEAD）；" +
          "请改传 --files <换行分隔文件列表>，或在有变更时使用 --changed",
      };
    return { scope: new Set(list) };
  }
  // ③ 两者皆缺 → 全库，向后兼容
  return { scope: null };
}
