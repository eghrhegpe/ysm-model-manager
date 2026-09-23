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

/**
 * 行高兜底值 42px = `.gh-row` 内容高（`.gh-icon-btn` 28px，content-gh.ts）
 * + padding 上下各 `--pad-nav`(6px) + margin-bottom 2px（--fs-scale=0 基准下成立）。
 * ⚠️ `--pad-nav = 6px + var(--fs-scale) * 0.5`——字体缩放主题下行高随之增长，
 * 定值 42 会产生累计偏移（每行 ±scale px × 行数）。故 bindRepoEvents 优先用
 * {@link measureGhRowH} 实测，本常量仅作测量失败（零布局/jsdom）兜底。
 */
export const GH_ROW_H = 42;

/**
 * 探针实测 .gh-row 行高（含 margin-bottom 2px，虚拟列表占位计算需含之内存高）。
 * 临时挂入 sr（shadow 树内，content-gh.ts adopted rules 生效），同步读取后移除；
 * offsetHeight 为 0（jsdom/无布局）返回 GH_ROW_H 兜底。DOM API 构建（R8：features 禁 HTML 字面量）。
 */
export function measureGhRowH(sr: HTMLElement): number {
  const probe = document.createElement("div");
  probe.className = "gh-row";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  for (const [cls, isActions] of [
    ["gh-name-wrap", false],
    ["gh-meta", false],
    ["gh-actions", true],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = cls;
    if (isActions) {
      const btn = document.createElement("button");
      btn.className = "gh-icon-btn";
      cell.appendChild(btn);
    }
    probe.appendChild(cell);
  }
  sr.appendChild(probe);
  // offsetHeight 不含 margin-bottom：有布局时补固定 2px（.gh-row margin-bottom: 2px，
  // 不随主题缩放）。判 0 在加 margin 之前——jsdom offsetHeight 恒 0，加完再判会误得 2
  const rawH = probe.offsetHeight;
  probe.remove();
  return rawH > 0 ? rawH + 2 : GH_ROW_H;
}

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
