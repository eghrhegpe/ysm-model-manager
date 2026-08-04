// ===== 站点视图共享状态类型（ADR-034 方向① 拆分基础设施）=====
// events/edit/drag 三块事件绑定共享的闭包变量提为显式 state 对象，
// 消除幽灵路径（AGENTS.md §致命陷阱 #13）+ 便于逐块抽到独立文件。
import type { bus } from "../../../bus.ts";
import type { WorkshopSite } from "../../../../bindings/ysm-model-manager/go/types/models.ts";
import type { LocalCreatorLike, RepoAuthorLike, RenderSiteViewCtx } from "./site-view.ts";

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
  showRepoModels: (repo: string, models: unknown[], source: string) => Promise<void>;
  fillSearch: (tpl: string, q: string) => string;
  repoModelCache: Map<string, { models: unknown[]; source: string }>;
  openUrl: (url: string) => void;
  backToSite: () => void;
  avatarCache: Record<string, string>;

  // renderSiteView 内部构造的派生状态
  site: WorkshopSite;
  creators: LocalCreatorLike[];
  authorCountMap: Record<string, number>;

  // 事件块共享的运行时状态
  bus: typeof bus;
  ctx: RenderSiteViewCtx; // 兜底：refreshView = () => renderSiteView(site, ctx) 需要原 ctx
}

/** bindXxxEvents 函数的统一返回：清理函数，主入口聚合成单一 cleanup */
export type CleanupFn = () => void;
