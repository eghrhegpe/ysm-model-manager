// ===== 树数据层（纯逻辑，不碰 DOM） =====

/** 多选状态 */
export const selectState: {
  keys: Set<string>; // 选中的路径 Set
  lastKey: string | null; // 上次点击的路径（用于 Shift 范围选择）
} = {
  keys: new Set(),
  lastKey: null,
};

/**
 * 切换选中状态
 * @param key - 节点路径
 */
export function toggleSelect(key: string): void {
  const { keys } = selectState;
  if (keys.has(key)) {
    keys.delete(key);
    // 如果删光了，重置 lastKey
    if (keys.size === 0) selectState.lastKey = null;
  } else {
    keys.add(key);
    selectState.lastKey = key;
  }
}
