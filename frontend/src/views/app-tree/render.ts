// ===== 树渲染层（虚拟滚动版）=====
import { t } from "../../core/i18n/t.ts";
import { hl } from "../../utils/dom/html.ts";
import { formatBytes, fmtDate } from "../../utils/dom/format.ts";
import { fileIcon, isYsmName } from "../../utils/icon/icon.ts";
import { emptyHTML } from "./tpl.ts";
import { fileRowHTML, folderRowHTML } from "./row-tpl.ts";
import { listFileRowHTML, listFolderRowHTML } from "./row-tpl-list.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { animateNumber } from "../../utils/animation/animate.ts";
import { selectState } from "./data.ts";
import type { TreeEntry } from "./loader.ts";
import {
  calcVisibleRange,
  installScrollSync,
} from "../../utils/dom/virtual-scroll.ts";

/** 树行高（虚拟滚动定高窗口，grid/list 两档；自 app-tree 原 virtual-scroll.ts 迁入） */
export const ROW_H_GRID = 28;
export const ROW_H_LIST = 24;

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
  return safeGet(RENDER_MODE_KEY) === "list" ? "list" : "grid";
}

/** Set render mode to localStorage */
export function setRenderMode(mode: RenderMode): void {
  safeSet(RENDER_MODE_KEY, mode);
}

// ——— 自底向上标注文件夹 hasEnabled/hasDisabled（一次遍历，消除 flattenVisible 内 dirEntries 重复递归） ———
const dirFlags = new WeakMap<TreeNode, { hasEnabled: boolean; hasDisabled: boolean }>();
function annotateDirNodes(node: TreeNode): void {
  for (const k of Object.keys(node)) {
    const child = node[k] as TreeNode;
    if (child._e) continue; // 文件节点，跳过
    annotateDirNodes(child);
    let hasEnabled = false;
    let hasDisabled = false;
    const stack: TreeNode[] = [child];
    while (stack.length) {
      const n = stack.pop()!;
      for (const ck of Object.keys(n)) {
        const cv = n[ck] as TreeNode;
        if (cv._e) {
          if (cv._e.banned) hasDisabled = true;
          else hasEnabled = true;
          if (hasEnabled && hasDisabled) break;
        } else {
          stack.push(cv);
        }
      }
      if (hasEnabled && hasDisabled) break;
    }
    dirFlags.set(child, { hasEnabled, hasDisabled });
  }
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
  // 筛选 + 建树：search（trim 后按路径匹配）/ filterPaths（按 fullPath 取交集）
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
  annotateDirNodes(root);
  return root;
}

// ——— 扁平化：将嵌套树拍平为一维行数组 ———
let _rowIdCounter = 0;

// ——— flattenVisible 拆分子函数（atFv* = app-tree/flatten-visible） ———
interface AtFvState {
  search: string;
  query: string;
  hasSearch: boolean;
  sort: string;
  dirOpen: Record<string, boolean>;
  mode: RenderMode;
  depth: number;
  indent: number;
}

function atFvNormParams(search: string): { query: string; hasSearch: boolean } {
  const hasSearch = !!(search || "").trim();
  const query = (search || "").trim().toLowerCase();
  return { query, hasSearch };
}

function atFvSortKeys(node: TreeNode, sort: string): string[] {
  return Object.keys(node).sort((a, b) => {
    const aIsDir = !(node[a] as TreeNode)._e;
    const bIsDir = !(node[b] as TreeNode)._e;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    const ea = (node[a] as TreeNode)._e;
    const eb = (node[b] as TreeNode)._e;
    if (sort === "size") return (eb?.size || 0) - (ea?.size || 0);
    if (sort === "date") return (eb?.modTime || 0) - (ea?.modTime || 0);
    return a.localeCompare(b);
  });
}

function atFvMatchSearch(full: string, state: AtFvState): boolean {
  if (!state.hasSearch) return true;
  return full.toLowerCase().includes(state.query);
}

