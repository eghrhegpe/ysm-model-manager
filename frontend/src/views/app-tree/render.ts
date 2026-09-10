// ===== 树渲染层（虚拟滚动版）=====
import { t } from "@/core/i18n/t.ts";
import { animateNumber } from "@/utils/animation/animate.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { calcVisibleRange, installScrollSync } from "@/utils/dom/virtual-scroll.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { entryKey } from "./entry-key.ts";
import type { TreeEntry } from "./loader.ts";
import { fileRowHTML, folderRowHTML } from "./row-tpl.ts";
import { listFileRowHTML, listFolderRowHTML } from "./row-tpl-list.ts";
import { emptyStateHTML } from "./tpl.ts";

/** 每级缩进像素（树深 → padding-left） */
const INDENT_PER_LEVEL = 16;

/** 树行高（虚拟滚动定高窗口，grid/list 两档；自 app-tree 原 virtual-scroll.ts 迁入） */
export const ROW_H_GRID = 28;
export const ROW_H_LIST = 24;

/** 扁平化行（虚拟滚动数据单元） */
export interface TreeRow {
  id: number;
  type: "file" | "folder";
  /**
   * 行键。file 行 = 磁盘完整路径（`entryKey`，与 DOM `data-fullpath` /
   * `selectState.keys` 同源，ADR-222）；folder 行 = 树内拼接路径
   * （文件夹不参与选中，其键仅用于 `dirOpen` 展开态，自洽子系统）。
   */
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

// ——— buildTree 缓存（memoization：搜索击键只重跑 flattenVisible，跳过 buildTree） ———

/** 缓存条目 */
interface BuildCacheEntry {
  key: string;
  root: TreeNode;
}

/** 绑定到 TreeRenderCtx 实例的缓存（WeakMap —— ctx GC 自动回收） */
const buildCache = new WeakMap<TreeRenderCtx, BuildCacheEntry>();

/**
 * 带缓存的 buildTree。
 * 缓存 key = entries 内容指纹（全路径 + banned 位）+ sort + filterPaths 全量序列化。
 * 输入内容不变时命中缓存，跳过 buildTree + annotateDirNodes 整段 O(n) 计算；
 * 任一输入变化（改名/banned 翻转/过滤集替换）即重建——键即内容指纹，无失效钩子依赖。
 */
function getBuildTreeCached(
  ctx: TreeRenderCtx,
  entries: TreeEntry[],
  sort: string,
  filterPaths: Set<string> | null,
): TreeNode {
  // code_review ee7c6077a #1/#2/#3（P1/P2）：缓存键必须是 buildTree 输入的内容指纹
  // ——原键只含 length + 首末 path + filterPaths.size，中间项改名/banned 翻转/等尺寸
  // 过滤集替换全部碰撞 → 服务过期树（旧行名/旧勾选态/点击指向已不存在路径）。
  // 改为内容派生：全路径 + banned 位拼串（O(n) 远廉于其守卫的 buildTree）+
  // filterPaths 排序全量序列化；dirOpen 项删除——buildTree 不消费它，留着只会
  // 造成折叠/展开时的无谓 miss + 误导性地宣称依赖
  const cacheKey = [
    entries.map((e) => (e.banned ? `*${e.path}` : e.path)).join("\n"),
    sort,
    filterPaths ? [...filterPaths].sort().join("\n") : "null",
  ].join("|");

  const cached = buildCache.get(ctx);
  if (cached && cached.key === cacheKey) {
    return cached.root; // ← 命中缓存，跳过 buildTree
  }

  const root = buildTree(entries, sort, filterPaths);
  buildCache.set(ctx, { key: cacheKey, root });
  return root;
}

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
// O(n²)→O(n) 重写（审计实证，见 render.test.ts 深链绊线）：
// 原实现「外层 for 每目录 + 内层 stack 重扫该目录整棵子树」最坏 O(n²)
// （深链 2000 级 115.9ms、每倍增 3-6×），且递归深度=树深，10000 级深链直接
// Maximum call stack size exceeded。现改为显式栈迭代后序：父目录 flags =
// 直接文件贡献 ∪ 各子目录已算好的 flags，每节点恰好访问一次，O(n) 且无递归。
function annotateDirNodes(root: TreeNode): void {
  interface Frame {
    node: TreeNode;
    childIdx: number;
  }
  const stack: Frame[] = [{ node: root, childIdx: 0 }];
  const order: TreeNode[] = [];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const keys = Object.keys(top.node).filter((k) => k !== "_e");
    if (top.childIdx < keys.length) {
      const child = top.node[keys[top.childIdx]] as TreeNode | undefined;
      top.childIdx++;
      if (child && typeof child === "object" && !child._e) {
        stack.push({ node: child, childIdx: 0 });
      }
    } else {
      order.push(top.node);
      stack.pop();
    }
  }
  for (const node of order) {
    let hasEnabled = false;
    let hasDisabled = false;
    for (const k of Object.keys(node)) {
      if (k === "_e") continue;
      const child = node[k];
      if (child && typeof child === "object") {
        if ((child as TreeNode)._e) {
          const e = (child as TreeNode)._e as TreeEntry;
          if (e.banned) hasDisabled = true;
          else hasEnabled = true;
        } else {
          const flags = dirFlags.get(child as TreeNode);
          if (flags) {
            if (flags.hasEnabled) hasEnabled = true;
            if (flags.hasDisabled) hasDisabled = true;
          }
        }
      }
    }
    dirFlags.set(node, { hasEnabled, hasDisabled });
  }
}

