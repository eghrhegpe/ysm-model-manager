// ===== 创意工坊页初始化（为 app-content/index.ts 减负，ADR-040）=====
// 本文件是纯编排入口（~80行），所有具体逻辑已拆到子模块：
// - workshop-tabs.ts: Tab 管理、创作者列表加载
// - workshop-browse-mode.ts: 浏览模式（外链/内嵌/窗口）
// - workshop-site-opener.ts: 站点打开、内嵌浏览器、导出/导入
// - workshop-avatar.ts: 创作者头像提取
// - features/community/show-repo-models.ts: 仓库模型显示（与 init-github.ts 共享）

import { bus } from "../../bus.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { esc } from "../../utils/dom/html.ts";
import { Events } from "../../backend/runtime.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { fillSearch } from "./community-data.ts";
import { renderSiteView, type RenderSiteViewCtx } from "./site-view.ts";
import { showRepoModels } from "../../features/community/show-repo-models.ts";
import { loadBrowseMode, saveBrowseMode, createBrowseModeRef, type BrowseMode } from "./workshop-browse-mode.ts";
import { initWorkshopTabs, setShowSiteView, createWorkshopRefs } from "./workshop-tabs.ts";
import { openSite, bindSiteEvents } from "./workshop-site-opener.ts";
import { extractAvatars } from "./workshop-avatar.ts";
import type { WorkshopModel } from "../../features/community/render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { RepoCacheEntry } from "./state.ts";

/**
 * 创建创意工坊页的共享 ref 对象——单一入口，tabs / showSiteView / edit 等全部从此处取。
 * 修复「initWorkshopTabs 写 .v 的对象 ≠ showSiteView 读 .v 的对象」这类实例错位 bug：
 * 以前是 4 个独立的 `{ v: ... }`，调用方必须在 initWorkshopTabs(...) 处手动对齐；
 * 现在统一封装成一个 WorkshopRefs 对象，工厂只生成一份，所有消费者拿同一个实例。
 */

/**
 * 初始化创意工坊页（编排入口）
 */
