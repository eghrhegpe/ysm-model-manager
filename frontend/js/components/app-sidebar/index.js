// ===== <app-sidebar> 入口 =====
import { sidebarCSS } from "./sidebar-css.js";
import { headerHTML, footerHTML, listContainerHTML } from "./tpl.js";
import { renderVersionCards } from "./render.js";
import {
  bindCardEvents,
  bindSearch,
  bindFooter,
  bindBusUpdates,
} from "./events.js";
import { loadInstances } from "./loader.js";
import { fallbackInstances } from "./data.js";

class AppSidebar extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(sidebarCSS);
    this._instances = [];
    this._unsubs = [];
  }

  async connectedCallback() {
    this._renderLayout();

    // 从 Go 加载真实数据
    try {
      const r = await loadInstances();
      if (r) {
        this._instances = r;
      } else {
        this._instances = fallbackInstances();
      }
    } catch (_) {
      this._instances = fallbackInstances();
    }

    renderVersionCards(this._root.getElementById("vg"), this._instances);
    bindCardEvents(this._root);
    bindSearch(this._root);
    bindFooter(this._root);
    bindBusUpdates(this._root, this._unsubs);
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _renderLayout() {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
customElements.define("app-sidebar", AppSidebar);
