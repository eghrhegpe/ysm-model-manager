// ===== 设置页：3D 解析 worker 开关（ADR-040 拆分：FBX/MMD worker 统一逃生舱）=====
// 收敛两个 worker 解析开关：fbx-worker、mmd-pmx-worker（fbx-adapter.ts / mmd-adapter.ts 读取）。
// 默认关闭（opt-in）：主线程解析为稳定基线；开启后走 worker 解析，失败自动降级主线程——
// 设置页提供手动开关作为回退保险。读写统一走 safeGet/safeSet（隐私模式安全）。
import { bus } from "../../../bus.ts";
import { t } from "../../../core/i18n/t.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";

// 魔法数值收敛：偏好变更成功 toast 展示时长（ms）
const TOAST_DURATION_MS = TOAST_MS.quick;

interface WorkerSwitch {
  id: string;
  storageKey: string;
  onMsg: string;
  offMsg: string;
}

const WORKER_SWITCHES: ReadonlyArray<WorkerSwitch> = [
  {
    id: "set-fbx-worker",
    storageKey: "fbx-worker",
    onMsg: "settings.worker.fbxOn",
    offMsg: "settings.worker.fbxOff",
  },
  {
    id: "set-mmd-worker",
    storageKey: "mmd-pmx-worker",
    onMsg: "settings.worker.mmdOn",
    offMsg: "settings.worker.mmdOff",
  },
];

/** 初始化 3D 解析 worker 开关：读取现有偏好回填 + 绑定变更 */
export function initWorkerPrefs(root: ShadowRoot): void {
  for (const { id, storageKey, onMsg, offMsg } of WORKER_SWITCHES) {
    const input = root.getElementById(id) as HTMLInputElement | null;
    if (!input) continue;
    input.checked = (safeGet(storageKey) ?? "0") === "1";
    input.addEventListener("change", () => {
      const checked = input.checked;
      safeSet(storageKey, checked ? "1" : "0");
      bus.emit("toast:show", {
        msg: checked ? t(onMsg) : t(offMsg),
        duration: TOAST_DURATION_MS,
        type: "success",
      });
    });
  }
}