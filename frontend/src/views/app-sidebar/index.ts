// ===== <app-sidebar> 入口 =====

import { bus } from "@/bus";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
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
  /** 下拉控制器 dispose（push/pull 两个，ADR-298 D3）；替代原 _docClickHandler 单槽 */
  private _dropdownCleanup: (() => void) | null = null;
  /** ADR-308 D2：整合包卡片 roving 键盘导航句柄（原语 = utils/dom/bind-roving.ts） */
  private _roving: RovingHandle | null = null;
  private _syncInProgress = false; // 防止并发推送/拉取
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
    }
  }

  async connectedCallback(): Promise<void> {
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
      (fn) => {
        this._dropdownCleanup = fn;
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
    // ADR-308 D2：重渲染后新卡片全为 tabindex=-1（render.ts 统一落点），键盘入口须由
    // 原语重新布局「恰一 tabindex 0」——落点 0；若有保存选中，restoreSelectedCard 的
    // rAF（晚于本同步路径）经 syncRestoredIndex 校正到选中卡，最终态正确
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
  getBusy(): boolean {
    return this._busy;
  }
  setBusy(v: boolean): void {
    this._busy = v;
  }

  /** SidebarHost（可选，ADR-308 D2）：恢复保存选中时把 roving 布局校正到选中卡
   *  （restoreSelectedCard 的 rAF 调用；事件层不感知原语细节，句柄缺失则 no-op） */
  syncRestoredIndex(idx: number): void {
    this._roving?.syncIndex(idx);
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
      return;
    }
    this._reloadInFlight = true;
    const gen = this._guard.next();
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
    } finally {
      this._reloadInFlight = false;
    }
    if (this._guard.stale(gen)) return;
    this._renderCards();
    bindFooter(this._root, this._instances);
    if (this._reloadPending) {
      this._reloadPending = false;
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
    this._reloadInFlight = false;
    // 清理防抖定时器，防止组件销毁后回调在已销毁实例上执行
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._reloadPending = false;
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
    if (this._dropdownCleanup) {
      this._dropdownCleanup();
      this._dropdownCleanup = null;
    }
    // ADR-308 D2：roving 键位监听随卸载死寂（dispose 幂等；重挂载由 connectedCallback 重绑）
    if (this._roving) {
      this._roving.dispose();
      this._roving = null;
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
