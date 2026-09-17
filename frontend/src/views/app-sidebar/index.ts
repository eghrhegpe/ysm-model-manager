// ===== <app-sidebar> 入口 =====

import { bus } from "@/bus";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { createShadowStyle } from "@/utils/dom/shadow-style.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { RESOURCE_TYPE_LABELS } from "@/utils/resource/types.ts";
import { sidebarCSS } from "./sidebar-css.ts";

// 模块级样式表（shadow 根装配，含 HMR 注册；见 utils/dom/shadow-style.ts）。
// 原 12 行「环境守卫 + new CSSStyleSheet + replaceSync」样板已收敛到该原语。
const appSidebarStyle = createShadowStyle(sidebarCSS, "app-sidebar");

export { appSidebarStyle };

import { t } from "@/core/i18n/t.ts";
import { bindPackCardDnD } from "@/features/dnd/pack-dnd.ts";
import type { SidebarInstance } from "./data.ts";
import { bindCardEvents, bindFooter, type SidebarHost } from "./events.ts";
import { loadInstances } from "./loader.ts";
import { renderVersionCards } from "./render.ts";
import { bindSelectAll, bindSyncSelected, restoreCheckboxes } from "./sync-flow.ts";
import { footerHTML, headerHTML, listContainerHTML } from "./tpl.ts";

// ---------- renderCards ----------
function renderCards(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  cardCleanup: (() => void) | null,
  getCheckedSets: () => Map<string, Set<string>>,
  host: SidebarHost,
): { cardCleanup: (() => void) | null } {
  const container = root.getElementById("sidebar-instance-list");
  if (!container) return { cardCleanup };
  renderVersionCards(container, instances);
  if (cardCleanup) {
    cardCleanup();
    cardCleanup = null;
  }
  cardCleanup = bindCardEvents(root, instances, host);
  restoreCheckboxes(root, rtype, instances, getCheckedSets);
  return { cardCleanup };
}

// ---------- AppSidebar 类 ----------
class AppSidebar extends WebComponentBase {
  static get observedAttributes(): string[] {
    return ["rtype"];
  }