function atFvMakeFileRow(
  e: TreeEntry,
  full: string,
  state: AtFvState,
): TreeRow | null {
  if (!atFvMatchSearch(full, state)) return null;
  const nmHtml = state.hasSearch ? hl(e.name, state.search.trim()) : renderDisplayName(e.name);
  const dateStr = e.modTime ? fmtDate(e.modTime) : "";
  const entryKey = e.fullPath || e.path;
  const selCls = selectState.keys.has(entryKey) ? " selected" : "";
  const nmCls = isYsmName(e.name) ? " ysm" : "";
  const ariaLevel = state.depth + 1;
  const html =
    state.mode === "list"
      ? listFileRowHTML(e, nmHtml, fileIcon(e.name), nmCls, state.indent, selCls, ariaLevel)
      : fileRowHTML(
          e,
          nmHtml,
          fileIcon(e.name),
          dateStr,
          nmCls,
          state.indent,
          selCls,
          ariaLevel,
        );
  return {
    id: ++_rowIdCounter,
    type: "file",
    key: entryKey,
    depth: state.depth,
    html,
  };
}

function atFvMakeFolderRow(
  k: string,
  full: string,
  sub: TreeNode,
  state: AtFvState,
): { row: TreeRow; shouldOpen: boolean } {
  const isLocked = k.startsWith("_");
  const shouldOpen = state.hasSearch || !!state.dirOpen[full];
  const flags = dirFlags.get(sub);
  const hasEnabled = !!flags?.hasEnabled;
  const hasDisabled = !!flags?.hasDisabled;
  const ariaLevel = state.depth + 1;
  const html =
    state.mode === "list"
      ? listFolderRowHTML(
          k,
          full,
          shouldOpen,
          isLocked,
          hasEnabled,
          hasDisabled,
          state.indent,
          ariaLevel,
        )
      : folderRowHTML(
          k,
          full,
          shouldOpen,
          isLocked,
          hasEnabled,
          hasDisabled,
          state.indent,
          ariaLevel,
        );
  return {
    row: {
      id: ++_rowIdCounter,
      type: "folder",
      key: full,
      depth: state.depth,
      html,
      isOpen: shouldOpen,
    },
    shouldOpen,
  };
}

function atFvRecurseDir(
  sub: TreeNode,
  full: string,
  state: AtFvState,
): TreeRow[] {
  const childState: AtFvState = {
    ...state,
    depth: state.depth + 1,
    indent: (state.depth + 1) * 16 + 4,
  };
  return atFvFlattenLevel(sub, full, childState);
}

function atFvFlattenLevel(
  node: TreeNode,
  dirPath: string,
  state: AtFvState,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const keys = atFvSortKeys(node, state.sort);
  keys.forEach((k) => {
    const v = node[k] as TreeNode;
    const full = dirPath ? dirPath + "/" + k : k;
    if (v._e) {
      const fileRow = atFvMakeFileRow(v._e, full, state);
      if (fileRow) rows.push(fileRow);
    } else {
      const { row, shouldOpen } = atFvMakeFolderRow(k, full, v, state);
      rows.push(row);
      if (shouldOpen) {
        rows.push(...atFvRecurseDir(v, full, state));
      }
    }
  });
  return rows;
}

