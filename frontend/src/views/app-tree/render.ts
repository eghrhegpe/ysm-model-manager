// ===== 树渲染层（虚拟滚动版）=====
import { t } from "@/core/i18n/t.ts";
import { animateNumber } from "@/utils/animation/animate.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { calcVisibleRange, installScrollSync } from "@/utils/dom/virtual-scroll.ts";
import { fmtDate, formatBytes } from "@/utils/format/format.ts";
import { hl } from "@/utils/html/html.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { keywordMatches } from "@/utils/search/match.ts";
import { entryKey } from "./entry-key.ts";
import type { TreeEntry } from "./loader.ts";
import { fileRowHTML, folderRowHTML } from "./row-tpl.ts";
import { listFileRowHTML, listFolderRowHTML } from "./row-tpl-list.ts";
import { emptyStateHTML } from "./tpl.ts";

/** 每级缩进像素（树深 → padding-left） */
const INDENT_PER_LEVEL = 16;

/**
 * 树行高（虚拟滚动定高窗口，grid/list 两档；自 app-tree 原 virtual-scroll.ts 迁入）。
 * 行高随「卡片密度」偏好变化：compact = 原值（grid 28 / list 24），normal = 加大一档
 * （grid 32 / list 28）。
 *
 * ⚠️ 单源约束：JS 行高（rowHeightGrid/List）与 CSS 行高（app-tree-styles.ts 的
 * --tree-row-grid / --tree-row-list）**必须同值**，否则虚拟滚动假定行高与实际渲染高度
 * 错位（paddingTop/paddingBottom 撑出的滚动条长度、键盘导航 scrollTop 全部算错）。
 * 故此处导出 ROW_H 尺寸供 ui-prefs.ts 写 CSS 变量，改动只需动这一处。
 */
export const ROW_H_GRID_COMPACT = 28;
export const ROW_H_GRID_NORMAL = 32;
export const ROW_H_LIST_COMPACT = 24;
export const ROW_H_LIST_NORMAL = 28;

/** 取当前卡片密度（compact / normal），与 ui-prefs.ts 同源读取同一 localStorage 键 */
function cardDensity(): "compact" | "normal" {
  // safeGet 在隐私模式/禁用存储下静默降级为 undefined → 回落 compact
  return safeGet("ui-card-density") === "normal" ? "normal" : "compact";
}

/** grid 模式行高（受卡片密度驱动） */
export function rowHeightGrid(): number {
  return cardDensity() === "normal" ? ROW_H_GRID_NORMAL : ROW_H_GRID_COMPACT;
}

/** list 模式行高（受卡片密度驱动） */
export function rowHeightList(): number {
  return cardDensity() === "normal" ? ROW_H_LIST_NORMAL : ROW_H_LIST_COMPACT;
}

/**
 * 扁平化行（虚拟滚动数据单元）。
 *
 * ⚠️ `html` 是 **惰性 getter**（锐评性能 #5 后续，2026-10-14）：虚拟滚动只渲染可见
 * 窗口，但 eager 实现为**全部**行拼 HTML 字符串——搜索击键一次 O(n) 次模板拼接
 * （n = 全部可见行，仓库上万模型时每次击键都在拼几万个字符串，而其中 ~30 行会进 DOM）。
 * 改 getter 后：只有真正被 `rowElOf` 读到（或测试/调试直读 .html）的行才付构造成本，
 * 且首次读取后记忆化，重复读零成本。字段名与字符串语义完全不变（测试 `.html` 断言
 * 与所有消费方零改动），只是把「构造时机」从 flatten 推迟到读取。
 */
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

/**
 * 惰性行工厂：build 首次读取时求值并缓存（memoize-once）。
 * 键是 build 闭包——row 对象可被 WeakMap 缓存复用（rowTplCache），缓存命中时
 * cloneNode 不再读 html，无需重复求值。
 */
