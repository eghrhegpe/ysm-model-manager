// ===== 3D 操作键位 / 相机偏好（从 model3d.ts 拆出，ADR-040 P1）=====
// 纯 localStorage 工具函数，无 Three.js 依赖，可独立单测。
// 原 model3d.ts L70-115，已迁移至此；model3d.ts 保留 re-export 兼容。
import { safeGet } from "../../utils/dom/storage.ts";

// ── 类型 ──────────────────────────────────────────

export type TdKeyAction = "forward" | "back" | "left" | "right" | "up" | "down";

/** 默认键位以 KeyboardEvent.code 存储（物理键，跨键盘布局一致） */
export const DEFAULT_TD_KEYMAP: Record<TdKeyAction, string> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  up: "Space",
  down: "ShiftLeft",
};

const TD_KEYMAP_KEY = "td-keymap";
const TD_CAMSPEED_KEY = "td-cam-speed";
const TD_ROTMODE_KEY = "td-rot-mode";

// ── 读取函数（非法/缺失回退默认）──────────────────

/** 读取用户自定义键位（无/非法时回退默认） */
export function loadTdKeymap(): Record<TdKeyAction, string> {
  const raw = safeGet(TD_KEYMAP_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<TdKeyAction, string>>;
      const merged: Record<TdKeyAction, string> = { ...DEFAULT_TD_KEYMAP };
      (Object.keys(DEFAULT_TD_KEYMAP) as TdKeyAction[]).forEach((k) => {
        if (typeof parsed[k] === "string" && parsed[k]!.length > 0) merged[k] = parsed[k]!;
      });
      return merged;
    } catch {
      /* JSON 解析失败回退默认 */
    }
  }
  return { ...DEFAULT_TD_KEYMAP };
}

/** 相机移动速度（2–200），默认 20 */
export function loadTdCamSpeed(): number {
  // P3 修复（审核）：裸调改 safeGet——隐私模式降级 null → Number(null)=0 → 回退 20
  const v = Number(safeGet(TD_CAMSPEED_KEY));
  return Number.isFinite(v) && v >= 2 && v <= 200 ? v : 20;
}

/** true = 环绕（orbit），false = 自身（free） */
export function loadTdRotMode(): boolean {
  return safeGet(TD_ROTMODE_KEY) !== "free";
}
