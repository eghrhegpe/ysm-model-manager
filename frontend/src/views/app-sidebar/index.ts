// ===== <app-sidebar> 入口 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { refreshAdoptedStyleSheets } from "../../utils/dom/css-hmr.ts";
import { RESOURCE_TYPE_LABELS, ALL_RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { currentRepoType } from "../../features/repo-rtype.ts";
import { sidebarCSS } from "./sidebar-css.ts";
// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）。
// 环境守卫对齐 ui-components-styles.ts：node/happy-dom 无 CSSStyleSheet 时返回
// 占位对象（replaceSync no-op）避免 import 即崩；浏览器恒走真实分支。
const appSidebarStyle: CSSStyleSheet = (() => {
  if (typeof CSSStyleSheet === "undefined") {
    return { replaceSync: () => {} } as unknown as CSSStyleSheet;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(sidebarCSS);
  return sheet;
})();
export { appSidebarStyle };
import { headerHTML, footerHTML, listContainerHTML } from "./tpl.ts";
import { renderVersionCards } from "./render.ts";
import { bindCardEvents, bindFooter, resetSelectedEmit } from "./events.ts";
import { bindPackCardDnD } from "../../features/pack-dnd.ts";
import { get } from "../../services/registry.ts";
import type { loadInstances } from "./loader.ts";
import type { SidebarInstance } from "./data.ts";
import { getApp } from "../../backend/app.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { t } from "../../core/i18n/t.ts";

// 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰
const _checkedSets = new Map<string, Set<string>>();
function checkedSetFor(rtype: string): Set<string> {
  let s = _checkedSets.get(rtype);
  if (!s) {
    s = new Set<string>();
    _checkedSets.set(rtype, s);
  }
  return s;
}

/** 推送等待/兜底超时（陷阱 #3：任何 await 必须有兜底，按钮才不会永久卡死） */
const SYNC_TIMEOUT_MS = 30_000;

// ---------- bindSelectAll ----------
function bindSelectAll(root: ShadowRoot, rtype: string, instances: SidebarInstance[]): void {
  const cb = root.getElementById("sb-select-all") as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener("change", () => {
    const checked = cb.checked;
    const set = checkedSetFor(rtype);
    root.querySelectorAll(".chk").forEach((c) => {
      const input = c as HTMLInputElement;
      input.checked = checked;
      const idx = parseInt(input.dataset.idx || "", 10);
      if (!isNaN(idx) && instances[idx]) {
        if (checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      }
    });
  });
}

// ---------- restoreCheckboxes ----------
function restoreCheckboxes(root: ShadowRoot, rtype: string, instances: SidebarInstance[]): void {
  const set = checkedSetFor(rtype);
  root.querySelectorAll(".chk").forEach((c) => {
    const input = c as HTMLInputElement;
    const idx = parseInt(input.dataset.idx || "", 10);
    if (!isNaN(idx) && instances[idx]) {
      input.checked = set.has(instances[idx].name);
      input.addEventListener("change", () => {
        if (input.checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      });
    }
  });
}

// ---------- renderCards ----------
function renderCards(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  cardCleanup: (() => void) | null,
): { cardCleanup: (() => void) | null } {
  const container = root.getElementById("sidebar-instance-list");
  if (!container) return { cardCleanup };
  renderVersionCards(container, instances);
  if (cardCleanup) {
    cardCleanup();
    cardCleanup = null;
  }
  cardCleanup = bindCardEvents(root, instances);
  restoreCheckboxes(root, rtype, instances);
  return { cardCleanup };
}

// ---------- closeAllMenus ----------
function closeAllMenus(pushMenu: HTMLElement, pullMenu: HTMLElement): void {
  pushMenu.style.display = "none";
  pullMenu.style.display = "none";
}

// ---------- getSelected ----------
function getSelected(root: ShadowRoot, instances: SidebarInstance[]): string[] {
  const sel: string[] = [];
  root.querySelectorAll(".chk:checked").forEach((c) => {
    const input = c as HTMLInputElement;
    const idx = parseInt(input.dataset.idx || "", 10);
    if (!isNaN(idx) && instances[idx])
      sel.push(instances[idx].name);
  });
  return sel;
}

// ---------- resolveTypes ----------
function resolveTypes(rt: string): string[] {
  return rt === "all" ? ALL_RESOURCE_TYPES : [rt];
}

// ---------- beginSync ----------
// push/pull 前置守卫共用的入闸流程（取 selected → 判空 toast → 置 inprogress → 关菜单 → 按钮 loading）
function beginSync(
  e: Event,
  verb: string,
  root: ShadowRoot,
  instances: SidebarInstance[],
  syncInProgress: { val: boolean },
  closeAll: () => void,
  btn: HTMLButtonElement,
): string[] | null {
  const target = e.target as HTMLElement | null;
  const item = target ? target.closest(".dd-item") : null;
  if (!item) return null;
  const selected = getSelected(root, instances);
  if (!selected.length) {
    bus.emit("toast:show", { msg: t("sidebar.selectPackFirst", { verb }), duration: TOAST_MS.success, type: "info" });
    return null;
  }
  if (syncInProgress.val) return null;
  syncInProgress.val = true;
  closeAll();
  btn.textContent = "⏳";
  btn.disabled = true;
  return selected;
}

function bindToggleMenu(
  btn: HTMLButtonElement,
  menu: HTMLElement,
  onToggle: () => void,
): void {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.style.display === "block";
    onToggle();
    if (!wasOpen) menu.style.display = "block";
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
}

// ---------- handlePushMenuClick ----------
function handlePushMenuClick(
  e: Event,
  pushBtn: HTMLButtonElement,
  pushMenu: HTMLElement,
  pullMenu: HTMLElement,
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  syncInProgress: { val: boolean },
): void {
  const selected = beginSync(e, t("sidebar.verbPush"), root, getInstances(), syncInProgress, () => closeAllMenus(pushMenu, pullMenu), pushBtn);
  if (!selected) return;
  const types = resolveTypes((e.target as HTMLElement)?.closest<HTMLElement>(".dd-item")?.dataset.syncType || "all");
  void runPush(selected, types, pushBtn, syncInProgress);
}

/** 单品推送：等待该 token 的下载完成事件；命中 skipped / 超时分别 reject 带 kind */
async function pushOne(insName: string, rt: string): Promise<void> {
  const token = `${insName}:${rt}:${Date.now()}`;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = bus.on("sync:download:done", (payload) => {
      if (payload?.token !== token) return;
      unsub();
      if (timer) clearTimeout(timer);
      if (payload.skipped) {
        reject(kindError(`推送被跳过（已有同步进行中）: ${insName}/${rt}`, "skipped"));
      } else {
        resolve();
      }
    });
    timer = setTimeout(() => {
      unsub();
      reject(kindError(`推送超时: ${insName}/${rt}`, "timeout"));
    }, SYNC_TIMEOUT_MS);
    bus.emit("sync:download:missing", { instanceName: insName, rtype: rt, token });
  });
}

/** 等待当前同步活动归位（最后一次非 skipped done 后 resolve），防后续推送竞态 */
async function waitBusQuiet(): Promise<void> {
  await new Promise<void>((resolve) => {
    const waitUnsub = bus.on("sync:download:done", (p) => {
      if (p?.skipped) return;
      waitUnsub();
      resolve();
    });
    setTimeout(() => {
      waitUnsub();
      resolve();
    }, SYNC_TIMEOUT_MS);
  });
}

function kindError(msg: string, kind: "skipped" | "timeout"): Error {
  const err = new Error(msg) as Error & { kind?: "skipped" | "timeout" };
  err.kind = kind;
  return err;
}

function pushErrorKind(e: unknown): "skipped" | "timeout" | undefined {
  return (e as Error & { kind?: "skipped" | "timeout" })?.kind;
}

/** 推送主流程：顺序逐包逐类型推送，跳过的按类型计数 → 汇总 toast + 按钮复位统一收口 */
async function runPush(
  selected: string[],
  types: string[],
  pushBtn: HTMLButtonElement,
  syncInProgress: { val: boolean },
): Promise<void> {
  let skipped = 0;
  let timedOut = 0;
  try {
    for (const insName of selected) {
      for (const rt of types) {
        try {
          await pushOne(insName, rt);
        } catch (e) {
          const kind = pushErrorKind(e);
          if (kind === "skipped") skipped++;
          else timedOut++;
          if (kind !== "skipped") await waitBusQuiet();
        }
      }
    }
    if (skipped > 0 || timedOut > 0) {
      const parts: string[] = [];
      if (skipped > 0) parts.push(t("sidebar.packSkipped", { n: skipped }));
      if (timedOut > 0) parts.push(t("sidebar.packTimedOut", { n: timedOut }));
      bus.emit("toast:show", { msg: t("sidebar.pushDone", { detail: parts.join("，") }), duration: TOAST_MS.normal, type: "warn" });
    } else {
      bus.emit("toast:show", { msg: t("sidebar.pushDoneAll", { n: selected.length }), duration: TOAST_MS.info });
    }
  } catch (err) {
    bus.emit("toast:show", { msg: t("sidebar.pushFailed", { msg: safeErrorMessage(err) }), duration: TOAST_MS.normal, type: "error" });
  } finally {
    pushBtn.textContent = "⬆️ " + t("sidebar.pushSelected") + " ▾";
    pushBtn.disabled = false;
    syncInProgress.val = false;
  }
}

// ---------- handlePullMenuClick ----------
function handlePullMenuClick(
  e: Event,
  pullBtn: HTMLButtonElement,
  pushMenu: HTMLElement,
  pullMenu: HTMLElement,
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  syncInProgress: { val: boolean },
): void {
  const selected = beginSync(e, t("sidebar.verbPull"), root, getInstances(), syncInProgress, () => closeAllMenus(pushMenu, pullMenu), pullBtn);
  if (!selected) return;
  const types = resolveTypes((e.target as HTMLElement)?.closest<HTMLElement>(".dd-item")?.dataset.syncType || "all");
  void runPull(selected, types, pullBtn, syncInProgress);
}

/** 拉取主流程：并行拉取各类型资源，计数成功/失败 → 汇总 toast + 刷新统计与树 */
async function runPull(
  selected: string[],
  types: string[],
  pullBtn: HTMLButtonElement,
  syncInProgress: { val: boolean },
): Promise<void> {
  let totalPulled = 0;
  let failed = 0;
  try {
    const { PullResourceFromInstance } = await getApp();
    for (const insName of selected) {
      const results = await Promise.allSettled(
        types.map((rt) => PullResourceFromInstance(rt, insName)),
      );
      for (const r of results) {
        if (r.status === "fulfilled") totalPulled += r.value;
        else failed++;
      }
    }
    if (failed > 0) {
      bus.emit("toast:show", { msg: t("sidebar.pullDone", { pulled: totalPulled, failed }), duration: TOAST_MS.normal, type: "warn" });
    } else if (totalPulled > 0) {
      bus.emit("toast:show", { msg: t("sidebar.pullDoneAll", { n: totalPulled }), duration: TOAST_MS.info });
    } else {
      bus.emit("toast:show", { msg: t("sidebar.pullNothing"), duration: TOAST_MS.info, type: "info" });
    }
    bus.emit("stats:refresh");
    bus.emit("tree:reload");
  } catch (err) {
    bus.emit("toast:show", { msg: t("sidebar.pullFailed", { msg: safeErrorMessage(err) }), duration: TOAST_MS.normal, type: "error" });
  } finally {
    pullBtn.textContent = "⬇️ " + t("sidebar.pullSelected") + " ▾";
    pullBtn.disabled = false;
    syncInProgress.val = false;
  }
}

// ---------- bindSyncSelected 主装配 ----------
function bindSyncSelected(
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  _getCardCleanup: () => (() => void) | null,
  _setCardCleanup: (fn: (() => void) | null) => void,
  getDocClickHandler: () => (() => void) | null,
  setDocClickHandler: (fn: (() => void) | null) => void,
  getSyncInProgress: () => boolean,
  setSyncInProgress: (v: boolean) => void,
): void {
  const pushBtn = root.querySelector(".sidebar-push-selected") as HTMLButtonElement | null;
  const pushMenu = root.getElementById("sidebar-push-menu") as HTMLElement | null;
  const pullBtn = root.querySelector(".sidebar-pull-selected") as HTMLButtonElement | null;
  const pullMenu = root.getElementById("sidebar-pull-menu") as HTMLElement | null;
  if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

  const closeAll = () => closeAllMenus(pushMenu, pullMenu);

  bindToggleMenu(pushBtn, pushMenu, closeAll);
  bindToggleMenu(pullBtn, pullMenu, closeAll);

  const prevHandler = getDocClickHandler();
  if (prevHandler) {
    document.removeEventListener("click", prevHandler);
  }
  setDocClickHandler(() => closeAll());
  document.addEventListener("click", getDocClickHandler()!);

  pushMenu.addEventListener("click", (e) => handlePushMenuClick(e, pushBtn, pushMenu, pullMenu, root, getInstances, { get val() { return getSyncInProgress(); }, set val(v) { setSyncInProgress(v); } }));
  pullMenu.addEventListener("click", (e) => handlePullMenuClick(e, pullBtn, pushMenu, pullMenu, root, getInstances, { get val() { return getSyncInProgress(); }, set val(v) { setSyncInProgress(v); } }));
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

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [appSidebarStyle];
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
        btn.textContent = "⬇️ " + t("sidebar.installAll") + (RESOURCE_TYPE_LABELS[this._rtype] || t("format.resources"));
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
    bindSelectAll(this._root, this._rtype, this._instances);
  }

  private _bindSyncSelected(): void {
    bindSyncSelected(
      this._root,
      () => this._instances,
      () => this._cardCleanup,
      (fn) => { this._cardCleanup = fn; },
      () => this._docClickHandler,
      (fn) => { this._docClickHandler = fn; },
      () => this._syncInProgress,
      (v) => { this._syncInProgress = v; },
    );
  }

  private _renderCards(): void {
    const { cardCleanup } = renderCards(this._root, this._rtype, this._instances, this._cardCleanup);
    this._cardCleanup = cardCleanup;
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
      const instances = await get<typeof loadInstances>("loadInstances")(this._rtype, force ? { force: true } : undefined);
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
    this._unsubs.forEach((fn) => fn());
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
    resetSelectedEmit();
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
import.meta.hot?.accept("./sidebar-css.ts", (newCssMod) => {
  refreshAdoptedStyleSheets(newCssMod?.sidebarCSS, "app-sidebar");
});
