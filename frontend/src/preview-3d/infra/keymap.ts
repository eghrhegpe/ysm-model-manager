// ===== 3D 操作键位 / 相机偏好（从 model3d.ts 拆出，ADR-040 P1）=====
// 纯 localStorage 与键位规格工具，无 i18n / DOM / Three.js 依赖，可独立单测。
// 键位动作、默认物理键、显示分组、顺序与输入 fallback 均由本文件 registry 派生。
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { TD_CAM_SPEED, TD_KEYMAP_KEY, TD_ROT_MODE } from "./settings-schema.ts";

// ── 键位规格 registry（动作/默认键/分组/顺序/fallback 单一事实源）─────────

export interface TdKeymapSpec {
  readonly action: string;
  readonly defaultCode: string;
  readonly group: string;
  readonly order: number;
  readonly fallbackCodes: readonly string[];
}

/** 有序键位规格；新增动作只在此处追加，UI 与输入层按 registry 派生。 */
export const TD_KEYMAP_REGISTRY = [
  {
    action: "forward",
    defaultCode: "KeyW",
    group: "movement",
    order: 0,
    fallbackCodes: ["ArrowUp", "Numpad8"],
  },
  {
    action: "back",
    defaultCode: "KeyS",
    group: "movement",
    order: 1,
    fallbackCodes: ["ArrowDown", "Numpad2"],
  },
  {
    action: "left",
    defaultCode: "KeyA",
    group: "movement",
    order: 2,
    fallbackCodes: ["ArrowLeft", "Numpad4"],
  },
  {
    action: "right",
    defaultCode: "KeyD",
    group: "movement",
    order: 3,
    fallbackCodes: ["ArrowRight", "Numpad6"],
  },
  { action: "up", defaultCode: "Space", group: "movement", order: 4, fallbackCodes: [] },
  { action: "down", defaultCode: "ShiftLeft", group: "movement", order: 5, fallbackCodes: [] },
] as const satisfies readonly TdKeymapSpec[];

export type TdKeyAction = (typeof TD_KEYMAP_REGISTRY)[number]["action"];

/** 默认键位由 registry 派生，存储值使用 KeyboardEvent.code。 */
export const DEFAULT_TD_KEYMAP: Record<TdKeyAction, string> = TD_KEYMAP_REGISTRY.reduce(
  (out, spec) => {
    out[spec.action] = spec.defaultCode;
    return out;
  },
  {} as Record<TdKeyAction, string>,
);

// ── 读取函数（非法/缺失回退默认）──────────────────

/** 读取用户自定义键位（无/非法时回退默认；未知持久化字段被忽略）。 */
export function loadTdKeymap(): Record<TdKeyAction, string> {
  const raw = safeGet(TD_KEYMAP_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const merged: Record<TdKeyAction, string> = { ...DEFAULT_TD_KEYMAP };
      for (const spec of TD_KEYMAP_REGISTRY) {
        const value = parsed[spec.action];
        if (typeof value === "string" && value.length > 0) merged[spec.action] = value;
      }
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
