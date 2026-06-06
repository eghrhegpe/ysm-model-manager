// ===== 树渲染层 =====
// 直接引用旧版 tree.js 的渲染逻辑
import { hl } from "../../utils/dom.js";
import { fmt, fmtDate } from "../../utils/fmt.js";
import { fileIcon, isYsmName } from "../../utils/icon.js";
import { emptyHTML } from "./tpl.js";
import { fileRowHTML, folderRowHTML } from "./row-tpl.js";
import {
  renderDisplayName,
  renderModelNameWithHighlight,
} from "../../utils/display.js";
import { animateNumber } from "../../utils/animate.js";

// 直接导出旧版 buildTree 和 renderTree 逻辑
// 由旧版 tree.js 移植
function buildTree(entries, sortMode, search) {
  const root = {};
  const query = (search || "").trim().toLowerCase();
  const sorted = [...entries].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    if (sortMode === "size") {
      const sa = a.size || 0,
        sb = b.size || 0;
      return sb - sa;
    }
    if (sortMode === "date") {
      const da = a.modTime || 0,
        db = b.modTime || 0;
      return db - da;
    }
    return 0;
  });
  sorted.forEach((e) => {
    if (!e || !e.path) return;
    const relPath = e.path;
    if (query && !relPath.toLowerCase().includes(query)) return;
    const parts = relPath.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i]) continue;
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const fn = parts[parts.length - 1];
    if (fn) node[fn] = { _e: e };
  });
  return root;
}

/** 收集文件夹节点下的所有条目（含嵌套子文件夹） */
function dirEntries(node, full, dirPath) {
  const all = [];
  const keys = Object.keys(node);
  for (const k of keys) {
    const v = node[k];
    if (v._e) {
      all.push(v._e);
    } else {
      const subFull = dirPath ? dirPath + "/" + k : k;
      all.push(...dirEntries(v, subFull, dirPath));
    }
  }
  return all;
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
    const v = node[k],
      full = dirPath ? dirPath + "/" + k : k;
    if (v._e) {
      const e = v._e;
      if (hasSearch && !e.name.toLowerCase().includes(search.toLowerCase()))
        return;
      const nmHtml = hasSearch ? hl(e.name, search) : renderDisplayName(e.name);
      const dateStr = e.modTime ? fmtDate(e.modTime) : "";
      const extraCls = isYsmName(e.name) ? " ysm" : "";
      h += fileRowHTML(e, nmHtml, fileIcon(e.name), dateStr, extraCls);
    } else {
      const isLocked = k.startsWith("_");
      const shouldOpen = hasSearch || !!dirOpen[full];
      // 检查子文件启用/禁用状态
      const subEntries = dirEntries(node[k], full, dirPath);
      const hasEnabled = subEntries.some((e) => !e.banned);
      const hasDisabled = subEntries.some((e) => e.banned);
      h += folderRowHTML(
        k,
        full,
        shouldOpen,
        isLocked,
        hasEnabled,
        hasDisabled,
      );
      h += renderNode(v, full, search, sort, dirOpen);
      h += "</div>";
    }
  });
  return h;
}

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

export function updateStat(el, entries) {
  if (!el) return;
  let total = 0,
    enabled = 0,
    totalSize = 0;
  (entries || []).forEach((e) => {
    total++;
    if (!e.banned) enabled++;
    totalSize += e.size || 0;
  });
  const newText = `共 ${total} 项 (已启用 ${enabled}) · ${fmt(totalSize)}`;
  if (el.textContent !== newText) {
    // 数字跳动动画（在旧文本上动效，动完才替换完整文本）
    const oldTotal = parseInt(el.textContent.match(/(\d+)\s*项/)?.[1], 10) || 0;
    if (oldTotal !== total && total > 0) {
      animateNumber(el, total, 700);
      // 动画结束后设置完整新文本
      setTimeout(() => { el.textContent = newText; }, 700);
    } else {
      el.textContent = newText;
    }
  }
}
