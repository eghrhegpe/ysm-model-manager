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
import {
  SelectDirectory,
  SaveAppConfig,
  LoadAppConfig,
} from "../../../wailsjs/go/main/App.js";

class AppSidebar extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(sidebarCSS);
    this._instances = [];
    this._unsubs = [];
    this._search = "";
  }

  async connectedCallback() {
    this._renderLayout();

    // 监听选择游戏目录
    this._unsubs.push(
      bus.on("dir:select-mc", async () => {
        try {
          const dir = await SelectDirectory();
          if (!dir) return;
          const cfg = await LoadAppConfig();
          await SaveAppConfig(cfg.repoRoot || "", dir, cfg.linkMode || "copy");
        } catch (_) {}
        await this._reload();
      }),
    );

    // 监听刷新事件
    this._unsubs.push(
      bus.on("stats:refresh", async () => {
        await this._reload();
      }),
    );

    await this._reload();
  }

  _renderCards() {
    const container = this._root.getElementById("vg");
    if (!container) return;
    const kw = this._search;
    const filtered = kw
      ? this._instances.filter((ins) => ins.name.toLowerCase().includes(kw))
      : this._instances;
    renderVersionCards(container, filtered);
    bindCardEvents(this._root);
  }

  async _reload() {
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

    // 更新统计数
    const statEl = this._root.getElementById("ver-stat");
    if (statEl) statEl.textContent = `${this._instances.length}个整合包`;

    this._renderCards();
    bindSearch(this._root, this);
    bindFooter(this._root);
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _renderLayout() {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
customElements.define("app-sidebar", AppSidebar);
