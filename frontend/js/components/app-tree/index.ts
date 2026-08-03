// ===== <app-tree> 入口 — 生命周期编排 =====
import { treeCSS } from "../app-tree-styles.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { headerHTML, footerHTML, spinnerHTML } from "./tpl.ts";
import { renderTree, updateStat, getRenderMode, setRenderMode, type RenderMode, type TreeRow } from "./render.ts";
import { bindTreeEvents } from "./events.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { loadEntries, type TreeEntry } from "./loader.ts";
import { bindBusEvents } from "./bus-handlers.ts";
import { loadAuthors, type AuthorInfo } from "./authors.ts";
import { bus } from "../../bus.ts";
import { selectState } from "./data.ts";
import { dbg } from "../../utils/debug.ts";

// 模块级待处理搜索词：切页先存、组件挂载后消费（替代 window._pendingTreeSearch，零 window 全局）
let _pendingTreeSearch = "";
export function setPendingTreeSearch(name: string): void {
  _pendingTreeSearch = name;
}
export function takePendingTreeSearch(): string {
  const v = _pendingTreeSearch;
  _pendingTreeSearch = "";
  return v;
}

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

export class AppTree extends HTMLElement {
  _root: ShadowRoot;
  _entries: TreeEntry[] = [];
  _search = "";
  _sort = "name";
  _typeFilter = "";
  _rootAttr = ""; // 由 root 属性指定，覆盖 _typeFilter 加载用
  _dirOpen: Record<string, boolean> = {};
  _repoRoot = "";
  _authors: Array<AuthorInfo | string> = [];
  _filterPaths: Set<string> | null = null; // Set 或 null，来自 SearchModels 结果
  _renderMode: RenderMode = getRenderMode(); // 'grid' | 'list'
  _unsubs: Array<() => void> = [];
  private _keydownHandler: EventListener | null = null;
  /** 已完成 connectedCallback 初始化（用于区分首次挂载与后续属性变更） */
  private _ready = false;

  /** 响应式属性：root（资源类型根，Design.md §15 契约） */
  static get observedAttributes(): string[] {
    return ["root"];
  }

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(treeCSS);
  }

  async connectedCallback(): Promise<void> {
    this._rootAttr = this.getAttribute("root") || "";

    try {
      Object.assign(
        this._dirOpen,
        JSON.parse(localStorage.getItem("at_dirs") || "{}"),
      );
    } catch (_) {}

    try {
      this._renderLayout();
      this._unsubs = [];
      bindToolbarEvents(this._root, this);
      this._unsubs.push(...bindBusEvents(this));

      await this._load();
      this._renderTree();

      // 事件委托绑定（只一次，虚拟滚动换 innerHTML 仍有效）
      const treeEl = this._root.getElementById("tree");
      if (treeEl) bindTreeEvents(treeEl, this);

      // 键盘快捷键
      this._initKeyboardShortcuts();

      // 延迟加载作者列表（不影响树渲染）
      this._loadAuthorsAsync();

      // 监听高级筛选结果
      this._unsubs.push(
        bus.on("filter:results", (results) => {
          if (results && results.length) {
            this._filterPaths = new Set(results.map((r) => r.path));
          } else {
            this._filterPaths = null;
          }
          this._renderTree();
        }),
      );

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

      // 检查是否有通过 bus 事件之前发来的待处理搜索
      // 用 setTimeout 确保在所有异步初始化完成后执行
      setTimeout(() => {
        const pending = takePendingTreeSearch();
        if (pending) {
          const srch = this._root?.getElementById("srch") as HTMLInputElement | null;
          if (srch) {
            srch.value = pending;
            srch.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }, 0);
    } catch (e) {
      console.error("[Tree Init Error]", e);
      const tree = this._root?.getElementById("tree");
      if (tree)
        tree.innerHTML =
          '<div class="empty"><div class="big">⚠️</div>加载失败</div>';
    } finally {
      this._ready = true;
    }
  }

  /** root 属性变更 → 重新加载并渲染（首次挂载由 connectedCallback 负责，避免重复加载） */
  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (name !== "root" || oldVal === newVal) return;
    this._rootAttr = newVal || "";
    if (!this._ready || !this.isConnected) return;
    void (async () => {
      try {
        await this._load();
        this._renderTree();
      } catch (e) {
        console.error("[Tree root change Error]", e);
      }
    })();
  }
  disconnectedCallback(): void {
    this._unsubs?.forEach((fn) => fn?.());
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }
    const treeEl = this._root.getElementById("tree");
    if (treeEl && treeEl._vsCleanup) {
      treeEl._vsCleanup();
      treeEl._vsCleanup = null;
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
      const r = await loadEntries(rtype);
      if (r && r.entries) {
        this._repoRoot = r.repoRoot;
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
      '<div class="list" id="tree">' +
      spinnerHTML() +
      "</div>" +
      footerHTML();
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
      repoBtn.textContent = this._repoRoot
        ? `📁 ${this._repoRoot}`
        : "📁 未设置";
    // 存到 root 上供需要时访问
    this._root._treeAuthors = this._authors;
  }

  // ========== 键盘快捷键 ==========
  private _initKeyboardShortcuts(): void {
    this._keydownHandler = ((e: KeyboardEvent): void => {
      // Ctrl+F / Cmd+F → 聚焦搜索框（允许输入框内响应）
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const srch = this._root.getElementById("srch") as HTMLInputElement | null;
        if (srch) {
          srch.focus();
          srch.select();
        }
        return;
      }

      // Delete → 删除选中文件（输入框中不触发，避免误删）
      const target = e.target as HTMLElement | null;
      if (
        (e.key === "Delete" || e.key === "Del") &&
        target &&
        target.tagName !== "INPUT" &&
        target.tagName !== "TEXTAREA"
      ) {
        const paths = [...(selectState?.keys || [])];
        if (!paths.length) {
          bus.emit("toast:show", {
            msg: "请先选中要删除的文件",
            duration: 2000,
            type: "warn",
          });
          return;
        }
        e.preventDefault();
        if (!confirm("确定要删除选中的 " + paths.length + " 个文件吗？"))
          return;
        const rtype = this._rootAttr || "ysm";
        const isDirModel = [RESOURCE_TYPES.MMD, RESOURCE_TYPES.VRC].includes(rtype);
        this._deleteSelected(paths, isDirModel);
      }
    }) as EventListener;
    // 只注册 document 级：shadow 内组合键事件会 composed 冒泡，双注册会导致 Delete 双触发
    document.addEventListener("keydown", this._keydownHandler);
  }

  async _deleteSelected(paths: string[], isDirModel: boolean): Promise<void> {
    let ok = 0,
      fail = 0;
    const { DeleteModelDir, DeleteResourcePack } =
      await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    for (const p of paths) {
      try {
        if (isDirModel) await DeleteModelDir(p);
        else await DeleteResourcePack(p);
        ok++;
      } catch {
        fail++;
      }
    }
    selectState.keys.clear();
    selectState.lastKey = null;
    await this._load();
    this._renderTree();
    bus.emit("toast:show", {
      msg: "✅ 已删除 " + ok + " 个" + (fail ? "，失败 " + fail : ""),
      duration: 3000,
      type: "success",
    });
  }
}

customElements.define("app-tree", AppTree);
