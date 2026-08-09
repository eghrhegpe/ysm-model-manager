// ===== <app-nav> — 左侧导航菜单（类型化版 — ADR-014 P3 components）=====
// 事件：nav:change — 切换页面
import { bus, type PageName } from "../../bus.ts";
import { resolveInitialPage } from "../../core/page-store.ts";
import { t } from "../../core/i18n/t.ts";
import { getApp } from "../../wails/app.ts";

class AppNav extends HTMLElement {
  _current: string;
  _unsub: (() => void) | undefined;
  _unsubLang: (() => void) | undefined;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // 与 PageStore 同源初始化（原硬编码 "dashboard" 是幽灵值——PageName 中
    // 不存在此页，启动时导航高亮缺失，靠 nav:changed 收敛后才恢复）
    this._current = resolveInitialPage();
  }

  connectedCallback(): void {
    this._unsub = bus.on("nav:changed", ({ page }) => {
      this._current = page;
      try {
        localStorage.setItem("nav_page", page);
      } catch {}
      this.shadowRoot!.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", (el as HTMLElement).dataset.page === page);
      });
    });
    // 语言切换时重渲染导航标签
    this._unsubLang = bus.on("lang:changed", () => this.render());
    this.render();
    // 恢复上次保存的页面（首次使用或仓库页也需发射，确保导航栏高亮和 app-content 渲染）
    // 用 queueMicrotask 确保其他组件的 connectedCallback 先完成注册
    // 恢复逻辑统一走 page-store.resolveInitialPage，避免两处漂移
    const targetPage = resolveInitialPage();
    queueMicrotask(() => bus.emit("nav:change", { page: targetPage }));
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._unsubLang?.();
  }

  render(): void {
    const items = [
      { id: "repository", icon: "📚", key: "nav.repository" },
      { id: "instances", icon: "🎮", key: "nav.instances" },
      { id: "workshop", icon: "🎨", key: "nav.community" },
      { id: "github", icon: "🧩", key: "nav.workshop" },
      { id: "diagnostics", icon: "🛠️", key: "nav.diagnostics" },
      { id: "settings", icon: "⚙️", key: "nav.settings" },
    ];

    this.shadowRoot!.innerHTML = `
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
        /* Logo 呼吸光晕 */
        @keyframes logoBreathe {
          0%, 100% { text-shadow: 0 0 4px color-mix(in srgb, var(--accent) 0%, transparent); }
          50% { text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 4px color-mix(in srgb, var(--accent) 15%, transparent); }
        }
        .logo-icon { animation: logoBreathe 3s ease-in-out infinite; }
        :host-context(.no-animations) .logo-icon { animation: none !important; }
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
          transition: var(--tr-fast);
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
          <div class="nav-item ${item.id === this._current ? "active" : ""}" data-testid="nav-item" data-page="${item.id}">
            <span class="icon">${item.icon}</span>
            <span>${t(item.key)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="version" id="nav-version">${t("common.loading")}</div>
    `;

    this.shadowRoot!.querySelectorAll(".nav-item").forEach((el) => {
      (el as HTMLElement).onclick = () => bus.emit("nav:change", { page: (el as HTMLElement).dataset.page as PageName });
    });

    // 异步加载版本号
    getApp()
      .then((App) =>
        App.GetAppVersion().then((v) => {
          const el = this.shadowRoot!.getElementById("nav-version");
          if (el) el.textContent = (v || "dev") + " \u2022 " + t("nav.preview");
        }),
      )
      .catch(() => {
        const el = this.shadowRoot!.getElementById("nav-version");
        if (el) el.textContent = "v1.0.0 \u2022 " + t("nav.preview");
      });
  }
}
customElements.define("app-nav", AppNav);
