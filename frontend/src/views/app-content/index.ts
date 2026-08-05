// ===== <app-content> 入口 =====
import { bus } from "../../bus.ts";
import { setPendingTreeSearch } from "../app-tree/index.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { contentCSS } from "./content-css.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { getApp } from "../../wails/app.ts";
import { Events } from "@wailsio/runtime";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  githubHTML,
} from "./tpl.ts";

/** 防止 avatar:config-loaded 事件重复注册（unsub 随组件销毁回收并复位 flag） */
let _avatarConfigLoadedRegistered = false;
let _avatarConfigLoadedUnsub: (() => void) | null = null;
import { registerGlobalHandlers } from "../../core/handlers/global.ts";
import { initDiagnostics } from "./diagnostics/community.ts";

import { initSettings } from "./settings/community.ts";
import {
  countMissing,
  renderCardsHTML,
  renderRepoHeaderHTML,
} from "../../features/community/render.ts";
import { bindRepoEvents } from "../../features/community/events.ts";
import { renderSiteView, type RenderSiteViewCtx, type RepoAuthorLike } from "./site-view.ts";
import { getSiteIcon } from "./workshop-icons.ts";
import { loadCommunityData, fillSearch, type LocalCreator } from "./community-data.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import type { WorkshopModel } from "../../features/community/render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

/** 仓库模型缓存条目（_workshopCache / _githubCache） */
interface RepoCacheEntry {
  models: WorkshopModel[];
  source: string;
  localMap?: Map<string, string>;
}

