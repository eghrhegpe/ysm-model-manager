// ===== 整合包同步管理器（生命周期壳） =====
// 展示整合包内所有资源类型的同步状态（扁平列表，一次加载，前端过滤）
// 使用: <app-sync-manager instance="1.20.1-Fabric"></app-sync-manager>
// 拆分：store / renderer / events / network 四模块，本文件仅负责生命周期编排
// 依赖 DAG：index → store / renderer / events / network / state（leaf modules 间无循环，
// events 的 LAST_TYPE_KEY 等共享状态走 state.ts，不再反向依赖 index）

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { WebComponentBase } from "@/utils/dom/web-component-base.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { SyncManagerFields, SyncManagerSelf } from "./self-type.ts";
import { loadData, loadTypeConfig } from "./store.ts";
import type { SyncItem } from "./tpl.ts";
import { containerHTML, loadingHTML } from "./tpl.ts";

export type { SyncManagerFields, SyncManagerSelf } from "./self-type.ts";

import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { bindDelegatedEvents } from "./events.ts";
import { performSingleOp } from "./network.ts";
import { cleanupSyncVirtualScroll, render } from "./renderer.ts";
import { getLastSelectedType, setLastSelectedType } from "./state.ts";

// P3 修复（子代理审计）：共享状态（LAST_TYPE_KEY / lastSelectedType / setLastSelectedType）
// 已下沉至 state.ts，打破 index ↔ events 循环依赖
// 2026-08-18：sm-tabs 移除后类型完全由全局 nav 下拉驱动——订阅 repo:rtype-changed 跟随，
// 状态主键统一 repo_rtype（state.ts），LAST_TYPE_KEY 仅历史兼容。

/** 按需加载当前 rtype 的 FilesRoot 仓库根路径（缓存到 _filesRoots，供 renderer 建树时扫描子条目） */
async function loadRepoRoots(self: SyncManagerSelf, rtype: string): Promise<void> {
  if (self._filesRoots[rtype]) return;
  try {
    const { GetRepoRoot } = await backendGetApp();
    self._filesRoots[rtype] = (await GetRepoRoot(rtype || "")) || "";
  } catch {
    self._filesRoots[rtype] = "";
  }
}

/** 本组件错误文案键（i18n 字面量联合：t() 只收已知键，裸 string 会被拒收） */
type SyncErrorMsgKey = "sync.renderFailed" | "syncManager.loadSyncStatusFailed";

export class AppSyncManager extends WebComponentBase {
  static get observedAttributes(): string[] {
    return ["instance", "default-type"];
  }

  _instance = "";
  private _defaultType = RESOURCE_TYPES.YSM;
  _selectedType = RESOURCE_TYPES.YSM;
  _statusFilter = "all";
  _subtype = "";
  _allItems: SyncItem[] = [];
  _filteredItems: SyncItem[] = [];
  /** 筛选后强制展开的目录 path 集合（status 筛选下「有命中后代的目录」，见 store.applyFilter） */
  _forceOpenPaths?: Set<string>;
  /** 与 self-type.ts 契约同形（store.loadTypeConfig 同步投影 resource_types.json 的 id/name/icon、
   *  renderer 消费；类侧声明须全量对齐，缺字段会让编译守卫「同形契约」宣称与实现脱节。
   *  ADR-269 D3③：dirLevelSync 全仓零读，已随本步从形状摘除） */
  _typeConfig: Array<{ id: string; name?: string | undefined; icon?: string | undefined }> = [];
  /** 代际守卫（ADR-230）：裸 _gen 计数退役，统一走全仓唯一出口 createLoadGuard。
   *  ⚠️ 曾并存手搓 `private _initGen`（与 _guard 语义不等价：invalidate 打不进早期 bail），
   *  2026-09 并轨至此单一出口——见 ADR-230「全仓唯一」claim，勿再引入第二套计数。 */
  readonly _guard = createLoadGuard();
  _eventsBound = false;
  _clickHandler: ((e: Event) => void) | null = null;
  _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** 一次性 click 委托的 unsub（生命周期跟随元素连接，不随 _init——re-init 不得销毁委托） */
  _clickUnsub: (() => void) | undefined;
  private _unsubs: Array<() => void> = [];
  _singleBusy = new Set<string>();
  _dirOpen: Record<string, boolean> = {};
  _filesRoots: Record<string, string> = {};
  /** 与 self-type.ts 契约同形（原 {warning?} 为过期形态——renderer/store 经 SyncManagerSelf 读写 warningCode/warningParams，TS 查不到此层） */
  _scanDirs: Record<
    string,
    {
      global: string;
      instance: string;
      warningCode?: string;
      warningParams?: { label: string; dir: string; subDir: string };
    }
  > = {};
  _cbRef:
    | {
        cb: {
          doRender: () => void;
          doPerformOp: (op: "push" | "pull", path: string) => Promise<void>;
        };
      }
    | undefined;

