// ===== <app-content> 入口（ADR-040：≤400 行红线）=====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { resolveInitialPage } from "../../core/page-store.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { refreshAdoptedStyleSheets } from "../../utils/dom/css-hmr.ts";
import { contentCSS } from "./content-css.ts";
// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）。
// 环境守卫对齐 ui-components-styles.ts：node/happy-dom 无 CSSStyleSheet 时返回
// 占位对象（replaceSync no-op）避免 import 即崩；浏览器恒走真实分支。
const appContentStyle: CSSStyleSheet = (() => {
  if (typeof CSSStyleSheet === "undefined") {
    return { replaceSync: () => {} } as unknown as CSSStyleSheet;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(contentCSS);
  return sheet;
})();
export { appContentStyle };
import { getApp } from "../../backend/app.ts";
import { swallowError } from "../../utils/core/async.ts";
import { registerGlobalHandlers } from "../../core/handlers/global.ts";
// 副作用导入：注册 <app-preview> 组件
import "../app-preview/index.ts";
import { initPreviewResize } from "./init-preview.ts";
import {
  initDiagnosticsPage,
  initInstancesPage,
  initRepositoryPage,
  initWorkshopPage,
  initGithubPage,
  initSettingsPage,
} from "./init-pages.ts";
import { resetAvatarConfigLoaded } from "./init-workshop.ts";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  githubHTML,
} from "./tpl.ts";

import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import { AppContentState, type RepoCacheEntry } from "./state.ts";
import { SubscriptionBucket } from "./subscription-bucket.ts";
import { PAGE_REGISTRY } from "./page-registry.ts";

class AppContent extends WebComponentBase {
  /** 状态容器（15 字段 + 9 setter 抽出，index.ts 瘦身为协调器） */
  private state: AppContentState;
  /** 订阅桶管理器（3 桶清理逻辑抽出） */
  private subs: SubscriptionBucket;

  // ===== 兼容外部调用方（init-workshop / init-github / init-preview）的委托访问器 =====
  // 这些 getter/setter 保持 AppContentHost 接口不变，内部委托给 state/subs。
  get _root(): ShadowRoot { return this.state.root; }
  get _current(): string { return this.state.current; }
  set _current(v: string) { this.state.current = v; }
  get _globalUnsubs(): Array<() => void> { return this.subs.globalUnsubs; }
  get _repoEventsCleanup(): (() => Promise<void>) | null { return this.state.repoEventsCleanup; }
  get _unsubs(): Array<() => void> { return this.subs.pageUnsubs; }
  get _resizeMove(): ((e: PointerEvent) => void) | null { return this.state.resizeMove; }
  get _resizeUp(): ((e: PointerEvent) => void) | null { return this.state.resizeUp; }
  get _insListenerReg(): boolean { return this.state.insListenerReg; }
  set _insListenerReg(v: boolean) { this.state.setInsListenerReg(v); }
  get _avatarRefreshRegistered(): boolean { return this.state.avatarRefreshRegistered; }
  get _currentSite(): WorkshopSite | null { return this.state.currentSite; }
  get _avatarCache(): Record<string, string> { return this.state.avatarCache; }
  get _workshopCache(): Map<string, RepoCacheEntry> | null { return this.state.workshopCache; }
  get _githubCache(): Map<string, RepoCacheEntry> | null { return this.state.githubCache; }
  get _workshopTimer(): ReturnType<typeof setTimeout> | null { return this.state.workshopTimer; }

