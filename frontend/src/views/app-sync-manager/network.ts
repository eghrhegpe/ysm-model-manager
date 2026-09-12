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
  setButtonsBusy(self, true);
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
    // code_review 3413288be 段 A #1/#2/#3/#4（P2）：busy 视觉须由在途 op 数派生——
    // 无条件 setButtonsBusy(false) 会把另一在途行的按钮提前复位（per-path 并发化
    // 只做了一半：守卫按 path、复位仍全局，两半自相矛盾——先结束的 op 让仍在途
    // 行的 UI 假空闲、点击被 Set 守卫静默吞）
    setButtonsBusy(self, self._singleBusy.size > 0);
  }
}

/**
 * 切换所有单行按钮的禁用态与视觉反馈。
 * 守卫：querySelectorAll 可能返回空集（卸载后），静默跳过。
 */
function setButtonsBusy(self: NetworkSelf, busy: boolean): void {
  self.querySelectorAll(".sm-item-btn").forEach((btn) => {
    const htmlBtn = btn as HTMLButtonElement;
    htmlBtn.disabled = busy;
    htmlBtn.style.opacity = busy ? "0.55" : "";
    htmlBtn.style.cursor = busy ? "wait" : "pointer";
  });
}
