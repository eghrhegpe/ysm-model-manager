// ===== <app-content> 入口（ADR-040：≤400 行红线）=====

import { bus } from "@/bus";
import { isValidPage, resolveInitialPage } from "@/core/page-store.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { refreshAdoptedStyleSheets } from "@/utils/dom/css-hmr.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { contentCSS } from "@/views/app-content/css/content-css.ts";

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

import { registerContextMenus } from "@/features/context-menu/context-menus.ts";
import { registerInstanceOps } from "@/features/pack-ops/instance-ops.ts";
import { registerAndroidEvents } from "@/features/platform/android-events.ts";
import { registerSync } from "@/features/sync.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
// 副作用导入：注册 <app-preview> 组件
import "@/views/app-preview/index.ts";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { clearAllCommunityCache } from "./community-data.ts";
import { initGithubPage } from "./init-github.ts";
import {
  initDiagnosticsPage,
  initInstancesPage,
  initRepositoryPage,
  initSettingsPage,
} from "./init-pages.ts";
import { initPreviewResize } from "./init-preview.ts";
import { initWorkshopPage, resetAvatarConfigLoaded } from "./init-workshop.ts";
import { PAGE_REGISTRY } from "./page-registry.ts";
import { AppContentState } from "./state.ts";
import { SubscriptionBucket } from "./subscription-bucket.ts";

class AppContent extends WebComponentBase {
  /** 状态容器（15 字段 + 9 setter 抽出，index.ts 瘦身为协调器） */
  readonly state: AppContentState;
  /** 订阅桶管理器（3 桶清理逻辑抽出） */
  readonly subs: SubscriptionBucket;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [appContentStyle];
    // 与 app-nav 同源：两者均走 resolveInitialPage()，避免硬编码幽灵值（旧 "dashboard"）。
    // app-content 经 app-modules.ts 动态加载，可能晚于 app-nav 派发的初始 nav:changed，
    // 事件被吞后若硬编码首页会让 UI 实际渲染页与 app-nav 脱节。统一走 resolveInitialPage，
    // 即使初始事件丢失，两者也保持一致。
    this.state = new AppContentState(root, resolveInitialPage());
    this.subs = new SubscriptionBucket();
  }

  connectedCallback(): void {
    this.subs.setNavUnsub(
      bus.on("nav:changed", ({ page }) => {
        // 口径对齐 app-nav：非法 page 拒绝（防 state.current 写脏 + DnD 遮罩守卫误判）
        if (!isValidPage(page)) return;
        this.state.current = page;
        // 不再每次 nav:changed 清扫描缓存：30s 缓存由导入/同步/下载等实际数据变更处
        // 显式清除（sync.ts / download-queue.ts），避免重复扫盘 + 刷屏扫描日志
        this._render();
      }),
    );
    // 创作者详情浮层→搜索本地模型
    this.subs.addGlobal(
      bus.on("repo:search-creator", (name) => {
        // 先切到仓库页面（_render 同步创建 <app-tree>，其 connectedCallback 注册 tree:set-search 监听）
        bus.emit("nav:changed", { page: "repository" });
        // 渲染完成后发射搜索事件——app-tree 已挂载，bus 监听就绪
        bus.emit("tree:set-search", name);
      }),
    );
    // 语言热切换（ADR-045 增强）：全量重建（ADR-163 常驻化下语言切换低频，重建可接受；
    // 面板缓存的页面 t() 已按旧语言渲染，必须清缓存让下次访问按新语言重建）
    this.subs.addGlobal(
      bus.on("lang:changed", () => {
        this.subs.cleanupPage();
        this.state.setInsListenerReg(false);
        this.state.clearPanels();
        this._render();
      }),
    );
    // 社区缓存统一失效（原社区-data.ts 模块级 bus.on 迁移至生命周期桶，
    // 组件 disconnectedCallback 经 SubscriptionBucket.cleanupAll 自动退订，防泄漏）
    this.subs.addGlobal(bus.on("community:clearCache", clearAllCommunityCache));
    this._render();
    // core 内核 + features 全局 handler（ADR-188：core/handlers/global 汇编壳已删，
    // app-content 直接注册各 features 全局 handler——core 不设壳层）
    const globalUnsubs: Array<() => void> = [];
    registerSync(globalUnsubs);
    registerContextMenus(globalUnsubs);
    registerInstanceOps(globalUnsubs);
    registerAndroidEvents(globalUnsubs);
    globalUnsubs.forEach((fn) => {
      this.subs.addGlobal(fn);
    });
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
   *   `host.state.root.getElementById` 无跨页冲突（无需页内查询作用域化）。
   */
  _render(): void {
    // 清理 workshop 延迟加载定时器（切页/语言热切换时防空跑网络请求）
    if (this.state.workshopTimer) {
      clearTimeout(this.state.workshopTimer);
      this.state.setWorkshopTimer(null);
    }
    try {
      const page = PAGE_REGISTRY[this.state.current] ?? PAGE_REGISTRY.instances;
      const cached = this.state.getCachedPanel(this.state.current);
      const isNew = !cached;
      let panel: HTMLElement;
      if (cached) {
        panel = cached;
      } else {
        panel = document.createElement("div");
        panel.className = "page";
        panel.innerHTML = page.html();
        this.state.cachePanel(this.state.current, panel);
      }
      // 单面板挂载：先分离 root 下其余页面面板（复用节点状态保留在缓存引用中），
      // 再挂回当前面板，保证同一时刻 root 下仅一个 .page。
      const root = this.state.root;
      for (const child of Array.from(root.children)) {
        if (child !== panel && child.classList.contains("page")) child.remove();
      }
      root.appendChild(panel);
      // init 必须在面板挂载后执行（init 经 host.state.root.getElementById 查询面板内容）
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
    logError("app-content", "页面初始化失败", e);
    bus.emit("toast:show", {
      msg: `❌ ${t("content.pageLoadFailed")}: ${friendlyError(e)}`,
      duration: TOAST_MS.long,
      type: "error",
    });
    // 重置页面状态为仓库页，防止 nav 高亮与内容脱节；
    // 已在 repository 页时跳过，避免无效 nav:changed 触发链
    if (this.state.current !== "repository") {
      this.state.current = "repository";
      bus.emit("nav:changed", { page: "repository" });
    }
  }

  _initPreviewResize(): void {
    initPreviewResize(this);
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
// HMR 热更新：仅 contentCSS（./css/content-css.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
import.meta.hot?.accept("./css/content-css.ts", (newCssMod) => {
  refreshAdoptedStyleSheets(newCssMod?.contentCSS, "app-content");
});
