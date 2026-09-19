// ===== app-sidebar 同步流程层 =====
// 从 index.ts 拆出（P1-3）：勾选状态管理 + push/pull 同步执行链。
// index.ts 保留 Web Component 生命周期与渲染编排；本文件收敛「勾选 → 菜单 → 同步」全链。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { SidebarInstance } from "./data.ts";

// 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰
// 通过 getter 注入实例属性，生命周期随组件（见 sync.test.ts）
function checkedSetFor(rtype: string, getCheckedSets: () => Map<string, Set<string>>): Set<string> {
  const checkedSets = getCheckedSets();
  let s = checkedSets.get(rtype);
  if (!s) {
    s = new Set<string>();
    checkedSets.set(rtype, s);
  }
  return s;
}

/** 推送等待/兜底超时（陷阱 #3：任何 await 必须有兜底，按钮才不会永久卡死） */
const SYNC_TIMEOUT_MS = 30_000;

// ---------- bindSelectAll ----------
export function bindSelectAll(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const cb = root.getElementById("sb-select-all") as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener("change", () => {
    const checked = cb.checked;
    const set = checkedSetFor(rtype, getCheckedSets);
    root.querySelectorAll(".chk").forEach((c) => {
      const input = c as HTMLInputElement;
      input.checked = checked;
      const idx = parseInt(input.dataset.idx || "", 10);
      if (!Number.isNaN(idx) && instances[idx]) {
        if (checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      }
    });
  });
}

// ---------- restoreCheckboxes ----------
export function restoreCheckboxes(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const set = checkedSetFor(rtype, getCheckedSets);
  // 恢复勾选状态（从实例属性 checkedSets 读取，支持跨重新挂载恢复）
  root.querySelectorAll(".chk").forEach((c) => {
    const input = c as HTMLInputElement;
    const idx = parseInt(input.dataset.idx || "", 10);
    if (!Number.isNaN(idx) && instances[idx]) {
      input.checked = set.has(instances[idx].name);
      input.addEventListener("change", () => {
        if (input.checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      });
    }
  });
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
    if (!Number.isNaN(idx) && instances[idx]) sel.push(instances[idx].name);
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
    bus.emit("toast:show", {
      msg: t("sidebar.selectPackFirst", { verb }),
      duration: TOAST_MS.success,
      type: "info",
    });
    return null;
  }
  if (syncInProgress.val) return null;
  syncInProgress.val = true;
  closeAll();
  btn.innerHTML = UI_ICONS.refresh;
  btn.disabled = true;
  return selected;
}

function bindToggleMenu(btn: HTMLButtonElement, menu: HTMLElement, onToggle: () => void): void {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.style.display === "block";
    onToggle();
    if (!wasOpen) menu.style.display = "block";
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
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

// ---------- 公共类型 / 工具 ----------

type SyncVerb = "push" | "pull";

/** 按钮复位（push/pull finally 块共用） */
function resetButton(btn: HTMLButtonElement, verb: SyncVerb): void {
  const icon = verb === "push" ? UI_ICONS.upload : UI_ICONS.download;
  const key = verb === "push" ? "sidebar.pushSelected" : "sidebar.pullSelected";
  btn.innerHTML = `${icon} ${t(key)} ▾`;
  btn.disabled = false;
}

// ---------- handleSyncMenuClick（push/handler 合并） ----------

function handleSyncMenuClick(
  verb: SyncVerb,
  e: Event,
  btn: HTMLButtonElement,
  pushMenu: HTMLElement,
  pullMenu: HTMLElement,
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  syncInProgress: { val: boolean },
): void {
  const selected = beginSync(
    e,
    verb === "push" ? t("sidebar.verbPush") : t("sidebar.verbPull"),
    root,
    getInstances(),
    syncInProgress,
    () => closeAllMenus(pushMenu, pullMenu),
    btn,
  );
  if (!selected) return;
  const types = resolveTypes(
    (e.target as HTMLElement)?.closest<HTMLElement>(".dd-item")?.dataset.syncType || "all",
  );
  if (verb === "push") {
    void runPush(selected, types, btn, syncInProgress);
  } else {
    void runPull(selected, types, btn, syncInProgress);
  }
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
      bus.emit("toast:show", {
        msg: t("sidebar.pushDone", { detail: parts.join("，") }),
        duration: TOAST_MS.normal,
        type: "warn",
      });
    } else {
      bus.emit("toast:show", {
        msg: t("sidebar.pushDoneAll", { n: selected.length }),
        duration: TOAST_MS.info,
      });
    }
  } catch (err) {
    bus.emit("toast:show", {
      msg: t("sidebar.pushFailed", { msg: safeErrorMessage(err) }),
      duration: TOAST_MS.normal,
      type: "error",
    });
  } finally {
    resetButton(pushBtn, "push");
    syncInProgress.val = false;
  }
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
    const { PullResourceFromInstance } = await backendGetApp();
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
      bus.emit("toast:show", {
        msg: t("sidebar.pullDone", { pulled: totalPulled, failed }),
        duration: TOAST_MS.normal,
        type: "warn",
      });
    } else if (totalPulled > 0) {
      bus.emit("toast:show", {
        msg: t("sidebar.pullDoneAll", { n: totalPulled }),
        duration: TOAST_MS.info,
      });
    } else {
      bus.emit("toast:show", {
        msg: t("sidebar.pullNothing"),
        duration: TOAST_MS.info,
        type: "info",
      });
    }
    bus.emit("stats:refresh");
    bus.emit("tree:reload");
  } catch (err) {
    bus.emit("toast:show", {
      msg: t("sidebar.pullFailed", { msg: safeErrorMessage(err) }),
      duration: TOAST_MS.normal,
      type: "error",
    });
  } finally {
    resetButton(pullBtn, "pull");
    syncInProgress.val = false;
  }
}

// ---------- bindSyncSelected 主装配 ----------
export function bindSyncSelected(
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
  const pushMenu = root.getElementById("sidebar-push-menu");
  const pullBtn = root.querySelector(".sidebar-pull-selected") as HTMLButtonElement | null;
  const pullMenu = root.getElementById("sidebar-pull-menu");
  if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

  const closeAll = () => closeAllMenus(pushMenu, pullMenu);

  bindToggleMenu(pushBtn, pushMenu, closeAll);
  bindToggleMenu(pullBtn, pullMenu, closeAll);

  const prevHandler = getDocClickHandler();
  if (prevHandler) {
    document.removeEventListener("click", prevHandler);
  }
  const docClickHandler = (): void => closeAll();
  setDocClickHandler(docClickHandler);
  document.addEventListener("click", docClickHandler);

  pushMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("push", e, pushBtn, pushMenu, pullMenu, root, getInstances, {
      get val() {
        return getSyncInProgress();
      },
      set val(v) {
        setSyncInProgress(v);
      },
    }),
  );
  pullMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("pull", e, pullBtn, pushMenu, pullMenu, root, getInstances, {
      get val() {
        return getSyncInProgress();
      },
      set val(v) {
        setSyncInProgress(v);
      },
    }),
  );
}
