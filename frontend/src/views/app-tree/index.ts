// ===== <app-tree> 入口 — 生命周期编排 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { treeCSS } from "./app-tree-styles.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { refreshAdoptedStyleSheets } from "../../utils/dom/css-hmr.ts";
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
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { headerHTML, footerHTML, spinnerHTML } from "./tpl.ts";
import { renderTree, updateStat, getRenderMode, setRenderMode, cleanupVirtualScroll, type RenderMode, type TreeRow } from "./render.ts";
import { ROW_H_GRID, ROW_H_LIST } from "./virtual-scroll.ts";
import { bindTreeEvents, updateSelectCount } from "./events.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { get } from "../../services/registry.ts";
import type { loadEntries, TreeEntry } from "./loader.ts";
import { bindBusEvents } from "./bus-handlers.ts";
import { loadAuthors, type AuthorInfo } from "./authors.ts";
import { bus } from "../../bus.ts";
import { selectState, selectSingle } from "./data.ts";
import { rememberModelPath } from "../app-content/init-pages.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../backend/app.ts";
import { modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { can } from "../../utils/dom/capabilities.ts";
import { bindTreeDnD } from "../../features/import-dnd.ts";



// —— 全局扩展：虚拟滚动容器属性 ——
declare global {
  interface ShadowRoot {
    /** 作者列表缓存（root 上，供外部读取） */
    _treeAuthors?: Array<AuthorInfo | string>;
  }
  interface HTMLElement {
    /** 虚拟滚动清理函数（render/events 共用） */
    _vsCleanup?: (() => void) | null;
    /** 虚拟滚动行缓存 */
    _vsRows?: TreeRow[];
    /** 当前渲染模式 */
    _vsMode?: RenderMode | null;
    /** 尺寸变化观察器 */
    _vsResizeObserver?: ResizeObserver | null;
    /** 作者列表缓存（root 上，供外部读取） */
    _treeAuthors?: AuthorInfo[];
  }
}

export class AppTree extends WebComponentBase {
  _root: ShadowRoot;
  _entries: TreeEntry[] = [];
  _search = "";
  _sort = "name";
  _typeFilter = "";
  _rootAttr = ""; // 由 root 属性指定，覆盖 _typeFilter 加载用
  _subdirAttr = ""; // 由 subdir 属性指定，ADR-094 位置路由：mmd 子类型扫子目录
  _dirOpen: Record<string, boolean> = {};
  _filesRoot = "";
  _authors: Array<AuthorInfo | string> = [];
  _filterPaths: Set<string> | null = null; // Set 或 null，来自 SearchModels 结果
  _renderMode: RenderMode = getRenderMode(); // 'grid' | 'list'
  _unsubs: Array<() => void> = [];
  /** 批量启用/禁用进行中（防连点菜单重叠循环二次 Toggle 把状态打回原形） */
  _batchBusy = false;
  /** 单文件开关进行中（防连点翻转状态） */
  _toggleBusy = false;
  private _keydownHandler: EventListener | null = null;
  /** 批量删除进行中（防连点 Delete 二次触发） */
  private _deleting = false;
  /** 已完成 connectedCallback 初始化（用于区分首次挂载与后续属性变更） */
  private _ready = false;
  /** root 属性切换代际计数：快速切换时丢弃过期加载的渲染 */
  _gen = 0;
  /** P2 修复（审核）：挂载期间 root 变更标记——_ready 前不吞掉变更，connected 补加载 */
  private _pendingRoot = false;

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
    this._rootAttr = this.getAttribute("root") || "";
    this._subdirAttr = this.getAttribute("subdir") || "";
    // P3 修复：挂载代际捕获——二次挂载时若 root 在途被切换（attributeChangedCallback 已 ++_gen），
    // 丢弃本代过期 _load 的渲染，防旧类型数据覆盖新树（绑定逻辑不受影响，容器不变）
    const gen = ++this._gen;

    try {
      Object.assign(
        this._dirOpen,
        JSON.parse(safeGet("at_dirs") || "{}"),
      );
    } catch (e) { console.warn("[app-tree] parse at_dirs:", e); }

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
      if (treeDnDEl) this._unsubs.push(bindTreeDnD(treeDnDEl, () => this._rootAttr || this._typeFilter));

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
      // P3：挂载期间 root 已切换（attributeChangedCallback 在途 ++_gen）→ 丢弃本代渲染
      //（不 return：事件绑定/订阅与渲染解耦，容器不变，后续逻辑照常执行）
      if (gen === this._gen) this._renderTree();
      // P2 修复（审核，挂载时序）：_ready 前 root 被切换时 attributeChangedCallback
      // 只置 pending 标记不启动加载——此处补加载最新 root，防「树停在 spinner」
      if (this._pendingRoot) {
        this._pendingRoot = false;
        const gen2 = ++this._gen;
        try {
          const App = await getApp();
          if (App.ClearScanCache) await App.ClearScanCache(); // P2-3：root 切换清扫描缓存
          await this._load();
          if (gen2 === this._gen) this._renderTree();
        } catch (e) {
          console.error("[Tree pendingRoot Error]", e);
        }
      }

    } catch (e) {
      console.error("[Tree Init Error]", e);
      const tree = this._root?.getElementById("tree");
      if (tree)
        tree.innerHTML =
          t("tree.treeLoadFailed");
    } finally {
      this._ready = true;
    }
  }

  /** root/subdir 属性变更 → 重新加载并渲染（首次挂载由 connectedCallback 负责，避免重复加载） */
  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    if (name === "root") this._rootAttr = newVal || "";
    if (name === "subdir") this._subdirAttr = newVal || "";
    if (!this._ready || !this.isConnected) {
      this._pendingRoot = true;
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
      console.error("[Tree root change Error]", e);
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  }
  disconnectedCallback(): void {
    this._unsubs?.forEach((fn) => fn?.());
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }
    const treeEl = this._root.getElementById("tree");
    if (treeEl) {
      // 清理虚拟滚动：scroll 监听 + ResizeObserver + 缓存引用
      cleanupVirtualScroll(treeEl);
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
      const rtype = this._rootAttr || this._typeFilter;
      // ADR-094：仅当有子目录时才传 subdir（无 subdir 保持单参，向后兼容）
      const r = this._subdirAttr
        ? await get<typeof loadEntries>("loadEntries")(rtype, this._subdirAttr)
        : await get<typeof loadEntries>("loadEntries")(rtype);
      if (r && r.entries) {
        this._filesRoot = r.filesRoot;
        this._entries = r.entries;
      } else {
        this._entries = [];
      }
    } catch (_) {
      this._entries = [];
    }
  }

  _renderLayout(): void {
    this._root.innerHTML =
      headerHTML() +
      '<div class="list" id="tree" role="tree" aria-label="' + t("tree.fileList") + '">' +
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
    // 清理旧的虚拟滚动监听
    if (c && c._vsCleanup) {
      c._vsCleanup();
      c._vsCleanup = null;
    }
    // 按类型过滤
    let filtered: TreeEntry[] = Array.isArray(this._entries) ? this._entries : [];
    if (this._typeFilter) {
      filtered = filtered.filter((e) => e.type === this._typeFilter);
    }
    // [DBG] 诊断：_renderTree 入参（entries 数 / filterPaths 大小）
    dbg(
      "_renderTree",
      "entries=" +
        filtered.length +
        " search=" +
        JSON.stringify(this._search) +
        " filterPaths=" +
        (this._filterPaths ? this._filterPaths.size : "null") +
        " typeFilter=" +
        JSON.stringify(this._typeFilter),
    );
    renderTree(
      c as HTMLElement,
      filtered,
      this._search,
      this._sort,
      this._dirOpen,
      this._filterPaths,
      this._renderMode,
    );
    // 有选中项时不更新 stat（由 updateSelectCount 维护），避免动画覆盖
    if (!selectState.keys.size) {
      updateStat(this._root.getElementById("ftr-stat"), filtered);
    }
    // 仓库路径显示在按钮上
    const repoBtn = this._root.getElementById("btn-repo");
    if (repoBtn)
      repoBtn.textContent = this._filesRoot
        ? `📁 ${this._filesRoot}`
        : t("tree.repoNotSet");
    // 存到 root 上供需要时访问
    this._root._treeAuthors = this._authors;
  }

  // ========== 键盘快捷键 ==========
  private _initKeyboardShortcuts(): void {
    this._keydownHandler = ((e: Event) => {
      void this._onKeydown(e as KeyboardEvent);
    }) as unknown as EventListener;
    document.addEventListener("keydown", this._keydownHandler as unknown as EventListener);
  }

  private async _onKeydown(e: KeyboardEvent): Promise<void> {
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
    ) return false;
    const paths = [...(selectState?.keys || [])];
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
        msg: "网页版不支持删除模型",
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return true;
    }
    e.preventDefault();
    if (!(await modalConfirm({
      title: "批量删除",
      icon: "🗑️",
      message: `确定要删除选中的 ${paths.length} 个文件吗？`,
      okText: "🗑️ 删除",
      danger: true,
    })))
      return true;
    const rtype = this._rootAttr || RESOURCE_TYPES.YSM;
    this._deleteSelected(paths, rtype);
    return true;
  }

  private _onKeyArrowNav(e: KeyboardEvent, target: HTMLElement | null): void {
    if (
      (e.key !== "ArrowDown" && e.key !== "ArrowUp") ||
      e.ctrlKey || e.metaKey || e.altKey ||
      target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" ||
      !target || !this._root.contains(target)
    ) return;
    const container = this._root.getElementById("tree");
    if (!container) return;
    const fileRows = (container._vsRows || []).filter(r => r.type === "file");
    if (!fileRows.length) return;
    e.preventDefault();

    const currentIdx = fileRows.findIndex(r => r.key === selectState.lastKey);
    const nextIdx = e.key === "ArrowDown"
      ? Math.min(currentIdx + 1, fileRows.length - 1)
      : Math.max(currentIdx - 1, 0);
    const nextKey = fileRows[nextIdx].key;
    selectSingle(nextKey);

    if (selectState.lastKey) {
      const oldEl = container.querySelector(`[data-fullpath="${CSS.escape(selectState.lastKey)}"]`);
      if (oldEl) {
        oldEl.classList.remove("selected");
        oldEl.setAttribute("aria-selected", "false");
      }
    }
    selectState.lastKey = nextKey;
    const newEl = container.querySelector(`[data-fullpath="${CSS.escape(nextKey)}"]`);
    if (newEl) {
      newEl.classList.add("selected");
      newEl.setAttribute("aria-selected", "true");
    }

    updateSelectCount(this._root);
    bus.emit("model:select", { path: nextKey });
    rememberModelPath(nextKey);

    const allRows = container._vsRows || [];
    const rowIdx = allRows.findIndex(r => r.key === nextKey);
    if (rowIdx >= 0) {
      const rowH = container._vsMode === "list" ? ROW_H_LIST : ROW_H_GRID;
      const targetScroll = rowIdx * rowH;
      if (targetScroll < container.scrollTop || targetScroll + rowH > container.scrollTop + container.clientHeight) {
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
      const { DeleteResourcePack } =
        await getApp();
      for (const p of paths) {
        try {
          await DeleteResourcePack(p, rtype);
          ok++;
        } catch {
          fail++;
        }
      }
      selectState.keys.clear();
      selectState.lastKey = null;
      // P2 修复（审核，缓存一致性）：删除后先清扫描缓存再加载——原 _load() 命中
      // 30s scanCache（Go 侧 DeleteModelFile 无 InvalidateCache，watcher 清缓存异步），
      // 刚删除的文件会立即"复活"显示。与 bus-handlers.reload() 的 ClearScanCache 链对齐。
      try {
        const App = await getApp();
        if (App.ClearScanCache) await App.ClearScanCache();
      } catch (_) {
        /* 清缓存失败不影响删除结果，_load 仍会执行 */
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
        msg: "❌ " + friendlyError(e),
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
