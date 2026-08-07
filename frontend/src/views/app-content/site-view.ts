// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { buildSiteHtml } from "./site/render.ts";
import { bindBrowseEvents } from "./site/events.ts";
import { bindEditEvents } from "./site/edit.ts";
import { bindDragEvents } from "./site/drag.ts";
import type { SiteViewState, CleanupFn } from "./site/types.ts";
import { bus } from "../../bus.ts";
import type { WorkshopSite, WorkshopCreator } from "../../../bindings/ysm-model-manager/go/types/models.ts";

/** 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） */
export type RepoAuthorLike = string | { Name?: string; Count?: number };

/** 竚点视图渲染上下文（index.ts _initWorkshop 传入） */
export interface RenderSiteViewCtx {
  esc: (s: unknown) => string;
  searchResults: HTMLElement;
  creatorView: HTMLElement;
  allSites: WorkshopSite[];
  allCreators: LocalCreatorLike[];
  repoAuthors: RepoAuthorLike[];
  wsEditModeRef: { v: boolean };
  showRepoModels: (repo: string, models: unknown[], source: string) => Promise<void>;
  fillSearch: (tpl: string, q: string) => string;
  repoModelCache: Map<string, { models: unknown[]; source: string }>;
  openUrl: (url: string) => void;
  backToSite: () => void;
  avatarCache: Record<string, string>;
}

/** 本地创作者（绑定 + 运行时附加字段） */
export interface LocalCreatorLike extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  [key: string]: unknown;
}

/**
 * 站点视图渲染主入口 — 编排壳：构造数据 → 构 HTML → 绑事件 → 聚 cleanup。
 * 各块实现在 site-view-{render,events,edit,drag}.ts，共享状态走 SiteViewState 显式传递。
 * 返回 cleanup 函数，供调用方在切页/重渲染时清理 storage 等监听。
 */
export function renderSiteView(site: WorkshopSite, ctx: RenderSiteViewCtx): CleanupFn {
  const {
    esc,
    searchResults,
    creatorView,
    allCreators,
    allSites,
    repoAuthors,
    wsEditModeRef,
    showRepoModels,
    fillSearch,
    repoModelCache,
    openUrl,
    backToSite,
    avatarCache,
  } = ctx;

  searchResults.innerHTML = "";
  creatorView.style.display = "none";

  const creators = allCreators.filter(
    (cr) => cr.type && cr.type.split(";").includes(site.id),
  );

  // 作者模型计数查找表
  const authorCountMap: Record<string, number> = {};
  if (repoAuthors) {
    repoAuthors.forEach((a) => {
      const name = typeof a === "string" ? a : a.Name;
      const count = typeof a === "object" && a ? a.Count || 0 : 0;
      if (name) authorCountMap[name] = count;
    });
  }

  // 按仓库模型数降序排列（高产创作者优先）
  creators.sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );

  // 构建 HTML（纯函数，实现在 site-view-render.ts）
  const html = buildSiteHtml({
    esc, site, creators, allSites, wsEditModeRef, repoAuthors, authorCountMap, avatarCache,
  });
  searchResults.innerHTML = html;

  // 主入口编排：构造共享状态 → 调各块事件绑定 → 聚合 cleanup
  const refreshView = (): void => {
    renderSiteView(site, ctx);
  };
  const state: SiteViewState = {
    esc, searchResults, creatorView, allSites, allCreators, repoAuthors,
    wsEditModeRef, showRepoModels, fillSearch, repoModelCache, openUrl,
    backToSite, avatarCache, site, creators, authorCountMap, bus, ctx,
  };
  const unsubs: CleanupFn[] = [];
  unsubs.push(bindBrowseEvents(state, refreshView));
  unsubs.push(bindEditEvents(state, refreshView));
  unsubs.push(bindDragEvents(state, refreshView));

  // 返回聚合清理函数：调用各块 cleanup（storage 等），供外层切页时统一调用
  return () => {
    unsubs.forEach((fn) => fn());
  };
}
