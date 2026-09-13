// ===== 站点视图共享状态类型（ADR-034 方向① 拆分基础设施）=====
// events/edit/drag 三块事件绑定共享的闭包变量提为显式 state 对象，
// 消除幽灵路径（AGENTS.md §致命陷阱 #13）+ 便于逐块抽到独立文件。

import type { bus } from "@/bus";
import type { WorkshopCreator, WorkshopSite } from "@/utils/types-re-export.ts";
import type { BrowseMode, BrowseModeRef } from "./workshop-browse-mode.ts";

/** 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） */
export type RepoAuthorLike = string | { Name?: string; Count?: number };

/** 站点视图渲染上下文（init-workshop.ts 传入） */
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
  /** 创作者频道浏览模式（external/embed/window，ref 单源，localStorage 持久化） */
  browseMode: BrowseModeRef;
  /** 更新浏览模式（写 localStorage + 更新共享变量），供事件块即时切换 */
  setBrowseMode: (mode: BrowseMode) => void;
  /** 分类标签过滤（localStorage 持久化），""=全部 */
  activeTag: string;
  /** 创作者搜索关键词（localStorage 持久化） */
  searchKw: string;
  /** 重渲染入口：由调用方（init-workshop）提供，先跑旧 cleanup 再存新 cleanup */
  reRender: () => void;
}

/** 本地创作者（绑定 + 运行时附加字段） */
export interface LocalCreatorLike extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  [key: string]: unknown;
}

/**
 * SiteViewState —— renderSiteView 内部闭包共享变量的显式收拢。
 * 由主入口构造，传入各 bindXxxEvents 函数，消除模块级隐式状态写入。
 */
export interface SiteViewState {
  // 来自 ctx 解构（RenderSiteViewCtx）
  esc: (s: unknown) => string;
  searchResults: HTMLElement;
  creatorView: HTMLElement;
  allSites: WorkshopSite[];
  allCreators: LocalCreatorLike[];
  repoAuthors: RepoAuthorLike[];
  wsEditModeRef: { v: boolean };
  fillSearch: (tpl: string, q: string) => string;
  openUrl: (url: string) => void;
  /** 由 init 层提供：更新共享 browseMode（写 localStorage），re-render 后即时生效 */
  setBrowseMode: (mode: BrowseMode) => void;
  avatarCache: Record<string, string>;

  // renderSiteView 内部构造的派生状态
  site: WorkshopSite;
  creators: LocalCreatorLike[];
  authorCountMap: Record<string, number>;

  // 事件块共享的运行时状态
  bus: typeof bus;
  ctx: RenderSiteViewCtx; // 兜底：refreshView = () => renderSiteView(site, ctx) 需要原 ctx
  /** 分类标签过滤（localStorage 持久化），""=全部 */
  activeTag: string;
  /** 创作者搜索关键词（localStorage 持久化） */
  searchKw: string;
}

/** bindXxxEvents 函数的统一返回：清理函数，主入口聚合成单一 cleanup */
export type CleanupFn = () => void;
