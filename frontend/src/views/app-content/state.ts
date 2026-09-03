// ===== app-content 状态容器（ADR-091 D22 延伸）=====
// 抽出组件的 15 个状态字段，使 index.ts 瘦身为协调器。
// 字段分组：
// - 核心状态：root / current
// - 标志位：insListenerReg / avatarRefreshRegistered
// - 拖拽回调：resizeMove / resizeUp
// - workshop/github 借宿状态：currentSite / avatarCache / workshopCache / githubCache / workshopTimer
// - 异步清理：repoEventsCleanup

import type { WorkshopModel } from "../../features/community/render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

export interface RepoCacheEntry {
  models: WorkshopModel[];
  source: string;
  localMap?: Map<string, string>;
}

export class AppContentState {
  /** Shadow DOM 根 */
  root: ShadowRoot;
  /** 当前页面 key */
  current: string;

  /** 实例页监听注册标志（防重复注册 package:selected） */
  insListenerReg = false;
  /** 头像刷新订阅注册标志 */
  avatarRefreshRegistered = false;

  /** 预览面板拖拽 move 回调 */
  resizeMove: ((e: PointerEvent) => void) | null = null;
  /** 预览面板拖拽 up 回调 */
  resizeUp: ((e: PointerEvent) => void) | null = null;

  /** 创意工坊当前浏览站点 */
  currentSite: WorkshopSite | null = null;
  /** 创作者头像缓存 */
  avatarCache: Record<string, string> = {};
  /** 创意工坊模型缓存 */
  workshopCache: Map<string, RepoCacheEntry> | null = null;
  /** GitHub 模型缓存 */
  githubCache: Map<string, RepoCacheEntry> | null = null;
  /** 创意工坊默认站点定时器（切页销毁时清理） */
  workshopTimer: ReturnType<typeof setTimeout> | null = null;

  /** 仓库视图异步清理函数 */
  repoEventsCleanup: (() => Promise<void>) | null = null;

  /** 页面面板缓存（ADR-163：tab-panel 常驻化——首次访问渲染并缓存 DOM 节点，
   *  切页复用节点不重建；key=页面名，value=面板节点） */
  private pagePanels = new Map<string, HTMLElement>();

  constructor(root: ShadowRoot, current: string) {
    this.root = root;
    this.current = current;
  }

  // ===== 页面面板缓存操作（ADR-163）=====

  /** 取缓存面板（未访问过 → undefined） */
  getCachedPanel(key: string): HTMLElement | undefined {
    return this.pagePanels.get(key);
  }

  /** 缓存面板（key 已存在则覆盖——调用方保证同 key 仅建一次） */
  cachePanel(key: string, panel: HTMLElement): void {
    this.pagePanels.set(key, panel);
  }

  /** 全量清空页面缓存并移除 DOM（lang:changed 全量重建 / disconnectedCallback 兜底） */
  clearPanels(): void {
    for (const panel of this.pagePanels.values()) {
      panel.remove();
    }
    this.pagePanels.clear();
  }

  // ===== 标志位操作 =====
  setInsListenerReg(v: boolean): void {
    this.insListenerReg = v;
  }
  setAvatarRefreshRegistered(v: boolean): void {
    this.avatarRefreshRegistered = v;
  }

  // ===== 拖拽回调操作 =====
  setResizeMove(fn: ((e: PointerEvent) => void) | null): void {
    this.resizeMove = fn;
  }
  setResizeUp(fn: ((e: PointerEvent) => void) | null): void {
    this.resizeUp = fn;
  }

  // ===== workshop/github 借宿状态操作 =====
  setCurrentSite(site: WorkshopSite | null): void {
    this.currentSite = site;
  }
  setAvatarCache(cache: Record<string, string>): void {
    this.avatarCache = cache;
  }
  setWorkshopCache(cache: Map<string, RepoCacheEntry> | null): void {
    this.workshopCache = cache;
  }
  setGithubCache(cache: Map<string, RepoCacheEntry> | null): void {
    this.githubCache = cache;
  }
  setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void {
    this.workshopTimer = timer;
  }

  // ===== 异步清理操作 =====
  setRepoEventsCleanup(fn: (() => Promise<void>) | null): void {
    this.repoEventsCleanup = fn;
  }

  /** 清理缓存与定时器（disconnectedCallback 调用） */
  cleanupTransient(): void {
    if (this.resizeMove) document.removeEventListener("pointermove", this.resizeMove);
    if (this.resizeUp) document.removeEventListener("pointerup", this.resizeUp);
    this.resizeMove = null;
    this.resizeUp = null;
    this.avatarRefreshRegistered = false;
    this.insListenerReg = false;
    if (this.workshopCache) this.workshopCache.clear();
    this.workshopCache = null;
    if (this.githubCache) this.githubCache.clear();
    this.githubCache = null;
    if (this.workshopTimer) {
      clearTimeout(this.workshopTimer);
      this.workshopTimer = null;
    }
  }
}
