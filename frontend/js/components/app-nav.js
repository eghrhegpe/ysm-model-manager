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
      try {
        localStorage.setItem("nav_page", page);
      } catch {}
      this.shadowRoot.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === page);
      });
    });
    this.render();
    // 恢复上次保存的页面
    let saved = localStorage.getItem("nav_page");
    if (saved && saved !== "repository") {
      if (saved === "resources") saved = "repository";
      setTimeout(() => bus.emit("nav:change", { page: saved }), 50);
    }
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }

  render() {
    const items = [
      { id: "repository", icon: "📚", label: "模型仓库" },
      { id: "instances", icon: "🎮", label: "整合包管理" },
      { id: "workshop", icon: "🎨", label: "创作者频道" },
      { id: "github", icon: "🧩", label: "创意工坊" },
      { id: "diagnostics", icon: "🛠️", label: "诊断与冲突" },
      { id: "settings", icon: "⚙️", label: "设置" },
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: var(--bg);
          border-right: 1px solid var(--bd);
          width: 160px;
          font-family: var(--font-ui);
          font-size: var(--fs-base);
        }
        .logo {
          padding: 16px 14px 12px;
          font-size: var(--fs-lg);
          font-weight: var(--fw-semibold);
          color: var(--txt);
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--bd);
        }
        .logo-icon { font-size: 20px; }
        .menu { padding: 4px 8px 8px; flex: 1; }
        .menu-label { font-size: var(--fs-xs); color: var(--muted); padding: 8px 10px 4px; text-transform: uppercase; letter-spacing: .5px; }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 5px;
          font-size: calc(var(--fs-nav) + 2px);
          color: var(--muted);
          cursor: pointer;
          transition: all .12s;
          margin-bottom: 2px;
        }
        .nav-item:hover { background: var(--hover); color: var(--txt); }
        .nav-item.active {
          background: rgba(255,255,255,.06);
          color: var(--accent);
          border-left: 3px solid var(--menu-indicator, var(--accent));
          padding-left: 7px;
        }
        .nav-item .icon { font-size: 15px; width: 20px; text-align: center; }
        .version {
          padding: 10px 14px;
          border-top: 1px solid var(--bd);
          font-size: var(--fs-sm);
          color: var(--muted);
        }
      </style>
      <div class="logo">
        <span class="logo-icon">💎</span>
        <span>YSM 管理器</span>
      </div>
      <div class="menu">
        <div class="menu-label">🧭 导航栏</div>
        ${items
          .map(
            (item) => `
          <div class="nav-item ${item.id === this._current ? "active" : ""}" data-page="${item.id}">
            <span class="icon">${item.icon}</span>
            <span>${item.label}</span>
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
