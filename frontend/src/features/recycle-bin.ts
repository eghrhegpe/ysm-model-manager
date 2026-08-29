// ===== 回收站管理（类型化版 — ADR-014 P3 features）=====
import { bus } from "../bus.ts";
import { t as _t } from "../core/i18n/t.ts";
import { modalConfirm as _modalConfirm } from "../utils/dom/dialogs/modal.ts";
import { renderDisplayName } from "../utils/dom/display.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { loadResourceRegistry } from "../utils/resource/registry.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp as _getApp } from "../backend/app.ts";
import { useCurrentResourceType } from "./repo-rtype.ts";
import { createLoadGuard, type LoadGuard } from "../utils/async/load-guard.ts";
import { stagger } from "../utils/animation/stagger.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { esc } from "../utils/dom/html.ts";
import { formatBytes } from "../utils/dom/format.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  'recy-item',
  'recy-restore',
  'recy-del',
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

export function isPathInRoot(path: string, root: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return p === r || p.startsWith(r + "/");
}

type ToastFn = (msg: string, duration: number, type: "success" | "error") => void;
type TFn = typeof _t;
type ModalConfirmFn = typeof _modalConfirm;
type GetAppFn = typeof _getApp;
type GetCurrentTypeFn = () => typeof RESOURCE_TYPES[keyof typeof RESOURCE_TYPES];

function renderRecycleListHtml(
  entries: RecycleBinEntry[],
  _getCurrentType: GetCurrentTypeFn,
  esc: (s: string) => string,
  fmtSize: (n: number) => string,
  renderDisplayName: (s: string) => string,
  stagger: (i: number, step: number, max: number) => number,
  t: TFn,
): string {
  return entries
    .map((e, i) => {
      const name = e.Name.replace(/\.(ysm|zip|7z)\.(disabled|ban)$/i, ".$1");
      const size = Number.isFinite(e.Size) ? fmtSize(e.Size as number) : "?";
      return `<div class="recy-item" data-testid="recy-item" style="animation-delay:${stagger(i, 25, 400)}ms;display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:var(--fs-sm)">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);cursor:pointer" title="${t("oldest.clickDetail", { name: esc(e.Path) })}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:var(--fs-xs);color:var(--muted)">${size}</span>
<button class="recy-restore" data-testid="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-xs)">↩️ ${t("recycle.restore")}</button>
<button class="recy-del" data-testid="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--paid);background:transparent;color:var(--paid);cursor:pointer;font-size:var(--fs-xs)">🗑️ ${t("recycle.delete")}</button>
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
    })
    .join("");
}

function setupRecycleActions(
  listEl: HTMLElement,
  opts: {
    RestoreFromRecycle: (p: string, s: string) => Promise<unknown>;
    DeleteFromRecycle: (p: string) => Promise<unknown>;
    getCurrentType: GetCurrentTypeFn;
    loadRecycleBin: () => void;
    t: TFn;
    onShowToast: ToastFn;
  },
): () => void {
  const bindRecycleAction = (
    selector: string,
    opt: {
      confirm?: { title: string; icon: string; message: string; okText: string };
      binding: (path: string) => Promise<unknown>;
      toastKey: string;
    },
  ): void => {
    listEl.querySelectorAll(selector).forEach((btnEl) => {
      const btn = btnEl as HTMLButtonElement;
      btn.onclick = async (): Promise<void> => {
        if (btn.disabled) return;
        if (opt.confirm) {
          const confirmed = await _modalConfirm({ ...opt.confirm, danger: true });
          if (!confirmed) return;
        }
        btn.disabled = true;
        const item = btn.closest(".recy-item");
        if (item) {
          item.classList.add("leaving");
          await new Promise((r) => setTimeout(r, LEAVE_ANIM_MS));
        }
        try {
          await opt.binding(btn.dataset.path || "");
          opts.loadRecycleBin();
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
          opts.onShowToast(opts.t(opt.toastKey), TOAST_ACTION_OK_MS, "success");
        } catch (e) {
          if (item) item.classList.remove("leaving");
          btn.disabled = false;
          opts.onShowToast(`❌ ${friendlyError(e)}`, TOAST_ACTION_ERR_MS, "error");
        }
      };
    });
  };

  bindRecycleAction(".recy-restore", {
    binding: (p) => opts.RestoreFromRecycle(p, ""),
    toastKey: "recycle.restored",
  });
  bindRecycleAction(".recy-del", {
    confirm: { title: opts.t("recycle.deleteTitle"), icon: "🗑️", message: opts.t("recycle.deleteConfirm"), okText: opts.t("recycle.deleteOk") },
    binding: (p) => opts.DeleteFromRecycle(p),
    toastKey: "recycle.deleted",
  });

  return () => {
    listEl.querySelectorAll(".recy-restore, .recy-del").forEach((btnEl) => {
      (btnEl as HTMLButtonElement).onclick = null;
    });
  };
}

function onRecycleRefreshClick(
  loadRecycleBin: () => void,
): () => void {
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
      title: opts.t("recycle.empty"), icon: "♻️",
      message: opts.t("recycle.emptyConfirm"),
      okText: opts.t("recycle.emptyOk"), danger: true,
    });
    if (!confirmed) return;
    opts.setEmptyBusy(true);
    try {
      const { EmptyRecycleBin } = await opts.getApp();
      const n = await EmptyRecycleBin("");
      opts.onShowToast(`♻️ ${opts.t("recycle.cleared", { n })}`, TOAST_EMPTY_OK_MS, "success");
      opts.loadRecycleBin();
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    } catch (e) {
      opts.onShowToast(`❌ ${friendlyError(e)}`, TOAST_EMPTY_ERR_MS, "error");
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

function buildLoadRecycleBin(
  root: ShadowRoot,
  getCurrentType: GetCurrentTypeFn,
  guard: LoadGuard,
  shell: RecycleShell,
  onShowToast: ToastFn,
): () => Promise<void> {
  return async function loadRecycleBin(): Promise<void> {
    const gen = guard.next();
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const { ListRecycleBin, RestoreFromRecycle, DeleteFromRecycle, GetRepoRoot } = await _getApp();
      const currentRoot = await GetRepoRoot(getCurrentType());
      const allEntries = (await ListRecycleBin("")) || [];
      if (guard.stale(gen)) return;
      const entries = (allEntries as RecycleBinEntry[]).filter((e) => e.Path && (currentRoot ? isPathInRoot(e.Path, currentRoot) : true));
      if (!entries.length) {
        if (shell.cleanupActions.current) { shell.cleanupActions.current(); shell.cleanupActions.current = null; }
        list.innerHTML = "";
        if (count) count.textContent = "空";
        return;
      }
      const reg = await loadResourceRegistry();
      if (guard.stale(gen)) return;
      const icon = (reg[getCurrentType()] && reg[getCurrentType()].icon) || "📦";
      if (count) count.textContent = icon + " " + entries.length + " 个文件";
      list.innerHTML = renderRecycleListHtml(entries, getCurrentType, esc, formatBytes, renderDisplayName, stagger, _t);
      if (shell.cleanupActions.current) shell.cleanupActions.current();
      shell.cleanupActions.current = setupRecycleActions(list, {
        RestoreFromRecycle, DeleteFromRecycle, getCurrentType,
        loadRecycleBin: shell.loadRecycleBin, t: _t, onShowToast,
      });
    } catch (e) {
      if (guard.stale(gen)) return;
      if (shell.cleanupActions.current) { shell.cleanupActions.current(); shell.cleanupActions.current = null; }
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:var(--paid);font-size:11px">❌ ${esc(friendlyError(e, _t("recycle.loadFailed")))}</div>`;
      if (count) count.textContent = _t("common.loadFailed");
    }
  };
}

