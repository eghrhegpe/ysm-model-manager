// ===== <app-nav> — 左侧导航菜单（类型化版 — ADR-014 P3 components）=====
// 事件：nav:changed — 切换页面
import { bus, type PageName } from "../../bus.ts";
import { resolveInitialPage, sanitizePage } from "../../core/page-store.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { t } from "../../core/i18n/t.ts";
import { getApp } from "../../backend/app.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { can } from "../../utils/dom/capabilities.ts";
import { RESOURCE_TYPES, GROUP_META, GROUP_OF, GROUP_TYPE_OPTIONS, type GroupTypeOption } from "../../utils/resource/types.ts";
import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { navCSS } from "./tpl.ts";

class AppNav extends WebComponentBase {
  _current: string;
  /** 导航折叠态：折叠后收成常驻窄条（仅图标），展开按钮/页面小图标始终可见 */
  _collapsed: boolean;
  _unsub: (() => void) | undefined;
  _unsubLang: (() => void) | undefined;
  _unsubRtype: (() => void) | undefined;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // 与 PageStore 同源初始化（原硬编码 "dashboard" 是幽灵值——PageName 中
    // 不存在此页，启动时导航高亮缺失，靠 nav:changed 收敛后才恢复）
    this._current = resolveInitialPage();
    // 折叠态持久化（用户手动折叠记忆；workshop 页自动折叠走 persist=false 不落盘）
    this._collapsed = safeGet("nav_collapsed") === "1";
  }

  connectedCallback(): void {
    // P1-2（子代理审核）：重入守卫——组件被重新插入 DOM（HMR/测试反复 mount）时
    // 先退订旧订阅，避免 nav:changed/lang:changed/repo:rtype-changed 叠加执行
    this._unsub?.();
    this._unsubLang?.();
    this._unsubRtype?.();
    this._unsub = bus.on("nav:changed", ({ page }) => {
      // P3 修复（子代理审计）：page 过 sanitizePage 白名单——非法页 emit（遗留 .js/
      // 未来调用方）会让高亮静默丢失 + 脏值入 nav_page（启动时虽被兜底，会话期 UI 脱节）；
      // 与 page-store 同款模式对齐
      this._current = sanitizePage(page);
      safeSet("nav_page", this._current);
      this.shadowRoot!.querySelectorAll(".nav-item").forEach((el) => {
        const isActive = (el as HTMLElement).dataset.page === this._current;
        el.classList.toggle("active", isActive);
        if (isActive) el.setAttribute("aria-current", "page");
        else el.removeAttribute("aria-current");
      });
    });
    // 语言切换时重渲染导航标签
    this._unsubLang = bus.on("lang:changed", () => this.render());
    // logo 文案随资源类型动态化：切换 rtype → 「💎 xxx管理器」（仅类型短标签）
    this._unsubRtype = bus.on("repo:rtype-changed", (rt) => {
      this._updateLogoText(rt);
    });
    this.render();
    // 恢复上次保存的页面（首次使用或仓库页也需发射，确保导航栏高亮和 app-content 渲染）
    // 用 queueMicrotask 确保其他组件的 connectedCallback 先完成注册
    // 恢复逻辑统一走 page-store.resolveInitialPage，避免两处漂移
    const targetPage = resolveInitialPage();
    queueMicrotask(() => bus.emit("nav:changed", { page: targetPage }));
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._unsubLang?.();
    this._unsubRtype?.();
  }

  /** logo 初始文案：当前资源类型短标签 + 「管理器」后缀（如「YSM 管理器」「MMD 管理器」） */
  private _logoText(): string {
    const rtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
    return shortLabelOf(rtype) + " " + t("app.managerSuffix");
  }

  /** logo 文案随资源类型动态化：rtype → 「xxx 管理器」（仅类型短标签，如 YSM/MMD/VRC） */
  private _updateLogoText(rtype: string): void {
    const el = this.shadowRoot?.querySelector(".logo-text");
    if (!el) return;
    el.textContent = shortLabelOf(rtype) + " " + t("app.managerSuffix");
  }

  render(): void {
    // 折叠态在 host 上以 data-collapsed 标记，CSS 据此切换窄条布局
    if (this._collapsed) this.setAttribute("data-collapsed", "");
    else this.removeAttribute("data-collapsed");
    // 查看器模式（Android/网页版 ADR-049）：instances 页依赖桌面专属 binding
    // ListVersionInstances（未桥接），用 can(binding) 能力门控精确判定——
    // 替代 isViewerMode() 复合判定（平台检测收敛到 capabilities 抽象，债务 #2）。
    const isViewer = !can("ListVersionInstances");
    const canYSMHub = can("ExecuteCLI") && !resolveWebMode();
    const items = [
      { id: "repository", icon: "📚", key: "nav.repository" },
      ...(isViewer ? [] : [{ id: "instances", icon: "🎮", key: "nav.instances" }]),
      { id: "workshop", icon: "🎨", key: "nav.community" },
      ...(canYSMHub ? [{ id: "ysmhub", icon: "🌐", key: "nav.ysmhub" }] : []),
      { id: "github", icon: "🧩", key: "nav.workshop" },
      { id: "diagnostics", icon: "🛠️", key: "nav.diagnostics" },
      { id: "settings", icon: "⚙️", key: "nav.settings" },
    ];

    this.shadowRoot!.innerHTML = `
      <style>${navCSS}</style>
      <div class="logo">
        <span class="logo-icon">💎</span>
        <span class="logo-text">${this._logoText()}</span>
      </div>
      <div class="menu">
        <div class="menu-head" data-menu-head title="${this._collapsed ? t("nav.expand") : t("nav.collapse")}">
          <div class="menu-label">🧭 ${t("nav.label")}</div>
          <button class="nav-toggle" data-testid="nav-toggle" title="${this._collapsed ? t("nav.expand") : t("nav.collapse")}">${this._collapsed ? "»" : "«"}</button>
        </div>
        <div class="nav-repo-sel" data-testid="nav-repo-sel">
          <select id="nav-group-select" data-testid="nav-group-select" title="资源大类"></select>
          <select id="nav-subtype-select" data-testid="nav-subtype-select" title="资源类型"></select>
        </div>
        ${items
          .map(
            (item, idx) => `
          <div class="nav-item ${item.id === this._current ? "active" : ""}" data-testid="nav-item" data-page="${item.id}" title="${t(item.key)}" role="button" tabindex="0" data-nav-idx="${idx}">
            <span class="icon">${item.icon}</span>
            <span class="nav-text">${t(item.key)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="nav-viewer-fab" data-testid="nav-viewer-fab" title="${t("nav.viewer")}" role="button" tabindex="0">
        <span class="icon">🎲</span>
        <span class="fab-text">${t("nav.viewer")}</span>
      </div>
      <div class="version" id="nav-version">${t("common.loading")}</div>
    `;

    const navItems = Array.from(this.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item"));
    navItems.forEach((el) => {
      const activate = (): void => {
        const page = el.dataset.page as PageName;
        safeSet("nav_page", page);
        bus.emit("nav:changed", { page });
        // 切到仓库页时，将焦点传递到内容区搜索框（app-content 渲染完成后）
        if (page === "repository") {
          queueMicrotask(() => this._focusRepoSearch());
        }
      };
      el.onclick = activate;
      el.addEventListener("keydown", (e) => {
        const idx = navItems.indexOf(el);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = e.key === "ArrowDown"
            ? (idx + 1) % navItems.length
            : (idx - 1 + navItems.length) % navItems.length;
          navItems[next].focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        } else if (e.key === "Home") {
          e.preventDefault();
          navItems[0].focus();
        } else if (e.key === "End") {
          e.preventDefault();
          navItems[navItems.length - 1].focus();
        }
      });
    });

    // —— 资源切换器：大类 + 子类型双下拉（ADR-092 派生，对齐仓库页旧 subtabs 逻辑）——
    const groupSel = this.shadowRoot!.querySelector<HTMLSelectElement>("#nav-group-select");
    const subtypeSel = this.shadowRoot!.querySelector<HTMLSelectElement>("#nav-subtype-select");
    if (groupSel && subtypeSel) {
      const groups = Object.entries(GROUP_META)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([gid, meta]) => ({ gid, label: meta.icon + " " + meta.name }));
      groupSel.innerHTML = groups
        .map((g) => `<option value="${g.gid}">${g.label}</option>`)
        .join("");

      // 子类型选项：统一走 GROUP_TYPE_OPTIONS（从 resource_types.json 派生）——
      // 各 MMD 类型（EntityPlayer/SceneModel/CustomAnim 等）现为独立顶级类型，
      // 直接在所属 group 下平铺，不再通过 subtype 展开。
      const buildSubtypeOptions = (group: string): GroupTypeOption[] =>
        (GROUP_TYPE_OPTIONS[group] || []).map((o) => ({
          label: o.label,
          rtype: o.rtype,
          subdir: o.subdir,
        }));
      const fillSubtypes = (group: string): void => {
        const opts = buildSubtypeOptions(group);
        subtypeSel.innerHTML = opts
          .map((o, i) => `<option value="${i}" data-rtype="${o.rtype}" data-subdir="${o.subdir}">${o.label}</option>`)
          .join("");
        const savedRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
        const savedSubdir = safeGet("repo_subdir") || "";
        let idx = opts.findIndex((o) => o.rtype === savedRtype && o.subdir === savedSubdir);
        if (idx < 0) idx = 0;
        subtypeSel.selectedIndex = idx;
      };
      const apply = (): void => {
        const opts = buildSubtypeOptions(groupSel.value);
        const sel = opts[Number(subtypeSel.value)] || opts[0];
        if (!sel) return;
        // localStorage 写入失败静默忽略（配额/隐私模式下的可接受降级，不阻断切换）
        try { safeSet("repo_rtype", sel.rtype); safeSet("repo_subdir", sel.subdir); } catch { /* 非关键路径 */ }
        bus.emit("repo:rtype-changed", sel.rtype);
        // ADR-095 后续：子目录选择单独广播（sync 页按 subdir 过滤列表）；
        // 平铺模式下 subdir 恒 ""（apply 时自然重置订阅方过滤）
        bus.emit("repo:subdir-changed", sel.subdir);
      };
      groupSel.addEventListener("change", () => { fillSubtypes(groupSel.value); apply(); });
      subtypeSel.addEventListener("change", apply);

      // 初始化：按 localStorage 恢复大类（无匹配回退首个），再填充子类型
      const savedRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
      const savedGroup = GROUP_OF[savedRtype] || groups[0]?.gid || "";
      groupSel.value = groups.some((g) => g.gid === savedGroup) ? savedGroup : (groups[0]?.gid || "");
      fillSubtypes(groupSel.value);
    }

    // 折叠/展开：整个「🧭 导航栏」行可点击（label + 箭头统一触发，扩大点击范围）
    const head = this.shadowRoot!.querySelector(".menu-head");
    head?.addEventListener("click", () => this.setCollapsed(!this._collapsed));

    // 左下角 3D 一键跳转：取上次选中模型直开全屏 3D 预览器（复用文件树记住的 path，不内嵌第二套树）
    const fab = this.shadowRoot!.querySelector<HTMLElement>(".nav-viewer-fab");
    if (fab) {
      const handler = (): void => {
        void this._viewerFabClick().catch((e) => {
          console.error("[app-nav] 打开 3D 失败:", e);
          bus.emit("toast:show", { msg: "❌ 打开 3D 失败", duration: 3000, type: "error" });
        });
      };
      fab.addEventListener("click", handler);
      fab.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      });
    }

    // 异步加载版本号
    getApp()
      .then((App) =>
        App.GetAppVersion().then((v) => {
          // P3-5（子代理审核）：版本加载是异步，disconnect 后不再写已卸载 DOM
          if (!this.isConnected) return;
          const el = this.shadowRoot!.getElementById("nav-version");
          if (el) el.textContent = (v || "dev") + " \u2022 " + t("nav.preview");
        }),
      )
      .catch(() => {
        if (!this.isConnected) return;
        const el = this.shadowRoot!.getElementById("nav-version");
        // P2 修复（审核）：兜底不再硬编码 "v1.0.0"（网页版 browserAdapter 已实现
        // GetAppVersion 返回 "web"，此处仅剩真失败兜底；硬编码版本与实际发版脱节会误导）
        if (el) el.textContent = t("nav.preview");
      });
  }

  /**
   * 左下角 3D 一键跳转：复用文件树记住的最近选中模型（getLastModelPath），
   * 委托 preview-library.openModel3DFullscreen（按类型派发既有 createXxx3D 全屏入口）；
   * 无选中模型 → 直接开空场景 3D（不弹 toast，降低首次使用门槛）。
   */
  private async _viewerFabClick(): Promise<void> {
    const { getLastModelPath } = await import("../../views/app-content/init-pages.ts");
    const path = getLastModelPath();
    if (!path) {
      // 无选中模型 → 空场景 3D（renderer/scene/camera 已就位，用户可通过资源库选模型）
      const { openEmpty3DFullscreen } = await import("../../views/app-preview/empty-3d.ts");
      void openEmpty3DFullscreen();
      return;
    }
    const { openModel3DFullscreen } = await import("../../views/app-preview/preview-library.ts");
    await openModel3DFullscreen(path);
  }

  /**
   * 切到仓库页后将焦点传至搜索框。
   * 因 app-content 用 innerHTML 整体替换，app-tree 挂载是异步的，
   * 这里用渐进重试（最多 500ms 超时，避免永久轮询）。
   */
  private _focusRepoSearch(): void {
    let tries = 0;
    const tryFocus = (): void => {
      const appContent = document.querySelector("app-content");
      const appTree = appContent?.shadowRoot?.querySelector("app-tree");
      const srch = appTree?.shadowRoot?.getElementById("srch") as HTMLInputElement | null;
      if (srch) {
        srch.focus();
        srch.select();
        return;
      }
      if (++tries < 20) setTimeout(tryFocus, 25);
    };
    tryFocus();
  }

  /**
   * 折叠/展开导航栏（债务 #4：boolean 参数改为 options 对象，可读性/扩展性更好）。
   * @param collapsed 是否折叠
   * @param options.persist 是否持久化到 localStorage。workshop 页自动折叠传
   *                        { persist: false }，避免污染用户手动折叠记忆；
   *                        用户点按钮默认 true。
   */
  setCollapsed(collapsed: boolean, options?: { persist?: boolean }): void {
    if (this._collapsed === collapsed) return;
    this._collapsed = collapsed;
    if (options?.persist !== false) safeSet("nav_collapsed", collapsed ? "1" : "0");
    this.render();
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-nav")) {
  customElements.define("app-nav", AppNav);
}