function lazyRow(base: Omit<TreeRow, "html">, build: () => string): TreeRow {
  let memo: string | undefined;
  Object.defineProperty(base, "html", {
    get() {
      if (memo === undefined) memo = build();
      return memo;
    },
    enumerable: true,
    configurable: true,
  });
  return base as TreeRow;
}

/**
 * 选中行键集合（可选项）。selectState.keys 同一对象直传（勿复制：数据渲染与
 * 选中态同源是 ADR-222 契约，复制层只会引入第二真相源）。缺省/空集 = 全行无选中。
 * 形参挂到 flattenVisible（而非逐行散传）——选中态是「本次渲染的全局上下文」，
 * 与 search/sort/dirOpen 同列；row-tpl 的 rowCls 由 fileRowFromEntry 单点派生。
 */
export type SelectedKeys = ReadonlySet<string> | undefined;

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
  entries?: TreeEntry[];
  sort?: string;
  filterRef?: Set<string> | null;
  /** 内容修订号快照：乐观更新原地翻 banned 不改变 entries 引用，靠本号让快速路径失效 */
  rev?: number;
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
  // O(1) 快速路径：entries 引用 + sort + filterPaths 引用 + 内容修订号均未变 → 复用上次指纹，
  // 跳过 O(n) 拼接（搜索键入/筛选不替换 entries 时命中）
  // ⚠️ rev 是必需的：乐观更新原地翻 `entry.banned`（events.ts / bus-handlers.ts 共 6 处）
  // **不替换 entries 数组引用**，只看引用会命中快速路径 → 复用旧 root，而 dirFlags
  // （WeakMap<TreeNode, hasEnabled/hasDisabled>）只在 buildTree 内 annotateDirNodes 重算 →
  // 文件行自身勾选态正确（惰性 html 读 e.banned），父文件夹行的 ck on/partial/off **停在旧值**，
  // 直到后续 _load() 换数组引用才纠（窗口期 = IPC + Go 侧 InvalidatePath 真实扫盘）。
  const cached = buildCache.get(ctx);
  const rev = ctx.buildRev ?? 0;
  if (
    cached &&
    cached.entries === entries &&
    cached.sort === sort &&
    cached.filterRef === filterPaths &&
    cached.rev === rev
  ) {
    return cached.root;
  }
  const cacheKey = [
    entries.map((e) => (e.banned ? `*${e.path}` : e.path)).join("\n"),
    sort,
    filterPaths ? [...filterPaths].sort().join("\n") : "null",
  ].join("|");

  if (cached && cached.key === cacheKey) {
    return cached.root;
  }

  const root = buildTree(entries, sort, filterPaths);
  buildCache.set(ctx, { key: cacheKey, root, entries, sort, filterRef: filterPaths, rev });
  return root;
}

/**
 * 使 buildTree 缓存失效（原地改动 entries 内容后调用）。
 * 乐观更新直接写 `entry.banned = !entry.banned` 而不替换数组引用——快速路径只看引用
 * 会误判内容未变。本函数让下次 renderTree 走全量指纹 + 重建（含 annotateDirNodes），
 * 恢复父文件夹行的 ck on/partial/off 一致态。**每次原地改动必须调**，漏调即复发
 * 「文件夹勾选态停在旧值直到 _load 回来」的缺陷。
 */
