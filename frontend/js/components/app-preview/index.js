// ===== <app-preview> 入口 =====
import { previewCSS } from "./preview-css.js";
import { contentHTML } from "./tpl.js";
import { DEFAULT_STATS } from "./data.js";
import { updateDisplay } from "./render.js";
import { bindActions, bindBusUpdates } from "./events.js";

class AppPreview extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(previewCSS);
    this._stats = { ...DEFAULT_STATS };
    this._unsubs = [];
  }

  connectedCallback() {
    this._renderLayout();
    bindActions(this._root);

    // 监听 bus 更新
    bindBusUpdates(this._root, this._stats, this._unsubs);
    this._unsubs.push(
      bus.on("_preview:needs-update", () => {
        updateDisplay(this._root, this._stats);
      })
    );

    updateDisplay(this._root, this._stats);
  }

  disconnectedCallback() {
    this._unsubs.forEach((fn) => fn());
  }

  _renderLayout() {
    this._root.innerHTML = contentHTML();
  }
}
customElements.define("app-preview", AppPreview);
