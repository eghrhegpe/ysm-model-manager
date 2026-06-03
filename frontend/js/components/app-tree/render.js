// ===== 树渲染层（输入数据 → 输出 HTML 字符串，不绑事件） =====
import { hl } from "../../utils/dom.js";
import { fmt, fmtDate } from "../../utils/fmt.js";
import { fileIcon } from "../../utils/icon.js";
import { buildTree, folderContains, calcStats } from "./data.js";
import { emptyHTML } from "./tpl.js";
import { fileRowHTML, folderRowHTML } from "./row-tpl.js";

// 渲染完整树（替换容器 innerHTML）
export function renderTree(container, entries, search, sort, dirOpen) {
  if (!entries.length) {
    container.innerHTML = emptyHTML("📁", "暂无模型文件");
    return;
  }
  const root = buildTree(entries, sort, search);
  const html = renderNode(root, "", search, sort, dirOpen);
  if (!html) {
    container.innerHTML = emptyHTML("🔍", "未找到匹配的文件");
    return;
  }
  container.innerHTML = html;
}

// 更新底部统计
export function updateStat(el, entries) {
  if (!el) return;
  const s = calcStats(entries);
  el.textContent = `共 ${s.total} 项 (已启用 ${s.enabled}) · ${fmt(s.totalSize)}`;
}

function renderNode(node, dirPath, search, sort, dirOpen) {
  const hasSearch = !!(search || "").trim();
  const keys = Object.keys(node).sort((a, b) => {
    const aIsDir = !node[a]._e,
      bIsDir = !node[b]._e;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    const ea = node[a]._e,
      eb = node[b]._e;
    if (sort === "size") return (eb?.size || 0) - (ea?.size || 0);
    if (sort === "date") return (eb?.modTime || 0) - (ea?.modTime || 0);
    return a.localeCompare(b);
  });

  let h = "";
  keys.forEach((k) => {
    const v = node[k];
    const full = dirPath ? dirPath + "/" + k : k;

    if (v._e) {
      const e = v._e;
      if (hasSearch && !e.name.toLowerCase().includes(search.toLowerCase()))
        return;
      const nmHtml = hasSearch ? hl(e.name, search) : e.name;
      const dateStr = e.modTime ? fmtDate(e.modTime) : "";
      const icon = fileIcon(e.name);
      h += fileRowHTML(e, nmHtml, icon, dateStr);
    } else {
      const isLocked = k.startsWith("_");
      const shouldOpen = hasSearch || !!dirOpen[full];
      const containsMatch = hasSearch
        ? folderContains(v, search.toLowerCase())
        : false;
      const isOpen = shouldOpen || (hasSearch && containsMatch);
      h += folderRowHTML(k, full, isOpen, isLocked);
      h += renderNode(v, full, search, sort, dirOpen);
      h += "</div>"; // close .ch
    }
  });
  return h;
}
