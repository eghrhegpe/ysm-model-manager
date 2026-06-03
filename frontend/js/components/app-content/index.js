// ===== <app-content> 入口 =====
import { contentCSS } from "./content-css.js";
import { dashboardHTML, repositoryHTML, instancesHTML, settingsHTML, placeholderHTML } from "./tpl.js";

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "dashboard";
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this._render();
    });
    this._render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  _render() {
    let inner = "";
    switch (this._current) {
      case "dashboard":   inner = dashboardHTML(); break;
      case "repository":  inner = repositoryHTML(); break;
      case "instances":   inner = instancesHTML(); break;
      case "downloads":   inner = placeholderHTML("⬇️", "下载与更新"); break;
      case "diagnostics": inner = placeholderHTML("🛠️", "诊断与冲突检测"); break;
      case "settings":    inner = settingsHTML(); break;
      default:            inner = dashboardHTML();
    }
    this._root.innerHTML = `<div class="page">${inner}</div>`;
  }
}
customElements.define("app-content", AppContent);
