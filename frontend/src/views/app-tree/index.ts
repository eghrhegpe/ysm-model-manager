// ===== <app-tree> 入口 — 生命周期编排 =====

import { can } from "@/backend/capabilities.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { rememberModelPath } from "@/core/model-path-store.ts";
import type { AppliedAdvFilter } from "@/features/dialogs/adv-filter-util.ts";
import { bindTreeDnD } from "@/features/dnd/import-dnd.ts";
import {
  bindTreeMoveDnD,
  computeMovedEntry,
  filterSelfReflection,
  type TreeMovePayload,
} from "@/features/dnd/move-dnd.ts";
import { isPreviewOverlayActive } from "@/preview-3d/infra/overlay-active.ts";
import { batchAllSettled } from "@/utils/async/batch-all-settled.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { type BusyLock, createBusyLock } from "@/utils/base/primitives/lock.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeGetJSON, safeSet } from "@/utils/base/primitives/storage.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { takeRepoSearchFocusPending } from "@/utils/dom/focus-pending.ts";
import { registerShortcut } from "@/utils/dom/key-router.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { takePendingTreeSearch } from "@/utils/dom/search-pending.ts";
import { createShadowStyle } from "@/utils/dom/shadow-style.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { treeCSS } from "./app-tree-styles.ts";
import { type AuthorInfo, loadAuthors } from "./authors.ts";
import { bindBusEvents } from "./bus-handlers.ts";
import { type SelectState, selectSingle } from "./data.ts";
import { bindTreeEvents, updateSelectCount } from "./events.ts";
import { withFooterProgress } from "./footer-progress.ts";
import { loadEntries, type TreeEntry } from "./loader.ts";
import {
  cleanupVirtualScroll,
  createTreeRenderCtx,
  getRenderMode,
  getVsMode,
  getVsRows,
  type RenderMode,
  renderTree,
  rowHeightGrid,
  rowHeightList,
  setRenderMode,
  type TreeRenderCtx,
  updateStat,
} from "./render.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { footerHTML, headerHTML, renderRepoLabel, spinnerHTML, treeLoadFailedHTML } from "./tpl.ts";
import { type TreeSnapshot, TreeState } from "./tree-state.ts";

// 模块级样式表（shadow 根装配，含 HMR 注册；见 utils/dom/shadow-style.ts）。
// 原 12 行「环境守卫 + new CSSStyleSheet + replaceSync」样板已收敛到该原语。
const appTreeStyle = createShadowStyle(treeCSS, "app-tree");

export { appTreeStyle };

// ADR-133 阶段 B/C+：本文件内钩子的稳定 testid 声明（G-1 单一事实源，与钩子同处）。
// 树容器 id="tree" 供 handler/CSS 锚定，testid 取 'tree-root'——落入契约孤儿扫描的
// 'tree-' 前缀白名单，从而同受 must-have 与孤儿双校验守护（裸 'tree' 只受前者）。
export const VIEW_TESTIDS: readonly string[] = ["tree-root"];

// —— 全局扩展（已随 WeakMap 改造移除）——
// 原 declare global 伪字段 _vsCleanup/_vsRows/_vsMode/_vsResizeObserver 已收敛至
// render.ts vsStates WeakMap（getVsRows/getVsMode 访问）；_treeAuthors 为死字段（无读取方）随删。

// —— dirOpen 持久化：{ [rtype]: { 相对目录: 展开态 } } 命名空间形态 ——
// 2026-09 收债：原平铺键（{ 相对目录: bool }）不分 rtype，不同类型同名目录互相
// 串展开态。旧平铺值无法判定来源类型，读侧直接忽略（用户重新展开一次即重建新形态，
// 代价小于跨类型污染）；空对象 {} 两态同形（every 空数组恒真），读写均无歧义。
type DirOpenStore = Record<string, Record<string, boolean>>;

function isScopedDirOpenStore(v: unknown): v is DirOpenStore {
  if (!v || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) =>
      !!x &&
      typeof x === "object" &&
      !Array.isArray(x) &&
      Object.values(x as Record<string, unknown>).every((b) => typeof b === "boolean"),
  );
}

function readScopedDirOpen(rtype: string): Record<string, boolean> {
  const stored = safeGetJSON<unknown>("dirOpenState", {});
  if (!isScopedDirOpenStore(stored)) return {};
  // null 原型副本（ADR-334）：存盘数据里的 `__proto__` 键不得经展开落成继承属性，
  // 否则读侧取到 Object.prototype；展开副本同时避免污染调用方的 stored 对象。
  return Object.assign(Object.create(null) as Record<string, boolean>, stored[rtype] || {});
}

function writeScopedDirOpen(rtype: string, dirs: Record<string, boolean>): void {
  const stored = safeGetJSON<unknown>("dirOpenState", {});
  const next: DirOpenStore = isScopedDirOpenStore(stored) ? stored : {};
  next[rtype] = { ...dirs };
  safeSet("dirOpenState", JSON.stringify(next));
}

// 挂载/补载失败 toast 节流（对齐 loader.ts 同款模式）：innerHTML 重建（类型切换）可高频
// 触发挂载失败，5s 内只提示一次防刷屏。
let _lastMountErrorToastAt = 0;
const MOUNT_ERROR_TOAST_MIN_GAP = 5000;
function toastThrottled(e: unknown, fallback: string): void {
  const now = Date.now();
  if (now - _lastMountErrorToastAt < MOUNT_ERROR_TOAST_MIN_GAP) return;
  _lastMountErrorToastAt = now;
  toast(`${friendlyError(e, fallback)}`, TOAST_MS.long, "error");
}

