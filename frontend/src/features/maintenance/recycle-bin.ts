// ===== 回收站管理（类型化版 — ADR-014 P3 features）=====
// 依赖注入（ADR-190 D2）：getApp / t / modalConfirm 经 initRecycleBin 的 deps 参数显式透传，
// 测试可直接注入替身，无需 vi.mock 整个模块；缺省走生产实现。
// ADR-208 D1（R5 门禁）：生产默认 getApp 经 backend-deps seam 单出口（禁止直引 backend/app.ts）。

import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { useCurrentResourceType } from "@/features/repo/repo-rtype.ts";
import { createLoadGuard, type LoadGuard } from "@/utils/async/load-guard.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { msgRowHTML } from "@/utils/dom/status-row.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { escUnknown as esc } from "@/utils/html/html.ts";
import { UI_ICONS, type UiIconName } from "@/utils/icon/ui-icons.ts";
import { type RESOURCE_TYPES, typeIconOf } from "@/utils/resource/types.ts";
import { maintenanceGetApp } from "./maintenance-deps.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
// `recy-list`（列表容器）由 views/app-content/tpl-recycle.ts 的 recycleHTML 产出，
// 2026-09-25 为 e2e 补：原 spec 用 #recy-list id 定位，被 e2e 定位通道门禁判 MISSING
// （id 属运行期可变锚点）——族内声明仍归此处，保持 recy-* 单一注册点。
export const VIEW_TESTIDS: readonly string[] = [
  "recy-item",
  "recy-restore",
  "recy-del",
  "recy-list",
  // 2026-10-04 补钩债务清账：刷新/清空按钮原只有 id，recycle-bin.spec 可见性用例走
  // #id 落 REVIEW 债——同名 testid 补上，e2e 迁 testid 通道。
  "recy-refresh",
  "recy-empty",
];

const LEAVE_ANIM_MS = 150;
const TOAST_ACTION_OK_MS = TOAST_MS.success;
const TOAST_ACTION_ERR_MS = TOAST_MS.normal;
const TOAST_EMPTY_OK_MS = TOAST_MS.normal;
const TOAST_EMPTY_ERR_MS = TOAST_MS.long;

export interface RecycleHost {
  _root: ShadowRoot;
}

interface RecycleBinEntry {
  Name: string;
  Path: string;
  Size: number | unknown;
}

export type { RecycleBinEntry };

type ToastFn = (msg: string, duration: number, type: "success" | "error") => void;
type TFn = typeof t;
type ModalConfirmFn = typeof modalConfirm;
type GetAppFn = typeof maintenanceGetApp;
type GetCurrentTypeFn = () => (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];