  connectedCallback(): void {
    this._instance = this.getAttribute("instance") || "";
    this._defaultType = this.getAttribute("default-type") || RESOURCE_TYPES.YSM;
    this._selectedType = getLastSelectedType() || this._defaultType;
    if (!this._instance) {
      this.innerHTML = `<div style="padding:var(--sp-3);color:var(--err)">${UI_ICONS.warning} ${t("sync.noInstance")}</div>`;
      return;
    }
    // _init 内部已统一 catch（加载段转错误 UI + toast），此处 void 仅表「不等待」意图
    void this._init();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "instance") {
      this._instance = newVal || "";
      if (this._instance) void this._init();
    } else if (name === "default-type") {
      this._defaultType = newVal || RESOURCE_TYPES.YSM;
    }
  }

  disconnectedCallback(): void {
    // 虚拟滚动监听（scroll + ResizeObserver）随卸载断开——同 _init 前置清理口径
    const vsListEl = this.querySelector<HTMLElement>(".sm-list");
    if (vsListEl) cleanupSyncVirtualScroll(vsListEl);
    if (this._unsubs) {
      this._unsubs.forEach((fn) => {
        fn();
      });
      this._unsubs = [];
    }
    // click 委托清理（_clickUnsub 内部：removeEventListener + 清 _clickHandler + 清 _cbRef）
    // 替换原 `if (_eventsBound && _clickHandler)` 显式分支——unsub 统一出口，
    // 与 bindDelegatedEvents 的清理逻辑单一事实源对齐
    if (this._clickUnsub) {
      this._clickUnsub();
      this._clickUnsub = undefined;
    }
    this._eventsBound = false;
    // 清除回调引用，防止重连时残留旧闭包
    this._cbRef = undefined;
  }

  async _init(): Promise<void> {
    const self = this as SyncManagerSelf;
    const gen = this._guard.next();
    this._resetViewState();
    this._setupSkeleton();
    this._pruneSubs();
    this._bindDelegate(self);

    // 加载段异常统一出口：原为浮动 Promise（connectedCallback / attributeChangedCallback
    // 均未 catch），三段 await 任一 reject 即 unhandled rejection + 骨架 spinner 永久卡死、
    // 用户零反馈。此处转错误 UI + toast 并早退（过期代际/已卸载则静默丢弃）。
    try {
      await loadTypeConfig(self);
      await loadData(self);
      await loadRepoRoots(self, this._selectedType);
    } catch (e) {
      if (this._guard.stale(gen) || !this.isConnected) return;
      this._showError("_init 加载失败:", e, "syncManager.loadSyncStatusFailed");
      return;
    }

    if (this._guard.stale(gen) || !this.isConnected) return;

    this._renderWithErrorFeedback();
    this._subscribeBus(self);
  }

  /**
   * 视图状态复位（切换整合包 = 全新视图上下文）。
   * 与 `repo:rtype-changed` 分支（复位 _statusFilter/_subtype）同口径——原仅 rtype 切换
   * 复位、instance 切换不复位，两条切换路径处置不对称：A 包的 _dirOpen 展开态与
   * _statusFilter 会串到 B 包（B 包首屏看着「空」或目录莫名展开）。
   * _singleBusy 刻意不清：切包瞬间可能仍有在途单行 op，clear 会让同名 path 二次可点，
   * 反丢重入保护；旧 op 的 finally 自行摘除，其过期结果亦被 _guard 丢弃。
   */
  private _resetViewState(): void {
    this._dirOpen = {};
    this._statusFilter = "all";
    this._subtype = "";
    // delete 而非赋 undefined：`exactOptionalPropertyTypes` 下可选属性不接受显式 undefined
    delete this._forceOpenPaths;
  }

  /**
   * 骨架装配：摘旧 `.sm-list` 的虚拟滚动监听 → 注入骨架 → 列表占位 spinner。
   * ⚠️ ResizeObserver 强引用被观察元素，不显式 disconnect 会吊着已废弃的旧容器
   * （`_init` 可被 instance 变更二次触发）。
   */
  private _setupSkeleton(): void {
    const prevListEl = this.querySelector<HTMLElement>(".sm-list");
    if (prevListEl) cleanupSyncVirtualScroll(prevListEl);
    this.innerHTML = containerHTML();
    const listEl = this.querySelector(".sm-list");
    if (listEl) listEl.innerHTML = loadingHTML();
  }

  /** 清空上一轮 bus 订阅（`_init` 可被 instance 变更二次触发，防重复订阅泄漏） */
  private _pruneSubs(): void {
    if (!this._unsubs) return;
    this._unsubs.forEach((fn) => {
      fn();
    });
    this._unsubs = [];
  }

  /**
   * 一次性容器级事件委托（render 重建 DOM 后无需重绑，消除并发 `_doRender` 双绑竞态）。
   * 并发重入防护：仅首次 `_init` 绑定 click handler，后续 `_init` 仅更新回调引用。
   */
  private _bindDelegate(self: SyncManagerSelf): void {
    if (!this._eventsBound) {
      this._clickHandler = null;
      const unsub = bindDelegatedEvents(self, {
        doRender: () => this._doRender(),
        doPerformOp: (op, path) =>
          performSingleOp(self, op, path, {
            doLoadData: () => loadData(self),
            doRender: () => this._doRender(),
            doEmitStats: () => bus.emit("stats:refresh"),
          }),
      });
      this._eventsBound = true;
      // ⚠️ 不进 _unsubs 桶：_init 顶部会对 _unsubs 全量 unsub（re-init 清理 bus 订阅），
      // click 委托若进桶会在第二次 _init 被连带销毁（_clickHandler=null + _cbRef=undefined），
      // 而 _eventsBound 仍 true → else 分支 if(self._cbRef) 不命中 → 委托永不重绑，
      // 状态页签/目录行/push/pull 点击全死。委托生命周期归 disconnectedCallback 管。
      this._clickUnsub = unsub;
      return;
    }
    // 后续 _init：仅更新 cbRef 中的回调引用，不重复 addEventListener
    if (self._cbRef) {
      self._cbRef.cb = {
        doRender: () => this._doRender(),
        doPerformOp: (op, path) =>
          performSingleOp(self, op, path, {
            doLoadData: () => loadData(self),
            doRender: () => this._doRender(),
            doEmitStats: () => bus.emit("stats:refresh"),
          }),
      };
    }
  }

  /**
   * 错误呈现统一出口（加载失败 / 渲染失败共用）：错误 div 挂 `.sm-list` + error toast。
   * @param context 环形日志上下文前缀
   * @param msgKey i18n 主文案键（渲染失败 sync.renderFailed / 加载失败 syncManager.loadSyncStatusFailed）
   */
  private _showError(context: string, e: unknown, msgKey: SyncErrorMsgKey): void {
    logError("sync-manager", context, e);
    const head = t(msgKey);
    // appendChild + textContent：杜绝「读改写 innerHTML +=」反模式（textContent 天然防注入，无需 esc）
    // 挂到 .sm-list（与 spinner/列表同容器），不挂组件根——脱离 .sm-container 会让错误 div
    // 落在布局/CSS 作用域外，排版异常（containerHTML 已在 _setupSkeleton 注入，.sm-list 此时必存在）
    const errDiv = document.createElement("div");
    errDiv.setAttribute("role", "alert"); // a11y：渲染/加载失败须被屏幕阅读器即时播报（非 polite）
    errDiv.style.padding = "12px";
    errDiv.style.color = "var(--err)";
    errDiv.textContent = `${head}: ${safeErrorMessage(e)}`;
    const listEl = this.querySelector(".sm-list");
    if (listEl) listEl.appendChild(errDiv);
    else this.appendChild(errDiv);
    bus.emit("toast:show", {
      msg: friendlyError(e, head),
      duration: TOAST_MS.long,
      type: "error",
    });
  }

  /** `_doRender` 抛错兜底：错误 div + toast（不让异常冒泡出 `_init`） */
  private _renderWithErrorFeedback(): void {
    try {
      this._doRender();
    } catch (e) {
      this._showError("_render 出错:", e, "sync.renderFailed");
    }
  }

  /** 订阅 bus：`stats:refresh` / `repo:rtype-changed` / `repo:subdir-changed`（unsub 进 `_unsubs` 桶） */
  private _subscribeBus(self: SyncManagerSelf): void {
    const unsub = bus.on("stats:refresh", () => {
      if (!this.isConnected) return;
      const gen = this._guard.current;
      dbg("sync-manager", "stats:refresh 收到");
      loadData(self)
        .then(async () => {
          if (this._guard.stale(gen)) return;
          await loadRepoRoots(self, this._selectedType);
          dbg("sync-manager", "_loadData 完成, items:", this._allItems ? this._allItems.length : 0);
          this._doRender();
        })
        .catch((err) => {
          logWarn("sync-manager", "stats:refresh 重载失败:", err);
        });
    });
    this._unsubs.push(unsub);

    // 全局焦点跟随（ADR-095 后续：sm-tabs 移除，类型切换归 app-nav 下拉）：
    // nav 切类型 → 重载该类型同步数据 + 重渲染；自身点击已不再触发此事件（sm-tab 已删），
    // 但仍保留 rt === _selectedType 防重入守卫（防未来其他发射源）。
    const unsubRtype = bus.on("repo:rtype-changed", (rt: string) => {
      if (!this.isConnected) return;
      if (!rt || rt === this._selectedType) return;
      this._selectedType = rt;
      setLastSelectedType(rt);
      this._statusFilter = "all";
      this._subtype = ""; // 切类型重置子类型选择
      const gen = this._guard.current;
      loadData(self)
        .then(async () => {
          if (this._guard.stale(gen)) return;
          // ADR-269 D3③：_typeConfig 已同步派生自 resource_types.json（loadData 前已就绪），
          // 类型切换无需重载——此处仅刷新仓库根后渲染。
          await loadRepoRoots(self, rt);
          this._doRender();
        })
        .catch((err) => {
          logWarn("sync-manager", "rtype 跟随重载失败:", err);
        });
    });
    this._unsubs.push(unsubRtype);

    // MMD 子目录选择 → 更新 _subtype，重载数据（后端路径限定扫描，与仓库路由同构）
    const unsubSubdir = bus.on("repo:subdir-changed", (subdir: string) => {
      if (!this.isConnected) return;
      const want = subdir || "";
      if (want === this._subtype) return;
      this._subtype = want;
      const gen = this._guard.current;
      loadData(self)
        .then(() => {
          if (this._guard.stale(gen) || !this.isConnected) return;
          this._doRender();
        })
        .catch((err) => {
          logWarn("sync-manager", "subdir 重载失败:", err);
        });
    });
    this._unsubs.push(unsubSubdir);
  }

  /** 渲染统一入口（供 _init 和 stats:refresh 复用） */
  private _doRender(): void {
    const self = this as SyncManagerSelf;
    // render 同步抛（去伪 async），异常由调用方 _renderWithErrorFeedback 统一兜底；
    // 事件由 _init 一次性委托绑定，render 重建 DOM 后无需重绑
    // （原在此 .then 全量重绑，并发 _doRender 会双绑竞态）
    render(self);
  }
}