export function invalidateBuildCache(ctx: TreeRenderCtx): void {
  // 防御：ctx 缺省即无缓存实例（部分测试替身只实现状态面）→ 无副作用早退
  if (!ctx) return;
  ctx.buildRev = (ctx.buildRev ?? 0) + 1;
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

/** 树节点子键（排除 `_e` 条目位）；后序遍历与 flattenVisible 共用同一口径 */
function treeChildKeys(node: TreeNode): string[] {
  return Object.keys(node).filter((k) => k !== "_e");
}

/** 文件条目对祖先目录的标志贡献：banned → 仅 disabled，否则仅 enabled */
function entryDirFlags(e: TreeEntry): { hasEnabled: boolean; hasDisabled: boolean } {
  return e.banned
    ? { hasEnabled: false, hasDisabled: true }
    : { hasEnabled: true, hasDisabled: false };
}

/** 单节点 hasEnabled/hasDisabled：直接文件贡献 ∪ 各子目录（后序已算好）的 flags */
function dirFlagsOf(node: TreeNode): { hasEnabled: boolean; hasDisabled: boolean } {
  let hasEnabled = false;
  let hasDisabled = false;
  for (const k of Object.keys(node)) {
    if (k === "_e") continue;
    const child = node[k];
    if (!child || typeof child !== "object") continue;
    const flags = (child as TreeNode)._e
      ? entryDirFlags((child as TreeNode)._e as TreeEntry)
      : dirFlags.get(child as TreeNode);
    if (!flags) continue;
    if (flags.hasEnabled) hasEnabled = true;
    if (flags.hasDisabled) hasDisabled = true;
  }
  return { hasEnabled, hasDisabled };
}

// O(n²)→O(n) 重写（审计实证，见 render.test.ts 深链绊线）：
// 原实现「外层 for 每目录 + 内层 stack 重扫该目录整棵子树」最坏 O(n²)
// （深链 2000 级 115.9ms、每倍增 3-6×），且递归深度=树深，10000 级深链直接
// Maximum call stack size exceeded。现改为显式栈迭代后序：父目录 flags =
// 直接文件贡献 ∪ 各子目录已算好的 flags，每节点恰好访问一次，O(n) 且无递归。
function annotateDirNodes(root: TreeNode): void {
  interface Frame {
    node: TreeNode;
    childKeys: string[];
    childIdx: number;
  }
  // P2 优化（审核）：子键列表仅在入栈时算一次，避免 while 每轮重建 Object.keys 过滤数组
  // （节点被访问 degree+1 次时原实现每次都全量分配，O(n·d) 临时数组；与 flattenVisible 的 Frame 模式统一）。
  const stack: Frame[] = [{ node: root, childKeys: treeChildKeys(root), childIdx: 0 }];
  const order: TreeNode[] = [];
  while (stack.length) {
    const top = stack[stack.length - 1];
    // 子键已尽 → 后序出栈记账；未尽 → 下探（早退版，与原 if/else 同序同判）
    if (top.childIdx >= top.childKeys.length) {
      order.push(top.node);
      stack.pop();
      continue;
    }
    const childKey = top.childKeys[top.childIdx];
    top.childIdx++;
    const child = top.node[childKey] as TreeNode | undefined;
    if (child && typeof child === "object" && !child._e) {
      stack.push({ node: child, childKeys: treeChildKeys(child), childIdx: 0 });
    }
  }
  for (const node of order) dirFlags.set(node, dirFlagsOf(node));
}

// ——— 语义调用包装：树参数 → 行模板渲染参数 ———
// flattenVisible 只持有 (entry/fullPath/depth/search) 语义信息，row-tpl 需要
// (nmHtml, icon, dateStr, nmCls, indent, rowCls, ariaLevel) 渲染参数。
// 两个包装函数负责桥接，让调用方类型合法、@ts-expect-error 不必存在。
//
// ⚠️ f4d590e12 教训（2026-10-13 P0-1 接线）：本函数曾因「消除未使用参数」连删
// selCls 计算 + hl 搜索高亮，rowCls/mark 双双断链——行模板的 rowCls 形参注释
// 明写「用于选中高亮」，删调用侧实参 = 删功能。现由 selectedKeys 驱动恢复；
// 回归锁 render.test.ts「行选中态随数据渲染」组，勿再只看签名不看语义。

/** 文件行包装：entry + depth + 选中态 + 拖源态 + 搜索词 → 完整 fileRowHTML / listFileRowHTML 调用 */
function fileRowFromEntry(
  entry: TreeEntry,
  depth: number,
  mode: RenderMode,
  opts: { selected: boolean; search: string; dragging?: boolean },
): string {
  // 搜索态命中段 <mark> 高亮（guide/repository.md 承诺「匹配字符高亮」）；
  // 代价 = 丢失 renderDisplayName 的 tag-work/tag-date/§ 着色（知识卡 P3 已记录的取舍，
  // 与 hl 互斥——hl 自己做 esc，双转义会炸）
  const nmHtml = opts.search ? hl(entry.name, opts.search.trim()) : renderDisplayName(entry.name);
  const indent = depth * INDENT_PER_LEVEL;
  // 视觉三态（ADR-336 §2.3）：selected（数据渲染唯一出口）+ dragging（拖源降透明，
  // 2026-10-13 补齐第三态）；rowCls 单点拼接，调用侧禁止 classList 手写（pitfalls #28）
  const rowCls = `${opts.selected ? " selected" : ""}${opts.dragging ? " dragging" : ""}`;
  // 日期列：grid 模式（28px）开、list 模式（24px 紧凑行）刻意关。
  // row-tpl.ts 的 dateStr 条件渲染 + .fl .dt 规则本就已接好，唯调用侧恒传 ""——
  // 「按日期」排序在 UI 上因此无任何可见反馈（2026-10-15 审核项，用户拍板 grid 开）。
  // list 模板签名无 dateStr 形参（头注明写「无 date」）且无 .fl-list .dt 规则，24px 行放不下。
  // fmtDate 自带 NaN/0/Infinity/负值 → "" 守卫，无 modTime 时该行自动回落到无日期列。
  return mode === "list"
    ? listFileRowHTML(entry, nmHtml, "📄", "", indent, rowCls, depth + 1)
    : fileRowHTML(entry, nmHtml, "📄", fmtDate(entry.modTime), "", indent, rowCls, depth + 1);
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

/** 待排序子项（键 + 原始节点引用；排序后只取 key） */
interface TreeChildRef {
  key: string;
  node: TreeNode | TreeEntry;
}

/**
 * 子项排序：目录恒在前 → 目录间按名称；文件按所选键降序（大→小 / 新→旧），
 * 同键回退名称稳定序。
 *
 * 目录无独立 size/modTime（子树聚合归 Go），故目录间恒按名称。
 * 提到顶层具名函数的立因：原实现在 flattenVisible 的 while 帧内联 `.sort(cb)`，
 * 回调体继承外层嵌套深度（复杂度扫描器按 AST 递归计分，回调**不**重置深度），
 * 一条 `??`/三元在帧内按 depth≥2 计分；顶层化后归零。
 */
function compareTreeChildren(a: TreeChildRef, b: TreeChildRef, sort: string): number {
  const aEntry = a.node && (a.node as TreeNode)._e;
  const bEntry = b.node && (b.node as TreeNode)._e;
  // 目录恒在前
  if (!aEntry !== !bEntry) return aEntry ? 1 : -1;
  const aName = a.key.toLowerCase();
  const bName = b.key.toLowerCase();
  const byName = aName < bName ? -1 : aName > bName ? 1 : 0;
  if (!aEntry || sort === "name") return byName;
  const ae = aEntry as TreeEntry;
  const be = bEntry as TreeEntry;
  if (sort === "size") return (be.size || 0) - (ae.size || 0) || byName;
  if (sort === "date") return (be.modTime || 0) - (ae.modTime || 0) || byName;
  return byName;
}

/** 帧内子键：排除 `_e` 与非法值后按 sort 排序（首访该帧时算一次） */
function sortedChildKeys(node: TreeNode, sort: string): string[] {
  return Object.keys(node)
    .filter((k) => k !== "_e")
    .map((k) => ({ key: k, node: node[k] as TreeNode | TreeEntry }))
    .filter((ref) => ref.node && typeof ref.node === "object")
    .sort((a, b) => compareTreeChildren(a, b, sort))
    .map((e) => e.key);
}

/**
 * 文件行（搜索未命中 → null，即该行不产出）。
 * 判据（ADR-343-d1 C1 单口径）：`keywordMatches(entry.name, entry.path, 关键词)`——
 * name/相对路径子串面 + 纯拉丁关键词的全拼/首字母拼音面（与 Go go/pinyin|MatchKeyword
 * 同判据，金样例 tests/fixtures/search-golden.json 双读对账）。
 * 原语义：`if (isSearch && !entry.path.toLowerCase().includes(searchLower)) continue;`
 *
 * key 走 entryKey（磁盘路径），非树内拼接路径——与 DOM data-fullpath /
 * selectState.keys 同源，否则选中相关的 indexOf 比对全部失配（ADR-222）
 */
function visibleFileRow(
  entry: TreeEntry,
  depth: number,
  mode: RenderMode,
  id: number,
  isSearch: boolean,
  searchLower: string,
  selectedKeys: SelectedKeys,
  search: string,
  draggingKeys: SelectedKeys = undefined,
): TreeRow | null {
  if (isSearch && !keywordMatches(entry.name, entry.path, searchLower)) return null;
  const key = entryKey(entry);
  return lazyRow(
    {
      id,
      type: "file",
      key,
      depth,
    },
    () =>
      fileRowFromEntry(entry, depth, mode, {
        selected: selectedKeys?.has(key) === true,
        search,
        dragging: draggingKeys?.has(key) === true,
      }),
  );
}

/** 文件夹行（含展开态；flags 缺记录时由调用方给兜底对象） */
function folderTreeRow(
  name: string,
  fullPath: string,
  depth: number,
  isOpen: boolean,
  flags: { hasEnabled: boolean; hasDisabled: boolean },
  mode: RenderMode,
  id: number,
): TreeRow {
  return lazyRow(
    {
      id,
      type: "folder",
      key: fullPath,
      depth,
      isOpen,
    },
    () => folderRowFromNode(name, fullPath, depth, isOpen, flags, mode),
  );
}

export function flattenVisible(
  root: TreeNode,
  prefix: string,
  search: string,
  sort: string,
  dirOpen: Record<string, boolean>,
  depth: number,
  mode: RenderMode,
  selectedKeys: SelectedKeys = undefined,
  draggingKeys: SelectedKeys = undefined,
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
    // 首次进入该帧：计算排序后的子键列表（childIdx===0 哨兵，与原实现同判）
    if (top.childIdx === 0) top.childKeys = sortedChildKeys(top.node, sort);
    // 子键已尽 → 出帧（早退版，等价原 if/else）
    if (top.childIdx >= top.childKeys.length) {
      stack.pop();
      continue;
    }
    const name = top.childKeys[top.childIdx];
    top.childIdx++;
    const node = top.node[name] as TreeNode | TreeEntry;
    const fullPath = top.prefix ? `${top.prefix}/${name}` : name;

    const entry = node && (node as TreeNode)._e;
    if (entry) {
      const fileRow = visibleFileRow(
        entry as TreeEntry,
        top.depth,
        mode,
        rows.length,
        isSearch,
        searchLower,
        selectedKeys,
        searchTrimmed,
        draggingKeys,
      );
      if (fileRow) rows.push(fileRow);
      continue;
    }
    if (!node) continue;

    // 目录行：isOpen 决定是否下探（搜索态恒展开，与原实现一致）
    // ⚠️ `Object.hasOwn` 判存在性（ADR-334）：键是磁盘目录名，名叫 `__proto__` 时
    // `dirOpen[fullPath]` 会读到 Object.prototype（truthy）→ 该目录恒显示为已展开且点不开。
    const isOpen = Object.hasOwn(dirOpen, fullPath) ? dirOpen[fullPath] === true : false;
    const flags = dirFlags.get(node as TreeNode) ?? { hasEnabled: false, hasDisabled: false };
    // 行态与下探判据同源（锐评 2026-10-15 P1-B）：搜索态子行确实照 `isOpen || isSearch`
    // 全量下探，故行态也必须报「已展开」——原先报 isOpen（磁盘存档值），搜索态下会出现
    // 「箭头收起 / aria-expanded=false，但子文件明明可见」的语义说谎，且点箭头视觉无变化。
    const row = folderTreeRow(
      name,
      fullPath,
      top.depth,
      isSearch || isOpen,
      flags,
      mode,
      rows.length,
    );
    rows.push(row);
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
  // 搜索态剪枝（锐评 2026-10-15 P1-B）：无命中后代的目录行是纯噪声——大仓库搜一个模型名，
  // 上百个空的作者文件夹会先把结果淹掉；更硬的一条是「一个都没搜到」时目录行恒存在，
  // `renderTree` 的 `!rows.length` 空态分支永远走不到，guide/repository.md 承诺的
  // 「无结果时显示未找到匹配的文件」在有任何子目录的仓库里等于失效。
  return isSearch ? pruneDirsWithoutMatch(rows) : rows;
}

/**
 * 搜索态剪枝：剔除子树内不含任何命中文件的目录行。
 *
 * 树行是深度优先前序且每行携带 `depth`，子树即「其后连续的一段 depth 更大者」，
 * 故只需维护一个「仍可能有后代」的目录栈：遇到文件行时栈内全部目录记保留，
 * 处理完每行后把深度 ≥ 下一行深度的目录弹栈（它们对下一行已非祖先）。
 * 单趟 O(n·层深)（典型层深 ≤ 5），不引入递归——与 flattenVisible 的显式栈口径一致
 * （深链回归绊线：`render.test.ts` 10000 级深链 + 搜索不得栈溢出）。
 */
function pruneDirsWithoutMatch(rows: TreeRow[]): TreeRow[] {
  const keep = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "folder") {
      open.push(i);
    } else {
      for (const fi of open) keep.add(fi);
    }
    const nextDepth = i + 1 < rows.length ? rows[i + 1].depth : -1;
    while (open.length && rows[open[open.length - 1]].depth >= nextDepth) open.pop();
  }
  return rows.filter((r, i) => r.type === "file" || keep.has(i));
}