class AppContent extends HTMLElement {
  _root: ShadowRoot;
  _current: string;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _unsub: (() => void) | null = null;
  _unsubs: Array<() => void> = [];
  _resizeMove: ((e: MouseEvent) => void) | null = null;
  _resizeUp: (() => void) | null = null;
  _insListenerReg = false;
  _avatarRefreshRegistered = false;
  _workshopCache: Map<string, RepoCacheEntry> | null = null;
  _githubCache: Map<string, RepoCacheEntry> | null = null;
  /** _initWorkshop 的默认站点定时器（切页销毁时清理，防空跑网络请求） */
  _workshopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(contentCSS);
    this._current = "repository";
    this._globalUnsubs = [];
    this._repoEventsCleanup = null;
  }

  connectedCallback(): void {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      // 切换页面时清除扫描缓存，确保显示最新数据
      try {
        getApp().then((App) => {
          if (App.ClearScanCache) App.ClearScanCache();
        }).catch(() => {});
      } catch (_) {}
      bus.emit("nav:changed", { page });
      this._render();
    });
    // DnD 导入等请求切换到仓库页的某个标签
    this._globalUnsubs.push(
      bus.on("repo:switch-tab", ({ tab }) => {
        const btn = this._root?.querySelector(`.repo-tab[data-tab="${tab}"]`) as HTMLElement | null;
        if (btn) btn.click();
      }),
    );
    // 创作者详情浮层→搜索本地模型
    this._globalUnsubs.push(
      bus.on("repo:search-creator", (name) => {
        // 存入搜索词，app-tree 在挂载时自动检查消费
        setPendingTreeSearch(name);
        // 先切到仓库页面
        bus.emit("nav:change", { page: "repository" });
      }),
    );
    this._render();
    this._globalUnsubs.push(...registerGlobalHandlers());
  }

  disconnectedCallback(): void {
    if (this._unsub) this._unsub();
    this._globalUnsubs.forEach((fn) => fn());
    this._globalUnsubs = [];
    if (this._resizeMove) document.removeEventListener("mousemove", this._resizeMove);
    if (this._resizeUp) document.removeEventListener("mouseup", this._resizeUp);
    this._resizeMove = null;
    this._resizeUp = null;
    this._avatarRefreshRegistered = false;
    // config-loaded Wails 订阅回收 + flag 复位（组件重建后新实例可重新注册）
    if (_avatarConfigLoadedUnsub) {
      _avatarConfigLoadedUnsub();
      _avatarConfigLoadedUnsub = null;
    }
    _avatarConfigLoadedRegistered = false;
    // 清理 _unsubs（dedup 等页面的事件订阅）
    if (this._unsubs && Array.isArray(this._unsubs)) {
      this._unsubs.forEach((fn) => {
        if (typeof fn === "function") fn();
      });
    }
    this._unsubs = [];
    // 清理 repo 视图事件
    if (this._repoEventsCleanup) {
      this._repoEventsCleanup().catch(() => {});
      this._repoEventsCleanup = null;
    }
    // 清理缓存
    if (this._workshopCache) this._workshopCache.clear();
    this._workshopCache = null;
    if (this._githubCache) this._githubCache.clear();
    this._githubCache = null;
    // 清理 workshop 默认站点定时器（防空跑网络请求）
    if (this._workshopTimer) {
      clearTimeout(this._workshopTimer);
      this._workshopTimer = null;
    }
  }

  _render(): void {
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

    // 初始化预览面板拖拽调整宽度
    this._initPreviewResize();

    try {
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
    } catch (e) {
      // 页 init 抛错不中断 _render 调用方，反馈给用户而非静默
      console.error("[app-content] 页面初始化失败:", e);
      bus.emit("toast:show", {
        msg: "❌ 页面加载失败: " + friendlyError(e),
        duration: 5000,
        type: "error",
      });
    }
  }

  _initPreviewResize(): void {
    const handle = this._root.getElementById("preview-resize-handle");
    const preview = this._root.getElementById("app-preview") as HTMLElement | null;
    if (!handle || !preview) return;

    // 从 localStorage 恢复宽度
    const savedWidth = localStorage.getItem("preview-width");
    if (savedWidth) {
      const w = Math.max(160, Math.min(500, parseInt(savedWidth, 10)));
      preview.style.width = w + "px";
    }

    // 先移除上一轮 _render 遗留的 document 监听器，防止切页累积泄漏
    if (this._resizeMove) document.removeEventListener("mousemove", this._resizeMove);
    if (this._resizeUp) document.removeEventListener("mouseup", this._resizeUp);

    let resizing = false;
    handle.addEventListener("mousedown", (e) => {
      resizing = true;
      e.preventDefault();
      handle.style.background = "var(--accent)";
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });
    const onMove = (e: MouseEvent): void => {
      if (!resizing) return;
      const rect = preview.getBoundingClientRect();
      const newW = Math.max(160, Math.min(500, rect.right - e.clientX));
      preview.style.width = newW + "px";
    };
    const onUp = (): void => {
      if (!resizing) return;
      resizing = false;
      handle.style.background = "transparent";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 保存宽度到 localStorage
      localStorage.setItem("preview-width", preview.style.width);
    };
    this._resizeMove = onMove;
    this._resizeUp = onUp;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  _initDiagnostics(): void {
    initDiagnostics(this._root, (s) => this._esc(s));
  }

  _initInstances(): void {
    this._bindTabs(".repo-tab", "ins", ["versions"]);
    // 只注册一次，避免重复监听
    if (this._insListenerReg) return;
    this._insListenerReg = true;
    this._globalUnsubs.push(
      bus.on("package:selected", (pkg) => {
        const content = this._root.getElementById("ins-content");
        if (!content) return;
        const insName = pkg.name || "";
        const defaultType = pkg.rtype || RESOURCE_TYPES.YSM;
        content.innerHTML =
          '<app-sync-manager instance="' +
          String(insName).replace(/"/g, "&quot;") +
          '" default-type="' +
          defaultType +
          '" style="display:flex;flex-direction:column;flex:1;overflow:hidden;height:100%"></app-sync-manager>';
      }),
    );
  }

  _initRepository(): void {
    this._bindTabs(".repo-tab", "repo", ["tree", "import", "recycle", "dedup", "oldest"]);

    // 资源类型 subtab 切换（全局生效）
    const root = this._root;
    const subtabs = root.querySelectorAll(".repo-subtab");
    const treeBody = root.getElementById("repo-tab-tree");
    import("../app-preview/index.ts").catch(() => {});
    let curRtype = localStorage.getItem("repo_rtype") || RESOURCE_TYPES.YSM;
    subtabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const rtype = (btn as HTMLElement).dataset.rtab || "";
        if (rtype === curRtype) return;
        const prevRtype = curRtype;
        curRtype = rtype;
        try {
          localStorage.setItem("repo_rtype", rtype);
        } catch {}
        subtabs.forEach((t) => {
          t.classList.toggle("active", t === btn);
        });
        // 更新文件树（预览已在外层共享，不重复创建）
        if (treeBody) {
          treeBody.innerHTML =
            '<app-tree root="' +
            rtype +
            '" style="flex:1;min-width:0"></app-tree>';
        }
        // 通知其他 tab（仅当 rtype 真正变化时）
        if (rtype !== prevRtype) {
          bus.emit("repo:rtype-changed", rtype);
        }
      });
    });
    const savedTab = root.querySelector(
      '.repo-subtab[data-rtab="' + curRtype + '"]',
    );
    if (savedTab) (savedTab as HTMLElement).click();
  }

  /**
   * 绑定 tab 按钮切换。按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
   *   _bindTabs(".repo-tab", "ins", ["versions"]) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-versions
   */
  _bindTabs(tabSelector: string, prefix: string, ids: string[]): void {
    const tabs = this._root.querySelectorAll(tabSelector);
    if (!tabs.length) return;
    const inited: Record<string, boolean> = {};
    tabs.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tab = (btn as HTMLElement).dataset.tab || "";
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
            const { downloadsHTML } = await import("./tpl.ts");
            container.innerHTML = downloadsHTML();
            const { initImportQueue } =
              await import("../../features/import-queue.ts");
            const importCleanup = initImportQueue(this);
            this._unsubs = this._unsubs || [];
            if (importCleanup) this._unsubs.push(importCleanup);
          } else if (tab === "recycle") {
            const { recycleHTML } = await import("./tpl.ts");
            container.innerHTML = recycleHTML();
            const { initRecycleBin } =
              await import("../../features/recycle-bin.ts");
            const recycleCleanup = initRecycleBin(this);
            this._unsubs = this._unsubs || [];
            if (recycleCleanup) this._unsubs.push(recycleCleanup);
          } else if (tab === "dedup") {
            const { startDedup } = await import("./diagnostics/community.ts");
            let dedupType = localStorage.getItem("repo_rtype") || RESOURCE_TYPES.YSM;
            container.innerHTML =
              '<div style="display:flex;flex-direction:column;height:100%">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--bd)">' +
              '<span style="flex:1;font-size:var(--fs-sm);color:var(--muted)">📌 按 SHA256 哈希分组，每组只保留一个，其余移入回收站</span>' +
              '<button class="btn-base accent" id="dedup-start-btn">🔗 开始去重</button>' +
              "</div>" +
              '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
              "</div>";
            const doDedup = (): void => {
              const list = container.querySelector("#dedup-result-list");
              if (list)
                startDedup(
                  list as HTMLElement,
                  this._esc,
                  dedupType,
                );
            };
            container
              .querySelector("#dedup-start-btn")
              ?.addEventListener("click", doDedup);
            // 全局类型切换时自动重复
            const _unsub = bus.on("repo:rtype-changed", (rt) => {
              if (rt !== dedupType) {
                dedupType = rt;
                doDedup();
              }
            });
            // 组件卸载时清理
            this._unsubs = this._unsubs || [];
            this._unsubs.push(_unsub);
          } else if (tab === "oldest") {
            const { loadOldestModel } =
              await import("../../features/oldest-models.ts");
            const oldestCleanup = await loadOldestModel(container, (s) =>
              this._esc(s),
            );
            this._unsubs = this._unsubs || [];
            if (oldestCleanup) this._unsubs.push(oldestCleanup);
          } else if (tab === "resourcepacks") {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const rpCleanup = await initResourcePacks(container, this);
            this._unsubs = this._unsubs || [];
            if (rpCleanup) this._unsubs.push(rpCleanup);
          } else if (tab === "shaderpacks") {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const spCleanup = await initResourcePacks(
              container,
              this,
              RESOURCE_TYPES.SHADER,
            );
            this._unsubs = this._unsubs || [];
            if (spCleanup) this._unsubs.push(spCleanup);
          } else if (tab === RESOURCE_TYPES.BLUEPRINT) {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const cbCleanup = await initResourcePacks(
              container,
              this,
              RESOURCE_TYPES.BLUEPRINT,
            );
            this._unsubs = this._unsubs || [];
            if (cbCleanup) this._unsubs.push(cbCleanup);
          } else if (tab === RESOURCE_TYPES.MMD) {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const msCleanup = await initResourcePacks(
              container,
              this,
              RESOURCE_TYPES.MMD,
            );
            this._unsubs = this._unsubs || [];
            if (msCleanup) this._unsubs.push(msCleanup);
          } else if (tab === RESOURCE_TYPES.VRC) {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const vaCleanup = await initResourcePacks(
              container,
              this,
              RESOURCE_TYPES.VRC,
            );
            this._unsubs = this._unsubs || [];
            if (vaCleanup) this._unsubs.push(vaCleanup);
          } else if (tab === RESOURCE_TYPES.LITEMATIC) {
            const { initResourcePacks } =
              await import("../../features/resource-packs.ts");
            const lmCleanup = await initResourcePacks(
              container,
              this,
              RESOURCE_TYPES.LITEMATIC,
            );
            this._unsubs = this._unsubs || [];
            if (lmCleanup) this._unsubs.push(lmCleanup);
          }
        }
      });
    });
  }

  _initWorkshop(): void {
    const root = this._root;
    const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
    const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
    const urlEl = root.getElementById("ws-url") as HTMLElement | null;
    const blockedEl = root.getElementById("ws-blocked") as HTMLElement | null;
    const searchResults = root.getElementById("ws-search-results") as HTMLElement | null;
    const creatorView = root.getElementById("ws-creator-view") as HTMLElement | null;
    const creatorList = root.getElementById("ws-cr-list") as HTMLElement | null;
    const creatorTitle = root.getElementById("ws-cr-title") as HTMLElement | null;
    let currentSite: WorkshopSite | null = null;
    let allSites: WorkshopSite[] = [];
    let allCreators: LocalCreator[] = [];
    let repoAuthors: RepoAuthorLike[] = [];
    // 创意工坊创作者编辑模式（放在外面以持久化）
    const wsEditModeRef = { v: false }; // 可共享引用，供 renderSiteView 读写
    if (!this._workshopCache) this._workshopCache = new Map();
    const repoModelCache = this._workshopCache;

    // 点击模式切换：外链 / 内嵌（委托到 searchResults，按钮在 renderSiteView 中动态渲染）
    let embedMode = false;
    const toggleEmbedMode = (): void => {
      embedMode = !embedMode;
      const btn = searchResults?.querySelector("#cr-mode-toggle");
      if (btn)
        btn
          .querySelectorAll(".cr-mode-opt")
          .forEach((el) => el.classList.toggle("active"));
    };

    // B站/爱发电 tab 点击 → 在右侧显示对应站点的创作者（不打开网站）
    const showCreatorsBySite = async (siteType: string): Promise<void> => {
      const { sites, creators, authors } = await loadCommunityData();
      allSites = sites;
      allCreators = creators;
      repoAuthors = (authors || []) as RepoAuthorLike[];
      const site = sites.find((s) => s.id === siteType);
      if (!site) return;
      currentSite = site;
      localStorage.setItem("ysm-ws-last-tab", site.id);
      // tab 切换高亮
      root
        .querySelectorAll(".repo-tab")
        .forEach((t) => t.classList.remove("active"));
      root.querySelector(`[data-tab="${siteType}"]`)?.classList.add("active");
      showSiteView(currentSite);
    };
    // 默认显示第一个站点
    this._workshopTimer = setTimeout(async () => {
      const { sites } = await loadCommunityData();
      allSites = sites;
      // 动态生成 Tab
      const tabsEl = root.getElementById("ws-tabs");
      if (tabsEl && sites.length) {
        tabsEl.innerHTML = "";
        sites.forEach((s, i) => {
          const btn = document.createElement("button");
          btn.className = "repo-tab" + (i === 0 ? " active" : "");
          btn.dataset.tab = s.id;
          btn.innerHTML = getSiteIcon(s.id) + " " + escUtil(s.label);
          btn.addEventListener("click", () => showCreatorsBySite(s.id));
          tabsEl.appendChild(btn);
        });
        // 默认显示第一个
        if (sites[0]) {
          // 恢复上次选中的 tab
          const last = localStorage.getItem("ysm-ws-last-tab") || sites[0].id;
          const target = sites.find((s) => s.id === last) || sites[0];
          showCreatorsBySite(target.id);
        }
      }
    }, 100);

    // 后台批量提取创作者头像（仅首次完成后刷新）
    let avatarCache: Record<string, string> = {};
    const extractAvatars = async (): Promise<void> => {
      try {
        const { BatchExtractCreatorAvatars } =
          await getApp();
        const result = await BatchExtractCreatorAvatars();
        const avatars = (result || {}) as Record<string, string>;
        const keys = Object.keys(avatars);
        if (keys.length > 0) {
          dbg("avatar", "提取了 " + keys.length + " 个头像: " + keys.join(", "));
          avatarCache = avatars;
          if (currentSite) showSiteView(currentSite);
        } else {
          dbg("avatar", "无头像可提取（无 .ysm 文件或无 avatar/ 目录）");
        }
      } catch (e) {
        dbg("avatar", "提取失败:", (e as Error)?.message);
      }
    };
    extractAvatars();

    // 配置加载完成后重新提取（覆盖用户在创意工坊内改仓库路径的场景）
    if (!_avatarConfigLoadedRegistered) {
      _avatarConfigLoadedRegistered = true;
      _avatarConfigLoadedUnsub = Events.On("config-loaded", () => {
        dbg("avatar", "配置已加载，重新提取头像");
        extractAvatars();
      });
    }

    // 卡片点击 → 正文切换右侧视图，右侧 ↗ 按开关打开
    const openSite = (site: WorkshopSite | null, external = false): void => {
      if (!site) return;
      if (embedMode) {
        openEmbedded(site);
      } else {
        getApp().then(({ OpenInBrowser }) =>
          OpenInBrowser(site.url),
        );
      }
    };

    // 内嵌浏览
    const PROXY_PORT = 18080;
    const PROXY_BASE = "http://127.0.0.1:" + PROXY_PORT + "/proxy?url=";
    const openEmbedded = async (site: WorkshopSite): Promise<void> => {
      try {
        const { StartProxy } = await getApp();
        await StartProxy(PROXY_PORT);
      } catch (_) {}
      if (urlEl) urlEl.textContent = site.url;
      if (iframe) {
        iframe.style.display = "";
        iframe.src = PROXY_BASE + encodeURIComponent(site.url);
      }
      if (browserEl) browserEl.style.display = "flex";
      if (blockedEl) blockedEl.style.display = "none";
    };

    root.getElementById("ws-back")?.addEventListener("click", () => {
      if (iframe) iframe.src = "";
      if (browserEl) browserEl.style.display = "none";
    });
    const openCurrent = (): void => {
      const cs = currentSite;
      if (cs) {
        getApp().then(({ OpenInBrowser }) =>
          OpenInBrowser(cs.url),
        );
      }
    };
    root.getElementById("ws-open")?.addEventListener("click", openCurrent);
    root
      .getElementById("ws-open-fallback")
      ?.addEventListener("click", openCurrent);

    // 站点导出/导入
    root
      .getElementById("ws-export-btn")
      ?.addEventListener("click", async () => {
        try {
          const { ExportWorkshopSitesJSONFile } =
            await getApp();
          const path = await ExportWorkshopSitesJSONFile();
          bus.emit("toast:show", {
            msg: "📤 站点已导出: " + path,
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e, "导出失败"),
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
            await getApp();
          const n = await ImportWorkshopSitesJSONFile();
          await showCreatorsBySite("bilibili");
          bus.emit("toast:show", {
            msg: "✅ 已导入 " + n + " 个站点",
            duration: 2000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e, "导入失败"),
            duration: 4000,
            type: "error",
          });
        }
      });

    // ===== 右栏：JSON驱动的站点视图 =====
    const showSiteView = (site: WorkshopSite | null): void => {
      if (!site) return;
      const openUrl = (url: string): void => {
        if (embedMode) {
          currentSite = { url } as unknown as WorkshopSite;
          openEmbedded(currentSite);
        } else {
          // 外链模式：走系统浏览器，共享用户登录态
          getApp().then(({ OpenInBrowser }) =>
            OpenInBrowser(url),
          );
        }
      };
      const ctx: RenderSiteViewCtx = {
        esc: (s) => this._esc(s),
        searchResults: searchResults as HTMLElement,
        creatorView: creatorView as HTMLElement,
        allSites,
        allCreators,
        repoAuthors,
        wsEditModeRef,
        showRepoModels: async (repo, models, source) => {
          await showRepoModels(repo, models as WorkshopModel[], source);
        },
        fillSearch,
        repoModelCache,
        openUrl,
        avatarCache,
        backToSite: () => {
          if (currentSite) showSiteView(currentSite);
        },
      };
      renderSiteView(site, ctx);
      // 外链/内嵌切换（按钮在 renderSiteView 中动态渲染）
      const toggleBtn = searchResults?.querySelector("#cr-mode-toggle") as HTMLElement | null;
      if (toggleBtn) {
        toggleBtn.onclick = () => {
          embedMode = !embedMode;
          toggleBtn
            .querySelectorAll(".cr-mode-opt")
            .forEach((el) => el.classList.toggle("active"));
        };
      }
    };

    // 下载完成后增量刷新创作者头像
    if (!this._avatarRefreshRegistered) {
      this._avatarRefreshRegistered = true;
      this._globalUnsubs.push(
        bus.on("avatar:refresh", ({ author, dataUri }) => {
          if (avatarCache[author] === dataUri) return;
          avatarCache[author] = dataUri;
          // 单卡片定点更新，避免整页重渲染
          let found = false;
          root.querySelectorAll(".cr-creator-card").forEach((c) => {
            if ((c as HTMLElement).dataset.name === author) {
              const img = c.querySelector(".cr-avatar") as HTMLImageElement | null;
              if (img && img.tagName === "IMG") img.src = dataUri;
              found = true;
            }
          });
          if (!found && currentSite) showSiteView(currentSite);
        }),
      );
    }

    // 📦 显示 GitHub 仓库模型列表（比对本地已有文件）
    // _currentRepo 检测过时的异步响应（与 _initGithub 的 showRepo 同模式，防快速切换乱序覆盖）
    let _currentRepo = "";
    const showRepoModels = async (
      repo: string,
      models: WorkshopModel[],
      source: string,
    ): Promise<void> => {
      _currentRepo = repo;
      // 加载本地仓库已有文件列表 + 镜像配置
      const localMap = new Map<string, string>();
      let mirror = "";
      try {
        const AppM = await getApp();
        const cfg = await AppM.LoadAppConfig();
        mirror = cfg.mirror || "";
        const repoRoot = AppM.GetRepoRoot ? await AppM.GetRepoRoot(RESOURCE_TYPES.YSM) : "";
        if (repoRoot) {
          // 先清缓存再扫描，确保新下载的文件立即可见
          if (AppM.ClearScanCache) await AppM.ClearScanCache();
          const entries = (await AppM.ScanModelEntries(repoRoot)) || [];
          entries.forEach((e) => {
            let n = e.Name || "";
            if (n.endsWith(".ban")) n = n.slice(0, -4);
            localMap.set(n, e.Hash || "");
          });
        }
      } catch (_) {
        // 加载失败不影响列表显示
      }
      if (_currentRepo !== repo) return; // 已切换仓库，丢弃过期结果

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

      if (_currentRepo !== repo) return; // 已切换，丢弃
      if (searchResults) {
        searchResults.innerHTML = renderRepoHeaderHTML({
          esc: (s) => this._esc(s),
          repo,
          sourceLabel,
          modelsLength: models.length,
          missingCount,
        });
      }

      // 清理前一次绑定
      if (this._repoEventsCleanup) await this._repoEventsCleanup();
      if (_currentRepo !== repo) return; // 清理期间已切换，丢弃

      // 委托 bindRepoEvents 管理所有事件 + 内部状态 (showAll/selectedSet/renderList)
      if (searchResults) {
        const { renderList, cleanup } = bindRepoEvents(searchResults, {
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
        this._repoEventsCleanup = cleanup;

        // 初始渲染
        const listContainer = searchResults.querySelector("#gh-repo-list");
        if (listContainer) listContainer.appendChild(renderList());
      }
    }; // end showRepoModels
  }

  _initGithub(): void {
    const root = this._root;
    const grid = root.getElementById("gh-grid") as HTMLElement | null;
    const resultsBody = root.getElementById("gh-results-body") as HTMLElement | null;
    const sourceInfo = root.getElementById("gh-source-info") as HTMLElement | null;
    if (!this._githubCache) this._githubCache = new Map();
    const repoModelCache = this._githubCache;

    const loadRepos = async (): Promise<void> => {
      if (grid) {
        grid.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载中...</div>';
      }
      try {
        const App = await getApp();
        const repos = await App.LoadGitHubRepos();
        const ghCreators = repos || [];
        if (sourceInfo) sourceInfo.textContent = ghCreators.length + " 仓库 · JSON驱动";
        if (!ghCreators.length) {
          if (grid) {
            grid.innerHTML =
              '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">暂无 GitHub 仓库</div>';
          }
          return;
        }
        if (grid) {
          grid.innerHTML = ghCreators
            .map(
              (cr, idx) =>
                '<div class="gh-card gh-repo-card" style="animation-delay:' + stagger(idx, 30, 300) + 'ms" data-index="' +
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
              const repo = (card as HTMLElement).dataset.repo || "";
              showRepo(repo);
            });
          });
        }
      } catch (e) {
        if (grid) {
          grid.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">加载失败</div>';
        }
      }
    };

    // _currentRepo 用于检测过时的异步响应（竞态防护）
    let _currentRepo = "";

    const showRepo = async (repo: string): Promise<void> => {
      _currentRepo = repo;
      if (resultsBody) {
        resultsBody.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">⏳ 加载模型列表中...</div>';
      }
      // 使用缓存
      if (repoModelCache.has(repo)) {
        const cached = repoModelCache.get(repo);
        if (cached) {
          const { models, source, localMap } = cached;
          if (_currentRepo !== repo) return; // 已切换，丢弃
          renderModels(repo, models, source, localMap || new Map());
          return;
        }
      }
      let mirror = "";
      try {
        const { LoadAppConfig, ScanModelEntries, GetRepoRoot } =
          await getApp();
        const cfg = await LoadAppConfig();
        mirror = cfg.mirror || "";
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        // 预先加载本地映射
        const localMap = new Map<string, string>();
        if (repoRoot) {
          const entries = (await ScanModelEntries(repoRoot)) || [];
          entries.forEach((e) => {
            let n = e.Name || "";
            if (n.endsWith(".ban")) n = n.slice(0, -4);
            localMap.set(n, e.Hash || "");
          });
        }
        const { tryFetchModels } =
          await import("../../features/community/data.ts");
        let fetchDone = false;
        const result = await tryFetchModels(repo, (mirror || "") as "" | "jsdelivr" | "githubapi", (pct, label) => {
          if (fetchDone || _currentRepo !== repo) return;
          if (resultsBody) {
            resultsBody.innerHTML =
              '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
              (label || "⏳ 加载中...") +
              "</div>";
          }
        });
        fetchDone = true;
        if (result && result.models) {
          repoModelCache.set(repo, {
            models: result.models as WorkshopModel[],
            source: result.source,
            localMap,
          });
          if (_currentRepo !== repo) return;
          renderModels(repo, result.models as WorkshopModel[], result.source, localMap);
        } else {
          if (_currentRepo !== repo) return;
          if (resultsBody) {
            resultsBody.innerHTML =
              '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ 未找到模型列表</div>' +
              '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo">↗ 在 GitHub 中打开</button></div>';
          }
        }
      } catch (e) {
        const err = e as Error;
        if (_currentRepo !== repo) return;
        const msg =
          err.message === "NetworkOffline"
            ? "🌐 无网络连接，请检查网络后重试"
            : err.message === "NoIndex"
              ? "📭 该仓库没有 index.json（尚未建立创意工坊索引）"
              : err.message === "RateLimited"
                ? "⏱️ GitHub API 频率限制，请稍后重试或改用浏览器打开"
                : "❌ 加载失败，请检查网络或稍后重试";
        if (resultsBody) {
          resultsBody.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ ' +
            this._esc(msg) +
            "</div>" +
            '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo">↗ 在 GitHub 中打开</button></div>';
        }
      }
      // 绑定打开 GitHub 按钮
      const openBtn = resultsBody?.querySelector("#gh-open-repo");
      if (openBtn)
        openBtn.addEventListener("click", () => {
          getApp().then(({ OpenInBrowser }) =>
            OpenInBrowser("https://github.com/" + repo),
          );
        });
    };

    const renderModels = async (
      repo: string,
      models: WorkshopModel[],
      source: string,
      localMap: Map<string, string>,
    ): Promise<void> => {
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
      if (resultsBody) {
        resultsBody.innerHTML = renderRepoHeaderHTML({
          esc: (s) => this._esc(s),
          repo,
          sourceLabel,
          modelsLength: models.length,
          missingCount,
        });
        // 清理前一次绑定
        if (this._repoEventsCleanup) await this._repoEventsCleanup();
        const { renderList, cleanup } = bindRepoEvents(resultsBody, {
          esc: (s) => this._esc(s),
          models,
          dlPrefix,
          repo,
          source,
          showRepoModels: () => showRepo(repo),
          backToSite: () => loadRepos(),
          localMap,
        });
        this._repoEventsCleanup = cleanup;
        const listContainer = resultsBody.querySelector("#gh-repo-list");
        if (listContainer) listContainer.appendChild(renderList());
      }
    };

    // 刷新按钮已移除
    loadRepos();
  }

  async _initSettings(): Promise<void> {
    this._bindTabs(".stg-tab", "stg", ["basic", "ui", "about", "credits"]);
    try {
      await initSettings(this._root);
    } catch (e) {
      console.error("[settings] 初始化失败:", e);
      bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "设置页初始化失败"), duration: 5000, type: "error" });
    }
  }

  _fmtSize(bytes: number): string {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  _esc(s: unknown): string {
    // 委托规范 esc（含引号转义）：_esc 被 site-view 等用于 data-* 属性插值
    return escUtil(String(s || ""));
  }
}

// 保持渲染工具引用（renderCardsHTML 为 features 导出，此处确保其类型被检查）
void renderCardsHTML;

customElements.define("app-content", AppContent);
