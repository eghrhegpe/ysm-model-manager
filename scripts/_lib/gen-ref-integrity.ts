#!/usr/bin/env node
/**
 * gen-ref-integrity.ts — 生成物「引用完整性」判定（并行会话卷带 · 第二道门）。
 *
 * 背景（2026-10-09 审核体系锐评第三刀，实测驱动）：
 *   ADR-151-d1 解决了「**身份**」问题——gen 期间新增的文件无法区分「gen 新建」与
 *   「并发会话新建」，故未知新建一律不收编。但它没解决「**引用**」问题：
 *   聚合型生成物（`docs/adr/index.md`、`docs/knowledge/index.md`、`routes*.md`、
 *   `sidebar.gen.mjs`…）的**内容**是全体输入的纯函数，因此会把**别人尚未入库的新文件**
 *   写进自己的正文。生成物本身合法、干净、可复现，于是被 gen-stage 正常收编进本次提交——
 *   结果提交里出现「登记表指向一个远端不存在的文件」。
 *
 *   实证（本次锐评过程中亲历）：另一会话新建 `docs/adr/decisions/ADR-235-d1-*.md` 后尚未
 *   commit，我的一次提交被钩子 gen-stage 卷带了重新生成的 `docs/adr/index.md`——该表新增
 *   一行指向那个未跟踪文件。本地全绿（文件在磁盘上），**远端必红**（ADR 登记/链接检查
 *   找不到目标）。仓规「生成物交就交当前全量态」在单会话成立、在并行会话下留了这个缝。
 *
 * 判定（本模块）：一个生成物若引用了**不在索引里**的仓库文件，就不该在本次提交里收编。
 *   与 ADR-151-d1 同一条红线：**漏收编无害**（生成物滞留工作区，等目标入库后的下一次
 *   commit 自然带走）／**误收编有害**（提交里留下悬空引用，且污染他人工作）。
 *
 * 保守边界（宁可漏报，不可误报——误报会让合法提交的生成物永久滞留）：
 *   - 只认 **markdown 相对链接**（`./x.md` / `../y/z.md`，允许 `#anchor` 后缀）；
 *   - 跳过 http(s)/mailto/绝对路径/纯锚点；
 *   - 跳过代码围栏（``` / ~~~）内的行——文档里大量示例链接不是真引用；
 *   - 只对 `.md` 文件做提取（其它生成物的引用语法各异，v1 不猜）。
 *
 * 依赖：零依赖（读文件由调用方注入，便于契约测试；git 调用亦在调用方）。
 *
 * 用法：
 *   import { filterUnindexedGenStaged, extractRepoRefs } from './_lib/gen-ref-integrity.ts';
 *   const { keep, dropped } = filterUnindexedGenStaged(stageList, indexed, readFileOrNull);
 *
 * 退出码：本模块无独立 CLI（被 _lib/gen-stage.ts 的 CLI 路径消费）。
 */
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "./to-posix.ts";

/** markdown 行内链接目标提取（宽松：`[文案](目标)` 与 `[文案](目标 "title")`）。 */
const LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * 抽取文本中的**仓库内相对引用**（markdown 链接），解析为相对仓库根的正斜杠路径。
 *
 * @param text     文件内容
 * @param filePath 该文件相对仓库根的路径（用于把 `../x` 解析成仓库路径）
 * @returns 去重后的仓库相对路径；无法解析/越出仓库/非相对/带 scheme 的一律忽略
 */
export function extractRepoRefs(text: string, filePath: string): string[] {
  const dir = toPosix(path.posix.dirname(toPosix(filePath)));
  const out = new Set<string>();
  let inFence = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    // 代码围栏切换（``` 或 ~~~ 开头）：围栏内的链接是示例，不是真引用
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null = LINK_RE.exec(line);
    while (m) {
      const target = m[1]!;
      m = LINK_RE.exec(line);
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http(s)/mailto/其它 scheme
      if (target.startsWith("#") || target.startsWith("/")) continue; // 纯锚点 / 站点绝对路径
      if (!target.startsWith("./") && !target.startsWith("../")) continue; // 只认显式相对
      const clean = target.split("#")[0]!;
      if (!clean || !/\.(md|mdx)$/i.test(clean)) continue; // v1 只认 markdown 目标
      const resolved = toPosix(path.posix.normalize(path.posix.join(dir, clean)));
      if (resolved.startsWith("..")) continue; // 越出仓库根
      out.add(resolved);
    }
  }
  return [...out].sort();
}

/** 从引用集合里挑出**不在索引**（未入库）的那些。 */
export function findUnindexedRefs(
  refs: readonly string[],
  indexed: ReadonlySet<string>,
): string[] {
  return refs.filter((r) => !indexed.has(r));
}

/** 单文件违规详情。 */
export interface RefViolation {
  /** 生成物路径（仓库相对）。 */
  file: string;
  /** 它引用但未入库的目标（去重有序）。 */
  missing: string[];
}

export interface FilterResult {
  /** 可安全收编的文件（按输入序）。 */
  keep: string[];
  /** 被拒收编的文件 + 原因（调用方据此打 stderr 提示）。 */
  dropped: RefViolation[];
}

/**
 * 过滤待收编的生成物：引用了未入库文件的，一律退出本次收编（ADR-151-d1 同向红线）。
 *
 * @param files    待收编的生成物路径（相对仓库根，正斜杠）
 * @param indexed  索引内的路径集合（`git ls-files` − 本次暂存删除）
 * @param readFile 读文件（返回 null = 读不到/二进制 → 视为无引用，保守放行）
 */
export function filterUnindexedGenStaged(
  files: readonly string[],
  indexed: ReadonlySet<string>,
  readFile: (p: string) => string | null = defaultReadFile,
): FilterResult {
  const keep: string[] = [];
  const dropped: RefViolation[] = [];
  for (const f of files) {
    const rel = toPosix(f);
    if (!/\.md$/i.test(rel)) {
      keep.push(f);
      continue;
    }
    const text = readFile(rel);
    if (text === null) {
      keep.push(f);
      continue;
    }
    const missing = findUnindexedRefs(extractRepoRefs(text, rel), indexed);
    if (missing.length) dropped.push({ file: rel, missing });
    else keep.push(f);
  }
  return { keep, dropped };
}

/** 默认读文件：失败（不存在/权限/二进制）返回 null。 */
function defaultReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
