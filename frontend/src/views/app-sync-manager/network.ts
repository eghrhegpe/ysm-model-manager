// ===== app-sync-manager 网络层（network） =====
// 职责：单文件 push/pull 操作 + 按钮禁用态视觉反馈
// _pushSingleFile 与 _pullSingleFile 80% 重复 → 合并为 performSingleOp。
// 依赖 DAG：index → network ← events（events 通过回调调用 network）
// network → store（push/pull 后调 loadData 刷新数据）

import { getApp } from "@/backend/app.ts";
import { bus } from "@/bus";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

import type { SyncManagerSelf } from "./index.ts";

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
  if (self._singleBusy) return;
  self._singleBusy = true;
  setButtonsBusy(self, true);
  const rtype = self._selectedType;
  const targetInstance = self._instance;
  try {
    const app = await getApp();
    if (op === "push") {
      await app.PushSingleResourceToInstance(rtype, targetInstance, path);
    } else {
      await app.PullSingleResourceFromInstance(rtype, path, targetInstance);
    }
    if (!self.isConnected) return;
    const msg = op === "push" ? "✅ 已推送" : "✅ 已拉取";
    bus.emit("toast:show", { msg, duration: TOAST_MS.success });
    const gen = self._gen;
    await cb.doLoadData();
    if (gen !== self._gen || !self.isConnected) return;
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
    self._singleBusy = false;
    setButtonsBusy(self, false);
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
