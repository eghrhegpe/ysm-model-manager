// ===== 3D 操作键位 / 相机偏好（从 model3d.ts 拆出，ADR-040 P1）=====
// 纯 localStorage 工具函数，无 Three.js 依赖，可独立单测。
// 原 model3d.ts L70-115，已迁移至此；model3d.ts 保留 re-export 兼容。
//
// [ADR-303] 键 + 值域 + 默认值的唯一声明处是 `./settings-schema.ts`——本文件只做
// 「读盘 + clamp + 回退」，不再自持键常量或值域字面量（曾与两处 UI 面三份副本漂移）。
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { TD_CAM_SPEED, TD_KEYMAP_KEY, TD_ROT_MODE } from "./settings-schema.ts";

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

// ── 读取函数（非法/缺失回退默认）──────────────────

/** 读取用户自定义键位（无/非法时回退默认） */
export function loadTdKeymap(): Record<TdKeyAction, string> {
  const raw = safeGet(TD_KEYMAP_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<TdKeyAction, string>>;
      const merged: Record<TdKeyAction, string> = { ...DEFAULT_TD_KEYMAP };
      (Object.keys(DEFAULT_TD_KEYMAP) as TdKeyAction[]).forEach((k) => {
        // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
        if (typeof parsed[k] === "string" && parsed[k]!.length > 0) merged[k] = parsed[k]!;
      });
      return merged;
    } catch {
      /* JSON 解析失败回退默认 */
    }
  }
  return { ...DEFAULT_TD_KEYMAP };
}

/** 相机移动速度（值域/默认见 TD_CAM_SPEED，越界或非法回退默认） */
export function loadTdCamSpeed(): number {
  // 裸调改 safeGet——隐私模式降级 null → Number(null)=0 → 回退默认
  const v = Number(safeGet(TD_CAM_SPEED.key));
  return Number.isFinite(v) && v >= TD_CAM_SPEED.min && v <= TD_CAM_SPEED.max
    ? v
    : TD_CAM_SPEED.default;
}

/** true = 环绕（orbit），false = 自身（free）——非 free 一律视作默认 orbit */
export function loadTdRotMode(): boolean {
  return safeGet(TD_ROT_MODE.key) !== TD_ROT_MODE.free;
}
