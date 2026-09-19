// ===== 创意工坊仓库事件绑定 · 共享上下文与渲染助手（ADR-040 拆出）=====
// 从 events.ts 拆出：特有上下文/状态机常量 + 行渲染小助手 + 监听注册原语，
// 供 repo-events-bindings.ts（8 个 cmReBind*）与 events.ts（bindRepoEvents 组装）共用。

import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { DownloadQueue } from "./download-queue.ts";
import { filterModels, type WorkshopModel } from "./render.ts";
import type { VirtualList } from "./virtual-list.ts";

/** bindRepoEvents 上下文 */
export interface RepoEventsContext {
  esc: (s: string) => string;
  models: WorkshopModel[];
  dlPrefix: string;
  repo: string;
  source: string;
  showRepoModels: () => void;
  backToSite: () => void;
  localMap: Map<string, string>;
}

/** 绑定返回值 */
export interface RepoEventsHandle {
  renderList: (filter?: string) => void;
  updateSelectedUI: () => void;
  cleanup: () => Promise<void>;
}

export interface CmReState {
  showAll: boolean;
  disposed: boolean;
  currentFilter: string;
  currentFiltered: WorkshopModel[];
  /** onAllDone 回跳定时器引用：cmReCleanup 集中 clear（对齐 cmPgClearTimers 集中清理范式） */
  doneTimer: ReturnType<typeof setTimeout> | null;
}

export interface CmReCtx {
  sr: HTMLElement;
  esc: (s: string) => string;
  models: WorkshopModel[];
  dlPrefix: string;
  repo: string;
  source: string;
  showRepoModels: () => void;
  backToSite: () => void;
  localMap: Map<string, string>;
  state: CmReState;
  selectedSet: Set<string>;
  queue: DownloadQueue;
  virtualList: VirtualList<WorkshopModel> | null;
  /** 已注册的 DOM 监听（cleanup 时成对 removeEventListener，替代 cloneNode hack 清监听） */
  listeners: ListenerRef[];
}

/** 单个已注册监听的引用（供 cmReCleanup 成对解绑） */
export interface ListenerRef {
  el: EventTarget;
  type: string;
  handler: EventListenerOrEventListenerObject;
}

/** 注册监听并记录引用：addEventListener + 登记（K 泛型恢复事件类型推断，如 contextmenu→MouseEvent） */
export function cmReListen<K extends keyof HTMLElementEventMap>(
  listeners: ListenerRef[],
  el: HTMLElement,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
): void {
  listeners.push({ el, type, handler: handler as EventListener });
  el.addEventListener(type, handler);
}

export const GH_ROW_H = 42;

/** 依据当前筛选/缺失开关重算 filtered 列表并刷新虚拟列表 */
export function cmReRenderList(ctx: CmReCtx, filter?: string): void {
  const { state, models, virtualList, localMap } = ctx;
  if (filter !== undefined) state.currentFilter = filter;
  state.currentFiltered = filterModels(models, state.currentFilter, state.showAll, localMap);
  virtualList?.refresh(state.currentFiltered);
}

/** 刷新「下载选中(N)」按钮的文案与禁用态 */
export function cmReUpdateSelectedUI(ctx: CmReCtx): void {
  const { sr, selectedSet } = ctx;
  const checked = selectedSet.size;
  const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement | null;
  if (btn) {
    btn.innerHTML = `${UI_ICONS.download} ${t("workshop.downloadSelected", { n: checked })}`;
    btn.disabled = checked === 0;
  }
}