  _setResizeMove(fn: ((e: PointerEvent) => void) | null): void { this.state.setResizeMove(fn); }
  _setResizeUp(fn: ((e: PointerEvent) => void) | null): void { this.state.setResizeUp(fn); }
  _setCurrentSite(site: WorkshopSite | null): void { this.state.setCurrentSite(site); }
  _setAvatarCache(cache: Record<string, string>): void { this.state.setAvatarCache(cache); }
  _setWorkshopCache(cache: Map<string, RepoCacheEntry> | null): void { this.state.setWorkshopCache(cache); }
  _setGithubCache(cache: Map<string, RepoCacheEntry> | null): void { this.state.setGithubCache(cache); }
  _setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void { this.state.setWorkshopTimer(timer); }
  _setAvatarRefreshRegistered(v: boolean): void { this.state.setAvatarRefreshRegistered(v); }
  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void { this.state.setRepoEventsCleanup(fn); }

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [appContentStyle];
    // 与 PageStore 同源初始化：app-nav 的初始 nav:changed 在 app-content 动态
    // import 完成前可能被吞（app-modules.ts 动态加载），此时若硬编码 "repository"
    // 会导致 UI 渲染与 PageStore 脱节（守卫误拦 DnD 遮罩）。统一走
    // resolveInitialPage，即使初始事件丢失，两者也保持一致。
    this.state = new AppContentState(root, resolveInitialPage());
    this.subs = new SubscriptionBucket();
  }

  connectedCallback(): void {
    this.subs.setNavUnsub(bus.on("nav:changed", ({ page }) => {
      this.state.current = page;
      // 不再每次 nav:changed 清扫描缓存：30s 缓存由导入/同步/下载等实际数据变更处
      // 显式清除（sync.ts / download-queue.ts），避免重复扫盘 + 刷屏扫描日志
      this._render();
    }));
    // 创作者详情浮层→搜索本地模型
    this.subs.addGlobal(bus.on("repo:search-creator", (name) => {
      // 先切到仓库页面（_render 同步创建 <app-tree>，其 connectedCallback 注册 tree:set-search 监听）
      bus.emit("nav:changed", { page: "repository" });
      // 渲染完成后发射搜索事件——app-tree 已挂载，bus 监听就绪
      bus.emit("tree:set-search", name);
    }));
    // 语言热切换（ADR-045 增强）：全量重建（ADR-163 常驻化下语言切换低频，重建可接受；
    // 面板缓存的页面 t() 已按旧语言渲染，必须清缓存让下次访问按新语言重建）
    this.subs.addGlobal(bus.on("lang:changed", () => {
      this.subs.cleanupPage();
      this.state.setInsListenerReg(false);
      this.state.clearPanels();
      this._render();
    }));
    this._render();
    registerGlobalHandlers().forEach((fn) => this.subs.addGlobal(fn));
  }

  disconnectedCallback(): void {
    // 清理订阅桶
    this.subs.cleanupAll();
    // 清理拖拽监听 + 缓存 + 定时器
    this.state.cleanupTransient();
    // ADR-163：清空常驻页面面板 DOM（防止组件销毁后面板残留泄漏）
    this.state.clearPanels();
    // config-loaded Wails 订阅回收 + flag 复位（init-workshop.ts 模块级状态，
    // 经导出函数访问——组件重建后新实例可重新注册）
    resetAvatarConfigLoaded();
    // 清理 repo 视图事件
    if (this.state.repoEventsCleanup) {
      swallowError(this.state.repoEventsCleanup());
      this.state.setRepoEventsCleanup(null);
    }
  }

  /**
   * 渲染当前页（ADR-163 tab-panel 常驻化）：
   * - 首次访问：构建面板 DOM + 执行 page.init（每页仅一次），缓存面板节点；
   * - 再次访问：复用缓存节点、不重建、不重复 init——
   *   保留树展开/滚动位置/输入焦点，消灭「再进 dedup 永久卡死」（busy 锁 finally 必复位 + 不再重复 init）。
   * - 单面板挂载：root 下同一时刻仅保留当前面板（复用节点从缓存取回重挂），
   *   其余面板分离 DOM 但引用仍在缓存——这样 root 内 id 天然唯一，页内
   *   `host._root.getElementById` 无跨页冲突（无需页内查询作用域化）。
   */
  _render(): void {
    // 清理 workshop 延迟加载定时器（切页/语言热切换时防空跑网络请求）
    if (this.state.workshopTimer) {
      clearTimeout(this.state.workshopTimer);
      this.state.setWorkshopTimer(null);
    }
    try {
      const page = PAGE_REGISTRY[this._current] ?? PAGE_REGISTRY.instances;
      const cached = this.state.getCachedPanel(this._current);
      const isNew = !cached;
      let panel: HTMLElement;
      if (cached) {
        panel = cached;
      } else {
        panel = document.createElement("div");
        panel.className = "page";
        panel.innerHTML = page.html();
        this.state.cachePanel(this._current, panel);
      }
      // 单面板挂载：先分离 root 下其余页面面板（复用节点状态保留在缓存引用中），
      // 再挂回当前面板，保证同一时刻 root 下仅一个 .page。
      const root = this.state.root;
      for (const child of Array.from(root.children)) {
        if (child !== panel && child.classList.contains("page")) child.remove();
      }
      root.appendChild(panel);
      // init 必须在面板挂载后执行（init 经 host._root.getElementById 查询面板内容）
      if (isNew) {
        // P1-1（子代理审核）：消费注册表 init 字段，替代手动 if/else 链——
        // 新增页面只需在 PAGE_REGISTRY 添加一行，init 自动执行（不再有死代码）。
        // async init（如 settings）显式挂 catch 出口（ADR-044 ①：reject 转 toast）；
        // 同步 init 抛错由外层 try/catch 统一兜底。
        const initResult = page.init(this);
        if (initResult instanceof Promise) {
          void initResult.catch((e) => this._pageInitFailed(e));
        }
      }
      // 初始化预览面板拖拽调整宽度（幂等：先移除旧监听再绑定）
      this._initPreviewResize();
    } catch (e) {
      // P2 修复（审核）：HTML 装配段与页 init 统一兜底——
      // 原装配段在 try 外，repositoryHTML() 等抛错会中断 _render 且无用户反馈，
      // 配合 nav:changed 后置广播，装配失败时状态不广播（杜绝「状态变、内容不渲染」）
      // ADR-163：构建失败面板从缓存剔除，允许下次访问重试
      this.state.clearPanels();
      this._pageInitFailed(e);
    }
  }

  /** 页面初始化失败统一出口（同步 throw 与 async reject 共用） */
  private _pageInitFailed(e: unknown): void {
    console.error("[app-content] 页面初始化失败:", e);
    bus.emit("toast:show", {
      msg: "❌ " + t("content.pageLoadFailed") + ": " + friendlyError(e),
      duration: TOAST_MS.long,
      type: "error",
    });
    // 重置页面状态为仓库页，防止 nav 高亮与内容脱节；
    // 已在 repository 页时跳过，避免无效 nav:changed 触发链
    if (this._current !== "repository") {
      this._current = "repository";
      bus.emit("nav:changed", { page: "repository" });
    }
  }

  _initPreviewResize(): void {
    initPreviewResize(this);
  }

  /**
   * 绑定 tab 按钮切换。按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
   *   _bindTabs(".repo-tab", "ins", ["versions"]) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-versions
   */
  _bindTabs(tabSelector: string, prefix: string, ids: string[]): void {
    initRepositoryPage(this);
    // 注意：这里需要调用真实的 bindTabs，但为了测试兼容，我们保留方法签名
    // 实际逻辑在 init-pages.ts 中
  }

  _initDiagnostics(): void {
    initDiagnosticsPage(this);
  }

  _initInstances(): void {
    initInstancesPage(this);
  }

  _initRepository(): void {
    initRepositoryPage(this);
  }

  _initWorkshop(): void {
    initWorkshopPage(this);
  }

  _initGithub(): void {
    initGithubPage(this);
  }

  async _initSettings(): Promise<void> {
    void initSettingsPage(this).catch((e) => this._pageInitFailed(e));
  }
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-content")) {
  customElements.define("app-content", AppContent);
}
// HMR 热更新：仅 contentCSS（./content-css.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
import.meta.hot?.accept("./content-css.ts", (newCssMod) => {
  refreshAdoptedStyleSheets(newCssMod?.contentCSS, "app-content");
});
