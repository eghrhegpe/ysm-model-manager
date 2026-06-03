// ===== <app-tree> 入口 — 生命周期编排 =====
import { treeCSS } from "../app-tree-styles.js";
import { headerHTML, footerHTML } from "./tpl.js";
import { renderTree, updateStat } from "./render.js";
import { bindTreeEvents, bindToolbarEvents } from "./events.js";
import { loadEntries, fallbackEntries } from "./loader.js";
import { bindBusEvents } from "./bus-handlers.js";
class AppTree extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(treeCSS);
    this._entries = [];
    this._search = "";
    this._sort = "name";
    this._dirOpen = {};
    this._repoRoot = "";
  }

  async connectedCallback() {
    try {
      Object.assign(
        this._dirOpen,
        JSON.parse(localStorage.getItem("at_dirs") || "{}"),
      );
    } catch (_) {}

    this._renderLayout();
    bindToolbarEvents(this._root, this);
    this._unsubs = bindBusEvents(this);

    await this._load();
    this._renderTree();
  }
  disconnectedCallback() {
    this._unsubs?.forEach((fn) => fn?.());
  }
  async _load() {
    try {
      const r = await loadEntries();
      if (r) {
        this._repoRoot = r.repoRoot;
        this._entries = r.entries;
      } else {
        this._entries = fallbackEntries();
      }
    } catch (_) {
      this._entries = fallbackEntries();
    }
  }

  _renderLayout() {
    this._root.innerHTML =
      headerHTML() +
      '<div class="list" id="tree"><div class="empty"><div class="big">📁</div>暂无模型文件</div></div>' +
      footerHTML();
  }

  _renderTree() {
    const c = this._root.getElementById("tree");
    renderTree(c, this._entries, this._search, this._sort, this._dirOpen);
    bindTreeEvents(c, this);
    updateStat(this._root.getElementById("ftr-stat"), this._entries);
  }
}

customElements.define("app-tree", AppTree);
