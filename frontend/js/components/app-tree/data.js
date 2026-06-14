// ===== 树数据层（纯逻辑，不碰 DOM） =====

// 多选状态
export const selectState = {
  keys: new Set(), // 选中的路径 Set
  lastKey: null, // 上次点击的路径（用于 Shift 范围选择）
};

/**
 * 切换选中状态（支持 Ctrl/Shift）
 * @param {string} key - 节点路径
 * @param {boolean} isRange - 是否 Shift 范围选择
 */
export function toggleSelect(key, isRange = false) {
  const { keys, lastKey } = selectState;
  if (isRange && lastKey && key !== lastKey) {
    // Shift 范围选择：全选或全不选
    // 简单模式：选中从 lastKey 到 key 之间的所有文件
    // 实际范围计算在 events.js 中处理，这里只做标记
    keys.add(key);
    selectState.lastKey = key;
    return;
  }
  if (keys.has(key)) {
    keys.delete(key);
    // 如果删光了，重置 lastKey
    if (keys.size === 0) selectState.lastKey = null;
  } else {
    keys.add(key);
    selectState.lastKey = key;
  }
}
