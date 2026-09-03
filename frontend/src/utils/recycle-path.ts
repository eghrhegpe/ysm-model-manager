// ===== 回收站路径段判定（单一实现，社区/parity 层共用）=====
// [G5 收口] 原 features/community/data.ts `isRecyclePath` 与 backend/web-community.ts
// `isRecycleRel` 逐字重复（拆段 EqualFold），且注释误引 Go `fsutil.IsRecycleDir`
// （基名版）。本 helper 命名对齐 Go `sync.hasRecycleSegment`（sync.go:534，逐字同构），
// 消除前端双实现与注释误导——后续对齐点检索只搜 hasRecycleSegment 一个名字。

/**
 * 路径任一段是否为回收站目录 `.recycle`（大小写不敏感 EqualFold）。
 *
 * 对齐 Go `sync.hasRecycleSegment`（sync.go:534-541）的段判定语义——对一次性传入的
 * 完整相对/绝对路径判定「路径上任何层级进入过回收站」。注意与 Go `fsutil.IsRecycleDir`
 * （walk.go:113-117，filepath.Base 基名精确匹配）的区别：后者供 walk 递归时对每个目录
 * 单独判定（递归效果等价段判定），而本函数直接拆段，两者不可互换——
 * 若误改为基名匹配，`.recycle/a.ysm` 这类路径会漏判。
 *
 * 段判定天然不误伤文件名含 ".recycle" 的正常模型（如 my.recycle.backup.ysm）——
 * 该文件名不是目录段，不会命中。
 *
 * @param relPath 路径（`/` 或 `\` 分隔均可；空串/无段 → false）
 */
export function hasRecycleSegment(relPath: string): boolean {
  const segs = relPath.split(/[/\\]/);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] && segs[i].toLowerCase() === ".recycle") return true;
  }
  return false;
}