// ——— 构建树（buildTree） ———
export function buildTree(
  entries: TreeEntry[],
  _sort: string,
  filterPaths: Set<string> | null,
): TreeNode {
  // ⚠️ null 原型对象（ADR-334）：键来自磁盘目录名/文件名，与 `__proto__` / `constructor` /
  // `toString` 等继承键同名时，普通对象会沿原型链读到继承属性（truthy）→ 跳过建节点并把
  // 整棵子树写进 `Object.prototype`（全局原型污染 + 该目录及其子树在 UI 完全不显示）。
  // null 原型下这些键退化为普通字符串键；遍历侧本就用 `Object.keys` + 显式 `_e` 过滤，
  // 语义不变。
  const root: TreeNode = Object.create(null) as TreeNode;
  // 白名单匹配与行键同源（ADR-222）：entryKey = fullPath || path——与 tag-editor 写入的
  // modelPath（ctx:show path = fullPath || path）对齐；原 e.fullPath 在 fullPath 空时对
  // 「标签筛选」静默失配（filterPaths 里的 path 永不命中）。锐评 2026-10-09 补齐 ④ 同源。
  const filtered = filterPaths ? entries.filter((e) => filterPaths.has(entryKey(e))) : entries;
  for (const entry of filtered) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!current[p] || (current[p] as TreeNode)._e) {
        current[p] = Object.create(null) as TreeNode;
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
  /** 在途统计动画句柄（WeakMap——DOM 元素为 key，值为取消函数；终值写回由
   *  animateNumber 的 onFinish 完成事件驱动，调用方无独立墙钟 timer，条目随落定自清） */
  statAnim: WeakMap<HTMLElement, () => void>;
  /**
   * entries 内容修订号。buildTree 缓存快速路径的守卫之一（与 entries/sort/filterPaths
   * 引用并列）：原地改动 entries（乐观更新翻 banned）后由 invalidateBuildCache 递增，
   * 使「数组引用未变但内容已变」不再误命中缓存。
   */
  buildRev?: number;
}