// ——— 语义调用包装：树参数 → 行模板渲染参数 ———
// flattenVisible 只持有 (entry/fullPath/depth) 语义信息，row-tpl 需要
// (nmHtml, icon, dateStr, nmCls, indent, rowCls, ariaLevel) 渲染参数。
// 两个包装函数负责桥接，让调用方类型合法、@ts-expect-error 不必存在。

/** 文件行包装：entry + depth → 完整 fileRowHTML / listFileRowHTML 调用 */
function fileRowFromEntry(entry: TreeEntry, depth: number, mode: RenderMode): string {
  const nmHtml = renderDisplayName(entry.name);
  const indent = depth * INDENT_PER_LEVEL;
  return mode === "list"
    ? listFileRowHTML(entry, nmHtml, "📄", "", indent, "", depth + 1)
    : fileRowHTML(entry, nmHtml, "📄", "", "", indent, "", depth + 1);
}

/** 文件夹行包装：name + depth + isOpen + flags → 完整 folderRowHTML / listFolderRowHTML 调用 */
function folderRowFromNode(
  name: string,
  fullPath: string,
  depth: number,
  isOpen: boolean,
  flags: { hasEnabled: boolean; hasDisabled: boolean },
  mode: RenderMode,
): string {
  const indent = depth * INDENT_PER_LEVEL;
  return mode === "list"
    ? listFolderRowHTML(
        name,
        fullPath,
        isOpen,
        false,
        flags.hasEnabled,
        flags.hasDisabled,
        indent,
        depth + 1,
      )
    : folderRowHTML(
        name,
        fullPath,
        isOpen,
        false,
        flags.hasEnabled,
        flags.hasDisabled,
        indent,
        depth + 1,
      );
}