export function flattenVisible(
  node: TreeNode,
  dirPath: string,
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  depth: number,
  mode: RenderMode,
): TreeRow[] {
  const { query, hasSearch } = atFvNormParams(search);
  const state: AtFvState = {
    search,
    query,
    hasSearch,
    sort,
    dirOpen,
    mode,
    depth,
    indent: depth * 16 + 4,
  };
  return atFvFlattenLevel(node, dirPath, state);
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

// ——— 虚拟滚动实例状态（原 4 个 declare global 伪字段 _vsCleanup/_vsRows/_vsMode/
// _vsResizeObserver 收敛于此：WeakMap 无类型污染 + 元素 GC 自动回收，杜绝全局接口污染）———

/** 单容器虚拟滚动实例状态 */
interface VsState {
  cleanup: (() => void) | null;
  rows: TreeRow[];
  mode: RenderMode | null;
  resizeObserver: ResizeObserver | null;
}

const vsStates = new WeakMap<HTMLElement, VsState>();

/** 取容器虚拟滚动状态（无则初始化空态；渲染/清理共用同一实例） */
function vsOf(container: HTMLElement): VsState {
  let s = vsStates.get(container);
  if (!s) {
    s = { cleanup: null, rows: [], mode: null, resizeObserver: null };
    vsStates.set(container, s);
  }
  return s;
}

/** 读取容器当前虚拟滚动行数据（events.ts / toolbar-events.ts 消费；替代 container._vsRows 伪字段） */
export function getVsRows(container: HTMLElement): TreeRow[] {
  return vsOf(container).rows;
}

/** 写入容器虚拟滚动行数据（renderTree 内部用；测试注入模拟渲染结果亦走此入口） */
export function setVsRows(container: HTMLElement, rows: TreeRow[]): void {
  vsOf(container).rows = rows;
}

/** 读取容器当前渲染模式（index.ts 键盘导航行高计算用；替代 container._vsMode 伪字段） */
export function getVsMode(container: HTMLElement): RenderMode | null {
  return vsOf(container).mode;
}

// ——— 入口：每次数据变化（搜索/排序/展开/折叠）调用 ———
/** 断开虚拟滚动相关监听 */
export function cleanupVirtualScroll(container: HTMLElement): void {
  const s = vsOf(container);
  s.cleanup?.();
  s.cleanup = null;
  s.resizeObserver?.disconnect();
  s.resizeObserver = null;
  s.rows = [];
  s.mode = null;
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
    container.innerHTML = emptyHTML("📁", t("tree.noModelFiles"));
    cleanupVirtualScroll(container);
    return;
  }
  const root = buildTree(entries, sort, search, filterPaths);
  const rows = flattenVisible(root, "", search, sort, dirOpen, 0, mode);
  if (!rows.length) {
    container.innerHTML = emptyHTML("🔍", t("tree.noMatchFiles"));
    cleanupVirtualScroll(container);
    return;
  }
  const st = vsOf(container);
  st.rows = rows;
  st.mode = mode;
  const rowH = mode === "list" ? ROW_H_LIST : ROW_H_GRID;
  renderSlice(container, rows, rowH);

  // 首次渲染容器可能还没布局 → 等 layout 后重新计算可见范围
  if (container.clientHeight === 0) {
    requestAnimationFrame(() => {
      const s2 = vsOf(container);
      if (s2.rows && s2.mode) {
        const m = s2.mode;
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, s2.rows, rh);
      }
    });
  }

  // 安装滚动同步（只装一次）
  if (!st.cleanup) {
    st.cleanup = installScrollSync(container, () => {
      const s2 = vsOf(container);
      const r = s2.rows;
      const m = s2.mode;
      if (r && r.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, r, rh);
      }
    });
  }

  // 容器尺寸变化时重新计算可见范围（侧边栏折叠/窗口 resize）
  if (!st.resizeObserver) {
    st.resizeObserver = new ResizeObserver(() => {
      const s2 = vsOf(container);
      const r = s2.rows;
      const m = s2.mode;
      if (r && r.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(container, r, rh);
      }
    });
    st.resizeObserver.observe(container);
  }
}

// 元素 → 在途统计动画句柄（连续搜索/过滤重渲染时取消旧动画与旧定时器，防堆积）
const statAnim = new WeakMap<HTMLElement, { cancel: () => void; timer: ReturnType<typeof setTimeout> }>();

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
  const newText = t("tree.statSummary", { total, enabled, size: formatBytes(totalSize) });
  // 先取消在途动画与定时器：连续触发时旧动画中间值会干扰下一次 textContent 判断，定时器堆积
  const prev = statAnim.get(el);
  if (prev) {
    prev.cancel();
    clearTimeout(prev.timer);
    statAnim.delete(el);
  }
  if (el.textContent !== newText) {
    const oldTotal = parseInt(el.textContent.match(/(\d+)\s*项/)?.[1] || "", 10) || 0;
    if (oldTotal > 0 && oldTotal !== total && total > 0) {
      const cancel = animateNumber(el, total, 700);
      const timer = setTimeout(() => {
        el.textContent = newText;
        statAnim.delete(el);
      }, 700);
      statAnim.set(el, { cancel, timer });
    } else {
      el.textContent = newText;
    }
  }
}
