// ===== app-sidebar 同步流程层 =====
// 从 index.ts 拆出（P1-3）：勾选状态管理 + push/pull 同步执行链。
// index.ts 保留 Web Component 生命周期与渲染编排；本文件收敛「勾选 → 菜单 → 同步」全链。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { initDropdown } from "@/utils/dom/dropdown.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { type SidebarInstance, SYNC_TYPE_ALL } from "./data.ts";

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
/** 程序化收起（兼容既有调用点）：菜单容器 display 复位。
 *  ARIA 状态由 dropdown 控制器在自身 close 路径同步；此处仅兜底 display，
 *  故同步重置 aria-expanded，避免「display 已关但 aria 仍为 true」的状态脱钩。 */
function closeAllMenus(pushMenu: HTMLElement, pullMenu: HTMLElement): void {
  for (const menu of [pushMenu, pullMenu]) {
    menu.style.display = "none";
    const trigger = menu.closest(".dd-wrap")?.querySelector("button");
    trigger?.setAttribute("aria-expanded", "false");
  }
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
  return rt === SYNC_TYPE_ALL ? ALL_RESOURCE_TYPES : [rt];
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
        // 诊断文案走 i18n（内部错误信息；被日志/面板消费时不注入中文硬编码）
        reject(kindError(t("sidebar.pushSkippedReason", { ins: insName, rt }), "skipped"));
      } else {
        resolve();
      }
    });
    timer = setTimeout(() => {
      unsub();
      reject(kindError(t("sidebar.pushTimeoutReason", { ins: insName, rt }), "timeout"));
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

/** 按钮复位（push/pull finally 块共用）。▾ 指示符由 dropdownBaseCSS 的
 *  `.dd-wrap > button::after` 单源生成（ADR-238），此处不再手拼——手拼会双箭头 */
function resetButton(btn: HTMLButtonElement, verb: SyncVerb): void {
  const iconSvg = verb === "push" ? UI_ICONS.upload : UI_ICONS.download;
  const key = verb === "push" ? "sidebar.pushSelected" : "sidebar.pullSelected";
  btn.innerHTML = `${iconSvg} ${t(key)}`;
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
    (e.target as HTMLElement)?.closest<HTMLElement>(".dd-item")?.dataset.syncType || SYNC_TYPE_ALL,
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
  /** 下拉控制器 dispose 的归集口（替代原 docClick 单槽存取器对，ADR-298 D3） */
  setDropdownCleanup: (fn: () => void) => void,
  getSyncInProgress: () => boolean,
  setSyncInProgress: (v: boolean) => void,
): void {
  const pushBtn = root.querySelector(".sidebar-push-selected") as HTMLButtonElement | null;
  const pushMenu = root.getElementById("sidebar-push-menu");
  const pullBtn = root.querySelector(".sidebar-pull-selected") as HTMLButtonElement | null;
  const pullMenu = root.getElementById("sidebar-pull-menu");
  if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

  // ADR-298 D3：展开/收起/ARIA/键盘/外点关闭/互斥全权交通用控制器——
  // 替代原 bindToggleMenu（手写 display 开关）+ 模块级 document-click 单槽 hack
  // （后者靠 _docClickHandler 存取器传递，且 aria 状态与 display 脱钩）。
  const pushWrap = pushMenu.closest(".dd-wrap") as HTMLElement | null;
  const pullWrap = pullMenu.closest(".dd-wrap") as HTMLElement | null;
  const disposePush = initDropdown(pushWrap);
  const disposePull = initDropdown(pullWrap);
  setDropdownCleanup(() => {
    disposePush();
    disposePull();
  });

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
