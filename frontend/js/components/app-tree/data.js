// ===== 树数据层（纯逻辑，不碰 DOM） =====

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
