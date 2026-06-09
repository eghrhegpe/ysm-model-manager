// ===== <app-content> 入口 =====
import { bus } from "../../bus.js";
import { contentCSS } from "./content-css.js";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  downloadsHTML,
  diagnosticsHTML,
  recycleHTML,
  workshopHTML,
} from "./tpl.js";
import { registerGlobalHandlers } from "../../core/global-handlers.js";
import { initImportQueue } from "../../features/import-queue.js";
import { initDiagnostics } from "./workshop-diagnostics.js";
import { initRecycleBin } from "../../features/recycle-bin.js";
import { initRepository } from "../../pages/repository.js";
import { initSettings } from "./workshop-settings.js";
import {
  countMissing,
  renderCardsHTML,
  renderRepoHeaderHTML,
} from "./workshop-render.js";
import { bindRepoEvents } from "./workshop-events.js";
import { renderSiteView } from "./workshop-site-view.js";
import { loadWorkshopData, fillSearch } from "./workshop-core.js";

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "instances";
    this._globalUnsubs = [];
  }

  connectedCallback() {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      bus.emit("nav:changed", { page });
      this._render();
    });
    // 侧栏/仓库头按钮跳转到设置页
    this._globalUnsubs.push(
      bus.on("navigate:settings", () => {
        bus.emit("nav:change", { page: "settings" });
      }),
    );
    this._render();
    this._globalUnsubs.push(...registerGlobalHandlers());
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub();
    this._globalUnsubs.forEach((fn) => fn());
  }

  _render() {
    let inner = "";
    switch (this._current) {
      case "repository":
        inner = repositoryHTML();
        break;
      case "instances":
        inner = instancesHTML();
        break;
      case "downloads":
        inner = downloadsHTML();
        break;
      case "workshop":
        inner = workshopHTML();
        break;
      case "recycle":
        inner = recycleHTML();
        break;
      case "diagnostics":
        inner = diagnosticsHTML();
        break;
      case "settings":
        inner = settingsHTML();
        break;
      default:
        inner = instancesHTML();
    }
    this._root.innerHTML = `<div class="page">${inner}</div>`;

    if (this._current === "diagnostics") {
      this._initDiagnostics();
    } else if (this._current === "recycle") {
      this._initRecycle();
    } else if (this._current === "settings") {
      this._initSettings();
    } else if (this._current === "downloads") {
      this._initDownloads();
    } else if (this._current === "workshop") {
      this._initWorkshop();
    } else if (this._current === "repository") {
      this._initRepository();
    }
  }

  _initDiagnostics() {
    initDiagnostics(this._root, (s) => this._esc(s));
  }

  _initRepository() {
    initRepository();
  }

  _initDownloads() {
    initImportQueue(this);
  }

  _initWorkshop() {
    const root = this._root;
    const grid = root.getElementById("ws-grid");
    const browserEl = root.getElementById("ws-browser");
    const iframe = root.getElementById("ws-iframe");
    const urlEl = root.getElementById("ws-url");
    const blockedEl = root.getElementById("ws-blocked");
    const popup = root.getElementById("ws-popup");
    const sourceInfo = root.getElementById("ws-source-info");
    const searchResults = root.getElementById("ws-search-results");
    const creatorView = root.getElementById("ws-creator-view");
    const creatorList = root.getElementById("ws-cr-list");
    const creatorTitle = root.getElementById("ws-cr-title");
    let currentSite = null;
    let allCreators = [];
    let repoAuthors = [];
    let wsEditMode = false; // 创意工坊创作者编辑模式（放在外面以持久化）
    const wsEditModeRef = { v: false }; // 可共享引用，供 renderSiteView 读写
    let repoModelCache = {}; // { repoName: { models, source, localMap } } 模型列表缓存

    // 加载数据
    const loadSites = async () => {
      grid.innerHTML = '<div class="ws-loading">⏳ 加载中...</div>';
      try {
        const { sites, creators, authors } = await loadWorkshopData();
        allCreators = creators;
        repoAuthors = authors;
        grid.innerHTML = renderCardsHTML(sites, (s) => this._esc(s));
        grid._wsSites = sites;
        sourceInfo.textContent = sites.length + " 站点 · JSON驱动";

        // 卡片点击事件
        grid.querySelectorAll(".ws-card").forEach((card) => {
          card.addEventListener("click", () => {
            grid
              .querySelectorAll(".ws-card")
              .forEach((c) => c.classList.remove("active"));
            card.classList.add("active");
            const idx = parseInt(card.dataset.index, 10);
            const sitesData = grid._wsSites;
            if (sitesData && sitesData[idx]) {
              currentSite = sitesData[idx];
              showSiteView(currentSite);
              const rect = card.getBoundingClientRect();
              showPopup(rect);
            }
          });
        });
      } catch (e) {
        grid.innerHTML = '<div class="ws-loading-error">加载失败</div>';
      }
    };

    // 二级菜单
    const showPopup = (rect) => {
      popup.style.display = "";
      popup.style.top = rect.bottom + 4 + "px";
      popup.style.left = Math.max(4, rect.left) + "px";
    };
    const hidePopup = () => {
      popup.style.display = "none";
    };

    popup.querySelectorAll(".ws-popup-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (!currentSite) return;
        if (item.dataset.action === "browser") {
          window.open(currentSite.url, "_blank");
          hidePopup();
        } else if (item.dataset.action === "embed") {
          hidePopup();
          openEmbedded(currentSite);
        }
      });
    });

    root.addEventListener("click", (e) => {
      if (!e.target.closest(".ws-popup") && !e.target.closest(".ws-card"))
        hidePopup();
    });

    // 内嵌浏览
    const PROXY_PORT = 18080;
    const PROXY_BASE = "http://127.0.0.1:" + PROXY_PORT + "/proxy?url=";
    const openEmbedded = async (site) => {
      try {
        const { StartProxy } = await import("../../../wailsjs/go/main/App.js");
        await StartProxy(PROXY_PORT);
      } catch (_) {}
      urlEl.textContent = site.url;
      iframe.style.display = "";
      iframe.src = PROXY_BASE + encodeURIComponent(site.url);
      browserEl.style.display = "flex";
      blockedEl.style.display = "none";
    };

    root.getElementById("ws-back").addEventListener("click", () => {
      iframe.src = "";
      browserEl.style.display = "none";
    });
    const openCurrent = () => {
      if (currentSite) window.open(currentSite.url, "_blank");
    };
    root.getElementById("ws-open").addEventListener("click", openCurrent);
    root
      .getElementById("ws-open-fallback")
      .addEventListener("click", openCurrent);

    root.getElementById("ws-refresh").addEventListener("click", loadSites);

    // 站点导出/导入
    root
      .getElementById("ws-export-btn")
      ?.addEventListener("click", async () => {
        try {
          const { ExportWorkshopSitesJSONFile } =
            await import("../../../wailsjs/go/main/App.js");
          const path = await ExportWorkshopSitesJSONFile();
          bus.emit("toast:show", {
            msg: "📤 站点已导出: " + path,
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ 导出失败: " + String(e),
            duration: 4000,
            type: "error",
          });
        }
      });
    root
      .getElementById("ws-import-btn")
      ?.addEventListener("click", async () => {
        try {
          const { ImportWorkshopSitesJSONFile } =
            await import("../../../wailsjs/go/main/App.js");
          const n = await ImportWorkshopSitesJSONFile();
          await loadSites();
          bus.emit("toast:show", {
            msg: "✅ 已导入 " + n + " 个站点",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + String(e),
            duration: 4000,
            type: "error",
          });
        }
      });

    // ===== 右栏：JSON驱动的站点视图 =====
    const showSiteView = (site) => {
      renderSiteView(site, {
        esc: (s) => this._esc(s),
        searchResults,
        creatorView,
        allCreators,
        wsEditModeRef,
        showRepoModels,
        fillSearch,
        repoModelCache,
        backToSite: () => {
          if (currentSite) showSiteView(currentSite);
        },
      });
    };

    // 📦 显示 GitHub 仓库模型列表（比对本地已有文件）
    const showRepoModels = async (repo, models, source) => {
      // 加载本地仓库已有文件列表 + 镜像配置
      let localMap = new Map();
      let mirror = "";
      try {
        const { LoadAppConfig, ScanModelEntries } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        mirror = cfg.mirror || "";
        const repoRoot = cfg.repoRoot || "";
        if (repoRoot) {
          const entries = await ScanModelEntries(repoRoot);
          entries.forEach((e) => {
            let n = e.Name || "";
            if (n.endsWith(".ban")) n = n.slice(0, -4);
            localMap.set(n, e.Hash || "");
          });
        }
      } catch (_) {
        // 加载失败不影响列表显示
      }

      // 根据镜像源选择下载 URL 前缀
      // 选 jsDelivr 时下载优先走 CDN；选 GitHub API 时走 raw（Go 端内部会按配置回退）
      const dlPrefix =
        mirror === "jsdelivr"
          ? "https://cdn.jsdelivr.net/gh/" + repo + "@main/"
          : "https://raw.githubusercontent.com/" + repo + "/main/";

      const sourceLabel =
        (source === "raw"
          ? '<span class="link-badge link-badge-raw">raw</span>'
          : source === "jsd"
            ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
            : source === "api"
              ? '<span class="link-badge link-badge-api">API</span>'
              : "") +
        (mirror === "jsdelivr"
          ? '<span class="link-badge link-badge-cdn">⚡CDN</span>'
          : mirror === "githubapi"
            ? '<span class="link-badge link-badge-ghapi">🐙API</span>'
            : "");

      const missingCount = countMissing(models, localMap);

      searchResults.innerHTML = renderRepoHeaderHTML({
        esc: (s) => this._esc(s),
        repo,
        sourceLabel,
        modelsLength: models.length,
        missingCount,
      });

      // 委托 bindRepoEvents 管理所有事件 + 内部状态 (showAll/selectedSet/renderList)
      const { renderList } = bindRepoEvents(searchResults, {
        esc: (s) => this._esc(s),
        models,
        dlPrefix,
        repo,
        source,
        showRepoModels: () => showRepoModels(repo, models, source),
        backToSite: () => {
          if (currentSite) showSiteView(currentSite);
        },
        localMap,
      });

      // 初始渲染
      const listContainer = searchResults.querySelector("#ws-repo-list");
      if (listContainer) listContainer.appendChild(renderList());
    }; // end showRepoModels

    loadSites();
  }

  _initRecycle() {
    initRecycleBin(this);
  }

  async _initSettings() {
    try {
      await initSettings(this._root);
    } catch (e) {
      console.error("[settings] 初始化失败:", e);
    }
  }

  _fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  _esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
customElements.define("app-content", AppContent);