// ——— 扁平化可见行（虚拟滚动数据源） ———
export function flattenVisible(
  root: TreeNode,
  prefix: string,
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  depth: number,
  mode: RenderMode,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const searchTrimmed = search.trim();
  const isSearch = searchTrimmed.length > 0;
  const searchLower = searchTrimmed.toLowerCase();
  // 显式栈迭代（防深链栈溢出）：每帧 = (节点, 前缀, 深度, 子键迭代器)
  interface Frame {
    node: TreeNode;
    prefix: string;
    depth: number;
    childKeys: string[];
    childIdx: number;
  }
  const stack: Frame[] = [{ node: root, prefix, depth, childKeys: [], childIdx: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.childIdx === 0) {
      // 首次进入该帧：计算排序后的子键列表
      const entries = Object.keys(top.node)
        .filter((k) => k !== "_e")
        .map((k) => ({ key: k, node: top.node[k] as TreeNode | TreeEntry }))
        .filter(({ node }) => node && typeof node === "object");
      entries.sort((a, b) => {
        const aIsDir = !(a.node && (a.node as TreeNode)._e);
        const bIsDir = !(b.node && (b.node as TreeNode)._e);
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        const aName = a.key.toLowerCase();
        const bName = b.key.toLowerCase();
        return sort === "date" ? 0 : aName < bName ? -1 : aName > bName ? 1 : 0;
      });
      top.childKeys = entries.map((e) => e.key);
    }
    if (top.childIdx < top.childKeys.length) {
      const name = top.childKeys[top.childIdx];
      top.childIdx++;
      const node = top.node[name] as TreeNode | TreeEntry;
      const fullPath = top.prefix ? `${top.prefix}/${name}` : name;
      if (node && (node as TreeNode)._e) {
        const entry = (node as TreeNode)._e as TreeEntry;
        if (isSearch && !entry.path.toLowerCase().includes(searchLower)) continue;
        const html = fileRowFromEntry(entry, top.depth, mode);
        // key 走 entryKey（磁盘路径），非树内拼接路径——与 DOM data-fullpath /
        // selectState.keys 同源，否则选中相关的 indexOf 比对全部失配（ADR-222）
        rows.push({ id: rows.length, type: "file", key: entryKey(entry), depth: top.depth, html });
      } else if (node) {
        const isOpen = dirOpen[fullPath] || false;
        const flags = dirFlags.get(node as TreeNode) ?? { hasEnabled: false, hasDisabled: false };
        const html = folderRowFromNode(name, fullPath, top.depth, isOpen, flags, mode);
        rows.push({
          id: rows.length,
          type: "folder",
          key: fullPath,
          depth: top.depth,
          html,
          isOpen,
        });
        if (isOpen || isSearch) {
          stack.push({
            node: node as TreeNode,
            prefix: fullPath,
            depth: top.depth + 1,
            childKeys: [],
            childIdx: 0,
          });
        }
      }
    } else {
      stack.pop();
    }
  }
  return rows;
}

// ——— 构建树（buildTree） ———
export function buildTree(
  entries: TreeEntry[],
  _sort: string,
  filterPaths: Set<string> | null,
): TreeNode {
  const root: TreeNode = {};
  const filtered = filterPaths ? entries.filter((e) => filterPaths.has(e.fullPath)) : entries;
  for (const entry of filtered) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!current[p] || (current[p] as TreeNode)._e) {
        current[p] = {};
      }
      current = current[p] as TreeNode;
    }
    const fileName = parts[parts.length - 1];
    if (fileName) {
      current[fileName] = { _e: entry };
    }
  }
  annotateDirNodes(root);
  return root;
}

// ——— 渲染上下文（实例级，AppTree 持有，多实例隔离） ———
export interface TreeRenderCtx {
  /** 行模板缓存（WeakMap——row 对象为 key，每次 flattenVisible 产生新 row 对象自动 GC 回收） */
  rowTplCache: WeakMap<object, HTMLTemplateElement>;
  /** 虚拟滚动实例状态（WeakMap——DOM 元素为 key，元素 GC 自动回收） */
  vsStates: WeakMap<HTMLElement, VsState>;
  /** 统计动画句柄（WeakMap——DOM 元素为 key） */
  statAnim: WeakMap<HTMLElement, { cancel: () => void; timer: ReturnType<typeof setTimeout> }>;
}

/** 创建渲染上下文（AppTree 实例化时调用） */
export function createTreeRenderCtx(): TreeRenderCtx {
  return {
    rowTplCache: new WeakMap(),
    vsStates: new WeakMap(),
    statAnim: new WeakMap(),
  };
}