  private _root: ShadowRoot;
  private _instances: SidebarInstance[] = [];
  private _unsubs: Array<() => void> = [];
  private _rtype: string;
  private _cardCleanup: (() => void) | null = null;
  private _packDndCleanup: (() => void) | null = null;
  private _docClickHandler: (() => void) | null = null;
  private _syncInProgress = false; // 防止并发推送/拉取
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _loading = false;
  /** 重载代数：rtype 快速切换时用代数校验丢弃过期结果 */
  private _reloadGen = 0;
  /** _loading 进行中又有新请求 → 标记待补跑（完成后用最新 rtype 再跑一次） */
  private _pendingReload = false;
  /** 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰；实例属性，生命周期随组件 */
  private _checkedSets = new Map<string, Set<string>>();
  /** 去重状态机：仅选中项实际变化时才 emit package:selected */
  private _lastEmittedPkg: string | null = null;
  /** 启动器检测/搜索并发守卫（两类入口共享：都在改 mcRoot，不并发） */
  private _busy = false;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [appSidebarStyle.sheet];
    // P1 修复（ADR-104 整合包视图首屏 rtype 回落）：tpl.ts 挂载 <app-sidebar> 不传 rtype
    // 属性，此前恒回落 YSM，整合包标题首屏显示 (ysm) 需手动切标签才被纠正。
    // 对齐仓库页 initRepositoryPage 的 savedRtype 恢复：属性优先，缺省读
    // currentRepoType()（localStorage repo_rtype 权威源，由 app-nav 切换器落盘）。
    this._rtype = this.getAttribute("rtype") || currentRepoType();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (name === "rtype" && oldVal !== newVal && newVal) {
      this._rtype = newVal;
      this._reload();
      // 更新导入按钮文字
      const btn = this._root.querySelector(".sidebar-import-all");
      if (btn) {
        btn.textContent =
          "⬇️ " +
          t("sidebar.installAll") +
          (RESOURCE_TYPE_LABELS[this._rtype] || t("format.resources"));
      }
    }
  }

  async connectedCallback(): Promise<void> {
    this._renderLayout();

    // 整合包卡片拖拽导入（先入仓库再推送）：document 层监听，惰性读最新实例列表
    this._packDndCleanup?.();
    this._packDndCleanup = bindPackCardDnD(this._root, () => this._instances);

    // 监听刷新事件（300ms 防抖，防止短时间内多次重载）
    // force=true：stats:refresh 由变异操作（sync 拉取/删除/导入/启停）完成后触发，
    // 必须绕过 loadInstances 在途去重——否则并入变异前发起的在途请求，拿到旧实例列表
    this._unsubs.push(
      bus.on("stats:refresh", () => {
        clearTimeout(this._debounceTimer ?? undefined);
        this._debounceTimer = setTimeout(() => this._reload(true), 300);
      }),
    );

    // 监听全局 subtab 类型切换 → 重新加载该类型的统计
    this._unsubs.push(
      bus.on("repo:rtype-changed", async (rtype) => {
        if (rtype && rtype !== this._rtype) {
          this._rtype = rtype;
          clearTimeout(this._debounceTimer ?? undefined);
          this._debounceTimer = setTimeout(() => this._reload(), 100);
        }
      }),
    );

    // 绑定全选 + 同步所选
    this._bindSelectAll();
    this._bindSyncSelected();

    clearTimeout(this._debounceTimer ?? undefined);
    this._debounceTimer = setTimeout(() => this._reload(), 50);
  }

  private _bindSelectAll(): void {
    bindSelectAll(this._root, this._rtype, this._instances, () => this._checkedSets);
  }

  private _bindSyncSelected(): void {
    bindSyncSelected(
      this._root,
      () => this._instances,
      () => this._cardCleanup,
      (fn) => {
        this._cardCleanup = fn;
      },
      () => this._docClickHandler,
      (fn) => {
        this._docClickHandler = fn;
      },
      () => this._syncInProgress,
      (v) => {
        this._syncInProgress = v;
      },
    );
  }

  private _renderCards(): void {
    const { cardCleanup } = renderCards(
      this._root,
      this._rtype,
      this._instances,
      this._cardCleanup,
      () => this._checkedSets,
      this,
    );
    this._cardCleanup = cardCleanup;
  }

  // SidebarHost 实现：去重状态机 + 并发守卫（实例级）
  getLastEmittedPkg(): string | null {
    return this._lastEmittedPkg;
  }
  setLastEmittedPkg(v: string | null): void {
    this._lastEmittedPkg = v;
  }
  resetSelectedEmit(): void {
    this._lastEmittedPkg = null;
  }
  getBusy(): boolean {
    return this._busy;
  }
  setBusy(v: boolean): void {
    this._busy = v;
  }

  private async _reload(force = false): Promise<void> {
    if (this._loading) {
      // 丢弃语义会导致 rtype 快速切换时 _instances 与 _rtype 错配：
      // 记下补跑请求，当前完成后用最新 rtype 再跑一次
      this._pendingReload = true;
      return;
    }
    this._loading = true;
    const gen = ++this._reloadGen;
    try {
      const instances = await loadInstances(this._rtype, force ? { force: true } : undefined);
      if (gen !== this._reloadGen) return; // 已被更新的重载取代，丢弃过期结果
      this._instances = instances;
      dbg(
        "sidebar",
        "_reload 完成, 实例数:",
        this._instances.length,
        "rtype:",
        this._rtype,
        "首个:",
        this._instances[0]
          ? {
              name: this._instances[0].name,
              synced: this._instances[0].synced,
              missing: this._instances[0].missing,
            }
          : "无",
      );
    } catch (e) {
      if (gen !== this._reloadGen) return;
      dbg("sidebar", "_reload 失败:", e);
      this._instances = [];
    } finally {
      this._loading = false;
    }
    if (gen !== this._reloadGen) return;
    this._renderCards();
    bindFooter(this._root, this._instances);
    if (this._pendingReload) {
      this._pendingReload = false;
      void this._reload();
    }
  }

  disconnectedCallback(): void {
    this._unsubs.forEach((fn) => {
      fn();
    });
    // P3 修复（子代理审计）：卸载时复位在途同步标志——推送/拉取 IIFE 的 finally
    // 只在本组件存活期间执行，卸载后 _syncInProgress/_loading 若保持 true，重挂载时
    // 新按钮点击被 L188/L269/L322 静默 return（按钮"死了"最多 30s 直到 timer 超时）。
    // 在途 bus.on 订阅与 30s timer 由各自 unsub 兜底（超时/完成后自行清理），此处
    // 仅需复位标志解除新实例的卡死
    this._syncInProgress = false;
    this._loading = false;
    // 清理防抖定时器，防止组件销毁后回调在已销毁实例上执行
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._pendingReload = false;
    // P2 复核修复：组件真正卸载时复位去重标记（同组件 reload 不复位、去重跨 reload 生效）
    this.resetSelectedEmit();
    // 清理 DOM 事件监听
    if (this._cardCleanup) {
      this._cardCleanup();
      this._cardCleanup = null;
    }
    if (this._packDndCleanup) {
      this._packDndCleanup();
      this._packDndCleanup = null;
    }
    if (this._docClickHandler) {
      document.removeEventListener("click", this._docClickHandler);
      this._docClickHandler = null;
    }
    // _checkedSets / _lastEmittedPkg / _busy 均为实例属性，随组件 GC 自然回收
  }

  private _renderLayout(): void {
    this._root.innerHTML = headerHTML() + listContainerHTML() + footerHTML();
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-sidebar")) {
  customElements.define("app-sidebar", AppSidebar);
}
// HMR 热更新：仅 sidebarCSS（./sidebar-css.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
appSidebarStyle.acceptHmr(import.meta.hot, "./sidebar-css.ts", "sidebarCSS");
