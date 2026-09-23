// ===== app-sync-manager 网络层（network） =====
// 职责：单文件 push/pull 操作 + 按钮禁用态视觉反馈
// _pushSingleFile 与 _pullSingleFile 80% 重复 → 合并为 performSingleOp。
// 依赖 DAG：index → network ← events（events 通过回调调用 network）
// network → store（push/pull 后调 loadData 刷新数据）

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

import type { SyncManagerSelf } from "./self-type.ts";

export type NetworkSelf = SyncManagerSelf;

interface NetworkCallbacks {
  doLoadData: () => Promise<void>;
  doRender: () => void;
  doEmitStats: () => void;
}

/**
 * 统一推送 / 拉取单文件操作。
 * 入口同步捕获 instance + rtype（防 await 期间 attributeChangedCallback 切换实例）；
 * 在途守卫防连点；finally 复位按钮视觉。
 */
export async function performSingleOp(
  self: NetworkSelf,
  op: "push" | "pull",
  path: string,
  cb: NetworkCallbacks,
): Promise<void> {
  // P2 修复：原全局 _singleBusy 布尔 → 按 path 粒度 Set——
  // 不同行可并发 push/pull，同一行防重入（保原契约）。
  if (self._singleBusy.has(path)) return;
  self._singleBusy.add(path);
  // per-path 禁用：只锁本行。原全局 setButtonsBusy(true) 会把无关行一并锁死，
  // 令「不同行可并发 push/pull」的 per-path 守卫在 UI 层形同虚设（并发化只做了一半）。
  setRowButtonsBusy(self, path, true);
  const rtype = self._selectedType;
  const targetInstance = self._instance;
  try {
    const app = await backendGetApp();
    if (op === "push") {
      await app.PushSingleResourceToInstance(rtype, targetInstance, path);
    } else {
      await app.PullSingleResourceFromInstance(rtype, path, targetInstance);
    }
    if (!self.isConnected) return;
    const msg = op === "push" ? t("syncManager.pushed") : t("syncManager.pulled");
    bus.emit("toast:show", { msg, duration: TOAST_MS.success });
    const gen = self._guard.current;
    await cb.doLoadData();
    if (self._guard.stale(gen) || !self.isConnected) return;
    cb.doRender();
    cb.doEmitStats();
  } catch (e) {
    if (!self.isConnected) return;
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  } finally {
    self._singleBusy.delete(path);
    // per-path 复位：只解禁本行，其他在途行的禁用态不受影响
    // （原为全局 setButtonsBusy(self, size > 0)：先结束的 op 会把仍在途行提前解禁，
    //  UI 假空闲 + 点击被 Set 静默吞——现两侧同为 per-path 口径，修复自相矛盾）
    setRowButtonsBusy(self, path, false);
  }
}

/**
 * 切换【单行】按钮的禁用态与视觉反馈（per-path 粒度）。
 * 路径用 dataset 比对而非属性选择器——path 含分隔符/引号会破坏 CSS 选择器语义。
 * 注：窗口化重建 DOM 后本处设置的禁用态会被冲掉，由 renderer.restoreBusyState
 * 按 self._singleBusy 重新贴回（两侧共用同一在途集合，口径单一）。
 */
function setRowButtonsBusy(self: NetworkSelf, path: string, busy: boolean): void {
  self.querySelectorAll("[data-path]").forEach((row) => {
    if ((row as HTMLElement).dataset.path !== path) return;
    row.querySelectorAll(".sm-item-btn").forEach((btn) => {
      const htmlBtn = btn as HTMLButtonElement;
      htmlBtn.disabled = busy;
      htmlBtn.style.opacity = busy ? "0.55" : "";
      htmlBtn.style.cursor = busy ? "wait" : "pointer";
    });
  });
}
