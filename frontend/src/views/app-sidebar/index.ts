// ===== <app-sidebar> 入口 =====

import { bus } from "@/bus";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { type BusyLock, createBusyLock } from "@/utils/base/primitives/lock.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { bindRoving, type RovingHandle } from "@/utils/dom/bind-roving.ts";
import { createShadowStyle } from "@/utils/dom/shadow-style.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { sidebarCSS } from "./sidebar-css.ts";

// 模块级样式表（shadow 根装配，含 HMR 注册；见 utils/dom/shadow-style.ts）。
// 原 12 行「环境守卫 + new CSSStyleSheet + replaceSync」样板已收敛到该原语。
const appSidebarStyle = createShadowStyle(sidebarCSS, "app-sidebar");

export { appSidebarStyle };

import { bindPackCardDnD } from "@/features/dnd/pack-dnd.ts";
import type { SidebarInstance } from "./data.ts";
import { bindCardEvents, bindFooter, bindMcPathLabel } from "./events.ts";
import { loadInstances } from "./loader.ts";
import { renderLoadError, renderVersionCards } from "./render.ts";
import { bindSelectAll, pruneCheckedSets, restoreCheckboxes } from "./sidebar-select.ts";
import { bindSyncSelected } from "./sync-flow.ts";
import { footerHTML, headerHTML, listContainerHTML, syncResultPanelHTML } from "./tpl.ts";

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
  /** 下拉控制器 dispose（push/pull 两个，ADR-298 D3）；替代原 _docClickHandler 单槽 */
  private _dropdownCleanup: (() => void) | null = null;
  /** ADR-308 D2：整合包卡片 roving 键盘导航句柄（原语 = utils/dom/bind-roving.ts） */
  private _roving: RovingHandle | null = null;
  private _syncLock = createBusyLock(); // 防止并发推送/拉取（ADR-341 归一 BusyLock）
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 重载在途锁（并发控制·单飞）：在途时新请求不并发，仅记补跑标记。
   *  ⚠️ 职责与代际守卫 `_guard` 不同——本锁管「同一时刻只跑一次」，`_guard` 管「丢弃过期结果」，
   *  二者正交，不可互相替代（原 `_loading` 命名含混，易被误读为「加载中」UI 状态）。
   *  「单飞 + 尾随补跑」全仓仅此一处（2026-09 核实），故不抽象为通用原语。 */
  private _reloadInFlight = false;
  /** 代际守卫（ADR-230 全仓唯一出口）：原手搓 `private _reloadGen` 计数，2026-09 并轨 */
  private readonly _guard = createLoadGuard();
  /** 在途期间来了新请求 → 标记待补跑（完成后用最新 rtype 再跑一次，尾随合并） */
  private _reloadPending = false;
  /** P0 修复（2026-10-16 锐评）：待补跑时**记住是否带 force**。原实现单飞命中后丢弃 force
   *  参数、补跑走 `_reload()`（不带 force），若变异（stats:refresh）请求恰被单飞拦下，
   *  补跑会并入在途的读请求、拉到变异前旧列表——loader 的 force 身份守卫被调用方绕开。 */
  private _reloadPendingForce = false;
  /** 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰；实例属性，生命周期随组件 */
  private _checkedSets = new Map<string, Set<string>>();
  /** 去重状态机：仅选中项实际变化时才 emit package:selected */
  private _lastEmittedPkg: string | null = null;
  /** 启动器检测/搜索并发守卫锁（两类入口共享：都在改 mcRoot，不并发；ADR-341 归一 BusyLock） */
  private _launcherLock = createBusyLock();
  /** 失败态重试监听清理（P0 修复：失败态自带 retry 按钮，其监听不经卡片事件委托） */
  private _errorCleanup: (() => void) | null = null;

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
    }
  }

  // 2026-10 收口（锐评）：原标 `async` 但函数体零 await——Web Component 生命周期
  // 回调的返回值无人接管，伪 async 只会把同步抛错转成 unhandled rejection（仓内
  // render 曾同病：错误提示整段变死码）。真实异步入口全部经 `void this._reload()` 等显式发起。
  connectedCallback(): void {
    this._renderLayout();

    // ADR-308 D2：整合包卡片键盘导航（roving tabindex + 方向键，list 预设垂直向）。
    // 激活走合成点击复用点击委托路径——高亮/涟漪/去重/持久化全在既有 handler，零复制。
    this._roving?.dispose();
    this._roving = bindRoving({
      root: this._root,
      container: "#sidebar-instance-list",
      itemSelector: ".instance-card",
      preset: "list",
      orientation: "vertical",
      onActivate: (item) => this._activateCardKeyboard(item),
    });

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
    // （2026-10 收口：原 handler 标 async 但体零 await，同伪 async 病）
    this._unsubs.push(
      bus.on("repo:rtype-changed", (rtype) => {
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

    // MC 路径按钮：首帧拉一次 + 订阅 config:changed（2026-10 架构补件：原挂在每轮 _reload 的
    // bindFooter 里 → 每轮操作白付一次 LoadAppConfig，未配置时还会连带扫盘；且设置页改完
    // 目录要等下一次 reload 侧栏才更新）。订阅进 _unsubs 桶，随 disconnectedCallback 退订。
    this._unsubs.push(bindMcPathLabel(this._root));

    clearTimeout(this._debounceTimer ?? undefined);
    this._debounceTimer = setTimeout(() => this._reload(), 50);
  }

  private _bindSelectAll(): void {
    // getter 注入而非按值捕获：本函数只在 connectedCallback 跑一次，而 _rtype/_instances
    // 都随 reload/切类型变化（按值捕获 = 全选写不进勾选集合，见 sync-flow.bindSelectAll 注释）
    bindSelectAll(
      this._root,
      () => this._rtype,
      () => this._instances,
      () => this._checkedSets,
    );
  }

  private _bindSyncSelected(): void {
    bindSyncSelected(
      this._root,
      () => this._instances,
      (fn) => {
        this._dropdownCleanup = fn;
      },
      this._syncLock,
    );
  }

  /**
   * 渲染卡片列表并重绑卡片事件（原模块级 `renderCards` 内联为私有方法，2026-10 锐评收口：
   * 该函数六个入参全是 this 的字段/闭包，靠「入参 cardCleanup + 返回 { cardCleanup }」模拟
   * 出参，实为把实例状态当参数倒手；内联后入参归零）。
   * ⚠️ 保留原早退语义：容器缺失（`_renderLayout` 未执行/异常）时本次不动，**旧 `_cardCleanup`
   * 原样保留**——不可改成置 null（会把仍挂在旧容器上的监听变成失联句柄、泄漏）。
   */
  private _renderCards(): void {
    // 成功态渲染前摘掉失败态重试监听（renderVersionCards 会清空容器，旧按钮随节点
    // 丢弃、监听本已失效；显式清理防句柄悬挂）
    this._errorCleanup?.();
    this._errorCleanup = null;
    const container = this._root.getElementById("sidebar-instance-list");
    if (container) {
      renderVersionCards(container, this._instances);
      if (this._cardCleanup) {
        this._cardCleanup();
        this._cardCleanup = null;
      }
      this._cardCleanup = bindCardEvents(this._root, this._instances, this);
      // P1 修复（2026-10 锐评）：先按最新实例列表修剪幽灵勾选名，再恢复勾选——
      // 顺序不可倒置（先恢复会把幽灵名当有效状态渲染，勾选态与实际列表错位）
      pruneCheckedSets(this._rtype, this._instances, () => this._checkedSets);
      restoreCheckboxes(this._root, this._rtype, this._instances, () => this._checkedSets);
    }
    // ADR-308 D2：重渲染后新卡片全为 tabindex=-1（render.ts 统一落点），键盘入口须由
    // 原语重新布局「恰一 tabindex 0」——落点 0；若有保存选中，restoreSelectedCard 的
    // rAF（晚于本同步路径）经 syncRovingIndex 校正到选中卡，最终态正确
    this._roving?.syncIndex(0);
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
  get launcherLock(): BusyLock {
    return this._launcherLock;
  }

  /** SidebarHost（可选，ADR-308 D2）：把 roving 布局校正到指定卡——restoreSelectedCard
   *  的 rAF 与卡片点击路径都调（事件层不感知原语细节，句柄缺失则 no-op） */
  syncRovingIndex(idx: number): void {
    this._roving?.syncIndex(idx);
  }

  /** P0 修复（2026-10 锐评）：加载失败态渲染（与空列表态分流）。
   *  `renderLoadError` 自挂重试监听并返回 cleanup（首帧即失败时 `bindCardEvents`
   *  尚未绑定，不能靠它的列表委托）；footer 统计清空，防上一次成功的旧数字留在
   *  失败态里被当成当前状态读。 */
  private _renderLoadError(): void {
    const container = this._root.getElementById("sidebar-instance-list");
    const statSync = this._root.getElementById("stat-sync");
    if (statSync) statSync.textContent = "";
    if (!container) return;
    this._errorCleanup?.();
    this._errorCleanup = renderLoadError(container, () => {
      // force=true：重试必须拿最新数据，不并入可能在途失败/陈旧的去重请求
      void this._reload(true);
    });
  }

  /** ADR-308 D2 键盘激活路径：在卡片 header 中心派发合成 click，完整复用点击委托路径的
   *  语义（高亮/涟漪/去重/持久化全在 events.ts 既有 handler，零复制——原语只产「激活哪个」）。
   *  取 header 而非整卡：点击路径的高亮/涟漪作用在 header；中心坐标让涟漪落点
   *  对齐 CSS 缺省锚点（--ripple-x/--ripple-y 50%）。 */
  private _activateCardKeyboard(card: HTMLElement): void {
    const hdr = card.querySelector(".instance-card-header") as HTMLElement | null;
    if (!hdr) return;
    const rect = hdr.getBoundingClientRect();
    hdr.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }

  private async _reload(force = false): Promise<void> {
    if (this._reloadInFlight) {
      // 丢弃语义会导致 rtype 快速切换时 _instances 与 _rtype 错配：
      // 记下补跑请求，当前完成后用最新 rtype 再跑一次
      this._reloadPending = true;
      // P0 修复（2026-10-16 锐评）：force 随补跑一起记忆（OR 累积，任一请求要求 force 即保持）
      this._reloadPendingForce = this._reloadPendingForce || force;
      return;
    }
    this._reloadInFlight = true;
    const gen = this._guard.next();
    // P0 修复（2026-10 锐评）：失败与空列表分流——原 catch 置 [] 后照走
    // _renderCards()，把加载失败渲染成「未找到整合包」空态（误导用户以为没装包）。
    // 现以 failed 标记在 finally 之后二选一：失败渲染失败态（含重试），成功才渲染卡片。
    let failed = false;
    try {
      const instances = await loadInstances(this._rtype, force ? { force: true } : undefined);
      if (this._guard.stale(gen)) return; // 已被更新的重载取代，丢弃过期结果
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
      if (this._guard.stale(gen)) return;
      dbg("sidebar", "_reload 失败:", e);
      this._instances = [];
      failed = true;
    } finally {
      this._reloadInFlight = false;
    }
    if (this._guard.stale(gen)) return;
    if (failed) {
      this._renderLoadError();
    } else {
      this._renderCards();
      bindFooter(this._root, this._instances);
    }
    if (this._reloadPending) {
      this._reloadPending = false;
      const nextForce = this._reloadPendingForce;
      this._reloadPendingForce = false;
      void this._reload(nextForce);
    }
  }

  disconnectedCallback(): void {
    this._unsubs.forEach((fn) => {
      fn();
    });
    // P3 修复（子代理审计）：卸载时复位在途同步标志——推送/拉取 IIFE 的 finally
    // 只在本组件存活期间执行，卸载后 _syncLock/_loading 若保持占用，重挂载时
    // 新按钮点击被入闸静默 return（按钮"死了"最多 30s 直到 timer 超时）。
    // 在途 bus.on 订阅与 30s timer 由各自 unsub 兜底（超时/完成后自行清理），此处
    // 仅需释放锁解除新实例的卡死（ADR-341：BusyLock.finish 复位）
    this._syncLock.finish();
    this._reloadInFlight = false;
    // 代际失效（2026-10 锐评修复）：单飞锁复位只解「同刻只跑一次」，**不作废在途代数**——
    // `_reload` 若正挂在 `await loadInstances(...)` 上，卸载后那块续体仍会走 `_renderCards()`
    // + `bindFooter()`，给已卸载的 shadow root 重渲染卡片、重绑 click/contextmenu 委托
    // （幽灵写入）。原实现漏接 `invalidate()`，使 `stale(gen)` 恒 false、代际守卫形同虚设；
    // 同仓 `app-tree` / `app-sync-manager` 的 cleanup 均已成对接上，唯本组件漏接。
    this._guard.invalidate();
    // 清理防抖定时器，防止组件销毁后回调在已销毁实例上执行
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._reloadPending = false;
    // P0 修复（2026-10-16 锐评）：待补跑的 force 标记随卸载复位，防重挂载沿用旧 force
    this._reloadPendingForce = false;
    // P2 复核修复：组件真正卸载时复位去重标记（同组件 reload 不复位、去重跨 reload 生效）
    this.resetSelectedEmit();
    // 清理 DOM 事件监听
    if (this._cardCleanup) {
      this._cardCleanup();
      this._cardCleanup = null;
    }
    // P0 修复：失败态重试监听随卸载摘除（防已卸载组件被点重试 → 幽灵 _reload）
    if (this._errorCleanup) {
      this._errorCleanup();
      this._errorCleanup = null;
    }
    if (this._packDndCleanup) {
      this._packDndCleanup();
      this._packDndCleanup = null;
    }
    if (this._dropdownCleanup) {
      this._dropdownCleanup();
      this._dropdownCleanup = null;
    }
    // ADR-308 D2：roving 键位监听随卸载死寂（dispose 幂等；重挂载由 connectedCallback 重绑）
    if (this._roving) {
      this._roving.dispose();
      this._roving = null;
    }
    // _checkedSets / _lastEmittedPkg / _launcherLock 均为实例属性，随组件 GC 自然回收
  }

  private _renderLayout(): void {
    // 同步变更明细浮层容器同步重建：重渲染后回归 hidden 态（内容由 sync-flow 重新触发）
    this._root.innerHTML =
      headerHTML() + listContainerHTML() + footerHTML() + syncResultPanelHTML();
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("app-sidebar")) {
  customElements.define("app-sidebar", AppSidebar);
}
// HMR 热更新：仅 sidebarCSS（./sidebar-css.ts）变更时热刷 shadow 样式表；其余依赖变更落到整页重载。
appSidebarStyle.acceptHmr(import.meta.hot, "./sidebar-css.ts", "sidebarCSS");
