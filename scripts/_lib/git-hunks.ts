/**
 * git-hunks.ts — 解析 `git diff --unified=0` 输出,提取「新增行号」集合(scripts/_lib)。
 *
 * 用途(2026-09 A4 行级增量闸):check-biome-lines.ts 需要回答「本次提交真正新增了哪些行」,
 * 以便只拦「新增行上的 biome 违规」——存量债(文件早已存在的违规)永不误伤。
 *
 * 为什么不用 biome/git 现成能力:
 *   - Biome `--changed` 是文件级增量(整文件全量 lint),无行级模式;
 *   - 行级增量须自取「staged diff 新增行号 ∩ biome 违规行号」,git diff 行号需自行解析。
 *
 * 解析约定(unified=0 的 hunk):
 *   - hunk 头 `@@ -a,b +c,d @@`:c = 该 hunk 在新文件中的起始行号(1-based);
 *   - hunk 内内容行以状态位开头:`+` 新增 / `-` 删除 / ` ` 上下文(unified=0 无上下文);
 *   - 新增行号从 c 起逐 `+` 行递增;`-` 行不占新行号;上下文行占位递增;
 *   - `+++` 之类文件头以 + 开头但位于 hunk 之外,必须忽略(仅 hunk 内状态位生效);
 *   - `\ No newline at end of file` 以 `\` 开头,无状态位,忽略。
 */
/**
 * 解析 git diff --unified=0 文本,返回新增行号集合(1-based,升序无关,仅作成员判定)。
 * @param diffText git diff --unified=0 的完整输出(可含多文件/多 hunk)
 * @returns 新增行号 Set<number>;空输入或纯删除返回空集合
 */
export function addedLinesFromDiff(diffText: string): Set<number> {
  const added = new Set<number>();
  const lines = diffText.split(/\r?\n/);
  let inHunk = false;
  let nextNew = 0;
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const m = hunkRe.exec(raw);
      if (m) {
        nextNew = Number(m[1]);
        inHunk = true;
      } else {
        inHunk = false; // 畸形 hunk 头,防御性退出
      }
      continue;
    }
    if (!inHunk) continue; // diff --git / index / --- / +++ / \ No newline 等文件头
    const mark = raw.charAt(0);
    if (mark === "+") {
      added.add(nextNew);
      nextNew += 1;
    } else if (mark === "-") {
      // 删除行不占新文件行号
    } else if (mark === " ") {
      nextNew += 1; // 上下文行(unified>0 时出现),占位递增
    } else {
      inHunk = false; // \ No newline 或下一个文件头,退出 hunk
    }
  }
  return added;
}

/**
 * 便捷包装:返回升序数组(调试/展示用)。
 */
export function addedLinesToArray(added: Set<number>): number[] {
  return [...added].sort((a, b) => a - b);
}