// ——— 仅渲染可见行：vs-wrap + 行节点复用（code review #5）———
// 原实现每个滚动 rAF 帧字符串拼接 slice 后 container.innerHTML = ... 整体重解析、
// 销毁重建全部可见行 DOM（持续 GC + reparse）。现改为：
//   ① 行节点按 row 对象缓存（WeakMap——renderTree 每次扁平化产生新 row 对象，
//      旧条目随数组 GC 自动回收，无手工失效负担）；滚动只改变可见窗口，
//      缓存节点跨帧复用，仅增删首尾行。
//   ② vs-wrap 容器持久复用，仅改 padding 与 replaceChildren 行片段（对齐
//      community/virtual-list.ts 范式）。
// 安全性：树事件全为容器级委托（closest 查询），行节点无独立监听器；选中态
// （rowCls/aria-selected）来自数据渲染，与 row 对象一一对应，复用不串行。

/** 取行 DOM 节点（缓存未命中时由 row.html 解析一次；命中时 cloneNode） */
function rowElOf(ctx: TreeRenderCtx, row: TreeRow): HTMLElement {
  let tpl = ctx.rowTplCache.get(row);
  if (!tpl) {
    tpl = document.createElement("template");
    tpl.innerHTML = row.html;
    ctx.rowTplCache.set(row, tpl);
  }
  const el = tpl.content.firstElementChild as HTMLElement | null;
  if (!el) throw new Error(`rowElOf: row.html produced no element for key ${row.key}`);
  // cloneNode 防缓存模板节点被 appendChild 移动——每帧插入全新克隆
  return el.cloneNode(true) as HTMLElement;
}

function renderSlice(
  ctx: TreeRenderCtx,
  container: HTMLElement,
  rows: TreeRow[],
  rowH: number,
): void {
  const total = rows.length;
  // 首次渲染时容器可能还没布局（clientHeight=0），全量渲染
  const range =
    container.clientHeight > 0
      ? calcVisibleRange(container, total, rowH)
      : { startIdx: 0, endIdx: total };

  // vs-wrap 复用（首次或被外层清空时重建）
  let wrap = container.firstElementChild;
  if (wrap?.className !== "vs-wrap") {
    container.replaceChildren();
    wrap = document.createElement("div");
    wrap.className = "vs-wrap";
    container.appendChild(wrap);
  }
  const frag = document.createDocumentFragment();
  for (let i = range.startIdx; i < range.endIdx; i++) {
    frag.appendChild(rowElOf(ctx, rows[i]));
  }
  wrap.replaceChildren(frag);
  (wrap as HTMLElement).style.paddingTop = `${range.startIdx * rowH}px`;
  (wrap as HTMLElement).style.paddingBottom = `${(total - range.endIdx) * rowH}px`;
}

// ——— 虚拟滚动实例状态 ———

/** 单容器虚拟滚动实例状态 */
interface VsState {
  cleanup: (() => void) | null;
  rows: TreeRow[];
  mode: RenderMode | null;
  resizeObserver: ResizeObserver | null;
}

/** 取容器虚拟滚动状态（无则初始化空态；渲染/清理共用同一实例） */
function vsOf(ctx: TreeRenderCtx, container: HTMLElement): VsState {
  let s = ctx.vsStates.get(container);
  if (!s) {
    s = { cleanup: null, rows: [], mode: null, resizeObserver: null };
    ctx.vsStates.set(container, s);
  }
  return s;
}

/** 读取容器当前虚拟滚动行数据（events.ts / toolbar-events.ts 消费；替代 container._vsRows 伪字段） */
export function getVsRows(ctx: TreeRenderCtx, container: HTMLElement): TreeRow[] {
  return vsOf(ctx, container).rows;
}

/** 写入容器虚拟滚动行数据（renderTree 内部用；测试注入模拟渲染结果亦走此入口） */
export function setVsRows(ctx: TreeRenderCtx, container: HTMLElement, rows: TreeRow[]): void {
  vsOf(ctx, container).rows = rows;
}

/** 读取容器当前渲染模式（index.ts 键盘导航行高计算用；替代 container._vsMode 伪字段） */
export function getVsMode(ctx: TreeRenderCtx, container: HTMLElement): RenderMode | null {
  return vsOf(ctx, container).mode;
}

