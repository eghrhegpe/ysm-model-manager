// ===== 创意工坊站点视图（initWorkshopPage 的下游渲染层） =====

import { isViewerMode } from "@/backend/platform.ts";
import { bus } from "@/bus";
import type { WorkshopSite } from "@/utils/types-re-export.ts";
import { bindDragEvents } from "./drag.ts";
import { bindEditEvents } from "./edit.ts";
import { bindBrowseEvents } from "./events.ts";
import { buildSiteHtml } from "./render.ts";
import type { CleanupFn, EditSession, RenderSiteViewCtx, SiteViewState } from "./types.ts";
import { compareByAuthorCount, loadFavs, parseSiteIds } from "./workshop-data.ts";

export type { EditSession, LocalCreatorLike, RenderSiteViewCtx, RepoAuthorLike } from "./types.ts";

/**
 * 站点视图渲染主入口 — 编排壳：构造数据 → 构 HTML → 绑事件 → 聚 cleanup。
 * 各块实现在 render.ts / events.ts / edit.ts / drag.ts，共享状态走 SiteViewState 显式传递。
 * 返回 cleanup 函数，供调用方在切页/重渲染时清理 storage 等监听。
 */
export function renderSiteView(site: WorkshopSite, ctx: RenderSiteViewCtx): CleanupFn {
  const {
    esc,
    searchResults,
    allCreators,
    allSites,
    repoAuthors,
    wsEditModeRef,
    fillSearch,
    openUrl,
    avatarCache,
    browseMode,
    activeTag,
    searchKw,
  } = ctx;

  const creators = allCreators.filter((cr) => parseSiteIds(cr.type).includes(site.id));

  // 作者模型计数查找表
  const authorCountMap: Record<string, number> = {};
  if (repoAuthors) {
    repoAuthors.forEach((a) => {
      const name = typeof a === "string" ? a : a.Name;
      const count = typeof a === "object" && a ? a.Count || 0 : 0;
      if (name) authorCountMap[name] = count;
    });
  }

  // 按仓库模型数降序排列（高产创作者优先）——编辑态卡片序，不含收藏置顶
  creators.sort((a, b) => compareByAuthorCount(a, b, authorCountMap));

  // 构建 HTML（纯函数，实现在 site-view-render.ts）
  // 收藏名单整轮渲染只解析一次（P1-c 锐评：原 ctx.isFaved 谓词 = 每卡一次 localStorage 解析）
  const html = buildSiteHtml({
    esc,
    site,
    creators,
    allSites,
    wsEditModeRef,
    repoAuthors,
    authorCountMap,
    avatarCache,
    browseMode,
    activeTag,
    searchKw,
    viewerMode: isViewerMode(),
    favedNames: loadFavs(),
  });
  searchResults.innerHTML = html;

  // 主入口编排：构造共享状态 → 调各块事件绑定 → 聚合 cleanup
  // 重渲染经 ctx.reRender（调用方 wrapper：先跑旧 cleanup 再存新 cleanup），
  // 不直接调 renderSiteView——否则返回的 cleanup 被丢弃，切站点时清理不到最新监听。
  const refreshView = (): void => {
    ctx.reRender();
  };
  // 编辑期跨重渲会话状态（锐评高危修复，2026-10-14）：renderSiteView 每次调用重建
  // SiteViewState，但这两份状态必须跨重渲存活（否则编辑态下一次重渲就清空 detachedNames
  // → 保存时 Go 整条丢弃跨站条目；editSnapshot 清空 → dirty 守卫失效）。
  // 缺 ctx.editSession 时自建一份（测试/独立渲染路径：行为退回「本次渲染内有效」）。
  const editSession: EditSession = ctx.editSession ?? { detachedNames: [], editSnapshot: null };
  const state: SiteViewState = {
    esc,
    searchResults,
    allSites,
    allCreators,
    repoAuthors,
    wsEditModeRef,
    fillSearch,
    openUrl,
    setBrowseMode: ctx.setBrowseMode,
    avatarCache,
    site,
    creators,
    authorCountMap,
    bus,
    activeTag,
    searchKw,
    // ADR-335：跨站创作者「解除本站关联」只暂存**名字**（交 Go 基于磁盘副本去本站段）。
    // getter/setter 透明代理到 editSession——消费方（edit.ts 的 push/read）与测试的
    // 字段访问语法零改动，但重渲不再清空。
    get detachedNames(): string[] {
      return editSession.detachedNames;
    },
    set detachedNames(v: string[]) {
      editSession.detachedNames = v;
    },
    // P1-3a 锐评：编辑态 dirty 守卫基线（进入编辑态时取，null=无未保存变更）。同样代理。
    get editSnapshot(): string | null {
      return editSession.editSnapshot;
    },
    set editSnapshot(v: string | null) {
      editSession.editSnapshot = v;
    },
  };
  const unsubs: CleanupFn[] = [];
  unsubs.push(bindBrowseEvents(state, refreshView));
  unsubs.push(bindEditEvents(state, refreshView));
  unsubs.push(bindDragEvents(state, refreshView));

  // 返回聚合清理函数：调用各块 cleanup（storage 等），供外层切页时统一调用
  return () => {
    unsubs.forEach((fn) => {
      fn();
    });
  };
}
