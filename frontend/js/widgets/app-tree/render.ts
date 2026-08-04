// ===== 树渲染层（虚拟滚动版）=====
import { hl } from "../../utils/dom/dom.ts";
import { fmt, fmtDate } from "../../utils/dom/fmt.ts";
import { fileIcon, isYsmName } from "../../utils/icon.ts";
import { emptyHTML } from "./tpl.ts";
import { fileRowHTML, folderRowHTML } from "./row-tpl.ts";
import { listFileRowHTML, listFolderRowHTML } from "./row-tpl-list.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { animateNumber } from "../../utils/animation/animate.ts";
import { dbg } from "../../utils/debug.ts";
import { selectState } from "./data.ts";
import type { TreeEntry } from "./loader.ts";
import {
  ROW_H_GRID,
  ROW_H_LIST,
  calcVisibleRange,
  installScrollSync,
} from "./virtual-scroll.ts";

/** 扁平化行（虚拟滚动数据单元） */
export interface TreeRow {
  id: number;
  type: "file" | "folder";
  key: string;
  depth: number;
  html: string;
  isOpen?: boolean;
}

/** buildTree 嵌套节点（文件夹 = 子节点对象，文件 = { _e: entry }） */
export interface TreeNode {
  _e?: TreeEntry;
  [key: string]: TreeNode | TreeEntry | undefined;
}

/** 渲染模式 */
export type RenderMode = "grid" | "list";

// localStorage key for render mode
const RENDER_MODE_KEY = "ysm-render-mode";

/** Get render mode from localStorage, default to 'grid' */
export function getRenderMode(): RenderMode {
  try {
    const mode = localStorage.getItem(RENDER_MODE_KEY);
    return mode === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** Set render mode to localStorage */
export function setRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(RENDER_MODE_KEY, mode);
  } catch {}
}

// ——— 树构建（与原版一致） ———
export function buildTree(
  entries: TreeEntry[],
  sortMode: string,
  search: string,
  filterPaths: Set<string> | null,
): TreeNode {
  const root: TreeNode = {};
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
  // [DBG] 诊断：打印 filterPaths 状态 + 首条 entry 路径形式（用于排查 Windows 路径分隔符）
  (() => {
    const fpSize = filterPaths ? filterPaths.size : 0;
    const fpSample = filterPaths
      ? Array.from(filterPaths).slice(0, 2)
      : [];
    const eSample = sorted.slice(0, 2).map((e) => ({
      name: e.name,
      path: e.path,
      fullPath: e.fullPath,
    }));
    const hit =
      filterPaths &&
      sorted[0] &&
      filterPaths.has(sorted[0].fullPath || sorted[0].path);
    dbg(
      "buildTree",
      "entries=" + sorted.length + " filterPaths=" + fpSize,
      { fpSample, eSample, firstHit: hit, query },
    );
  })();
  sorted.forEach((e) => {
    if (!e || !e.path) return;
    const relPath = e.path;
    if (query && !relPath.toLowerCase().includes(query)) return;
    if (filterPaths && !filterPaths.has(e.fullPath || e.path)) return;
    const parts = relPath.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i]) continue;
      const child = node[parts[i]];
      if (!child || (child as TreeNode)._e) {
        node[parts[i]] = {};
      }
      node = node[parts[i]] as TreeNode;
    }
    const fn = parts[parts.length - 1];
    if (fn) node[fn] = { _e: e };
  });
  return root;
}

/** 收集文件夹下所有条目 */
function dirEntries(node: TreeNode): TreeEntry[] {
  const all: TreeEntry[] = [];
  for (const k of Object.keys(node)) {
    const v = node[k] as TreeNode;
    if (v._e) all.push(v._e);
    else all.push(...dirEntries(v));
  }
  return all;
}

// ——— 扁平化：将嵌套树拍平为一维行数组 ———
let _rowIdCounter = 0;

export function flattenVisible(
  node: TreeNode,
  dirPath: string,
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  depth: number,
  mode: RenderMode,
): TreeRow[] {
  const hasSearch = !!(search || "").trim();
  const query = (search || "").toLowerCase();
  const keys = Object.keys(node).sort((a, b) => {
    const aIsDir = !(node[a] as TreeNode)._e,
      bIsDir = !(node[b] as TreeNode)._e;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    const ea = (node[a] as TreeNode)._e,
      eb = (node[b] as TreeNode)._e;
    if (sort === "size") return (eb?.size || 0) - (ea?.size || 0);
    if (sort === "date") return (eb?.modTime || 0) - (ea?.modTime || 0);
    return a.localeCompare(b);
  });

  const rows: TreeRow[] = [];
  const indent = depth * 16 + 4;

  keys.forEach((k) => {
    const v = node[k] as TreeNode;
    const full = dirPath ? dirPath + "/" + k : k;

    if (v._e) {
      // — 文件行 —
      const e = v._e;
      if (hasSearch && !e.name.toLowerCase().includes(query)) return;
      const nmHtml = hasSearch ? hl(e.name, search) : renderDisplayName(e.name);
      const dateStr = e.modTime ? fmtDate(e.modTime) : "";
      // selectState.keys 存的是 data-fullpath（绝对路径），必须用 e.fullPath 匹配
      const entryKey = e.fullPath || e.path;
      const selCls = selectState.keys.has(entryKey) ? " selected" : "";
      const nmCls = isYsmName(e.name) ? " ysm" : "";
      // 根据模式选择模板
      const html =
        mode === "list"
          ? listFileRowHTML(e, nmHtml, fileIcon(e.name), nmCls, indent, selCls)
          : fileRowHTML(
              e,
              nmHtml,
              fileIcon(e.name),
              dateStr,
              nmCls,
              indent,
              selCls,
            );
      rows.push({
        id: ++_rowIdCounter,
        type: "file",
        key: entryKey,
        depth,
        html,
      });
    } else {
      // — 文件夹行 —
      const isLocked = k.startsWith("_");
      const shouldOpen = hasSearch || !!dirOpen[full];
      const sub = dirEntries(node[k] as TreeNode);
      const hasEnabled = sub.some((e) => !e.banned);
      const hasDisabled = sub.some((e) => e.banned);
      // 根据模式选择模板
      const html =
        mode === "list"
          ? listFolderRowHTML(
              k,
              full,
              shouldOpen,
              isLocked,
              hasEnabled,
              hasDisabled,
              indent,
            )
          : folderRowHTML(
              k,
              full,
              shouldOpen,
              isLocked,
              hasEnabled,
              hasDisabled,
              indent,
            );
      rows.push({
        id: ++_rowIdCounter,
        type: "folder",
        key: full,
        depth,
        html,
        isOpen: shouldOpen,
      });
      if (shouldOpen) {
        rows.push(
          ...flattenVisible(
            v,
            full,
            search,
            sort,
            dirOpen,
            depth + 1,
            mode,
          ),
        );
      }
    }
  });
  return rows;
}