// 编译期对齐守卫（零运行时成本）：self-type.ts 新增【必选】字段而本类漏实现时，此处 TS 报错。
// 取代「口头记得写 implements SyncManagerSelf」——原生 querySelector 返回类型收窄冲突使 implements 子句不可用，
// 故用结构化断言：类实例剥掉 HTMLElement 原生成员后，必须满足 SyncManagerFields 全量契约。
// 局限：extends 语义对 SyncManagerFields 新增【可选】字段（如 _forceOpenPaths?/dirLevelSync?）的漂移不敏感
//（可选字段缺失不构成 extends 失败），仅防「新增必选且类未声明该键」——可选字段契约变更需人审。
type _SyncSelfAlign =
  Omit<AppSyncManager, keyof HTMLElement> extends Omit<SyncManagerFields, "querySelector">
    ? true
    : never;
const _SYNC_SELF_ALIGN_GUARD: _SyncSelfAlign = true;
void _SYNC_SELF_ALIGN_GUARD;

// 编译期守卫（零运行时成本）：render 必须【同步】返回 void。
// 背景：render 曾误标 async 而函数体零 await，抛出的异常变成 rejected promise 被调用方
// .catch 静默吞掉，令 _renderWithErrorFeedback 的 try/catch 永不触发（错误 div + toast
// 整段死码）。改回 `async render` → 返回 Promise<void>（不 extends void）→ 此处编译失败。
type _RenderSyncGuard = ReturnType<typeof render> extends void ? true : never;
const _RENDER_SYNC_GUARD: _RenderSyncGuard = true;
void _RENDER_SYNC_GUARD;

if (typeof customElements !== "undefined" && !customElements.get("app-sync-manager")) {
  customElements.define("app-sync-manager", AppSyncManager);
}
