/**
 * diff-source.ts — 「本次变更」的 diff 来源与**提交侧内容**来源抽象（scripts/_lib，2026-09 立）。
 *
 * 设计意图（为什么需要这一层）：
 *   行级门禁必须回答两件事——「哪些行是本次新增的」与「这些行在**提交侧**长什么样」。
 *   两个调用场景的答案来源不同，但语义必须一致（ADR-256 D2「统一口径」）：
 *     index 源：pre-commit —— 暂存区 vs HEAD（钩子继承 GIT_INDEX_FILE，天然只含本次提交）
 *     range 源：pre-push / CI —— base..head（base 取与默认分支的 merge-base）
 *   本层把两者收敛为同一组询问（changedFiles / renameMap / addedLines / content），
 *   判定语义只有一个实现点，不会出现「提交时一套、推送时另一套」的漂移。
 *
 * 为什么内容取 blob 而不读磁盘（ADR-256 D3）：
 *   门禁必须对**提交内容**负责。读磁盘时「已 staged 又续改」（`git status` 的 MM）或
 *   并行会话改了同一文件，判定对象就会与提交对象错位——行号位移被判成新增（误伤）、
 *   内容差异又可能漏判。故：
 *     index 源 → `git show :<path>`（暂存 blob）
 *     range 源 → `git show <head>:<path>`（提交 blob）
 *
 * 依赖：./proc.ts（run：统一子进程，禁直接 execFileSync）+ ./git-hunks.ts（新增行解析）
 *       + ./scan-files.ts（ROOT）。零 npm 依赖。
 *
 * 用法：
 *   import { addedLines, changedFiles, content, type DiffSource } from './_lib/diff-source.ts';
 *   const src: DiffSource = { kind: "index" };                  // pre-commit
 *   const src2: DiffSource = { kind: "range", base, head: "HEAD" }; // pre-push / CI
 *   const files = changedFiles(src);                            // null = git 失败（fail-closed）
 *   const lines = addedLines(src, rel, oldPath);                // null = 失败；空集 = 无新增行
 *   const text = content(src, rel);                             // null = 该 revision 无此文件
 *
 * 返回约定（三态，调用方据此 fail-closed）：
 *   null      = git 执行失败 / 无法判定 → 调用方必须显式失败，不得当「零命中」放行
 *   空集/[]   = 合法空结果（本次变更确实没碰这个文件 / 这个文件没有新增行）
 *
 * 退出码：本模块无独立 CLI（被 check-design-tokens.ts 等门禁 import）。
 */
import { addedLinesFromDiff } from "./git-hunks.ts";
import { run } from "./proc.ts";
import { ROOT } from "./scan-files.ts";

/** 本次变更的 diff 来源。 */
export type DiffSource =
  /** 暂存区 vs HEAD：pre-commit 钩子（GIT_INDEX_FILE 由 git 交给钩子 → 只含本次提交）。 */
  | { kind: "index" }
  /** base..head 净差异：pre-push / CI（base 一般取与默认分支的 merge-base）。 */
  | { kind: "range"; base: string; head: string };

/** 可选执行上下文（测试可注入临时仓库 cwd）。 */
export interface DiffSourceOpts {
  cwd?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 60_000;

/** git 执行（统一 -c core.quotepath=false：防中文路径八进制转义）。失败 ok=false。
 *  ⚠️ `out` **不 trim**：内容类询问（`content`）必须逐字节等于 blob（尾换行有语义）；
 *  列表类询问在各自调用点 trim（见 changedFiles / renameMap / addedLines）。 */
function git(args: string[], opts: DiffSourceOpts): { ok: boolean; out: string } {
  const r = run("git", ["-c", "core.quotepath=false", ...args], {
    cwd: opts.cwd ?? ROOT,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    // stdio 显式 "pipe"：execFileSync 默认把子进程 stderr **转发到父进程 stderr**
    // （Node 文档：stderr 未显式指定时输出到父进程）。本层有「预期失败」的询问（取已删除
    // 文件的内容），转发会把 `fatal: path ... does not exist` 喷进钩子日志；显式 pipe 后
    // stderr 仍随 run 的 mergeStderr 合进 out，错误信息不丢。
    // ⚠️ 必须传字符串 "pipe"（不能传数组）：run() 的 out 捕获判据是 `stdio !== "pipe"`，
    //    传数组会被当成「输出已透传到终端」→ out 恒为空串（实测踩过：内容读成 ''）。
    stdio: "pipe",
  });
  return { ok: r.ok, out: r.out };
}

/**
 * 该文件的 diff argv（纯函数，契约测试锁定）。`oldPath` 用于 rename 配对：
 * 只给新路径时 git 无法配对旧路径（pathspec 同时约束两侧），整文件会被当全新文件
 * → 全量行都算「新增」。（同 check-biome-lines.ts 的 rename 处理。）
 */
export function diffArgs(src: DiffSource, rel: string, oldPath?: string): string[] {
  const paths = oldPath ? [rel, oldPath] : [rel];
  return src.kind === "index"
    ? ["diff", "--cached", "--unified=0", "-M", "--", ...paths]
    : ["diff", "--unified=0", "-M", src.base, src.head, "--", ...paths];
}

/** 内容 revision 表达式（纯函数，契约测试锁定）：索引 `:path` / `<rev>:path`。 */
export function contentRev(src: DiffSource, rel: string): string {
  return src.kind === "index" ? `:${rel}` : `${src.head}:${rel}`;
}

/** 变更文件清单（ACMR：新增/复制/修改/改名；删除项不出现在扫描树里，静默忽略）。 */
export function changedFiles(
  src: DiffSource,
  pathspecs: readonly string[] = [],
  opts: DiffSourceOpts = {},
): string[] | null {
  const args =
    src.kind === "index"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
      : ["diff", "--name-only", "--diff-filter=ACMR", src.base, src.head];
  if (pathspecs.length > 0) args.push("--", ...pathspecs);
  const r = git(args, opts);
  return r.ok ? r.out.split("\n").filter(Boolean) : null;
}

/** 改名配对表：新路径 → 旧路径（让整文件 rename 不按「全量新增行」误判）。 */
export function renameMap(
  src: DiffSource,
  pathspecs: readonly string[] = [],
  opts: DiffSourceOpts = {},
): Map<string, string> | null {
  const args =
    src.kind === "index"
      ? ["diff", "--cached", "--name-status", "-M", "--diff-filter=ACMR"]
      : ["diff", "--name-status", "-M", "--diff-filter=ACMR", src.base, src.head];
  if (pathspecs.length > 0) args.push("--", ...pathspecs);
  const r = git(args, opts);
  if (!r.ok) return null;
  const map = new Map<string, string>();
  for (const line of r.out.split("\n")) {
    const m = /^R\d+\t(.+)\t(.+)$/.exec(line.trim());
    if (m?.[1] && m[2]) map.set(m[2], m[1]);
  }
  return map;
}

/** 该文件在本次变更中的新增行号集合。null = git 失败；空集 = 无新增行（合法）。 */
export function addedLines(
  src: DiffSource,
  rel: string,
  oldPath?: string,
  opts: DiffSourceOpts = {},
): Set<number> | null {
  const r = git(diffArgs(src, rel, oldPath), opts);
  return r.ok ? addedLinesFromDiff(r.out) : null;
}

/** 提交侧内容（blob）。null = 该 revision 无此文件 / git 失败（调用方按跳过或 fail-closed 处理）。 */
export function content(src: DiffSource, rel: string, opts: DiffSourceOpts = {}): string | null {
  const r = git(["show", contentRev(src, rel)], opts);
  return r.ok ? r.out : null;
}