// ——— 仅渲染可见行的 HTML，用 padding 撑出滚动高度 ———
function renderSlice(container: HTMLElement, rows: TreeRow[], rowH: number): void {
  const total = rows.length;
  // 首次渲染时容器可能还没布局（clientHeight=0），全量渲染
  const range =
    container.clientHeight > 0
      ? calcVisibleRange(container, total, rowH)
      : { startIdx: 0, endIdx: total };
  const slice = rows.slice(range.startIdx, range.endIdx);

  let buf = "";
  for (let i = 0; i < slice.length; i++) {
    buf += slice[i].html;
  }
  const topPad = range.startIdx * rowH;
  const bottomPad = (total - range.endIdx) * rowH;
  container.innerHTML =
    '<div class="vs-wrap" style="padding-top:' +
    topPad +
    "px;padding-bottom:" +
    bottomPad +
    'px">' +
    buf +
    "</div>";
}

// ——— 入口：每次数据变化（搜索/排序/展开/折叠）调用 ———
/** 断开虚拟滚动相关监听 */
function _cleanupVS(container: HTMLElement): void {
  container._vsCleanup?.();
  container._vsCleanup = null;
  container._vsResizeObserver?.disconnect();
  container._vsResizeObserver = null;
  container._vsRows = [];
  container._vsMode = null;
}

export function renderTree(
  container: HTMLElement,
  entries: TreeEntry[],
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  filterPaths: Set<string> | null,
  mode: RenderMode = "grid",
): void {
  if (!entries.length) {
    container.innerHTML = emptyHTML("📁", "暂无模型文件");
    _cleanupVS(container);
    return;
  }
  const root = buildTree(entries, sort, search, filterPaths);
  const rows = flattenVisible(root, "", search, sort, dirOpen, 0, mode);
  if (!rows.length) {
    container.innerHTML = emptyHTML("🔍", "未找到匹配的文件");
    _cleanupVS(container);
    return;
  }
  container._vsRows = rows;
  container._vsMode = mode;
  const rowH = mode === "list" ? ROW_H_LIST : ROW_H_GRID;
  renderSlice(container, rows, rowH);

  // 首次渲染容器可能还没布局 → 等 layout 后重新计算可见范围
  if (container.clientHeight === 0) {
    requestAnimationFrame(() => {
      if (container._vsRows && container._vsMode) {
        const m = container._vsMode;
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, container._vsRows, rh);
      }
    });
  }

  // 安装滚动同步（只装一次）
  if (!container._vsCleanup) {
    container._vsCleanup = installScrollSync(container, () => {
      const r = container._vsRows;
      const m = container._vsMode;
      if (r && r.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, r, rh);
      }
    });
  }

  // 容器尺寸变化时重新计算可见范围（侧边栏折叠/窗口 resize）
  if (!container._vsResizeObserver) {
    container._vsResizeObserver = new ResizeObserver(() => {
      const r = container._vsRows;
      const m = container._vsMode;
      if (r && r.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, r, rh);
      }
    });
    container._vsResizeObserver.observe(container);
  }
}

// ——— 选中计数用（兼容旧接口） ———
export function updateStat(el: HTMLElement | null, entries: TreeEntry[]): void {
  if (!el) return;
  if (!Array.isArray(entries)) entries = [];
  let total = 0,
    enabled = 0,
    totalSize = 0;
  (entries || []).forEach((e) => {
    total++;
    if (!e.banned) enabled++;
    totalSize += e.size || 0;
  });
  const newText =
    "共 " + total + " 项 (已启用 " + enabled + ") · " + fmt(totalSize);
  if (el.textContent !== newText) {
    const oldTotal = parseInt(el.textContent.match(/(\d+)\s*项/)?.[1] || "", 10) || 0;
    if (oldTotal > 0 && oldTotal !== total && total > 0) {
      animateNumber(el, total, 700);
      setTimeout(() => {
        el.textContent = newText;
      }, 700);
    } else {
      el.textContent = newText;
    }
  }
}