export class AppTree extends WebComponentBase {
  _root: ShadowRoot;
  _authors: Array<AuthorInfo | string> = [];
  _unsubs: Array<() => void> = [];
  /** 启停链互斥锁（ADR-341 归一并单锁：原 _batchBusy/_toggleBusy 双布尔互查——
   *  两条链的「A 在途拦 B、B 在途拦 A」在互斥语义下本是一把锁两个名字。
   *  防连点菜单重叠循环二次 Toggle 把状态打回原形 / 单文件开关翻转竞态） */
  private _toggleLock = createBusyLock();
  /** 搜索防抖 timer（实例级，HMR 重入时可被 disconnectedCallback 清理） */
  _searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** 全局快捷键注册表 dispose 句柄（key-router，ADR-308 D1；随 disconnectedCallback 逐个解除） */
  private _shortcutOffs: Array<() => void> = [];
  /** 批量删除进行中（防连点 Delete 二次触发；ADR-341 归一 BusyLock） */
  private _deleteLock = createBusyLock();
  /** 树内拖拽移动进行中（ADR-336，防 drop 重入；ADR-341 归一 BusyLock） */
  private _moveLock = createBusyLock();
  /** 拖源降透明键集（ADR-336 视觉三态之三）：dragstart 置位、dragend/drop 清；
   *  经 _renderTree(draggingKeys) 走数据渲染，非 classList 手写 */
  private _draggingKeys: Set<string> | null = null;
  /** 已完成 connectedCallback 初始化（用于区分首次挂载与后续属性变更；重连时为 true，
   *  connectedCallback 借它走「恢复」分支而非从零起步） */
  private _ready = false;
  /** 分离前树滚动位置快照（重连恢复，补齐 ADR-163「滚动位置跨页保留」承诺）：
   *  常驻面板 detach/attach 仍走完整断连/重连，_renderLayout + _renderTree 重建 DOM
   *  把 scrollTop 归零——用户「切页回来滚到顶」。数据新鲜度不在此省：树不消费 watcher
   *  增量，重连 _load 是分离期间文件变更的唯一补采口，只恢复视觉不跳过加载 */
  private _savedScrollTop = 0;
  /** root 属性切换代际守卫（ADR-230）：快速切换时丢弃过期加载的渲染 */
  _guard = createLoadGuard();

  /** 属性变更重载合并句柄：同任务内 root+subdir 成对变更（mountTree 复用路径）
   *  只放行 microtask 末尾一次全价重扫，避免中间态（如 root 已新、subdir 尚旧）空转一整轮 */
  private _attrReloadQueued = false;

  /** 最近一次 dirOpen 水化所依据的 rtype（null = 尚未水化）。水化必须「按 rtype 判定 + 赋值
   *  替换」——三个入口（首挂载/重连、切类型重载链、挂载期补载链）共用 `_hydrateDirOpen`。 */
  private _dirOpenRtype: string | null = null;

  /** 渲染上下文（实例级，含 WeakMap 缓存） */
  treeRenderCtx: TreeRenderCtx = createTreeRenderCtx();

  // ── TreeState 容器（封装 10 个可变状态字段）──
  private _state = new TreeState();

  /** 只读快照给子模块消费 */
  get snapshot(): TreeSnapshot {
    return this._state.getSnapshot();
  }

  // ── 状态修改方法（子模块写状态走这些入口）──
  setSearch(v: string): void {
    this._state.search = v;
  }

  setSort(v: string): void {
    this._state.sort = v;
  }

  toggleDir(dir: string): void {
    // ⚠️ `Object.hasOwn` 判存在性（ADR-334）：键是磁盘目录名，目录恰名 `__proto__` 时
    // `this._state.dirOpen[dir]` 会读到 Object.prototype（truthy）→ 取反恒 false →
    // 该目录永不可折叠。仓内同病先例与修法见 `utils/icon/workshop-icons.ts`。
    const isOpen = Object.hasOwn(this._state.dirOpen, dir)
      ? this._state.dirOpen[dir] === true
      : false;
    this._state.dirOpen[dir] = !isOpen;
    if (isOpen) {
      const prefix = `${dir}/`.replace(/\\/g, "/");
      for (const key of Object.keys(this._state.dirOpen)) {
        const nk = key.replace(/\\/g, "/");
        if (nk !== dir && nk.startsWith(prefix)) delete this._state.dirOpen[key];
      }
    }
    writeScopedDirOpen(this._state.rootAttr, this._state.dirOpen);
  }

  setFilterPaths(paths: Set<string> | null): void {
    this._state.filterPaths = paths;
  }

  /** 已应用的高级筛选条件（数值范围 + 标签）；keyword 不入内，真相源 = search */
  setAdvFilter(v: AppliedAdvFilter): void {
    this._state.advFilter = v;
  }

  setRenderMode(mode: RenderMode): void {
    this._state.renderMode = mode;
    setRenderMode(mode);
  }

  /** /deprecated 使用 snapshot.selectState 或 _state.selectState */
  get selectState(): SelectState {
    return this._state.selectState;
  }
  set selectState(v: SelectState) {
    this._state.selectState = v;
  }

  // ── 公共 getter（供集成测试和外部消费者使用）──
  get ready(): boolean {
    return this._ready;
  }
  get deleting(): boolean {
    return this._deleteLock.isBusy();
  }
  get entries(): TreeEntry[] {
    return this._state.entries;
  }
  /** 外部模块（bus-handlers 等）写条目走公共 setter，内部用 _state 直写 */
  set entries(v: TreeEntry[]) {
    this._state.entries = v;
  }
  get rootAttr(): string {
    return this._state.rootAttr;
  }
  get subdirAttr(): string {
    return this._state.subdirAttr;
  }
  get filesRoot(): string {
    return this._state.filesRoot;
  }
  /** 外部模块（bus-handlers 等）写仓库根走公共 setter */
  set filesRoot(v: string) {
    this._state.filesRoot = v;
  }
  get filterPaths(): Set<string> | null {
    return this._state.filterPaths;
  }
  get dirOpen(): Record<string, boolean> {
    return this._state.dirOpen;
  }
  /** 启停链互斥锁（events / bus-handlers 抢锁-释放的唯一句柄，ADR-341） */
  get toggleLock(): BusyLock {
    return this._toggleLock;
  }

