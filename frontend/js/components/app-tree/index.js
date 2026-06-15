// ===== <app-tree> 入口 — 生命周期编排 =====
import { treeCSS } from "../app-tree-styles.js";
import { headerHTML, footerHTML, spinnerHTML } from "./tpl.js";
import { renderTree, updateStat } from "./render.js";
import { bindTreeEvents } from "./events.js";
import { bindToolbarEvents } from "./toolbar-events.js";
import { loadEntries } from "./loader.js";
import { bindBusEvents } from "./bus-handlers.js";
import { loadAuthors } from "./authors.js";
import { bus } from "../../bus.js";
import { selectState } from "./data.js";
import { dbg } from "../../utils/debug.js";
class AppTree extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(treeCSS);
    this._entries = [];
    this._search = "";
    this._sort = "name";
    this._typeFilter = "";
    this._rootAttr = ""; // 由 root 属性指定，覆盖 _typeFilter 加载用
    this._dirOpen = {};
    this._repoRoot = "";
    this._authors = [];
    this._filterPaths = null; // Set 或 null，来自 SearchModels 结果
  }

  async connectedCallback() {
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
            this._filterPaths = new Set(results.map((r) => r.Path));
          } else {
            this._filterPaths = null;
          }
          this._renderTree();
        }),
      );

      // 监听创作者详情→搜索本地模型
      this._unsubs.push(
        bus.on("tree:set-search", (name) => {
          const srch = this._root?.getElementById("srch");
          if (srch) {
            srch.value = name;
            srch.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }),
      );

      // 检查是否有通过 bus 事件之前发来的待处理搜索
      // 用 setTimeout 确保在所有异步初始化完成后执行
      setTimeout(() => {
        if (window._pendingTreeSearch) {
          const srch = this._root?.getElementById("srch");
          if (srch) {
            srch.value = window._pendingTreeSearch;
            srch.dispatchEvent(new Event("input", { bubbles: true }));
          }
          window._pendingTreeSearch = "";
        }
      }, 0);
    } catch (e) {
      console.error("[Tree Init Error]", e);
      const tree = this._root?.getElementById("tree");
      if (tree)
        tree.innerHTML =
          '<div class="empty"><div class="big">⚠️</div>加载失败</div>';
    }
  }
  disconnectedCallback() {
    this._unsubs?.forEach((fn) => fn?.());
    if (this._keydownHandler) {
      this._root.removeEventListener("keydown", this._keydownHandler);
      document.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }
    const treeEl = this._root.getElementById("tree");
    if (treeEl && treeEl._vsCleanup) {
      treeEl._vsCleanup();
      treeEl._vsCleanup = null;
    }
  }

  async _loadAuthorsAsync() {
    try {
      this._authors = await loadAuthors();
    } catch {
      this._authors = [];
    }
  }

  async _load() {
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

  _renderLayout() {
    this._root.innerHTML =
      headerHTML() +
      '<div class="list" id="tree">' +
      spinnerHTML() +
      "</div>" +
      footerHTML();
  }

  _renderTree() {
    const c = this._root.getElementById("tree");
    // 清理旧的虚拟滚动监听
    if (c && c._vsCleanup) {
      c._vsCleanup();
      c._vsCleanup = null;
    }
    // 按类型过滤
    let filtered = Array.isArray(this._entries) ? this._entries : [];
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
      c,
      filtered,
      this._search,
      this._sort,
      this._dirOpen,
      this._filterPaths,
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
  _initKeyboardShortcuts() {
    this._keydownHandler = (e) => {
      // Ctrl+F / Cmd+F → 聚焦搜索框（允许输入框内响应）
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const srch = this._root.getElementById("srch");
        if (srch) {
          srch.focus();
          srch.select();
        }
        return;
      }

      // Delete → 删除选中文件（输入框中不触发，避免误删）
      if (
        (e.key === "Delete" || e.key === "Del") &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
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
        const isDirModel = ["mmd-skin", "vrchat-avatar"].includes(rtype);
        this._deleteSelected(paths, isDirModel);
      }
    };
    this._root.addEventListener("keydown", this._keydownHandler);
    document.addEventListener("keydown", this._keydownHandler);
  }

  async _deleteSelected(paths, isDirModel) {
    let ok = 0,
      fail = 0;
    const { DeleteModelDir, DeleteResourcePack } =
      await import("../../../wailsjs/go/main/App.js");
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