/** 可注入依赖（ADR-190 D2 注入真化）；测试传部分字段，其余回落生产实现 */
export interface RecycleDeps {
  getApp: GetAppFn;
  t: TFn;
  modalConfirm: ModalConfirmFn;
  /** 列表条目 HTML 渲染（ADR-190 D1a：DOM 模板归 views，由组合根注入，features 不自渲染） */
  renderListHtml: (entries: RecycleBinEntry[]) => string;
}
const PROD_DEPS: RecycleDeps = {
  getApp: maintenanceGetApp,
  t,
  modalConfirm,
  // fail-loud：渲染属 views 职责，features 无合法默认实现；漏注入立即暴露而非静默空列表
  renderListHtml: () => {
    throw new Error(
      "RecycleDeps.renderListHtml 未注入（应由 views 组合根提供，见 tpl-recycle.ts）",
    );
  },
};
function resolveDeps(overrides?: Partial<RecycleDeps>): RecycleDeps {
  return { ...PROD_DEPS, ...overrides };
}
function setupRecycleActions(
  listEl: HTMLElement,
  guard: LoadGuard,
  opts: {
    RestoreFromRecycle: (p: string) => Promise<unknown>;
    DeleteFromRecycle: (p: string) => Promise<unknown>;
    getCurrentType: GetCurrentTypeFn;
    loadRecycleBin: () => void;
    t: TFn;
    modalConfirm: ModalConfirmFn;
    onShowToast: ToastFn;
  },
): () => void {
  const bindRecycleAction = (
    selector: string,
    opt: {
      confirm?: {
        title: string;
        titleIcon: UiIconName;
        message: string;
        okText: string;
        okIcon?: UiIconName;
      };
      binding: (path: string) => Promise<unknown>;
      toastKey: LocaleKey;
    },
  ): void => {
    listEl.querySelectorAll(selector).forEach((btnEl) => {
      const btn = btnEl as HTMLButtonElement;
      btn.onclick = async (): Promise<void> => {
        if (btn.disabled) return;
        // 本次操作自成一"代"：组件 cleanup（guard.invalidate）后，任何 await 返回即失效，
        // 杜绝幽灵 toast / bus 副作用 / 对已脱离 DOM 的按钮恢复状态
        const opGen = guard.next();
        if (opt.confirm) {
          const confirmed = await opts.modalConfirm({ ...opt.confirm, danger: true });
          if (!confirmed || guard.stale(opGen)) return;
        }
        btn.disabled = true;
        const item = btn.closest(".recy-item");
        if (item) {
          item.classList.add("leaving");
          await new Promise((r) => setTimeout(r, LEAVE_ANIM_MS));
        }
        try {
          await opt.binding(btn.dataset.path || "");
          if (guard.stale(opGen)) return;
          opts.loadRecycleBin();
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
          opts.onShowToast(opts.t(opt.toastKey), TOAST_ACTION_OK_MS, "success");
        } catch (e) {
          if (guard.stale(opGen)) return;
          if (item) item.classList.remove("leaving");
          btn.disabled = false;
          opts.onShowToast(friendlyError(e), TOAST_ACTION_ERR_MS, "error");
        }
      };
    });
  };

  bindRecycleAction(".recy-restore", {
    // filesRoot 兜底根由 loadRecycleBin 闭包传入当前类型真实根（对接锐评③：
    // 原恒传空串让 Go 端 fallback 沦为 CWD 相对 ".recycle" 的死救援分支）
    binding: (p) => opts.RestoreFromRecycle(p),
    toastKey: "recycle.restored",
  });
  bindRecycleAction(".recy-del", {
    confirm: {
      title: opts.t("recycle.deleteTitle"),
      titleIcon: "delete",
      message: opts.t("recycle.deleteConfirm"),
      okText: opts.t("recycle.deleteOk"),
      okIcon: "delete",
    },
    binding: (p) => opts.DeleteFromRecycle(p),
    toastKey: "recycle.deleted",
  });

  return () => {
    listEl.querySelectorAll(".recy-restore, .recy-del").forEach((btnEl) => {
      (btnEl as HTMLButtonElement).onclick = null;
    });
  };
}

function onRecycleRefreshClick(loadRecycleBin: () => void): () => void {
  return (): void => {
    loadRecycleBin();
  };
}

function onRecycleEmptyClick(opts: {
  getEmptyBusy: () => boolean;
  setEmptyBusy: (b: boolean) => void;
  getApp: GetAppFn;
  loadRecycleBin: () => void;
  onShowToast: ToastFn;
  modalConfirm: ModalConfirmFn;
  t: TFn;
}): () => Promise<void> {
  return async (): Promise<void> => {
    if (opts.getEmptyBusy()) return;
    const confirmed = await opts.modalConfirm({
      title: opts.t("recycle.empty"),
      titleIcon: "recycle",
      message: opts.t("recycle.emptyConfirm"),
      okText: opts.t("recycle.emptyOk"),
      okIcon: "recycle",
      danger: true,
    });
    if (!confirmed) return;
    opts.setEmptyBusy(true);
    try {
      const { EmptyRecycleBin } = await opts.getApp();
      const n = Number(await EmptyRecycleBin()) || 0; // 旧桥可能返回 undefined，兜底防「undefined 个文件」
      opts.onShowToast(opts.t("recycle.cleared", { n }), TOAST_EMPTY_OK_MS, "success");
      opts.loadRecycleBin();
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    } catch (e) {
      opts.onShowToast(friendlyError(e), TOAST_EMPTY_ERR_MS, "error");
    } finally {
      opts.setEmptyBusy(false);
    }
  };
}

function onRecycleListClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest(".recy-restore") || target.closest(".recy-del")) return;
  const el = target.closest("[data-path]");
  if (el) {
    const path = el.getAttribute("data-path");
    if (path) bus.emit("model:select", { path });
  }
}

interface RecycleShell {
  loadRecycleBin: () => void;
  cleanupActions: { current: (() => void) | null };
}

/** 清理解除上一次的回收站条目按钮绑定（置空 current） */
function clearCleanup(shell: RecycleShell): void {
  if (shell.cleanupActions.current) {
    shell.cleanupActions.current();
    shell.cleanupActions.current = null;
  }
}

/** 空列表渲染 */
function renderEmptyRecycleList(list: HTMLElement, count: HTMLElement | null, t: TFn): void {
  list.innerHTML = "";
  if (count) count.textContent = t("recycle.emptyState");
}

/** 读取失败：错误行渲染（含 UI_ICONS.error / esc / friendlyError 兜底文案） */
function renderRecycleError(
  list: HTMLElement,
  count: HTMLElement | null,
  e: unknown,
  t: TFn,
): void {
  // ADR-332 D1：复用跨域状态行外壳，消除手写行内样式将就（且修正 .stat-row 基类
  // space-between 把图标/文案推到两端的视觉缺陷——diag-msg 族自带 flex-start + gap）。
  // 友好错误文案可能含 Go 透传文本，过 esc 单点转义（原 textContent 亦转义等效）。
  list.innerHTML = msgRowHTML("error", friendlyError(e, t("recycle.loadFailed")), esc, {
    icon: UI_ICONS.error,
  });
  if (count) count.textContent = t("common.loadFailed");
}

function buildLoadRecycleBin(
  root: ShadowRoot,
  loadCtx: { getCurrentType: GetCurrentTypeFn; guard: LoadGuard; onScanned?: () => void },
  shell: RecycleShell,
  onShowToast: ToastFn,
  deps: RecycleDeps,
): () => Promise<void> {
  const { getCurrentType, guard, onScanned } = loadCtx;
  const { getApp, t } = deps;
  return async function loadRecycleBin(): Promise<void> {
    const gen = guard.next();
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const { ListRecycleBin, RestoreFromRecycle, DeleteFromRecycle, GetRepoRoot } = await getApp();
      const currentRoot = await GetRepoRoot(getCurrentType());
      // 作用域交由 Go 端过滤（ListRecycleBin 的 recyclePath 参数），前端不再自建路径前缀匹配
      const allEntries = (await ListRecycleBin(currentRoot || "")) || [];
      if (guard.stale(gen)) return;
      // 记账点：结果确实上屏（成功与空列表都是「已呈现该类型的列表」）才记，
      // 供 onShow 判定「面板里的结果是否属于当前类型」
      onScanned?.();
      const entries = (allEntries as RecycleBinEntry[]).filter((e) => e.Path);
      if (!entries.length) {
        clearCleanup(shell);
        renderEmptyRecycleList(list, count, t);
        return;
      }
      // ADR-269 D3④：图标同步派生自 resource_types.json（typeIconOf），废 Go RPC 旁路
      const icon = typeIconOf(getCurrentType());
      if (count) count.textContent = `${icon} ${t("recycle.fileCount", { n: entries.length })}`;
      list.innerHTML = deps.renderListHtml(entries);
      if (shell.cleanupActions.current) shell.cleanupActions.current();
      shell.cleanupActions.current = setupRecycleActions(list, guard, {
        // 传当前类型真实根作为 Go 端兜底恢复根（列表按该根作用域过滤，条目与根相关）
        RestoreFromRecycle: (p) => RestoreFromRecycle(p, currentRoot),
        DeleteFromRecycle,
        getCurrentType,
        loadRecycleBin: shell.loadRecycleBin,
        t,
        modalConfirm: deps.modalConfirm,
        onShowToast,
      });
    } catch (e) {
      if (guard.stale(gen)) return;
      clearCleanup(shell);
      renderRecycleError(list, count, e, t);
    }
  };
}

/** initRecycleBin 返回值（bindTabs 懒初始化双形态契约）。
 *  cleanup 卸载清理；onShow 每次激活副作用——补渲染隐藏期间被脏账记账跳过的类型切换。
 *  ⚠️ 兼容旧契约：返回体本身即 cleanup（既有调用点/测试直接当函数调用），
 *  故用 Object.assign 把两个字段挂到函数上，解构与直调两种消费形态并存。 */