  /** 响应式属性：root（资源类型根，Design.md §15 契约）+ subdir（ADR-094 子类型子目录） */
  static get observedAttributes(): string[] {
    return ["root", "subdir"];
  }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [appTreeStyle.sheet];
  }

  async connectedCallback(): Promise<void> {
    this._state.rootAttr = this.getAttribute("root") || "";
    this._state.subdirAttr = this.getAttribute("subdir") || "";
    // 挂载入口快照：与补载判定共用——root/subdir 在途切换 = 当前属性 ≠ 入口快照。
    // 同步段内不可能有 attributeChanged（JS 单线程），此值即「挂载开始时的事实」。
    const initRoot = this._state.rootAttr;
    const initSubdir = this._state.subdirAttr;
    // 挂载代际捕获：二次挂载时若 root 在途被切换（attributeChangedCallback 已推进代际），
    // 丢弃本代过期 _load 的渲染，防旧类型数据覆盖新树（绑定逻辑不受影响，容器不变）
    const gen = this._guard.next();
    // 重连判据（disconnected→connected 同实例：_ready 已置位）——恢复分离前视觉状态
    const isRemount = this._ready;

    this._hydrateDirOpen();

    // code_review 47e68917b #1（P2）：恢复 render-mode 持久化水化——TreeState 重构删了
    // `_renderMode = getRenderMode()` 实例字段后，TreeState.renderMode 硬编码默认
    // "grid"（tree-state.ts:29），写侧（setRenderMode 持久化）存活但读侧断裂 →
    // 用户保存的 list 视图每次挂载被静默重置回 grid；在首次渲染前水化一次
    this._state.renderMode = getRenderMode();

    try {
      this._renderLayout();
      this._unsubs = [];
      // 工具栏（含三个下拉控制器）返回聚合 dispose，随 _unsubs 在卸载/layout 重建时释放
      this._unsubs.push(bindToolbarEvents(this._root, this));
      this._unsubs.push(...bindBusEvents(this));
      // ADR-223：消费 nav 在树未挂时积压的 repo:focus-search 请求
      if (takeRepoSearchFocusPending()) this.focusSearch();

      // 事件委托绑定（只一次，虚拟滚动换 innerHTML 仍有效）
      const treeEl = this._root.getElementById("tree");
      if (treeEl) this._unsubs.push(bindTreeEvents(treeEl, this));

      // 滚动位置持续快照（随 _unsubs 断连退订）：断连回调触发时元素已分离、scrollTop
      // 恒读 0——分离前最后一次机会只有滚动事件本身，故在此持续记录，重连时恢复
      if (treeEl) {
        const onTreeScroll = (): void => {
          this._savedScrollTop = treeEl.scrollTop;
        };
        treeEl.addEventListener("scroll", onTreeScroll);
        this._unsubs.push(() => treeEl.removeEventListener("scroll", onTreeScroll));
      }

      // 键盘快捷键（走 key-router 注册表单点分发，ADR-308 D1 收编：原 document 手挂
      // listener 已退役；提前注册——异步 _load 期间 disconnect 也能经
      // disconnectedCallback 逐个 dispose，避免组合键/监听泄漏）
      this._initKeyboardShortcuts();

      // 仓库页 DnD 绑定（组件级，ADR-060）；透传当前树类型作导入落盘上下文。
      // P2 审核修复：传 getter 而非按值——root 支持动态切换，闭包惰性解析防旧类型残留
      const treeDnDEl = this._root.getElementById("tree");
      if (treeDnDEl) {
        this._unsubs.push(bindTreeDnD(treeDnDEl, () => this._state.rootAttr));
        // 树内拖拽移动（ADR-336）：与导入链靠 dataTransfer.types 互斥分流，
        // 拖源=文件行/目标=文件夹行或根；执行链走 _executeTreeMove（批量+乐观+代际守卫）
        this._unsubs.push(
          bindTreeMoveDnD(treeDnDEl, {
            getPayload: (anchor) => this._treeMovePayload(anchor),
            // 拖源降透明（视觉三态之三）：置位即重渲（dragging 类走数据渲染），
            // 清位同样——渲染管线唯一出口，禁 classList 手写（pitfalls #28）
            setDragging: (paths) => {
              this._draggingKeys = paths;
              this._renderTree();
            },
            executeMove: (paths, targetDir) => this._executeTreeMove(paths, targetDir),
            setDropTarget: () => {}, // drop-target 类由 move-dnd 直接操作行元素（瞬态视觉，同 droppable 范式）
          }),
        );
      }

      // 监听创作者详情→搜索本地模型
      this._unsubs.push(
        bus.on("tree:set-search", (name) => {
          this.applySearchToInput(name);
          // 写侧（repo:search-creator）已挂载路径会先 setPending 再 emit——take 清残，
          // 防 pending 残留到未来挂载迟到误填旧词
          takePendingTreeSearch();
        }),
      );
      // 冷启动 pending 消费（repo:search-creator 在 chunk 未加载时 emit 落空的兜底）：
      // 与上方 listener 共用同一套填词动作；take 互斥防双触发
      const pendingSearch = takePendingTreeSearch();
      if (pendingSearch) this.applySearchToInput(pendingSearch);

      // 延迟加载作者列表（不影响树渲染）
      this._loadAuthorsAsync();

      await this._load();
      // 挂载期间 root 在途切换（attributeChangedCallback 已推进代际）→ 丢弃本代渲染
      //（不 return：事件绑定/订阅与渲染解耦，容器不变，后续逻辑照常执行）
      if (!this._guard.stale(gen)) {
        this._renderTree();
        // 重连恢复滚动位置（搜索词回填一并进行）——须在本代渲染成功上屏后；catch 失败态
        // 与属性快照差补载路径不恢复（前者无位置可回、后者 root/subdir 已变旧位置失义）
        if (isRemount) this._restoreRemountState();
      }
      // 时序收敛（审计 c）：root/subdir 在挂载期间切换 → 快照差量触发补载最新值，
      // 取代原 _pendingRoot 事后纠错（原实现 attributeChanged 未 ready 分支不推进代际，
      // 首代渲染不被丢弃 → 需 pendingRoot 补载纠错 + 未连接 setAttribute 冗余双加载）。
      // 首代 _load 已用最新 _rootAttr 完成 → 渲染无错配；仅快照差时补载一次。
      if (this._state.rootAttr !== initRoot || this._state.subdirAttr !== initSubdir) {
        await this._reloadAfterMountSwitch();
      }
    } catch (e) {
      logError("app-tree", "Init Error", e);
      // 失败态树无位置可回：清快照防陈旧值污染下次重连恢复
      this._savedScrollTop = 0;
      const tree = this._root?.getElementById("tree");
      if (tree) tree.innerHTML = treeLoadFailedHTML();
      toastThrottled(e, t("tree.treeLoadFailed"));
    } finally {
      this._ready = true;
    }
  }

  /** 搜索词灌入工具栏输入框并派发 input（走统一防抖渲染入口）。
   *  消费方：tree:set-search listener 与冷启动 pending 消费（search-pending.ts） */
  private applySearchToInput(word: string): void {
    const srch = this._root?.getElementById("srch") as HTMLInputElement | null;
    if (srch) {
      srch.value = word;
      srch.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /** 重连恢复分离前视觉状态（补齐 ADR-163「滚动位置跨页保留」承诺）：
   *  滚动位置回写 + 搜索词回填。过滤结果本就按 _state.search 渲染（实例存活、_renderLayout
   *  不触碰 state），回填 input 只是消除「框空但结果已过滤」的显示失同步，不 dispatch 事件。 */
  private _restoreRemountState(): void {
    const treeEl = this._root.getElementById("tree");
    if (treeEl && this._savedScrollTop > 0) {
      treeEl.scrollTop = this._savedScrollTop;
    }
    this._savedScrollTop = 0;
    if (this._state.search) {
      const srch = this._root.getElementById("srch") as HTMLInputElement | null;
      if (srch) srch.value = this._state.search;
    }
  }

  /** 挂载期间 root/subdir 切换后的补载：清扫描缓存 → 重载最新值 → 守卫渲染；失败节流 toast + 兜底渲染 */
  private async _reloadAfterMountSwitch(): Promise<void> {
    const gen2 = this._guard.next();
    this._hydrateDirOpen();
    try {
      const App = await backendGetApp();
      if (App.ClearScanCache) await App.ClearScanCache(); // root 切换清扫描缓存
      await this._load();
      if (!this._guard.stale(gen2)) this._renderTree();
    } catch (e) {
      logError("app-tree", "pendingRoot Error", e);
      // 补载失败：entries 保留首代数据 → 兜底渲染避免空白树（gen 未被再次作废时）
      if (!this._guard.stale(gen2) && this._state.entries.length) this._renderTree();
      toastThrottled(e, t("tree.treeLoadFailed"));
    }
  }

  /**
   * 水化当前 rtype 的目录展开态（锐评 2026-10-15 P1-A）。
   *
   * 病灶：`readScopedDirOpen` 原先只在 connectedCallback 跑一次，而切资源类型有三条**不重连**
   * 的路径，任一条漏读都会让新树沿用上类型的展开图：
   *   ① 切类型走 `init-pages.mountTree` 的 `setAttribute("root", …)`（实例复用，只触发
   *      attributeChangedCallback → `_attrChangeReloadAsync`）；
   *   ② 分离期切类型（`!isConnected` 分支只更新 rootAttr）→ 切回页面时重连，旧实现走
   *      `Object.assign` **合并**语义，把上类型目录并进新类型 map；
   *   ③ 首挂载 `await _load()`（慢扫描 RPC）期间切类型 → `_reloadAfterMountSwitch`。
   * 污染面不止显示：`toggleDir` 的 `writeScopedDirOpen(rtype, this._state.dirOpen)` 写的是
   * **全量 map**，混装态一旦落盘就把上类型目录写进新类型槽位——2026-09「按类型命名空间」
   * 收债（dirOpenState 分 rtype）会从任一条活路径复活。故三个入口收敛到本方法。
   *
   * 判据用「上次水化的 rtype」而非无条件重读：同 rtype 重连时保留内存态（toggleDir 每次
   * 即时落盘，二者等价，但省一次存储读且不打断「分离→重连保留展开态」的既有承诺）。
   * **赋值替换**而非 Object.assign 合并——合并等于把旧类型残留留在新类型里，正是本缺陷本体。
   */
  private _hydrateDirOpen(): void {
    const rtype = this._state.rootAttr;
    if (this._dirOpenRtype === rtype) return;
    this._dirOpenRtype = rtype;
    this._state.dirOpen = readScopedDirOpen(rtype);
  }

  /** root/subdir 属性变更 → 重新加载并渲染（首次挂载由 connectedCallback 负责，避免重复加载） */
  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    if (name === "root") this._state.rootAttr = newVal || "";
    if (name === "subdir") this._state.subdirAttr = newVal || "";
    if (!this._ready || !this.isConnected) {
      // 挂载未完成：作废在途首代 _load 的迟到渲染（否则首代渲染「新 rootAttr +
      // 旧 entries」错配帧上屏）；connected 末尾用入口快照差量补载，无冗余双加载。
      this._guard.invalidate();
      return;
    }
    // microtask 合并：mountTree 复用路径先改 root 再改 subdir（或反向），同步任务内
    // 两次回调只应在两属性都落位后重载一次——gen 在 microtask 里捕获即终值代际
    if (this._attrReloadQueued) return;
    this._attrReloadQueued = true;
    queueMicrotask(() => {
      this._attrReloadQueued = false;
      const gen = this._guard.next();
      void this._attrChangeReloadAsync(gen);
    });
  }

  private async _attrChangeReloadAsync(gen: number): Promise<void> {
    // ⚠️ 水化必须在**任何 await 之前**（子代理复核 2026-10-15）：rootAttr 在属性回调里已
    // 同步落成新 rtype，而本方法要先走 `ClearScanCache` + `_load`（大仓库扫盘可达秒级）——
    // 窗口内 DOM 仍是旧类型的可点行，用户点任一文件夹 → `toggleDir` 以
    // `writeScopedDirOpen(新 rtype, 旧 dirOpen)` 落盘污染；若水化押后，随后的
    // `readScopedDirOpen(新 rtype)` 会把这份污染**读回来当作本类型状态**，瞬时污染升级为持久
    // 状态。另两条入口（connectedCallback / _reloadAfterMountSwitch）本就是「先水化后 await」。
    this._hydrateDirOpen();
    try {
      const App = await backendGetApp();
      if (App.ClearScanCache) await App.ClearScanCache();
      await this._load();
      if (this._guard.stale(gen)) return;
      // 切资源类型清选中态（锐评 2026-10-13 P1-1）：选中键是**上一类型的磁盘路径**，
      // 与新类型条目键空间不同源，留着会出现「底部仍报已选 N 个、新树 0 行高亮」，
      // 按 Delete 则拿「新类型 rtype + 旧路径」拼参。后端 root 包含守卫会拦（删不掉），
      // 但确认框文案说 N 个而实为上类型的文件 = 虚假危险确认，与移动/改名链同口径清空。
      // ⚠️ 落点必须在切类型链而非 _load()：_load() 也是删除后的重载入口，而
      // 「删除失败不清空选中」是刻意行为（events.test.ts 有回归锁），放那儿会误伤。
      this._clearSelection();
      this._renderTree();
    } catch (e) {
      logError("app-tree", "root change Error", e);
      toast(`${friendlyError(e)}`, TOAST_MS.verbose, "error");
    }
  }

  /** 清空选中态 + 同步底部计数（移动/改名/删除/切类型四条链共用的同一动作） */
  private _clearSelection(): void {
    this._state.selectState.keys.clear();
    this._state.selectState.lastKey = null;
    updateSelectCount(this._root, this._state.selectState);
  }
  disconnectedCallback(): void {
    this._unsubs?.forEach((fn) => {
      fn?.();
    });
    // 代际失效（2026-10 锐评修复）：卸载只解订阅/定时器/监听，**不作废在途代数**——
    // `_reloadAfterMountSwitch`（`await ClearScanCache()` + `await _load()`，都是慢 IPC）
    // 或 `_load()` 的续体若在卸载后落地，`stale(gen)` 仍为 false（无人推进 gen），
    // 会执行 `_renderTree()` 给**已卸载**的 shadow root 重渲染整棵树。同型先例：
    // app-sidebar 同类漏接（`_guard.invalidate()`）；本调用是守卫生效的唯一前提。
    this._guard.invalidate();
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this._shortcutOffs.length) {
      this._shortcutOffs.forEach((off) => {
        off();
      });
      this._shortcutOffs = [];
    }
    const treeEl = this._root.getElementById("tree");
    if (treeEl) {
      // 清理虚拟滚动：scroll 监听 + ResizeObserver + 缓存引用
      cleanupVirtualScroll(this.treeRenderCtx, treeEl);
    }
    // statAnim 在途 animateNumber 尾帧【计时器红线豁免锚】（子代理复核 P3 正名，勿误判漏清）：
    // ≤700ms 有界尾 + 落笔目标是随 ctx GC 的 detached footer（无害写）+ 重连后新一轮
    // updateStat 的 prev() 先行取消旧句柄——不在此登记逐元素 cancel（WeakMap 不可枚举）。
  }

  async _loadAuthorsAsync(): Promise<void> {
    try {
      this._authors = await loadAuthors();
    } catch {
      this._authors = [];
    }
  }

  async _load(): Promise<void> {
    try {
      const rtype = this._state.rootAttr;
      // ADR-094：仅当有子目录时才传 subdir（无 subdir 保持单参，向后兼容）
      const r = this._state.subdirAttr
        ? await loadEntries(rtype, this._state.subdirAttr)
        : await loadEntries(rtype);
      if (r?.entries) {
        this._state.filesRoot = r.filesRoot;
        this._state.entries = r.entries;
      } else {
        this._state.entries = [];
      }
      // 成功加载（含真返回空列表）清位——loadFailed 只描述「最近一次加载」，不滞留旧错
      this._state.loadFailed = false;
    } catch (e) {
      // P2（2026-10-13）：失败置 loadFailed，空态显示「加载失败」而非「暂无模型文件」——
      // 原静默降级让用户侧「空目录」与「加载失败」不可区分，排障只能翻日志。
      // loader 侧另有节流 toast 即时提示；本标志管的是树面板内的驻留空态。
      logWarn("app-tree", "entries 加载失败:", e);
      this._state.entries = [];
      this._state.loadFailed = true;
    }
  }

  _renderLayout(): void {
    this._root.innerHTML =
      headerHTML() +
      '<div class="list" id="tree" data-testid="tree-root" role="tree" tabindex="0" aria-label="' +
      t("tree.fileList") +
      '">' +
      spinnerHTML() +
      "</div>" +
      '<div class="tree-drop-hint" id="tree-drop-hint"><span class="dot"></span><span id="tree-drop-text"></span></div>' +
      footerHTML();
    // 注入拖拽提示文案（i18n）
    const hintEl = this._root.getElementById("tree-drop-text");
    if (hintEl) hintEl.textContent = t("tree.dropHint");
  }

  _renderTree(): void {
    const c = this._root.getElementById("tree");
    // ⚠️ 此处曾先调 cleanupVirtualScroll 再 renderTree（锐评性能 #5 后续，2026-10-14 移除）：
    // 虚拟滚动的 scroll 监听与 ResizeObserver 是**按需安装一次**的（renderTree 内
    // `if (!st.cleanup)` / `if (!st.resizeObserver)` 守卫），但每次交互（选中/方向键/
    // 拖源态切换）都经本方法 → 拆了再装，搜索击键 150ms 重建一次监听 + Observer。
    // 监听器是容器级、无状态（redraw 闭包每次从 vsStates 取最新 rows/mode），
    // 跨渲染复用无需重建；真正的销毁点在 disconnectedCallback（_disconnected）。
    const filtered: TreeEntry[] = Array.isArray(this._state.entries) ? this._state.entries : [];
    // [DBG] 诊断：_renderTree 入参（entries 数 / filterPaths 大小）
    dbg(
      "_renderTree",
      "entries=" +
        filtered.length +
        " search=" +
        JSON.stringify(this._state.search) +
        " filterPaths=" +
        (this._state.filterPaths ? this._state.filterPaths.size : "null"),
    );
    renderTree(
      this.treeRenderCtx,
      c as HTMLElement,
      filtered,
      this._state.search,
      this._state.sort,
      this._state.dirOpen,
      this._state.filterPaths,
      this._state.renderMode,
      // 选中态回归数据渲染唯一出口（2026-10-13 P0-1）：此前 rowCls 恒 ""，
      // .fl.selected 零生产者、aria-selected 恒 false，鼠标选中无视觉反馈；
      // _onKeyArrowNav 的手写 classList 双轨由本参数接管后拆除。
      this._state.selectState.keys,
      // 加载失败空态区分（2026-10-13 P2）：空 entries + loadFailed → 「加载失败」空态
      this._state.loadFailed,
      // 拖源降透明（ADR-336 视觉三态之三，2026-10-13 补齐）：dragstart→setDragging
      // 置位即整树重渲（dragging 类数据渲染），dragend/drop 清位恢复
      this._draggingKeys ?? undefined,
    );
    // 有选中项时不更新 stat（由 updateSelectCount 维护），避免动画覆盖
    if (!this._state.selectState.keys.size) {
      updateStat(this.treeRenderCtx, this._root.getElementById("ftr-stat"), filtered);
    }
    // 仓库路径显示在按钮上：icon 走语义名 SVG（ADR-238 结构槽），路径是外部数据
    // 必须 esc —— 未设置态文案由 locale 提供纯文本
    const repoBtn = this._root.getElementById("btn-repo");
    if (repoBtn) {
      const repoLabel = renderRepoLabel(this._state.filesRoot);
      repoBtn.innerHTML = repoLabel;
    }
    // 注意：_authors 仅作组件字段保留（曾写 _root._treeAuthors 伪字段，死写无读取方已删）
  }

  // ========== 键盘快捷键（key-router 注册表，ADR-308 D1）==========
  // 原 document 单点 keydown 委托 + _onKeydown 串接三段（find/delete/arrow）已收编为
  // 注册表 4 条 spec——全局组合键仲裁从「约定」变「检测」（key-router 碰撞告警），
  // 且 3D 全屏让路（ADR-175 M1）以 when 门禁表达（统一走 overlay-active 权威查询，不裸查 DOM）。
  private _initKeyboardShortcuts(): void {
    // HMR 重入：先解除旧代际 spec（同 id 重复注册会触发注册表碰撞告警）
    this._shortcutOffs.forEach((off) => {
      off();
    });
    this._shortcutOffs = [];
    // 3D 全屏会话激活时让路：Ctrl+F 会把用户踢去树面板搜索框、Delete 会误删选中
    // 模型、方向键与 3D 相机平移冲突——3D 打开期间树面板不接管任何全局按键。
    const yieldTo3D = (): boolean => !isPreviewOverlayActive();
    this._shortcutOffs = [
      registerShortcut({
        id: "tree:find",
        combo: ["Ctrl+F", "Meta+F"],
        when: yieldTo3D,
        handler: (e) => {
          e.preventDefault();
          this.focusSearch();
        },
      }),
      registerShortcut({
        id: "tree:delete",
        combo: ["Delete", "Del"],
        when: yieldTo3D,
        handler: (e) => void this._onKeyDelete(e, e.target as HTMLElement | null),
      }),
      // 方向键为列表导航语义（B 级 bindListKeyboard 泛化候选，暂原样收编）；
      // 裸键匹配 = 无修饰键（原实现放行 Shift+方向键属漏查，此处按 ARIA 规范收紧）
      registerShortcut({
        id: "tree:nav-down",
        combo: "ArrowDown",
        when: yieldTo3D,
        handler: (e) => this._onKeyArrowNav(e, e.target),
      }),
      registerShortcut({
        id: "tree:nav-up",
        combo: "ArrowUp",
        when: yieldTo3D,
        handler: (e) => this._onKeyArrowNav(e, e.target),
      }),
    ];
  }

  /** 聚焦仓库搜索框（ADR-223：nav repo:focus-search + Ctrl+F 共用入口） */
  focusSearch(): void {
    const srch = this._root.getElementById("srch") as HTMLInputElement | null;
    if (srch) {
      srch.focus();
      srch.select();
    }
  }

  private async _onKeyDelete(e: KeyboardEvent, target: HTMLElement | null): Promise<boolean> {
    if (
      (e.key !== "Delete" && e.key !== "Del") ||
      !target ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA"
    )
      return false;
    const paths = [...(this.selectState?.keys || [])];
    if (!paths.length) {
      toast(t("tree.selectFilesFirst"), TOAST_MS.success, "warn");
      return true;
    }
    if (!can("DeleteResourcePack")) {
      toast(t("tree.webNoDelete"), TOAST_MS.normal, "warn");
      return true;
    }
    e.preventDefault();
    if (
      !(await modalConfirm({
        title: t("tree.batchDeleteTitle"),
        titleIcon: "delete",
        message: t("tree.batchDeleteConfirm", { n: paths.length }),
        okText: t("tree.deleteOk"),
        okIcon: "delete",
        danger: true,
      }))
    )
      return true;
    const rtype = this._state.rootAttr || RESOURCE_TYPES.YSM;
    this._deleteSelected(paths, rtype);
    return true;
  }

  private _onKeyArrowNav(e: KeyboardEvent, target: EventTarget | null): void {
    // 焦点归树容器（锐评 UX #1，2026-10-14）：行无 tabindex 时浏览器焦点永不落在行上，
    // 旧守卫 `this._root.contains(target)` 把 body 事件全拦下——箭头导航是死代码。
    // 修法：容器 role="tree" 挂 tabindex="0" 作单点 tab 停靠（WAI-ARIA tree 的 roving focus
    // 简化等价），每次导航显式 focus 容器。焦点不能交给行——renderTree 每次重渲重建行节点，
    // 行上焦点会在下一次按键前丢失（连续按方向键第二下就哑）。
    // 守卫放宽为「焦点不在输入区」：点击页面空白处（焦点落 body）后按方向键也能导航，
    // 而输入框/文本域/contenteditable 内方向键归光标所有，不抢。
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.ctrlKey || e.metaKey || e.altKey)
      return;
    // 焦点在输入区（input/textarea/select/contenteditable）时方向键归光标所有，树不抢。
    // keydown 的 target 在 happy-dom/部分 WebView 下可能是 document（无 closest）——
    // 此时按「焦点不在输入区」处理（等价 body 焦点态），故只对 Element 做 closest 判定。
    if (target instanceof Element && target.closest("input,textarea,select,[contenteditable]"))
      return;
    const container = this._root.getElementById("tree");
    if (!container) return;
    container.focus({ preventScroll: true });
    const fileRows = getVsRows(this.treeRenderCtx, container).filter((r) => r.type === "file");
    if (!fileRows.length) return;
    e.preventDefault();

    const ss = this._state.selectState;
    const currentIdx = fileRows.findIndex((r) => r.key === ss.lastKey);
    const nextIdx =
      e.key === "ArrowDown"
        ? Math.min(currentIdx + 1, fileRows.length - 1)
        : Math.max(currentIdx - 1, 0);
    const nextKey = fileRows[nextIdx].key;
    // 选中态唯一出口 = 数据渲染（2026-10-13 P0-1）：_renderTree 按 state.selectState.keys
    // 产出 .selected / aria-selected——原手写 classList add/remove 双轨（含 selectSingle 前
    // 捕获 oldKey 的时序补丁）随 rowCls 接线一并拆除，重渲冲掉高亮的根源（rowCls 恒 ""）已除。
    selectSingle(ss, nextKey);
    this._renderTree();

    // _renderTree 重建行节点 → 滚动定位必须在新 rows 上重查（原引用已失效）
    updateSelectCount(this._root, ss);
    bus.emit("model:select", { path: nextKey, rtype: this._state.rootAttr || RESOURCE_TYPES.YSM });
    rememberModelPath(nextKey);

    const allRows = getVsRows(this.treeRenderCtx, container);
    const rowIdx = allRows.findIndex((r) => r.key === nextKey);
    if (rowIdx >= 0) {
      const rowH =
        getVsMode(this.treeRenderCtx, container) === "list" ? rowHeightList() : rowHeightGrid();
      const targetScroll = rowIdx * rowH;
      if (
        targetScroll < container.scrollTop ||
        targetScroll + rowH > container.scrollTop + container.clientHeight
      ) {
        container.scrollTop = targetScroll;
      }
    }
  }

  /** 树内拖拽移动载荷（ADR-336）：锚行在选中集内 → 多选全集，否则单行。
   *  busy 拒绝（导入链/批量链在途）返回 null = move-dnd 不起拖。 */
  private _treeMovePayload(anchor: string): TreeMovePayload | null {
    if (this._deleteLock.isBusy() || this._state.selectState.keys.size === 0) return null;
    if (this._state.selectState.keys.has(anchor)) {
      const paths = [...this._state.selectState.keys];
      return { paths, anchor };
    }
    return { paths: [anchor], anchor };
  }

  /** 树内拖拽移动执行链（ADR-336 §2.4）：批量 MoveModelFile + 乐观更新 + 代际守卫回滚。
   *  与单文件开关乐观同款范式；失败项本地不翻 + toast 明细（同 dirRecycle 格式）。 */
  private async _executeTreeMove(paths: string[], targetDir: string): Promise<void> {
    if (!this._moveLock.tryStart()) return;
    const rollbackGen = this._guard.current;
    try {
      const filesRoot = this._state.filesRoot;
      // 步骤 1：自反过滤（条目已在目标目录 = no-op；含根目标 dstDir=filesRoot 语义）
      const movePaths = filterSelfReflection(paths, targetDir, filesRoot);
      if (!movePaths.length) return; // 全自反 → 静默 no-op（不 toast，拖错地方不是错误）
      const { MoveModelFile } = await backendGetApp();
      // 步骤 2：批量移动（batchAllSettled 逐项不短路，rejected[].index 归因原下标）
      const r = await batchAllSettled(
        movePaths.map(
          (p) => () => MoveModelFile(p, `${filesRoot}/${targetDir}`.replace(/\/$/, "")),
        ),
      );
      // 步骤 3：乐观更新——成功项本地重算 path/fullPath（key 空间归一正斜杠，与 reload 同形）
      // 失败项不动；代际守卫：期间 root 切换/树已重载 → 放弃本地写（新树自洽）
      if (!this._guard.stale(rollbackGen)) {
        const byOldPath = new Map<string, number>();
        for (let m = 0; m < movePaths.length; m++) byOldPath.set(movePaths[m], m);
        for (let i = 0; i < this._state.entries.length; i++) {
          const e = this._state.entries[i];
          const key = e.fullPath || e.path;
          const idx = byOldPath.get(key);
          if (idx === undefined || r.rejected.some((x) => x.index === idx)) continue;
          this._state.entries[i] = computeMovedEntry(e, targetDir, filesRoot);
        }
        this._renderTree();
      }
      // 步骤 4：后台 reload 校正真值（Go 侧 MoveModelFile 已 InvalidateCache）+ 联动
      const gen = this._guard.current;
      await this._load();
      if (!this._guard.stale(gen)) this._renderTree();
      // ADR-339：带当前树类型发射，Go 侧按 dirLevelSync 过滤同步（非 dirLevelSync 自动 no-op）
      bus.emit("sync:toggle:status", { rtype: this._state.rootAttr || RESOURCE_TYPES.YSM });
      bus.emit("stats:refresh");
      // 选中态清空：移动后旧路径失效（与 rename/recycle/切类型链同口径，防对已不存在路径批量误删）

      this._clearSelection();
      const ok = r.fulfilled.length;
      const fail = r.rejected.length;
      if (ok > 0 || fail > 0) {
        toast(
          `${t("tree.movedDone", { ok, fail })}`,
          TOAST_MS.normal,
          fail > 0 ? "warn" : "success",
        );
      }
    } catch (e) {
      toast(`${friendlyError(e, t("tree.moveFail"))}`, TOAST_MS.long, "error");
    } finally {
      this._moveLock.finish();
    }
  }

  async _deleteSelected(paths: string[], rtype: string): Promise<void> {
    if (!this._deleteLock.tryStart()) return; // 并发守卫：连点 Delete 只执行第一次
    const gen = this._guard.current; // P2-1 代际捕获：删除期间 root 切换/新加载 → 丢弃过期渲染
    try {
      const { DeleteResourcePack } = await backendGetApp();
      // 批处理收口（2026-10-13）：BATCH=8 手抄循环迁 utils/async/batch-all-settled
      //（分批并发 + 逐项 ok/fail 不短路单一实现；2026-09 曾 P2 修复串行链）。
      // 2026-10-15：批量删除是可选中数百数千项的破坏性操作，补页脚进度——它是「还在跑」
      // 的可见证据（withFooterProgress 保证四条出口都清槽）。删除链刻意**不做乐观更新**：
      // 条目移除会让树行消失，误删无法本地回滚，真值一律等 _load 取。
      const r = await withFooterProgress(
        this._root,
        (done, total) => t("tree.batchProgress", { action: t("tree.deleteOk"), done, total }),
        paths.length,
        (onProgress) =>
          batchAllSettled(
            paths.map((p) => () => DeleteResourcePack(p, rtype)),
            undefined,
            onProgress,
          ),
      );

      this._clearSelection();
      // P2 修复（审核，缓存一致性）：删除后先清扫描缓存再加载——原 _load() 命中
      // 30s scanCache（Go 侧 DeleteModelFile 无 InvalidateCache，watcher 清缓存异步），
      // 刚删除的文件会立即"复活"显示。与 bus-handlers.reload() 的 ClearScanCache 链对齐。
      try {
        const App = await backendGetApp();
        if (App.ClearScanCache) await App.ClearScanCache();
      } catch (e) {
        /* 清缓存失败不影响删除结果，_load 仍会执行；留痕防缓存幽灵无人知晓 */
        logWarn("app-tree", "ClearScanCache 失败:", e);
      }
      await this._load();
      if (this._guard.stale(gen)) return; // P2-1 root 切换/新加载已发起 → 丢弃过期渲染
      this._renderTree();
      toast(
        `${t("tree.deleted", { ok: r.fulfilled.length, fail: r.rejected.length || 0 })}`,
        TOAST_MS.normal,
        "success",
      );
    } catch (e) {
      // P2 修复：getApp/删除/刷新任一环节失败都要有出口，避免 unhandled rejection 静默
      toast(`${friendlyError(e)}`, TOAST_MS.long, "error");
    } finally {
      this._deleteLock.finish();
    }
  }
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-tree")) {
  customElements.define("app-tree", AppTree);
}
// HMR 热更新：仅 treeCSS（./app-tree-styles.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
appTreeStyle.acceptHmr(import.meta.hot, "./app-tree-styles.ts", "treeCSS");
