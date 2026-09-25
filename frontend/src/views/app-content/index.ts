// ===== <app-content> 入口（ADR-040：≤400 行红线）=====

import { bus } from "@/bus";
import { isValidPage, resolveInitialPage } from "@/core/page-store.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { setPendingTreeSearch } from "@/utils/dom/search-pending.ts";
import { createShadowStyle } from "@/utils/dom/shadow-style.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { contentCSS } from "@/views/app-content/css/content-css.ts";

// 模块级样式表（shadow 根装配，含 HMR 注册；见 utils/dom/shadow-style.ts）。
// 原 12 行「环境守卫 + new CSSStyleSheet + replaceSync」样板已收敛到该原语。
const appContentStyle = createShadowStyle(contentCSS, "app-content");

export { appContentStyle };

import { registerContextMenus } from "@/features/context-menu/context-menus.ts";
import { registerInstanceOps } from "@/features/pack-ops/instance-ops.ts";
import { registerAndroidEvents } from "@/features/platform/android-events.ts";
import { registerSync } from "@/features/sync/sync.ts";
// 副作用导入：注册 <app-preview> 组件
import "@/views/app-preview/index.ts";
import { t } from "@/core/i18n/t.ts";
import { clearAllCommunityCache } from "@/features/community/community-data.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { initPreviewResize } from "./init-preview.ts";
import { resetAvatarConfigLoaded } from "./init-workshop.ts";
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
    root.adoptedStyleSheets = [appContentStyle.sheet];
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
        // 冷启动兜底（focus-pending 同族）：app-tree chunk 走动态 import，元素未升级
        // 时下行 emit 落空（监听未注册），词进 pending 由挂载段 take 消费；已挂载场景
        // listener 命中后 take 清残。必须先 set 再 emit（bus 同步派发，顺序反了 listener
        // take 到的是 null，pending 会残留到未来挂载迟到误填）
        setPendingTreeSearch(name);
        bus.emit("tree:set-search", name);
      }),
    );
    // 语言热切换（ADR-045 增强）：全量重建（ADR-163 常驻化下语言切换低频，重建可接受；
    // 面板缓存的页面 t() 已按旧语言渲染，必须清缓存让下次访问按新语言重建）
    this.subs.addGlobal(
      bus.on("lang:changed", () => {
        this.subs.cleanupPage();
        this.state.clearPanels();
        this._render();
      }),
    );
    // 社区缓存统一失效（原社区-data.ts 模块级 bus.on 迁移至生命周期桶，
    // 组件 disconnectedCallback 经 SubscriptionBucket.cleanupAll 自动退订，防泄漏）
    this.subs.addGlobal(bus.on("community:clear-cache", clearAllCommunityCache));
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
    // 注：repo 视图事件清理不再手工执行——已随 subs.addPage 入桶，上面 cleanupAll() 已覆盖
    //（ADR-260：页面级拆除单源，避免「桶清一半、字段清一半」的双轨）
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
      this.state.workshopTimer = null;
    }
    try {
      const page = PAGE_REGISTRY[this.state.current] ?? PAGE_REGISTRY.instances;
      const cached = this.state.getCachedPanel(this.state.current);
      // 同页重放短路（2026-09 收债）：点击已激活 nav 项 / repo:search-creator 已在仓库页会重放
      // nav:changed——面板仍连接时 appendChild 对已挂载节点是 DOM move，会触发 app-tree 断连重连
      // （全量重扫 RPC）与 app-preview 重连自清（详情面板被清成空壳）。
      // 判据用 isConnected 而非同页键：lang:changed 与装配失败路径都先 clearPanels（面板已
      // 分离），天然绕过短路照常重建。
      if (cached?.isConnected) return;
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
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-content")) {
  customElements.define("app-content", AppContent);
}
// HMR 热更新：仅 contentCSS（./css/content-css.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
appContentStyle.acceptHmr(import.meta.hot, "./css/content-css.ts", "contentCSS");