export function initWorkshopPage(host: AppContentHost): void {
  const root = host._root;
  const searchResults = root.getElementById("ws-search-results") as HTMLElement | null;
  const creatorView = root.getElementById("ws-creator-view") as HTMLElement | null;

  host._setCurrentSite(null);
  // 单一入口：所有可变 ref 由 createWorkshopRefs() 生成一份；tabs 写入、showSiteView 读取，
  // 永远是同一实例——杜绝「形状相同、实例不同」的错位 bug。
  const refs = createWorkshopRefs();
  if (!host._workshopCache) host._setWorkshopCache(new Map());
  const repoModelCache = host._workshopCache;

  // 浏览模式：单源 ref（{ v }）＋ setter——setBrowseMode 改 .v 即让
  // re-render 高亮与 openUrl 打开同时读到新值，无需退出页面、无值拷贝 stale。
  const browseModeRef = createBrowseModeRef(loadBrowseMode());
  const setBrowseMode = (mode: BrowseMode): void => {
    browseModeRef.v = mode;
    saveBrowseMode(mode);
  };

  // 后台批量提取创作者头像
  host._setAvatarCache({});
  extractAvatars(host);

  // 配置加载完成后重新提取
  if (!(_avatarConfigLoadedRegistered)) {
    _avatarConfigLoadedRegistered = true;
    _avatarConfigLoadedUnsub = Events.On("config-loaded", () => {
      dbg("avatar", "配置已加载，重新提取头像");
      extractAvatars(host);
    });
  }

  // 站点视图切换（先定义，再注册给 tabs）
  // 保存上一次渲染的 cleanup 函数，切站点时先清理旧监听再渲染新视图
  let _prevSiteViewCleanup: (() => void) | null = null;
  // 统一清理入口：所有 renderSiteView 调用（首次渲染 + refreshView 重渲染）先跑旧
  // cleanup 再存新 cleanup——确保切站点清理的是**最新**视图的监听，且旧渲染 DOM 不被
  // 闭包链保留（此前 refreshView 直接调 renderSiteView 丢弃 cleanup，_prevSiteViewCleanup
  // 永远只持有首次渲染的 cleanup，首次渲染 DOM 保留到下次切站点）。
  const runPrevSiteViewCleanup = (): void => {
    if (_prevSiteViewCleanup) {
      _prevSiteViewCleanup();
      _prevSiteViewCleanup = null;
    }
  };
  const showSiteView = (site: WorkshopSite | null): void => {
    if (!site) return;
    // 清理旧站点视图的监听器，防止切页时事件泄漏
    runPrevSiteViewCleanup();
    const openUrl = (url: string): void => {
      // 透传目标 URL：搜索按钮拼好的带词链接（fillSearch）需真正打开，不能丢弃只开首页
      openSite(host, site, browseModeRef.v, url);
    };
    const ctx: RenderSiteViewCtx = {
      esc: (s) => esc(String(s || "")),
      searchResults: searchResults as HTMLElement,
      creatorView: creatorView as HTMLElement,
      allSites: refs.allSitesRef.v,
      allCreators: refs.allCreatorsRef.v,
      repoAuthors: refs.repoAuthorsRef.v,
      wsEditModeRef: refs.wsEditModeRef,
      showRepoModels: async (repo, models, source) => {
        await showRepoModels(
          (s) => esc(String(s || "")),
          host._repoEventsCleanup,
          host._setRepoEventsCleanup,
          host._currentSite,
          host._setCurrentSite,
          repo,
          models as WorkshopModel[],
          source,
          searchResults!
        );
      },
      fillSearch,
      repoModelCache: repoModelCache!,
      openUrl,
      avatarCache: host._avatarCache,
      browseMode: browseModeRef,
      setBrowseMode,
      activeTag: safeGet("ysm-ws-active-tag") || "",
      searchKw: safeGet("ysm-ws-search-kw") || "",
      backToSite: () => {
        if (host._currentSite) showSiteView(host._currentSite);
      },
      // 重渲染（编辑切换/保存/拖拽/搜索等）经同一 wrapper：先跑旧 cleanup 再存新
      // cleanup（见 runPrevSiteViewCleanup 注释），供 site-view 的 refreshView 调用。
      reRender: () => {
        runPrevSiteViewCleanup();
        _prevSiteViewCleanup = renderSiteView(site, ctx);
      },
    };
    _prevSiteViewCleanup = renderSiteView(site, ctx);
  };

  // 注册 showSiteView 给 tabs 模块使用（必须在 initWorkshopTabs 之前）
  setShowSiteView(showSiteView);

  // 初始化 Tab
  initWorkshopTabs(host, refs);

  // 绑定站点打开事件
  bindSiteEvents(host);

  // 下载完成后增量刷新创作者头像
  if (!host._avatarRefreshRegistered) {
    host._setAvatarRefreshRegistered(true);
    host._globalUnsubs.push(
      bus.on("avatar:refresh", ({ author, dataUri }) => {
        if (host._avatarCache[author] === dataUri) return;
        host._avatarCache[author] = dataUri;
        let found = false;
        root.querySelectorAll(".cr-creator-card").forEach((c) => {
          if ((c as HTMLElement).dataset.name === author) {
            const img = c.querySelector(".cr-avatar") as HTMLImageElement | null;
            if (img && img.tagName === "IMG") img.src = dataUri;
            found = true;
          }
        });
        if (!found && host._currentSite) showSiteView(host._currentSite);
      }),
    );
  }
}

// ==================== 模块级状态 ====================

/** 防止 avatar:config-loaded 事件重复注册（模块级状态，经 reset 函数与 index.ts 协作） */
let _avatarConfigLoadedRegistered = false;
let _avatarConfigLoadedUnsub: (() => void) | null = null;

/** 供 app-content disconnectedCallback 调用：回收 config-loaded 订阅并复位注册 flag */
export function resetAvatarConfigLoaded(): void {
  if (_avatarConfigLoadedUnsub) {
    _avatarConfigLoadedUnsub();
    _avatarConfigLoadedUnsub = null;
  }
  _avatarConfigLoadedRegistered = false;
}

// ==================== 类型定义 ====================

/** app-content 组件接口（供 workshop/github 初始化函数访问） */
export interface AppContentHost {
  _root: ShadowRoot;
  _unsubs: Array<() => void>;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void;
  _currentSite: WorkshopSite | null;
  _setCurrentSite(site: WorkshopSite | null): void;
  _avatarCache: Record<string, string>;
  _setAvatarCache(cache: Record<string, string>): void;
  _workshopCache: Map<string, RepoCacheEntry> | null;
  _setWorkshopCache(cache: Map<string, RepoCacheEntry> | null): void;
  _githubCache: Map<string, RepoCacheEntry> | null;
  _setGithubCache(cache: Map<string, RepoCacheEntry> | null): void;
  _workshopTimer: ReturnType<typeof setTimeout> | null;
  _setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void;
  _avatarRefreshRegistered: boolean;
  _setAvatarRefreshRegistered(v: boolean): void;
}
