// ===== 树数据层（纯逻辑，不碰 DOM） =====

/** 多选状态（实例级，由 AppTree 持有，多实例隔离防串扰） */
export interface SelectState {
  keys: Set<string>; // 选中的路径 Set
  lastKey: string | null; // 上次点击的路径（用于 Shift 范围选择）
}

/**
 * 切换选中状态
 * @param state - 实例级多选状态
 * @param key - 节点路径
 */
export function toggleSelect(state: SelectState, key: string): void {
  const { keys } = state;
  if (keys.has(key)) {
    keys.delete(key);
    // 如果删光了，重置 lastKey
    if (keys.size === 0) state.lastKey = null;
  } else {
    keys.add(key);
    state.lastKey = key;
  }
}

/**
 * 单选：清空后选中单个并设为 lastKey（用于单击选中，避免外部直接写 selectState）
 * @param state - 实例级多选状态
 * @param key - 节点路径
 */
export function selectSingle(state: SelectState, key: string): void {
  state.keys.clear();
  state.keys.add(key);
  state.lastKey = key;
}
