// ===== 通用数组操作（纯函数层）=====
// 从 site/edit.ts 的拖拽排序 drop 逻辑抽出，供单测覆盖（ADR-023 L3）。

/**
 * 将 arr[from] 移到 arr[to]（原地修改，返回同一数组）。
 * 越界 / from===to 时原样返回。语义与「先 splice 移除再在 to 处插入」一致。
 */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= arr.length ||
    to >= arr.length ||
    from === to
  ) {
    return arr;
  }
  const [removed] = arr.splice(from, 1);
  arr.splice(to, 0, removed);
  return arr;
}
