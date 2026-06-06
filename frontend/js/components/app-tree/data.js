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

// 构建树结构：entries → 嵌套对象
export function buildTree(entries, sort, search) {
  const sorted = [...entries].sort((a, b) => {
    if (sort === "size") return (b.size || 0) - (a.size || 0);
    if (sort === "date") return (b.modTime || 0) - (a.modTime || 0);
    return a.name.localeCompare(b.name);
  });
  const query = (search || "").trim().toLowerCase();
  const root = {};
  sorted.forEach((e) => {
    if (query && !e.name.toLowerCase().includes(query)) return;
    const parts = e.path.replace(/\\/g, "/").split("/");
    let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i]) continue;
      if (!n[parts[i]]) n[parts[i]] = {};
      n = n[parts[i]];
    }
    n[parts[parts.length - 1]] = { _e: e };
  });
  return root;
}

// 递归检查文件夹是否包含匹配的文件
export function folderContains(node, query) {
  if (!query || !node) return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v._e) {
      if (v._e.name.toLowerCase().includes(query)) return true;
    } else {
      if (k.toLowerCase().includes(query)) return true;
      if (folderContains(v, query)) return true;
    }
  }
  return false;
}

// 按状态分组的统计
export function calcStats(entries) {
  const total = entries.length;
  const enabled = entries.filter((e) => !e.banned).length;
  const totalSize = entries.reduce((s, e) => s + (e.size || 0), 0);
  return { total, enabled, totalSize };
}
