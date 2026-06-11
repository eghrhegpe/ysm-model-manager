// ===== <app-content> 入口 =====
import { bus } from "../../bus.js";
import { contentCSS } from "./content-css.js";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  githubHTML,
} from "./tpl.js";
import { registerGlobalHandlers } from "../../core/global-handlers.js";
import { initDiagnostics } from "./workshop-diagnostics.js";
import { initRepository } from "../../pages/repository.js";
import { initSettings } from "./workshop-settings.js";
import {
  countMissing,
  renderCardsHTML,
  renderRepoHeaderHTML,
} from "../../features/workshop/render.js";
import { bindRepoEvents } from "../../features/workshop/events.js";
import { renderSiteView } from "./workshop-site-view.js";
import { loadWorkshopData, fillSearch } from "./workshop-core.js";

class AppContent extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "repository";
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
      case "workshop":
        inner = workshopHTML();
        break;
      case "github":
        inner = githubHTML();
        break;
      case "diagnostics":
      case "oldest":
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
    } else if (this._current === "settings") {
      this._initSettings();
    } else if (this._current === "workshop") {
      this._initWorkshop();
    } else if (this._current === "github") {
      this._initGithub();
    } else if (this._current === "instances") {
      this._initInstances();
    } else if (this._current === "repository") {
      this._initRepository();
    }
  }

  _initDiagnostics() {
    initDiagnostics(this._root, (s) => this._esc(s));
  }

  _initInstances() {
    this._bindTabs("ins", ["versions"]);
    // 只注册一次，避免重复监听
    if (this._insListenerReg) return;
    this._insListenerReg = true;
    this._globalUnsubs.push(
      bus.on("package:selected", async (pkg) => {
        const content = this._root.getElementById("ins-content");
        if (!content) return;
        const { renderBody } =
          await import("../../components/app-sidebar/render.js");
        const synced = pkg.synced || 0;
        const missing = pkg.missing || 0;
        const extra = pkg.extra || 0;
        const filterKey = "ins-filter-" + Date.now();
        content.innerHTML =
          '<div class="ins-filter-bar" style="display:flex;gap:12px;padding:8px 8px 0;flex-shrink:0;border-bottom:1px solid var(--bd);padding-bottom:4px" data-key="' +
          filterKey +
          '">' +
          '<div class="ins-filter-card active" style="cursor:pointer;font-size:10px;color:var(--accent);font-weight:600;transition:all .12s;border-bottom:2px solid var(--accent);padding-bottom:2px" data-filter="all" title="显示全部">📊 全部</div>' +
          '<div class="ins-filter-card" style="cursor:pointer;font-size:10px;color:var(--muted);transition:all .12s" data-filter="synced" title="仅显示已同步">' +
          '<span style="color:#6bb86b;font-weight:700">' +
          synced +
          "</span> 已同步" +
          "</div>" +
          '<div class="ins-filter-card" style="cursor:pointer;font-size:10px;color:var(--muted);transition:all .12s" data-filter="missing" title="仅显示待同步">' +
          '<span style="color:#f38ba8;font-weight:700">' +
          missing +
          "</span> 待同步" +
          "</div>" +
          '<div class="ins-filter-card" style="cursor:pointer;font-size:10px;color:var(--muted);transition:all .12s" data-filter="extra" title="仅显示可加入">' +
          '<span style="color:#f9a826;font-weight:700">' +
          extra +
          "</span> 可加入" +
          "</div>" +
          "</div>" +
          '<div class="ins-filter-list ins-model-list" style="flex:1;overflow-y:auto;padding:4px 8px" data-key="' +
          filterKey +
          '">' +
          renderBody(pkg) +
          "</div>";
        // 绑定卡片点击筛选
        const bar = content.querySelector(
          '.ins-filter-bar[data-key="' + filterKey + '"]',
        );
        const list = content.querySelector(
          '.ins-filter-list[data-key="' + filterKey + '"]',
        );
        if (bar && list) {
          bar.addEventListener("click", (e) => {
            const card = e.target.closest(".ins-filter-card");
            if (!card) return;
            bar.querySelectorAll(".ins-filter-card").forEach((c) => {
              c.style.color = "var(--muted)";
              c.style.fontWeight = "400";
              c.style.borderBottom = "2px solid transparent";
            });
            card.style.color = "var(--accent)";
            card.style.fontWeight = "600";
            card.style.borderBottom = "2px solid var(--accent)";
            const filter = card.dataset.filter;
            Array.from(list.children).forEach((sec) => {
              if (filter === "all") {
                sec.style.display = "";
                return;
              }
              const cat = sec.dataset?.category || "";
              sec.style.display = cat === filter ? "" : "none";
            });
          });
        }
        // 绑定单个安装按钮
        const { InstallModelTo } =
          await import("../../../wailsjs/go/main/App.js");
        content.querySelectorAll(".btn-install-one").forEach((btn) => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const name = btn.dataset.path;
            if (!name) return;
            // 查找所在整合包名（从 pkg 获取）
            const insName = pkg.name || "";
            const { LoadAppConfig, ListVersionInstances } =
              await import("../../../wailsjs/go/main/App.js");
            const cfg = await LoadAppConfig();
            const mcRoot = cfg.mcRoot || "";
            const allIns = mcRoot
              ? (await ListVersionInstances(mcRoot)) || []
              : [];
            const match = allIns.find((i) => i.Name === insName);
            const targetDir = match ? match.CustomDir : "";
            if (!targetDir) {
              bus.emit("toast:show", {
                msg: "未找到整合包目录",
                duration: 3000,
                type: "error",
              });
              return;
            }
            try {
              await InstallModelTo(name, targetDir);
              bus.emit("stats:refresh");
              bus.emit("toast:show", {
                msg: `✅ 已安装: ${name}`,
                duration: 2000,
                type: "success",
              });
            } catch (e) {
              bus.emit("toast:show", {
                msg: `❌ 安装失败: ${String(e)}`,
                duration: 3000,
                type: "error",
              });
            }
          };
        });
      }),
    );
  }

  _initRepository() {
    initRepository();
    this._bindTabs("repo", ["tree", "import", "recycle", "dedup", "oldest"]);
  }

  _bindTabs(prefix, ids) {
    const tabs = this._root.querySelectorAll(".repo-tab");
    if (!tabs.length) return;
    let inited = {};
    tabs.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tab = btn.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("active", t === btn));
        ids.forEach((id) => {
          const el = this._root.getElementById(prefix + "-tab-" + id);
          if (el) el.style.display = id === tab ? "" : "none";
        });
        // 首次切换到非默认 tab 时初始化内容
        if (!inited[tab] && tab !== ids[0]) {
          inited[tab] = true;
          const container = this._root.getElementById(prefix + "-tab-" + tab);
          if (!container) return;
          if (tab === "import") {
            const { downloadsHTML } = await import("./tpl.js");
            container.innerHTML = downloadsHTML();
            const { initImportQueue } =
              await import("../../features/import-queue.js");
            initImportQueue(this);
          } else if (tab === "recycle") {
            const { recycleHTML } = await import("./tpl.js");
            container.innerHTML = recycleHTML();
            const { initRecycleBin } =
              await import("../../features/recycle-bin.js");
            initRecycleBin(this);
          } else if (tab === "dedup") {
            const { startDedup } = await import("./workshop-diagnostics.js");
            // 构建简易的去重面板
            container.innerHTML =
              '<div style="display:flex;flex-direction:column;height:100%">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--bd)">' +
              '<span style="flex:1;font-size:10px;color:var(--muted)">📌 按 SHA256 哈希分组，每组只保留一个，其余移入回收站</span>' +
              '<button class="hdr-btn accent" id="dedup-start-btn">🔗 开始去重</button>' +
              "</div>" +
              '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
              "</div>";
            container
              .querySelector("#dedup-start-btn")
              ?.addEventListener("click", async () => {
                const list = container.querySelector("#dedup-result-list");
                if (list)
                  await startDedup({ getElementById: () => list }, this._esc);
              });
          } else if (tab === "oldest") {
            const { loadOldestModel } =
              await import("../../features/oldest-models.js");
            await loadOldestModel(container, (s) => this._esc(s));
          }
        }
      });
    });
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
      } catch (e) {
        grid.innerHTML = '<div class="ws-loading-error">加载失败</div>';
      }
    };

    // 点击模式切换：外链 / 内嵌
    let embedMode = false;
    const toggleBtn = root.getElementById("cr-mode-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        embedMode = !embedMode;
        toggleBtn.textContent = embedMode ? "🔍 内嵌" : "↗ 外链";
      });
    }

    // 卡片点击 → 正文执行主操作，右侧 ↗ 总是外链
    const openSite = (site, external = false) => {
      if (!site) return;
      if (external || !embedMode) {
        window.open(site.url, "_blank");
      } else {
        openEmbedded(site);
      }
    };
    grid.addEventListener("click", (e) => {
      const externalBtn = e.target.closest(".gh-card-external");
      const card = e.target.closest(".gh-card");
      if (!card) return;
      // 如果点的是外链按钮，不更新选中状态和右侧视图
      const isExternal = !!externalBtn;
      if (!isExternal) {
        grid.querySelectorAll(".gh-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
      }
      const idx = parseInt(card.dataset.index, 10);
      const sitesData = grid._wsSites;
      if (sitesData && sitesData[idx]) {
        currentSite = sitesData[idx];
        if (!isExternal) showSiteView(currentSite);
        openSite(currentSite, isExternal);
      }
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

    // 刷新按钮已移除

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

  _initGithub() {
    const root = this._root;
    const grid = root.getElementById("gh-grid");
    const resultsBody = root.getElementById("gh-results-body");
    const sourceInfo = root.getElementById("gh-source-info");
    let repoModelCache = {};

    const loadRepos = async () => {
      grid.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>';
      try {
        const App = await import("../../../wailsjs/go/main/App.js");
        const repos = await App.LoadGitHubRepos();
        const ghCreators = repos || [];
        sourceInfo.textContent = ghCreators.length + " 仓库 · JSON驱动";
        if (!ghCreators.length) {
          grid.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">暂无 GitHub 仓库</div>';
          return;
        }
        grid.innerHTML = ghCreators
          .map(
            (cr, idx) =>
              '<div class="gh-card gh-repo-card" data-index="' +
              idx +
              '" data-repo="' +
              this._esc(cr.name) +
              '">' +
              '<div class="gh-card-body">' +
              '<div class="ws-name" style="font-size:11px">🐙 ' +
              this._esc(cr.name) +
              "</div>" +
              '<div class="ws-desc" style="font-size:9px">' +
              this._esc(cr.desc) +
              "</div>" +
              "</div></div>",
          )
          .join("");
        // 点击仓库
        grid.querySelectorAll(".gh-repo-card").forEach((card) => {
          card.addEventListener("click", () => {
            grid
              .querySelectorAll(".gh-card")
              .forEach((c) => c.classList.remove("active"));
            card.classList.add("active");
            const repo = card.dataset.repo;
            showRepo(repo);
          });
        });
      } catch (e) {
        grid.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">加载失败</div>';
      }
    };

    const showRepo = async (repo) => {
      resultsBody.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载模型列表中...</div>';
      // 使用缓存
      if (repoModelCache[repo]) {
        const { models, source, localMap } = repoModelCache[repo];
        renderModels(repo, models, source, localMap);
        return;
      }
      let mirror = "";
      try {
        const { LoadAppConfig, ScanModelEntries } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        mirror = cfg.mirror || "";
        const repoRoot = cfg.repoRoot || "";
        // 预先加载本地映射
        let localMap = new Map();
        if (repoRoot) {
          const entries = await ScanModelEntries(repoRoot);
          entries.forEach((e) => {
            let n = e.Name || "";
            if (n.endsWith(".ban")) n = n.slice(0, -4);
            localMap.set(n, e.Hash || "");
          });
        }
        const { tryFetchModels } =
          await import("../../features/workshop/data.js");
        const result = await tryFetchModels(repo, mirror, (pct, label) => {
          resultsBody.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
            (label || "⏳ 加载中...") +
            "</div>";
        });
        if (result && result.models) {
          repoModelCache[repo] = {
            models: result.models,
            source: result.source,
            localMap,
          };
          renderModels(repo, result.models, result.source, localMap);
        } else {
          resultsBody.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ 未找到模型列表</div>' +
            '<div style="text-align:center;padding:8px"><button class="ws-btn ws-btn-txt" id="gh-open-repo">↗ 在 GitHub 中打开</button></div>';
        }
      } catch (e) {
        resultsBody.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ 加载失败: ' +
          this._esc(String(e)) +
          "</div>" +
          '<div style="text-align:center;padding:8px"><button class="ws-btn ws-btn-txt" id="gh-open-repo">↗ 在 GitHub 中打开</button></div>';
      }
      // 绑定打开 GitHub 按钮
      const openBtn = resultsBody.querySelector("#gh-open-repo");
      if (openBtn)
        openBtn.addEventListener("click", () => {
          window.open("https://github.com/" + repo, "_blank");
        });
    };

    const renderModels = (repo, models, source, localMap) => {
      const dlPrefix =
        source === "jsd"
          ? "https://cdn.jsdelivr.net/gh/" + repo + "@main/"
          : "https://raw.githubusercontent.com/" + repo + "/main/";
      const sourceLabel =
        source === "raw"
          ? '<span class="link-badge link-badge-raw">raw</span>'
          : source === "jsd"
            ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
            : source === "api"
              ? '<span class="link-badge link-badge-api">API</span>'
              : "";
      const missingCount = countMissing(models, localMap);
      resultsBody.innerHTML = renderRepoHeaderHTML({
        esc: (s) => this._esc(s),
        repo,
        sourceLabel,
        modelsLength: models.length,
        missingCount,
      });
      const { renderList } = bindRepoEvents(resultsBody, {
        esc: (s) => this._esc(s),
        models,
        dlPrefix,
        repo,
        source,
        showRepoModels: () => showRepo(repo),
        backToSite: () => loadRepos(),
        localMap,
      });
      const listContainer = resultsBody.querySelector("#ws-repo-list");
      if (listContainer) listContainer.appendChild(renderList());
    };

    // 刷新按钮已移除
    loadRepos();
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