export type RecycleBinHandle = (() => void) & {
  cleanup: () => void;
  onShow: () => void;
};

export function initRecycleBin(
  app: RecycleHost,
  depsOverrides?: Partial<RecycleDeps>,
  container?: HTMLElement,
): RecycleBinHandle {
  const deps = resolveDeps(depsOverrides);
  const root = app._root;
  let _emptyBusy = false;
  const getEmptyBusy = () => _emptyBusy;
  const setEmptyBusy = (b: boolean) => {
    _emptyBusy = b;
  };
  const onShowToast: ToastFn = (msg, duration, type) => {
    toast(msg, duration, type);
  };

  const shell: RecycleShell = { loadRecycleBin: () => {}, cleanupActions: { current: null } };
  // 感知性绑定（锐评 2026-10-13 P1-2）：面板隐藏时不跑 Go RPC——列表作用域绑当前类型
  // （ListRecycleBin(currentRoot)），隐藏时刷新的结果写进用户没看的面板；且 guard 世代被
  // 占用后，用户切进来看到的不是自己触发的那次结果。与 dedup/oldest 同款原语对齐，
  // 三类随类型联动的面板此前只有本面板缺守卫（两种心智模型）。
  let dirty = false;
  let lastScannedType: string | null = null;
  // 面板可见性：container 由 init-pages 传入（tab-body 本体）。缺省（测试直调、
  // 旧调用点）时视为可见——守卫只应在能确知隐藏时生效，不得把首屏加载也拦掉。
  const isPanelHidden = (): boolean => container?.hidden === true;
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => {
    if (isPanelHidden()) {
      dirty = true;
      return;
    }
    shell.loadRecycleBin();
  });
  const guard = createLoadGuard();

  const listEl = root.getElementById("recy-list");
  if (listEl) listEl.addEventListener("click", onRecycleListClick);

  shell.loadRecycleBin = buildLoadRecycleBin(
    root,
    {
      getCurrentType,
      guard,
      onScanned: () => {
        lastScannedType = getCurrentType();
      },
    },
    shell,
    onShowToast,
    deps,
  );

  const onRefreshClick = onRecycleRefreshClick(() => shell.loadRecycleBin());
  root.getElementById("recy-refresh")?.addEventListener("click", onRefreshClick);

  const onEmptyClick = onRecycleEmptyClick({
    getEmptyBusy,
    setEmptyBusy,
    getApp: deps.getApp,
    loadRecycleBin: () => shell.loadRecycleBin(),
    onShowToast,
    modalConfirm: deps.modalConfirm,
    t: deps.t,
  });
  root.getElementById("recy-empty")?.addEventListener("click", onEmptyClick);

  shell.loadRecycleBin();

  // 每次激活面板时的补扫校验（bindTabs showFns 落位，激活是重复事件）：
  // 面板里显示的列表必须属于当前类型。从未扫过（lastScannedType null）不自动开跑
  // ——维持「进入面板自动加载一次」的现状语义，只消除「隐藏时切了类型、
  // 切进来看到旧类型残留列表」的误导（与 dedup tab 同款口径）。
  const onShow = (): void => {
    if (!dirty) return;
    dirty = false;
    if (lastScannedType !== null && getCurrentType() !== lastScannedType) shell.loadRecycleBin();
  };

  const cleanup = (): void => {
    guard.invalidate();
    cleanupRtype();
    if (shell.cleanupActions.current) shell.cleanupActions.current();
    if (listEl) listEl.removeEventListener("click", onRecycleListClick);
    root.getElementById("recy-refresh")?.removeEventListener("click", onRefreshClick);
    root.getElementById("recy-empty")?.removeEventListener("click", onEmptyClick);
    if (listEl) listEl.innerHTML = "";
  };
  // 兼容两种消费形态：直接当清理函数调用（旧契约，测试与既有调用点），
  // 或解构取 onShow（tabs-runtime 的 showFns 通道）。函数本身即 cleanup。
  return Object.assign(cleanup, { cleanup, onShow });
}