export function initRecycleBin(app: RecycleHost): () => void {
  const root = app._root;
  let _emptyBusy = false;
  const getEmptyBusy = () => _emptyBusy;
  const setEmptyBusy = (b: boolean) => { _emptyBusy = b; };
  const onShowToast: ToastFn = (msg, duration, type) => { bus.emit("toast:show", { msg, duration, type }); };

  const shell: RecycleShell = { loadRecycleBin: () => {}, cleanupActions: { current: null } };
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => shell.loadRecycleBin());
  const guard = createLoadGuard();

  const listEl = root.getElementById("recy-list");
  if (listEl) listEl.addEventListener("click", onRecycleListClick);

  shell.loadRecycleBin = buildLoadRecycleBin(root, getCurrentType, guard, shell, onShowToast);

  const onRefreshClick = onRecycleRefreshClick(() => shell.loadRecycleBin());
  root.getElementById("recy-refresh")?.addEventListener("click", onRefreshClick);

  const onEmptyClick = onRecycleEmptyClick({
    getEmptyBusy, setEmptyBusy, getApp: _getApp,
    loadRecycleBin: () => shell.loadRecycleBin(),
    onShowToast, modalConfirm: _modalConfirm, t: _t,
  });
  root.getElementById("recy-empty")?.addEventListener("click", onEmptyClick);

  shell.loadRecycleBin();

  return () => {
    guard.invalidate();
    cleanupRtype();
    if (shell.cleanupActions.current) shell.cleanupActions.current();
    if (listEl) listEl.removeEventListener("click", onRecycleListClick);
    root.getElementById("recy-refresh")?.removeEventListener("click", onRefreshClick);
    root.getElementById("recy-empty")?.removeEventListener("click", onEmptyClick);
    if (listEl) listEl.innerHTML = "";
  };
}
