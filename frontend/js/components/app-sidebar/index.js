// ===== <app-sidebar> 入口 =====
import { bus } from "../../bus.js";
import { sidebarCSS } from "./sidebar-css.js";
import { headerHTML, footerHTML, listContainerHTML } from "./tpl.js";
import { renderVersionCards } from "./render.js";
import { bindCardEvents, bindFooter } from "./events.js";
import { loadInstances } from "./loader.js";

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

    // 监听刷新事件
    this._unsubs.push(
      bus.on("stats:refresh", async () => {
        await this._reload();
      }),
    );

    // 绑定侧栏导入按钮
    const importBtn = this._root.querySelector(".sidebar-import-all");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
        importBtn.textContent = "⏳ 导入中...";
        importBtn.disabled = true;
        bus.emit("sync:download-missing");
        // 监听完成恢复按钮
        const restore = () => {
          importBtn.textContent = "⬇️ 一键安装模型";
          importBtn.disabled = false;
          bus.off("sync:download-complete", restore);
        };
        bus.on("sync:download-complete", restore);
      });
    }

    await this._reload();
  }

  _renderCards() {
    const container = this._root.getElementById("vg");
    if (!container) return;
    renderVersionCards(container, this._instances);
    bindCardEvents(this._root, this._instances);
  }

  async _reload() {
    try {
      this._instances = await loadInstances();
    } catch (_) {
      this._instances = [];
    }

    this._renderCards();
    bindFooter(this._root, this._instances);
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _renderLayout() {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
customElements.define("app-sidebar", AppSidebar);