// ——— 入口：每次数据变化（搜索/排序/展开/折叠）调用 ———
/** 断开虚拟滚动相关监听 */
export function cleanupVirtualScroll(ctx: TreeRenderCtx, container: HTMLElement): void {
  const s = vsOf(ctx, container);
  s.cleanup?.();
  s.cleanup = null;
  s.resizeObserver?.disconnect();
  s.resizeObserver = null;
  s.rows = [];
  s.mode = null;
}

export function renderTree(
  ctx: TreeRenderCtx,
  container: HTMLElement,
  entries: TreeEntry[],
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  filterPaths: Set<string> | null,
  mode: RenderMode = "grid",
): void {
  if (!entries.length) {
    container.innerHTML = emptyStateHTML("📁", t("tree.noModelFiles"));
    cleanupVirtualScroll(ctx, container);
    return;
  }
  const root = getBuildTreeCached(ctx, entries, sort, filterPaths);
  const rows = flattenVisible(root, "", search, sort, dirOpen, 0, mode);
  if (!rows.length) {
    container.innerHTML = emptyStateHTML("🔍", t("tree.noMatchFiles"));
    cleanupVirtualScroll(ctx, container);
    return;
  }
  const st = vsOf(ctx, container);
  st.rows = rows;
  st.mode = mode;
  const rowH = mode === "list" ? ROW_H_LIST : ROW_H_GRID;
  renderSlice(ctx, container, rows, rowH);

  // 首次渲染容器可能还没布局 → 等 layout 后重新计算可见范围
  if (container.clientHeight === 0) {
    requestAnimationFrame(() => {
      const s2 = vsOf(ctx, container);
      if (s2.rows && s2.mode) {
        const m = s2.mode;
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(ctx, container, s2.rows, rh);
      }
    });
  }

  // 安装滚动同步（只装一次）
  if (!st.cleanup) {
    st.cleanup = installScrollSync(container, () => {
      const s2 = vsOf(ctx, container);
      const r = s2.rows;
      const m = s2.mode;
      if (r?.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(ctx, container, r, rh);
      }
    });
  }

  // 容器尺寸变化时重新计算可见范围（侧边栏折叠/窗口 resize）
  if (!st.resizeObserver) {
    st.resizeObserver = new ResizeObserver(() => {
      const s2 = vsOf(ctx, container);
      const r = s2.rows;
      const m = s2.mode;
      if (r?.length) {
        const rh = m === "list" ? ROW_H_LIST : ROW_H_GRID;
        renderSlice(ctx, container, r, rh);
      }
    });
    st.resizeObserver.observe(container);
  }
}

// ——— 选中计数用（兼容旧接口） ———
export function updateStat(ctx: TreeRenderCtx, el: HTMLElement | null, entries: TreeEntry[]): void {
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
  // code_review 3413288be 段 C #1（P3）：data-total 无条件写（与可见文案是否变化
  // 无关）——多选期间 updateStat 被跳过 + 选中文案不写 dataset → dataset.total 冻结
  // 在预选值，取消选择后 oldTotal 取到从未显示过的计数 → 错误起点计数动画
  el.dataset.total = String(total);
  // 先取消在途动画与定时器：连续触发时旧动画中间值会干扰下一次 textContent 判断，定时器堆积
  const prev = ctx.statAnim.get(el);
  if (prev) {
    prev.cancel();
    clearTimeout(prev.timer);
    ctx.statAnim.delete(el);
  }
  if (el.textContent !== newText) {
    // P1.3 修复：原 `match(/(\d+)\s*项/)` 硬编码中文「项」，en/ja locale 失效；
    // 改读 data-total 属性通道（与 events.ts 的 data-count 同源思路，ADR-133 导向）。
    const oldTotal = parseInt(el.dataset.total || "0", 10) || 0;
    if (oldTotal > 0 && oldTotal !== total && total > 0) {
      const cancel = animateNumber(el, total, 700);
      const timer = setTimeout(() => {
        el.textContent = newText;
        ctx.statAnim.delete(el);
      }, 700);
      ctx.statAnim.set(el, { cancel, timer });
    } else {
      el.textContent = newText;
    }
  }
}
