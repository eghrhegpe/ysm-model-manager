// ===== app-sidebar 同步编排入口（锐评 P1-2 拆分后收敛）=====
// 从 index.ts 拆出（P1-3）：原 706 行承担「勾选持久化 / 下拉控制器 / push / pull / 结果浮层 /
// 按钮 loading」6 类职责，测试要 mock 六种子系统。现按职责拆：
//   sidebar-select.ts       勾选持久化 + 按 data-name 解析
//   sidebar-push.ts         推送编排 + 跨批归并 + 汇总文案
//   sidebar-pull.ts         拉取编排 + 计数汇总 + 汇总文案
//   sidebar-result-panel.ts 变更明细浮层（ESC 关闭）
//   sidebar-shared.ts       push/pull 共用原语（SyncVerb / resetButton）
// 本文件只留「编排入口 + 下拉控制器」：菜单命中 → 抢锁 → 分派 push/pull。

import { t } from "@/core/i18n/t.ts";
import type { BusyLock } from "@/utils/base/primitives/lock.ts";
import { initDropdown } from "@/utils/dom/dropdown.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { type SidebarInstance, SYNC_TYPE_ALL } from "./data.ts";
import { runPull } from "./sidebar-pull.ts";
import { runPush } from "./sidebar-push.ts";
import { closeSyncResultPanel } from "./sidebar-result-panel.ts";
import { getSelected } from "./sidebar-select.ts";

// ---------- closeAllMenus ----------
/** 程序化收起两个同步下拉：统一走 dropdown 控制器句柄的 .close()（幂等：已关 no-op，
 *  状态/ARIA 单源留在控制器内——2026-09 收口：原实现手改 display:none + 重置 aria-expanded，
 *  绕过控制器留了状态脱钩后门，ADR-298 D3「收起全权交通用控制器」的漏网，已退役）。
 *  焦点归还不归本函数管：菜单项点击路径的收起已由控制器 onMenuClick close(restoreFocus) 完成。 */
function closeAllMenus(pushClose: () => void, pullClose: () => void): void {
  pushClose();
  pullClose();
}

// ---------- resolveTypes ----------
function resolveTypes(rt: string): string[] {
  return rt === SYNC_TYPE_ALL ? ALL_RESOURCE_TYPES : [rt];
}

/**
 * beginSync：推送/拉取入闸流程（判空 toast → 原子抢锁 → 关菜单 → 按钮 loading）。
 * `.dd-item` 的定位与 `data-sync-type` 读取都由调用方完成（2026-10 锐评收口：原先本函数与
 * handleSyncMenuClick 各自 `closest(".dd-item")` 一次，同一 target 查两遍）。
 */
function beginSync(
  verb: string,
  root: ShadowRoot,
  instances: SidebarInstance[],
  lock: BusyLock,
  closeAllMenus: () => void,
  btn: HTMLButtonElement,
): string[] | null {
  const selected = getSelected(root, instances);
  if (!selected.length) {
    toast(t("sidebar.selectPackFirst", { verb }), TOAST_MS.success, "info");
    return null;
  }
  // ADR-341 归一：tryStart 原子抢锁（判空提示在前——顺序语义与原实现一致：
  // 空选择在先、busy 拒收在后）。
  // 批D 修正：原实现 busy 时静默 return，注释称「按钮 loading 态就是可见反馈」——
  // 但 loading 赋值发生在本 return **之后**，且锁是 push/pull **共用**的：点另一个按钮
  // 时那个按钮根本不会进 loading，用户只看到「点了没反应」。更糟的是拉取侧原先没有
  // 超时（binding 挂起会把锁永久占住），静默拒收会让整个同步入口看起来彻底坏掉。
  // 故改为如实提示（toast 是唯一能覆盖「两个按钮 + 共用锁」的反馈面）。
  if (!lock.tryStart()) {
    toast(t("sidebar.syncBusy", { verb }), TOAST_MS.normal, "info");
    return null;
  }
  closeAllMenus();
  btn.innerHTML = UI_ICONS.refresh;
  btn.disabled = true;
  return selected;
}

// ---------- handleSyncMenuClick ----------
function handleSyncMenuClick(
  verb: "push" | "pull",
  e: Event,
  btn: HTMLButtonElement,
  closeAll: () => void,
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  lock: BusyLock,
): void {
  // 命中判定与 syncType 读取都只需要一次 closest（原实现 beginSync 内一次、此处又一次）
  const ddItem = (e.target as HTMLElement | null)?.closest(".dd-item");
  if (!ddItem) return;
  const selected = beginSync(
    verb === "push" ? t("sidebar.verbPush") : t("sidebar.verbPull"),
    root,
    getInstances(),
    lock,
    closeAll,
    btn,
  );
  if (!selected) return;
  const types = resolveTypes((ddItem as HTMLElement).dataset.syncType || SYNC_TYPE_ALL);
  if (verb === "push") {
    void runPush(selected, types, btn, lock, root);
  } else {
    void runPull(selected, types, btn, lock, root);
  }
}

// ---------- bindSyncSelected 主装配 ----------
export function bindSyncSelected(
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  /** 下拉控制器 dispose 的归集口（替代原 docClick 单槽存取器对，ADR-298 D3） */
  setDropdownCleanup: (fn: () => void) => void,
  /** 同步在途互斥锁（ADR-341 归一：原 `{ get, set }` 访问器对退役，组件直传 BusyLock） */
  syncLock: BusyLock,
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
    // P2 修复（2026-10-16 锐评）：结果浮层的 ESC 监听也须随组件卸载移除。
    // 原 cleanup 只 dispose 下拉控制器，`escHandler`（模块级）只被
    // `closeSyncResultPanel` 自己摘除——组件在结果面板打开时卸载，ESC 监听
    // 永久挂 document。closeSyncResultPanel 幂等（内部 `if (escHandler)`），
    // 已关面板时调用无害。
    closeSyncResultPanel(root);
  });
  // 程序化收起统一走控制器句柄（closeAllMenus 见上方）：不再手改 display / aria-expanded
  const closeAllMenusBoth = (): void => closeAllMenus(disposePush.close, disposePull.close);

  pushMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("push", e, pushBtn, closeAllMenusBoth, root, getInstances, syncLock),
  );
  pullMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("pull", e, pullBtn, closeAllMenusBoth, root, getInstances, syncLock),
  );
}
