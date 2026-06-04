// ===== <app-nav> — 左侧导航菜单 =====
// 事件：nav:change — 切换页面
import { bus } from "../bus.js";

class AppNav extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._current = "dashboard";
  }

  connectedCallback() {
    this._unsub = bus.on("nav:changed", ({ page }) => {
      this._current = page;
      this.shadowRoot.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === page);
      });
    });
    this.render();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  render() {
    const items = [
      { id: "instances", icon: "🎮", label: "整合包管理" },
      { id: "repository", icon: "📦", label: "模型仓库" },
      { id: "downloads", icon: "⬇️", label: "下载与更新" },
      { id: "recycle", icon: "🗑️", label: "回收站" },
      { id: "diagnostics", icon: "🛠️", label: "诊断与冲突" },
      { id: "settings", icon: "⚙️", label: "设置" },
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: #11111b;
          border-right: 1px solid rgba(255,255,255,.06);
          width: 200px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .logo {
          padding: 16px 14px 12px;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .logo-icon { font-size: 20px; }
        .menu { padding: 8px; flex: 1; }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 12px;
          color: #a6adc8;
          cursor: pointer;
          transition: all .12s;
          margin-bottom: 2px;
        }
        .nav-item:hover { background: #2a2a42; color: #cdd6f4; }
        .nav-item.active {
          background: #7c83ff22;
          color: #7c83ff;
        }
        .nav-item .icon { font-size: 14px; width: 20px; text-align: center; }
        .nav-item .tag {
          margin-left: auto;
          font-size: 9px;
          background: #f38ba822;
          color: #f38ba8;
          padding: 1px 5px;
          border-radius: 4px;
        }
        .version {
          padding: 10px 14px;
          border-top: 1px solid rgba(255,255,255,.06);
          font-size: 10px;
          color: #6c7086;
        }
      </style>
      <div class="logo">
        <span class="logo-icon">🧱</span>
        <span>YSM 管理器</span>
      </div>
      <div class="menu">
        ${items
          .map(
            (item) => `
          <div class="nav-item ${item.id === this._current ? "active" : ""}" data-page="${item.id}">
            <span class="icon">${item.icon}</span>
            <span>${item.label}</span>
            ${item.id === "diagnostics" ? '<span class="tag">!</span>' : ""}
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="version">v1.0.0 \u2022 预告版</div>
    `;

    this.shadowRoot.querySelectorAll(".nav-item").forEach((el) => {
      el.onclick = () => bus.emit("nav:change", { page: el.dataset.page });
    });
  }
}
customElements.define("app-nav", AppNav);
