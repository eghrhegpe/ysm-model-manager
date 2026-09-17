// ===== app-content 状态容器（ADR-091 D22 延伸）=====
// 抽出组件的 15 个状态字段，使 index.ts 瘦身为协调器。
// 字段分组：
// - 核心状态：root / current
// - 拖拽回调：resizeMove / resizeUp（app 壳层预览拖拽，非页私有）
// - 其余借宿字段：avatarCache（头像缓存，写入方比页面长寿，见下）/ workshopCache / githubCache
// - 定时器：workshopTimer（app 壳层跨切防御，见字段注释——非普通页私有状态）
// 注：仓库视图的异步清理**不在本容器**——已归订阅桶（host.subs.addPage 收 Promise，ADR-260）。

import type { PageName } from "@/bus";
import type { WorkshopModel } from "@/features/community/render.ts";

export interface RepoCacheEntry {
  models: WorkshopModel[];
  source: string;
  localMap?: Map<string, string>;
}

export class AppContentState {
  /** Shadow DOM 根 */
  root: ShadowRoot;
  /** 当前页面 key */
  current: PageName;

  /** 预览面板拖拽 move 回调 */
  resizeMove: ((e: PointerEvent) => void) | null = null;
  /** 预览面板拖拽 up 回调 */
  resizeUp: ((e: PointerEvent) => void) | null = null;

  // 注：`currentSite` 已下沉到工坊页作用域（ADR-262，`site/workshop-page-state.ts`）——
  // 它只服务于工坊页，且只被 tabs（写）/ opener（读）消费，两类读者都经页作用域句柄拿到它。
  // 本容器不再持有该字段：借宿时 tabs 手持整个 AppContentState，顺手写下了 workshopTimer。

  /** 创作者头像缓存（`author → dataUri`）
   *  ⚠️ 跨切归属（ADR-262）：写入方 `features/community/download-queue-store.ts` 是模块级持久层
   *  （`Events.On("queue:file-done")` 脚本加载即注册，**页面切换不丢事件**），下载队列离页照跑，
   *  `avatar:refresh` 随时可能在非工坊页派发。故本字段的生命周期**注定长于工坊页**：
   *  若随页清理，漏掉的增量头像在切回时既不会重提（面板常驻 ADR-163，init 不重跑）也不会自愈。
   *  真正的归宿是上收为与下载队列同寿命的 community 层 store（另一刀），现状借宿是**有意**的。 */
  avatarCache: Record<string, string> = {};

  /** 创意工坊模型缓存 */
  workshopCache: Map<string, RepoCacheEntry> | null = null;
  /** GitHub 模型缓存 */
  githubCache: Map<string, RepoCacheEntry> | null = null;
  /** 创意工坊默认站点延迟加载定时器
   *  ⚠️ 跨切归属（ADR-262）：清理点是 app 壳层的 `_render()` 开头（早于 `page.init`，
   *  覆盖「app-content 尚未加载就被切走」的窗口）与 `cleanupTransient()`——
   *  防的是离页后 `loadCommunityData()` 的全量拉取 + 脏写 currentSite。
   *  搬进工坊页自清无法等效（订阅桶没有「切页」这一清理粒度，见 subscription-bucket 文件头），
   *  属**有意的跨切生命周期**，非历史债；下沉即净增复杂度。 */
  workshopTimer: ReturnType<typeof setTimeout> | null = null;

  // 注：仓库视图的异步清理已归订阅桶（host.subs.addPage 收 Promise，ADR-260）——
  // 不再在共享 state 上开专用字段；页面级可变状态由各页闭包自持（currentSite 已于 ADR-262 归位）。

  /** 页面面板缓存（ADR-163：tab-panel 常驻化——首次访问渲染并缓存 DOM 节点，
   *  切页复用节点不重建；key=页面名，value=面板节点） */
  private pagePanels = new Map<string, HTMLElement>();

  constructor(root: ShadowRoot, current: PageName) {
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

  /** 清理缓存与定时器（disconnectedCallback 调用） */
  cleanupTransient(): void {
    if (this.resizeMove) document.removeEventListener("pointermove", this.resizeMove);
    if (this.resizeUp) document.removeEventListener("pointerup", this.resizeUp);
    this.resizeMove = null;
    this.resizeUp = null;
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