/** 创建渲染上下文（AppTree 实例化时调用） */
export function createTreeRenderCtx(): TreeRenderCtx {
  return {
    rowTplCache: new WeakMap(),
    vsStates: new WeakMap(),
    statAnim: new WeakMap(),
    buildRev: 0,
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
  const live = vsOf(ctx, container).liveNodes;
  // 节点池复用（锐评性能 #5 后续，2026-10-14）：滚动只有首尾进出窗口，中间行直接搬动，
  // 每帧新增/销毁从「窗口大小」降到「滚动跨越的行数」。node 实例不变（cloned:false）。
  const keep = new Set<string>();
  for (let i = range.startIdx; i < range.endIdx; i++) {
    const row = rows[i];
    keep.add(row.key);
    const hit = live.get(row.key);
    // row 对象身份一致 = 内容未变（搜索/排序/选中新数据产生新 row 对象 → 身份必变→ 重建）
    if (hit && hit.row === row) {
      frag.appendChild(hit.el);
      continue;
    }
    const el = rowElOf(ctx, row);
    live.set(row.key, { row, el });
    frag.appendChild(el);
  }
  // 滚出窗口的key 从池中剔除（否则池随滚动无界增长 = 内存泄漏）
  for (const k of live.keys()) {
    if (!keep.has(k)) live.delete(k);
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
  /**
   * 在DOM 中的行节点池（键 = row.key → 节点；锐评性能 #5 后续，2026-10-14）。
   * 原实现每帧 `cloneNode` 重建全部可见行：滚动 1px 也要把窗口内约 40 行重新克隆一遍
   * （持续 GC 压力）。改为按 key 复用——滚动只有首尾进出窗口，中间行直接搬动，
   * 每帧新增/销毁的节点从「窗口大小」降到「滚动跨越的行数」（典型 1-2 个）。
   * 安全性：树事件全为容器级委托（closest 查询），行节点无独立监听器；节点身份与
   * row 对象一一对应，跨帧复用不串行（key 是磁盘全路径 / 树内路径，同一可见集内唯一）。
   * 数据变更（搜索/排序/展开）产生全新 row 对象但 key 可能相同——此时节点内容是旧的，
   * 故按 row 对象身份比对（`rowTplCache` 同款 WeakMap 语义），不一致则重建该行。
   */
  liveNodes: Map<string, { row: TreeRow; el: HTMLElement }>;
}

/** 取容器虚拟滚动状态（无则初始化空态；渲染/清理共用同一实例） */
function vsOf(ctx: TreeRenderCtx, container: HTMLElement): VsState {
  let s = ctx.vsStates.get(container);
  if (!s) {
    s = { cleanup: null, rows: [], mode: null, resizeObserver: null, liveNodes: new Map() };
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
  s.liveNodes.clear(); // 节点池随容器一起弃（否则 WeakMap 值里的 DOM 节点被池强持有）
}

/**
 * 空 entries 时的空态文案选择（2026-10-13 P2）：loadFailed=true → 「加载失败」
 * （warning 图标，用户侧可区分「目录真空」与「扫描出错」）；缺省 → 「暂无模型文件」。
 * 纯函数（i18n 取词 + 图标语义名），node 环境可测——抽出的立因即 renderTree 的
 * 空态分支此前无法在 node 测试环境触达（container.innerHTML 需 DOM）。
 */
export function emptyStateForEmptyEntries(loadFailed: boolean): string {
  return loadFailed
    ? emptyStateHTML("warning", t("tree.treeLoadFailed"))
    : emptyStateHTML("folder", t("tree.noModelFiles"));
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
  selectedKeys: SelectedKeys = undefined,
  loadFailed = false,
  draggingKeys: SelectedKeys = undefined,
): void {
  if (!entries.length) {
    container.innerHTML = emptyStateForEmptyEntries(loadFailed);
    cleanupVirtualScroll(ctx, container);
    return;
  }
  const root = getBuildTreeCached(ctx, entries, sort, filterPaths);
  const rows = flattenVisible(root, "", search, sort, dirOpen, 0, mode, selectedKeys, draggingKeys);
  if (!rows.length) {
    container.innerHTML = emptyStateHTML("search", t("tree.noMatchFiles"));
    cleanupVirtualScroll(ctx, container);
    return;
  }
  const st = vsOf(ctx, container);
  st.rows = rows;
  st.mode = mode;
  const rowH = mode === "list" ? rowHeightList() : rowHeightGrid();
  renderSlice(ctx, container, rows, rowH);

  // 「从 vsStates 取最新 rows/mode → 算行高 → renderSlice」三处回调（rAF / scroll /
  // ResizeObserver）同构，收成单一 redraw 闭包——原三份手抄即陷阱 #25「判据手抄复发」
  // 的渲染版：改行高判定或取值口径时要记得改三处。
  const redraw = (): void => {
    const s2 = vsOf(ctx, container);
    const r = s2.rows;
    const m = s2.mode;
    if (!r?.length) return;
    renderSlice(ctx, container, r, m === "list" ? rowHeightList() : rowHeightGrid());
  };

  // 首次渲染容器可能还没布局 → 等 layout 后重新计算可见范围
  if (container.clientHeight === 0) {
    requestAnimationFrame(redraw);
  }

  // 安装滚动同步（只装一次）
  if (!st.cleanup) {
    st.cleanup = installScrollSync(container, redraw);
  }

  // 容器尺寸变化时重新计算可见范围（侧边栏折叠/窗口 resize）
  if (!st.resizeObserver) {
    st.resizeObserver = new ResizeObserver(redraw);
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
  // data-total 双职责：① e2e 属性通道无条件写（code_review 3413288be 段 C #1：多选期间
  // updateStat 被跳过也要保持 dataset 新鲜）；② 计数动画的起点——必须**先读后写**，
  // 写后再读恒等于新值，`oldTotal !== total` 恒假、animateNumber 永不触发（2026-09 收债）。
  const oldTotal = parseInt(el.dataset.total || "0", 10) || 0;
  el.dataset.total = String(total);
  // 先取消在途动画：旧动画中间值会干扰下一次 textContent 判断；取消不触发旧轮
  // onFinish（值未落定），本轮的终值写接管元素，不存在双写竞态
  const prev = ctx.statAnim.get(el);
  if (prev) {
    prev();
    ctx.statAnim.delete(el);
  }
  if (el.textContent !== newText) {
    // 动画起点 = 上面写入前捕获的 oldTotal（P1.3 修复：原 `match(/(\d+)\s*项/)` 硬编码
    // 中文「项」，en/ja locale 失效；属性通道取向保留，起点读取随之修正）
    if (oldTotal > 0 && oldTotal !== total && total > 0) {
      // 完成事件替墙钟接力（收债双 700 魔法数）：终值文案写回由 onFinish 驱动，
      // 时长单一事实源 = animateNumber 默认参——调用方不再抄同速常量，
      // 「动画终点 = 收尾时点」由结构保证，不由约定
      let settled = false;
      const cancel = animateNumber(el, total, undefined, () => {
        settled = true;
        el.textContent = newText;
        ctx.statAnim.delete(el);
      });
      // 同步短路落定（单帧/等值/无数字）不留登记：登记 = 动画真正在途
      if (!settled) ctx.statAnim.set(el, cancel);
    } else {
      el.textContent = newText;
    }
  }
}
