/**
 * _lib/deadcode-attrib.ts — 死代码/重复代码发现项归属（纯函数）。
 *
 * 设计：check-deadcode-baseline 的门禁按域裁剪——新增发现项只有落在
 * 「本次责任文件集」（staged / 未推送提交改动）内才阻断提交；
 * 他人遗留债务不拦路，由调用方自动收编进基线并留痕。
 * 责任集为 null = 无法归属（无 git 上下文），严格模式全阻断（fail-closed）。
 */
import { toPosix } from "./to-posix.ts";

/** 从发现项 key 提取涉及文件（posix，工具 cwd 相对路径）。
 * knip 键形如 `file|type|name`；jscpd 键形如 `f1#f2`。无法解析返回 []。 */
export function findingFiles(key: string): string[] {
  if (typeof key !== "string") return [];
  if (key.includes("|")) {
    return [key.slice(0, key.indexOf("|"))].filter(Boolean);
  }
  if (key.includes("#")) {
    const i = key.indexOf("#");
    return [key.slice(0, i), key.slice(i + 1)].filter(Boolean);
  }
  return [];
}

/** 判断发现项是否归属责任文件集。
 * 兼容三种形态：候选补 `frontend/` 前缀后命中、根路径直配、候选自带前缀直配。 */
export function attributable(key: string, responsibleSet: Set<string> | null): boolean {
  if (!responsibleSet) return true; // null = 严格模式
  for (const f of findingFiles(key)) {
    const p = toPosix(f);
    if (responsibleSet.has(p)) return true;
    if (responsibleSet.has(`frontend/${p}`)) return true;
    if (p.startsWith("frontend/") && responsibleSet.has(p.slice("frontend/".length))) return true;
  }
  return false;
}

/** 拆分新增发现项 → { blocking, absorbable }。
 * responsibleSet 为 null 时全部 blocking（严格兜底）。 */
export function splitNewFindings(
  newKeys: string[],
  responsibleSet: Set<string> | null,
): { blocking: string[]; absorbable: string[] } {
  const blocking: string[] = [];
  const absorbable: string[] = [];
  for (const k of newKeys) {
    (attributable(k, responsibleSet) ? blocking : absorbable).push(k);
  }
  return { blocking, absorbable };
}

/** 单工具结果可信度：findings 非空即可信（有发现必是执行+解析成功）；
 * 为空时只有「执行成功（out 非 null）且输出解析成功（未置 parseFailed）」才可信——
 * 否则空 findings 是「工具没跑/输出解析失败」的假零，写盘会洗白既有债务。 */
function trusted(findings: string[], out: string | null, parseFailed: boolean): boolean {
  return findings.length > 0 || (out !== null && !parseFailed);
}

/** 基线写盘守卫（纯决策）：knip 与 jscpd 两工具结果都可信才允许自动收编/更新基线写盘。
 * 防洗白：任一工具「未执行成功或输出解析失败」时禁止写盘（code_review P2 回归）。 */
export function canWriteBaseline(
  knipFindings: string[],
  knipOut: string | null,
  knipParseFailed: boolean,
  jscpdFindings: string[],
  jscpdOut: string | null,
  jscpdParseFailed: boolean,
): boolean {
  return (
    trusted(knipFindings, knipOut, knipParseFailed) &&
    trusted(jscpdFindings, jscpdOut, jscpdParseFailed)
  );
}

// ── 责任文件集解析（2026-09-15 下沉自 check-deadcode-baseline main，可注入 git 便于契约测试）──

/** git 运行器：成功返回 stdout（可能含换行）、失败返回 null。 */
export type GitRunner = (...args: string[]) => string | null;

/**
 * 显式变更范围解析（纯函数）：`--base <rev>` 优先，其次 env `YSM_DEADCODE_BASE`。
 * 空白 / 缺省 → null（= 不启用显式范围，退回本地上下文语义）。
 * 为什么需要它：CI 跑在 push **之后**，本地三源与未推送 diff 必然全空 ⇒ 责任集恒 null
 * ⇒ 严格模式全阻断，而 CI 传 `--json` 又关掉自动收编 ⇒ 门禁结构性恒红且无法自愈。
 */
export function parseBaseRef(
  argv: string[],
  env: Record<string, string | undefined> = {},
): string | null {
  const i = argv.indexOf("--base");
  const cli = i >= 0 ? (argv[i + 1] ?? "") : "";
  const raw = (cli || env.YSM_DEADCODE_BASE || "").trim();
  return raw || null;
}

/**
 * 责任文件集解析（仓库根相对 posix 路径）。
 *
 * 解析顺序：
 *   ⓪ `baseRef` 可解析为提交对象 → `git diff --name-only <base>...HEAD`（**CI 唯一可用上下文**）；
 *      结果**允许为空数组**——「本次范围没改到相关文件 ⇒ 谁都不该背锅」与「无从归属」(null)
 *      必须严格区分，前者不该触发严格模式全阻断。
 *   ①②③ 本地三源：staged（commit 场景）+ 未暂存改动 + 未跟踪文件（gitignore 之外）；
 *   ④ 回退未推送提交 diff（push 场景）→ null（严格模式，调用方全阻断 fail-closed）。
 *
 * 「未暂存改动」必须纳入：pre-commit / 手工检查在 `git add` 前运行时，自己的新死代码若不在
 * 责任集，会被当成「他人遗留」自动收编进基线、永久洗白（code_review P2-2）。
 * @param notes 追加诊断行（--base 生效 / 不可解析），调用方据此输出 INFO
 */
export function resolveResponsibleFiles(
  git: GitRunner,
  baseRef?: string | null,
  notes: string[] = [],
): string[] | null {
  const collect = (out: string | null): string[] => {
    if (out === null || !out.trim()) return [];
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((p: string) => toPosix(p));
  };
  if (baseRef) {
    const verified = git("rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`);
    if (verified?.trim()) {
      const scope = collect(git("diff", "--name-only", `${verified.trim()}...HEAD`));
      notes.push(
        `责任范围: --base ${baseRef.slice(0, 12)}（本次变更 ${scope.length} 个文件）—— CI 场景唯一可用上下文`,
      );
      return scope;
    }
    notes.push(`--base ${baseRef} 不可解析（非提交对象），已退回本地上下文解析`);
  }
  const files = new Set([
    ...collect(git("diff", "--cached", "--name-only")),
    ...collect(git("diff", "--name-only")),
    ...collect(git("ls-files", "--others", "--exclude-standard")),
  ]);
  if (files.size > 0) return [...files];
  const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  if (upstream?.trim()) {
    const pushed = collect(git("diff", "--name-only", `${upstream.trim()}...HEAD`));
    if (pushed.length > 0) return pushed;
  }
  return null;
}
