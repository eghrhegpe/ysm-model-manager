// ===== <app-tree> 入口 — 生命周期编排 =====

import { t } from "@/core/i18n/t.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeGetJSON, safeSet } from "@/utils/base/primitives/storage.ts";
import { refreshAdoptedStyleSheets } from "@/utils/dom/css-hmr.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { treeCSS } from "./app-tree-styles.ts";

// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）。
// 环境守卫对齐 ui-components-styles.ts：node/happy-dom 无 CSSStyleSheet 时返回
// 占位对象（replaceSync no-op）避免 import 即崩；浏览器恒走真实分支。
const appTreeStyle: CSSStyleSheet = (() => {
  if (typeof CSSStyleSheet === "undefined") {
    return { replaceSync: () => {} } as unknown as CSSStyleSheet;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(treeCSS);
  return sheet;
})();

export { appTreeStyle };

import { isPreviewOverlayActive } from "@/preview-3d/adapters/overlay-active.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { bindBusEvents } from "./bus-handlers.ts";
import { bindTreeEvents, updateSelectCount } from "./events.ts";
import { loadEntries, type TreeEntry } from "./loader.ts";
import {
  cleanupVirtualScroll,
  createTreeRenderCtx,
  getRenderMode,
  getVsMode,
  getVsRows,
  type RenderMode,
  ROW_H_GRID,
  ROW_H_LIST,
  renderTree,
  setRenderMode,
  type TreeRenderCtx,
  updateStat,
} from "./render.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { footerHTML, headerHTML, spinnerHTML } from "./tpl.ts";
import { type TreeSnapshot, TreeState } from "./tree-state.ts";

// ADR-133 阶段 B/C+：本文件内钩子的稳定 testid 声明（G-1 单一事实源，与钩子同处）。
// 树容器 id="tree" 供 handler/CSS 锚定，testid 取 'tree-root'——落入契约孤儿扫描的
// 'tree-' 前缀白名单，从而同受 must-have 与孤儿双校验守护（裸 'tree' 只受前者）。
export const VIEW_TESTIDS: readonly string[] = ["tree-root"];

import { getApp } from "@/backend/app.ts";
import { can } from "@/backend/capabilities.ts";
import { bus } from "@/bus";
import { rememberModelPath } from "@/core/model-path-store.ts";
import { modalConfirm } from "@/features/dialogs/modal-confirm.ts";
import { bindTreeDnD } from "@/features/dnd/import-dnd.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { type AuthorInfo, loadAuthors } from "./authors.ts";
import { type SelectState, selectSingle } from "./data.ts";

// —— 全局扩展（已随 WeakMap 改造移除）——
// 原 declare global 伪字段 _vsCleanup/_vsRows/_vsMode/_vsResizeObserver 已收敛至
// render.ts vsStates WeakMap（getVsRows/getVsMode 访问）；_treeAuthors 为死字段（无读取方）随删。

// 挂载/补载失败 toast 节流（对齐 loader.ts 同款模式）：innerHTML 重建（类型切换）可高频
// 触发挂载失败，5s 内只提示一次防刷屏。
let _lastMountErrorToastAt = 0;
const MOUNT_ERROR_TOAST_MIN_GAP = 5000;
function toastThrottled(e: unknown, fallback: string): void {
  const now = Date.now();
  if (now - _lastMountErrorToastAt < MOUNT_ERROR_TOAST_MIN_GAP) return;
  _lastMountErrorToastAt = now;
  bus.emit("toast:show", {
    msg: `❌ ${friendlyError(e, fallback)}`,
    duration: TOAST_MS.long,
    type: "error",
  });
}

export class AppTree extends WebComponentBase {
  _root: ShadowRoot;
  _authors: Array<AuthorInfo | string> = [];
  _unsubs: Array<() => void> = [];
  /** 批量启用/禁用进行中（防连点菜单重叠循环二次 Toggle 把状态打回原形） */
  _batchBusy = false;
  /** 单文件开关进行中（防连点翻转状态） */
  _toggleBusy = false;
  /** 搜索防抖 timer（实例级，HMR 重入时可被 disconnectedCallback 清理） */
  _searchTimer: ReturnType<typeof setTimeout> | null = null;
  private _keydownHandler: EventListener | null = null;
  /** 批量删除进行中（防连点 Delete 二次触发） */
  private _deleting = false;
  /** 已完成 connectedCallback 初始化（用于区分首次挂载与后续属性变更） */
  private _ready = false;
  /** root 属性切换代际计数：快速切换时丢弃过期加载的渲染 */
  _gen = 0;

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
    const isOpen = this._state.dirOpen[dir];
    this._state.dirOpen[dir] = !isOpen;
    if (isOpen) {
      const prefix = `${dir}/`.replace(/\\/g, "/");
      for (const key of Object.keys(this._state.dirOpen)) {
        const nk = key.replace(/\\/g, "/");
        if (nk !== dir && nk.startsWith(prefix)) delete this._state.dirOpen[key];
      }
    }
    safeSet("dirOpenState", JSON.stringify(this._state.dirOpen));
  }

  setFilterPaths(paths: Set<string> | null): void {
    this._state.filterPaths = paths;
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

  // ── Deprecated 兼容访问器（转发到 _state，供旧代码渐进迁移）──
  /** /deprecated 使用 snapshot.entries */
  get _entries(): TreeEntry[] {
    return this._state.entries;
  }
  set _entries(v: TreeEntry[]) {
    this._state.entries = v;
  }
  /** /deprecated 使用 snapshot.search */
  get _search(): string {
    return this._state.search;
  }
  set _search(v: string) {
    this._state.search = v;
  }
  /** /deprecated 使用 snapshot.sort */
  get _sort(): string {
    return this._state.sort;
  }
  set _sort(v: string) {
    this._state.sort = v;
  }
  /** /deprecated 使用 snapshot.rootAttr */
  get _rootAttr(): string {
    return this._state.rootAttr;
  }
  set _rootAttr(v: string) {
    this._state.rootAttr = v;
  }
  /** /deprecated 使用 snapshot.subdirAttr */
  get _subdirAttr(): string {
    return this._state.subdirAttr;
  }
  set _subdirAttr(v: string) {
    this._state.subdirAttr = v;
  }
  /** /deprecated 使用 snapshot.dirOpen */
  get _dirOpen(): Record<string, boolean> {
    return this._state.dirOpen;
  }
  set _dirOpen(v: Record<string, boolean>) {
    this._state.dirOpen = v;
  }
  /** /deprecated 使用 snapshot.filesRoot */
  get _filesRoot(): string {
    return this._state.filesRoot;
  }
  set _filesRoot(v: string) {
    this._state.filesRoot = v;
  }
  /** /deprecated 使用 snapshot.filterPaths */
  get _filterPaths(): Set<string> | null {
    return this._state.filterPaths;
  }
  set _filterPaths(v: Set<string> | null) {
    this._state.filterPaths = v;
  }
  /** /deprecated 使用 snapshot.renderMode */
  get _renderMode(): RenderMode {
    return this._state.renderMode;
  }
  set _renderMode(v: RenderMode) {
    this._state.renderMode = v;
  }

  // ── 公共 getter（供集成测试和外部消费者使用）──
  get ready(): boolean {
    return this._ready;
  }
  get deleting(): boolean {
    return this._deleting;
  }
  get entries(): TreeEntry[] {
    return this._state.entries;
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
  get filterPaths(): Set<string> | null {
    return this._state.filterPaths;
  }
  get dirOpen(): Record<string, boolean> {
    return this._state.dirOpen;
  }
  get toggleBusy(): boolean {
    return this._toggleBusy;
  }
  set toggleBusy(v: boolean) {
    this._toggleBusy = v;
  }
  get batchBusy(): boolean {
    return this._batchBusy;
  }
  set batchBusy(v: boolean) {
    this._batchBusy = v;
  }

  /** 响应式属性：root（资源类型根，Design.md §15 契约）+ subdir（ADR-094 子类型子目录） */
  static get observedAttributes(): string[] {
    return ["root", "subdir"];
  }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [appTreeStyle];
  }

  async connectedCallback(): Promise<void> {
    this._state.rootAttr = this.getAttribute("root") || "";
    this._state.subdirAttr = this.getAttribute("subdir") || "";
    // 挂载入口快照：与补载判定共用——root/subdir 在途切换 = 当前属性 ≠ 入口快照。
    // 同步段内不可能有 attributeChanged（JS 单线程），此值即「挂载开始时的事实」。
    const initRoot = this._state.rootAttr;
    const initSubdir = this._state.subdirAttr;
    // 挂载代际捕获：二次挂载时若 root 在途被切换（attributeChangedCallback 已 ++_gen），
    // 丢弃本代过期 _load 的渲染，防旧类型数据覆盖新树（绑定逻辑不受影响，容器不变）
    const gen = ++this._gen;

    Object.assign(this._state.dirOpen, safeGetJSON<Record<string, boolean>>("dirOpenState", {}));

    // code_review 47e68917b #1（P2）：恢复 render-mode 持久化水化——TreeState 重构删了
    // `_renderMode = getRenderMode()` 实例字段后，TreeState.renderMode 硬编码默认
    // "grid"（tree-state.ts:29），写侧（setRenderMode 持久化）存活但读侧断裂 →
    // 用户保存的 list 视图每次挂载被静默重置回 grid；在首次渲染前水化一次
    this._state.renderMode = getRenderMode();

    try {
      this._renderLayout();
      this._unsubs = [];
      bindToolbarEvents(this._root, this);
      this._unsubs.push(...bindBusEvents(this));

      // 事件委托绑定（只一次，虚拟滚动换 innerHTML 仍有效）
      const treeEl = this._root.getElementById("tree");
      if (treeEl) bindTreeEvents(treeEl, this);

      // 键盘快捷键（只用 document + this._root，提前注册——异步 _load 期间 disconnect
      // 也能经 disconnectedCallback 正常移除，避免 keydown 监听泄漏）
      this._initKeyboardShortcuts();

      // 仓库页 DnD 绑定（组件级，ADR-060）；透传当前树类型作导入落盘上下文。
      // P2 审核修复：传 getter 而非按值——root 支持动态切换，闭包惰性解析防旧类型残留
      const treeDnDEl = this._root.getElementById("tree");
      if (treeDnDEl) this._unsubs.push(bindTreeDnD(treeDnDEl, () => this._state.rootAttr));

      // 监听创作者详情→搜索本地模型
      this._unsubs.push(
        bus.on("tree:set-search", (name) => {
          const srch = this._root?.getElementById("srch") as HTMLInputElement | null;
          if (srch) {
            srch.value = name;
            srch.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }),
      );

      // 延迟加载作者列表（不影响树渲染）
      this._loadAuthorsAsync();

      await this._load();
      // 挂载期间 root 在途切换（attributeChangedCallback 已 ++_gen）→ 丢弃本代渲染
      //（不 return：事件绑定/订阅与渲染解耦，容器不变，后续逻辑照常执行）
      if (gen === this._gen) this._renderTree();
      // 时序收敛（审计 c）：root/subdir 在挂载期间切换 → 快照差量触发补载最新值，
      // 取代原 _pendingRoot 事后纠错（原实现 attributeChanged 未 ready 分支不 ++_gen，
      // 首代渲染不被丢弃 → 需 pendingRoot 补载纠错 + 未连接 setAttribute 冗余双加载）。
      // 首代 _load 已用最新 _rootAttr 完成 → 渲染无错配；仅快照差时补载一次。
      if (this._state.rootAttr !== initRoot || this._state.subdirAttr !== initSubdir) {
        await this._reloadAfterMountSwitch();
      }
    } catch (e) {
      logError("app-tree", "Init Error", e);
      const tree = this._root?.getElementById("tree");
      if (tree) tree.innerHTML = t("tree.treeLoadFailed");
      toastThrottled(e, t("tree.treeLoadFailed"));
    } finally {
      this._ready = true;
    }
  }

  /** 挂载期间 root/subdir 切换后的补载：清扫描缓存 → 重载最新值 → 守卫渲染；失败节流 toast + 兜底渲染 */
  private async _reloadAfterMountSwitch(): Promise<void> {
    const gen2 = ++this._gen;
    try {
      const App = await getApp();
      if (App.ClearScanCache) await App.ClearScanCache(); // root 切换清扫描缓存
      await this._load();
      if (gen2 === this._gen) this._renderTree();
    } catch (e) {
      logError("app-tree", "pendingRoot Error", e);
      // 补载失败：entries 保留首代数据 → 兜底渲染避免空白树（gen 未被再次作废时）
      if (gen2 === this._gen && this._state.entries.length) this._renderTree();
      toastThrottled(e, t("tree.treeLoadFailed"));
    }
  }

  /** root/subdir 属性变更 → 重新加载并渲染（首次挂载由 connectedCallback 负责，避免重复加载） */
  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    if (name === "root") this._state.rootAttr = newVal || "";
    if (name === "subdir") this._state.subdirAttr = newVal || "";
    if (!this._ready || !this.isConnected) {
      // 挂载未完成：递增代际作废在途首代 _load 的迟到渲染（否则首代渲染「新 rootAttr +
      // 旧 entries」错配帧上屏）；connected 末尾用入口快照差量补载，无冗余双加载。
      ++this._gen;
      return;
    }
    const gen = ++this._gen;
    void this._attrChangeReloadAsync(gen);
  }

  private async _attrChangeReloadAsync(gen: number): Promise<void> {
    try {
      const App = await getApp();
      if (App.ClearScanCache) await App.ClearScanCache();
      await this._load();
      if (gen !== this._gen) return;
      this._renderTree();
    } catch (e) {
      logError("app-tree", "root change Error", e);
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  }
  disconnectedCallback(): void {
    // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
    this._unsubs?.forEach((fn) => fn?.());
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }
    const treeEl = this._root.getElementById("tree");
    if (treeEl) {
      // 清理虚拟滚动：scroll 监听 + ResizeObserver + 缓存引用
      cleanupVirtualScroll(this.treeRenderCtx, treeEl);
    }
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
    } catch (e) {
      // 目录加载失败降级为空树——用户侧「空目录」与「加载失败」不可区分，留痕供排查
      logWarn("app-tree", "entries 加载失败:", e);
      this._state.entries = [];
    }
  }

  _renderLayout(): void {
    this._root.innerHTML =
      headerHTML() +
      '<div class="list" id="tree" data-testid="tree-root" role="tree" aria-label="' +
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
    // 清理旧的虚拟滚动监听（cleanupVirtualScroll：断开 cleanup/resizeObserver + 复位状态）
    if (c) cleanupVirtualScroll(this.treeRenderCtx, c);
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
    );
    // 有选中项时不更新 stat（由 updateSelectCount 维护），避免动画覆盖
    if (!this._state.selectState.keys.size) {
      updateStat(this.treeRenderCtx, this._root.getElementById("ftr-stat"), filtered);
    }
    // 仓库路径显示在按钮上
    const repoBtn = this._root.getElementById("btn-repo");
    if (repoBtn)
      repoBtn.textContent = this._state.filesRoot
        ? `📁 ${this._state.filesRoot}`
        : t("tree.repoNotSet");
    // 注意：_authors 仅作组件字段保留（曾写 _root._treeAuthors 伪字段，死写无读取方已删）
  }

  // ========== 键盘快捷键 ==========
  private _initKeyboardShortcuts(): void {
    this._keydownHandler = ((e: Event) => {
      void this._onKeydown(e as KeyboardEvent);
    }) as unknown as EventListener;
    document.addEventListener("keydown", this._keydownHandler as unknown as EventListener);
  }

  private async _onKeydown(e: KeyboardEvent): Promise<void> {
    // 3D 全屏会话激活时让路：Ctrl+F 会把用户踢去树面板搜索框、Delete 会误删选中
    // 模型、方向键与 3D 相机平移冲突——3D 打开期间树面板不接管任何全局按键。
    // 契约收编（ADR-175 M1）：统一走 ui/overlay-active 权威查询，不裸查 DOM。
    if (isPreviewOverlayActive()) return;
    const target = e.target as HTMLElement | null;
    if (this._onKeyFind(e)) return;
    if (await this._onKeyDelete(e, target)) return;
    this._onKeyArrowNav(e, target);
  }

  private _onKeyFind(e: KeyboardEvent): boolean {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      const srch = this._root.getElementById("srch") as HTMLInputElement | null;
      if (srch) {
        srch.focus();
        srch.select();
      }
      return true;
    }
    return false;
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
      bus.emit("toast:show", {
        msg: t("tree.selectFilesFirst"),
        duration: TOAST_MS.success,
        type: "warn",
      });
      return true;
    }
    if (!can("DeleteResourcePack")) {
      bus.emit("toast:show", {
        msg: t("tree.webNoDelete"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return true;
    }
    e.preventDefault();
    if (
      !(await modalConfirm({
        title: t("tree.batchDeleteTitle"),
        icon: "🗑️",
        message: t("tree.batchDeleteConfirm", { n: paths.length }),
        okText: t("tree.deleteOk"),
        danger: true,
      }))
    )
      return true;
    const rtype = this._state.rootAttr || RESOURCE_TYPES.YSM;
    this._deleteSelected(paths, rtype);
    return true;
  }

  private _onKeyArrowNav(e: KeyboardEvent, target: HTMLElement | null): void {
    if (
      (e.key !== "ArrowDown" && e.key !== "ArrowUp") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      !target ||
      !this._root.contains(target)
    )
      return;
    const container = this._root.getElementById("tree");
    if (!container) return;
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
    // 在 selectSingle（内部会把 lastKey 改为 nextKey）之前捕获旧行 key，用它清除旧行
    // 高亮——原代码在 selectSingle 后读 selectState.lastKey，拿到的已是新行，清除逻辑
    // 误删新行自己，旧行 .selected 残留（连续 ArrowDown 多行同时高亮）。
    const oldKey = ss.lastKey;
    selectSingle(ss, nextKey);

    if (oldKey && oldKey !== nextKey) {
      const oldEl = container.querySelector(`[data-fullpath="${CSS.escape(oldKey)}"]`);
      if (oldEl) {
        oldEl.classList.remove("selected");
        oldEl.setAttribute("aria-selected", "false");
      }
    }
    const newEl = container.querySelector(`[data-fullpath="${CSS.escape(nextKey)}"]`);
    if (newEl) {
      newEl.classList.add("selected");
      newEl.setAttribute("aria-selected", "true");
    }

    updateSelectCount(this._root, ss);
    bus.emit("model:select", { path: nextKey, rtype: this._state.rootAttr || RESOURCE_TYPES.YSM });
    rememberModelPath(nextKey);

    const allRows = getVsRows(this.treeRenderCtx, container);
    const rowIdx = allRows.findIndex((r) => r.key === nextKey);
    if (rowIdx >= 0) {
      const rowH = getVsMode(this.treeRenderCtx, container) === "list" ? ROW_H_LIST : ROW_H_GRID;
      const targetScroll = rowIdx * rowH;
      if (
        targetScroll < container.scrollTop ||
        targetScroll + rowH > container.scrollTop + container.clientHeight
      ) {
        container.scrollTop = targetScroll;
      }
    }
  }

  async _deleteSelected(paths: string[], rtype: string): Promise<void> {
    if (this._deleting) return; // 并发守卫：连点 Delete 只执行第一次
    this._deleting = true;
    const gen = this._gen; // P2-1 代际捕获：删除期间 root 切换/新加载 → 丢弃过期渲染
    try {
      let ok = 0,
        fail = 0;
      const { DeleteResourcePack } = await getApp();
      // P2 修复：原串行 for...of await → 并发批处理（限并发 8）——
      // 大批量删除时串行 IPC 阻塞主线程，并发 8 兼顾吞吐与后端压力。
      // Promise.allSettled 保原语义：每项独立 try/catch，统计 ok/fail 不短路。
      const BATCH = 8;
      for (let i = 0; i < paths.length; i += BATCH) {
        const batch = paths.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map((p) => DeleteResourcePack(p, rtype)));
        for (const r of results) {
          if (r.status === "fulfilled") ok++;
          else fail++;
        }
      }
      this._state.selectState.keys.clear();
      this._state.selectState.lastKey = null;
      // P2 修复（审核，缓存一致性）：删除后先清扫描缓存再加载——原 _load() 命中
      // 30s scanCache（Go 侧 DeleteModelFile 无 InvalidateCache，watcher 清缓存异步），
      // 刚删除的文件会立即"复活"显示。与 bus-handlers.reload() 的 ClearScanCache 链对齐。
      try {
        const App = await getApp();
        if (App.ClearScanCache) await App.ClearScanCache();
      } catch (e) {
        /* 清缓存失败不影响删除结果，_load 仍会执行；留痕防缓存幽灵无人知晓 */
        logWarn("app-tree", "ClearScanCache 失败:", e);
      }
      await this._load();
      if (gen !== this._gen) return; // P2-1 root 切换/新加载已发起 → 丢弃过期渲染
      this._renderTree();
      bus.emit("toast:show", {
        msg: `✅ ${t("tree.deleted", { ok, fail: fail || 0 })}`,
        duration: TOAST_MS.normal,
        type: "success",
      });
    } catch (e) {
      // P2 修复：getApp/删除/刷新任一环节失败都要有出口，避免 unhandled rejection 静默
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: TOAST_MS.long,
        type: "error",
      });
    } finally {
      this._deleting = false;
    }
  }
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-tree")) {
  customElements.define("app-tree", AppTree);
}
// HMR 热更新：仅 treeCSS（./app-tree-styles.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
import.meta.hot?.accept("./app-tree-styles.ts", (newCssMod) => {
  refreshAdoptedStyleSheets(newCssMod?.treeCSS, "app-tree");
});
