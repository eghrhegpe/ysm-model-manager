// ===== 创意工坊仓库事件绑定 · 组装入口（ADR-014 P3 features）=====
// 拆分说明（ADR-040 ≤400 行红线）：原 events.ts 429 行拆为三文件——
// · repo-events-shared.ts：共享上下文/状态机常量 + 行渲染小助手 + 监听注册原语
// · repo-events-bindings.ts：8 个 cmReBind*（DOM 注册块）+ 单文件下载决策
// · 本文件：bindRepoEvents 组装（队列/虚拟列表装配 + 清理）+ 公共类型 re-export
// 对外契约不变：bindRepoEvents / RepoEventsContext / RepoEventsHandle 仍从本文件导出

import { createDownloadQueue } from "./download-queue.ts";
import { buildModelRow, type WorkshopModel } from "./render.ts";
import {
  cmReBindBack,
  cmReBindContextMenu,
  cmReBindDlSelected,
  cmReBindRowClick,
  cmReBindSearch,
  cmReBindSelAll,
  cmReBindSelChecks,
  cmReBindToggle,
} from "./repo-events-bindings.ts";
import {
  type CmReCtx,
  type CmReState,
  cmReRenderList,
  cmReUpdateSelectedUI,
  GH_ROW_H,
  type ListenerRef,
  type RepoEventsContext,
  type RepoEventsHandle,
} from "./repo-events-shared.ts";
import { createVirtualList } from "./virtual-list.ts";

export type { RepoEventsContext, RepoEventsHandle };

async function cmReCleanup(ctx: CmReCtx): Promise<void> {
  const { state, virtualList, queue, selectedSet, listeners } = ctx;
  state.disposed = true;
  // 集中清理：onAllDone 回跳 timer 不再等 200ms 空跑（disposed 短路是兜底不是清理）
  if (state.doneTimer) {
    clearTimeout(state.doneTimer);
    state.doneTimer = null;
  }
  // 成对移除 cmReListen 登记的监听（替代 cloneNode hack：不重建 DOM、不清外部
  // 监听、release 可预测——cloneNode 会丢弃元素引用与状态，逐个替换是暴力清监听反模式）
  for (const { el, type, handler } of listeners) el.removeEventListener(type, handler);
  virtualList?.destroy();
  await queue.cancel();
  selectedSet.clear();
  queue.destroy();
}

/**
 * 绑定仓库模型页面的所有事件。
 * 管理 showAll / selectedSet 内部状态。
 *
 * @param sr searchResults DOM 容器
 * @param ctx 上下文
 */
export function bindRepoEvents(sr: HTMLElement, ctx: RepoEventsContext): RepoEventsHandle {
  const { esc, models, dlPrefix, repo, source, showRepoModels, backToSite, localMap } = ctx;
  const state: CmReState = {
    showAll: false,
    disposed: false,
    currentFilter: "",
    currentFiltered: [],
    doneTimer: null,
  };
  const selectedSet = new Set<string>();
  const reCtxShell: { ctx: CmReCtx | null } = { ctx: null };

  const queue = createDownloadQueue({
    sr,
    esc,
    getLocalMap: () => localMap,
    onFileSuccess: (name) => {
      selectedSet.delete(name);
      if (reCtxShell.ctx) cmReUpdateSelectedUI(reCtxShell.ctx);
    },
    onAllDone: () => {
      selectedSet.clear();
      // 先清旧 timer 再 set：连发完成不堆积（200ms 内新一轮完成时旧回跳作废，
      // 与 cleanup 集中 clear 双保险——纯靠 disposed 短路是风格债，已修）
      if (state.doneTimer) clearTimeout(state.doneTimer);
      state.doneTimer = setTimeout(() => {
        state.doneTimer = null;
        if (state.disposed) return;
        showRepoModels();
      }, 200);
    },
  });

  const listEl = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  const virtualList = listEl
    ? createVirtualList<WorkshopModel>({
        scrollEl: sr,
        listEl,
        rowH: GH_ROW_H,
        renderItem: (m) =>
          buildModelRow(m, { dlPrefix, localMap, showAll: state.showAll, selectedSet, esc }),
        renderEmpty: () => {
          const empty = document.createElement("div");
          empty.className = "gh-empty";
          return empty;
        },
      })
    : null;

  const listeners: ListenerRef[] = [];
  const reCtx: CmReCtx = {
    sr,
    esc,
    models,
    dlPrefix,
    repo,
    source,
    showRepoModels,
    backToSite,
    localMap,
    state,
    selectedSet,
    queue,
    virtualList,
    listeners,
  };
  reCtxShell.ctx = reCtx;

  cmReBindBack(reCtx, listeners);
  cmReBindSearch(reCtx, listeners);
  cmReBindToggle(reCtx, listeners);
  cmReBindSelChecks(reCtx, listeners);
  cmReBindDlSelected(reCtx, listeners);
  cmReBindSelAll(reCtx, listeners);
  cmReBindContextMenu(reCtx, listeners);
  cmReBindRowClick(reCtx, listeners);

  const renderList = (f?: string): void => cmReRenderList(reCtx, f);
  const updateSelectedUI = (): void => cmReUpdateSelectedUI(reCtx);
  const cleanup = (): Promise<void> => cmReCleanup(reCtx);
  return { renderList, updateSelectedUI, cleanup };
}
