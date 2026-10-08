// ===== 水面持久化数据面（锐评 2026-10-08 P1-0/P3-1：原 scene-capability.ts|restoreBySchema 下沉）=====
// 先例 = light-persist.ts（ADR-281 数据面下沉，f5bd97d32）。原 restoreBySchema 是「共享工具暗特化」：
// 通用签名（scene-capability.ts 工具箱门面）里藏 `startsWith("water")` 后门类，全仓消费方仅
// water-capability 一处（P3-1 病名）；下沉水面叶后 scene-capability.ts 回归「接口 + localStorage IO
// （persistState/restoreState）」本分（锐评 2026-10-07 #6 拆轴同法，fan-in 收敛）。
import { envState, setEnvState, type WriteSource } from "@/preview-3d/state/env-state.ts";
import {
  ENV_STATE_SCHEMA,
  type EnvState,
  type EnvStateKey,
} from "@/preview-3d/state/env-state-schema.ts";
// 同目录持久化工具（restoreState 的对象形态闸见 scene-capability 唯一入口注释）
import { restoreState } from "./scene-capability.ts";

/**
 * [锐评 P1-0] 存档恢复来源纪律（ground F-2 / light L-1 同口径，2026-09-22 立法「恢复一律
 * auto-model」）：恢复是**程序化动作**，非用户手改。反例（原实现）：批量路径与 setter 委托
 * 站点全打 `manual` → water 组键 lastWriteSource 冻死，此后同轨 auto-model 写入（模型默认 /
 * 氛围预设）被 shouldOverwrite 静默拒绝（「切氛围水面不跟改」，13c0a13df L-1 同症状）。
 * 收敛成单一常量（ground-capability.ts|RESTORE_SOURCE 同款范式）：恢复站点两条路径
 * （批量恢复 + setter 委托）都显式传它——各写各的，F-2 只修一条留一条暗门。
 */
export const RESTORE_SOURCE = { source: "auto-model" } as const;

/** 写入口的可选覆盖：`source`（恢复来源）+ `skipMiddleware`（存档恢复豁免中间件）。
 *  省略即用户手改语义（manual）。 */
export type WriteOpts = { source?: WriteSource; skipMiddleware?: boolean };

/** 组装 setEnvState 的 opts：省略项不写入键（exactOptionalPropertyTypes），
 *  避免 `{source: undefined}` 把默认来源顶掉。 */
export function writeOpts(opts?: WriteOpts): { source: WriteSource; skipMiddleware?: boolean } {
  const base: { source: WriteSource; skipMiddleware?: boolean } = {
    source: opts?.source ?? "manual",
  };
  if (opts?.skipMiddleware === true) base.skipMiddleware = true;
  return base;
}

/**
 * 存档源解析（原 water-capability.ts|loadState 首段下沉，行数红线 ADR-315 同族拆缝）：
 * 读 `water` 自有存档，缺失才回看 legacy `ground` 存档的两个方言——嵌套 `water` 对象
 * （V2 前旧格式）或顶层四键平铺（wetness / waterColor / waterOpacity / normalStrength，
 * 任一为 number 才认）。对象形态闸由 restoreState 唯一入口兜住（非对象一律 null）。
 *
 * `fromNestedLegacy` 是必须回传的语义位：legacy.water 解包后 state 自身不再含 `water`
 * 键，调用方若照常做 `state.water` 的 nested 判定，会把嵌套方言误判成 flat——子域开关
 * `enabled` 不写 setWaterEnabled，「用户关水」偏好升级后丢失、重开能力水面重现。
 *
 * @returns `null` = 无可恢复存档（调用方直接 return，不进恢复段）。
 */
export function resolveWaterRestoreState(): {
  state: Record<string, unknown>;
  fromNestedLegacy: boolean;
} | null {
  let state = restoreState("water");
  let fromNestedLegacy = false;
  if (!state) {
    const legacy = restoreState("ground");
    if (legacy) {
      const lw = legacy.water;
      if (lw && typeof lw === "object") {
        state = lw as Record<string, unknown>;
        fromNestedLegacy = true;
      } else if (
        typeof legacy.wetness === "number" ||
        typeof legacy.waterColor === "number" ||
        typeof legacy.waterOpacity === "number" ||
        typeof legacy.normalStrength === "number"
      ) {
        state = {
          wetness: legacy.wetness,
          waterColor: legacy.waterColor,
          waterOpacity: legacy.waterOpacity,
          normalStrength: legacy.normalStrength,
        };
      }
    }
  }
  if (!state) return null;
  return { state, fromNestedLegacy };
}

/**
 * 水面 canonical 键批量恢复（原 scene-capability.ts|restoreBySchema 的承接者，water-only）：
 * 只接 number/boolean 两类标量键——枚举键（waterMode）与 legacy 旧方言别名（mode/size/level…）
 * 由调用方 spec（restoreFields）单独接，防脏枚举值直漏 cap setter（与写侧 clampFieldValue 的
 * 枚举收敛同纪律）。
 *
 * - 全程 `{ source: RESTORE_SOURCE, skipMiddleware: true }`——[锐评 P1-0] 原实现硬编码
 *   `manual`，把 water 组键 lastWriteSource 冻死（暗门）；skipMiddleware 豁免保留（存档恢复
 *   显式豁免「手改即 custom」类中间件——water 现无中间件，属防御性豁免）。
 * - 同值短路：envState 现值 === 存档值则跳过（大多遗留存档无此键时省一次无谓写）。
 * - 组外键静默跳过：本函数是水面叶（名已自陈），键集属主 = 调用方 `getPresetKeys("water")`；
 *   原「通用签名藏 startsWith 后门」的 P3-1 暗特化随下沉除名（defense-in-depth 过滤保留，
 *   组外键写入从此「名为水、实为水」，不再静默吞他组键）。
 *
 * @returns 至少一个键落值返回 true（与 restoreFields 语义一致，便于统一早退判定）。
 */
export function restoreWaterSchemaKeys(
  state: Record<string, unknown> | null,
  keys: readonly EnvStateKey[],
): boolean {
  if (!state) return false;
  let applied = false;
  for (const key of keys) {
    if (!key.startsWith("water")) continue; // defense-in-depth：键集属主为调用方 getPresetKeys("water")
    const def = ENV_STATE_SCHEMA[key] as { type: string } | undefined;
    if (!def) continue;
    const v = state[key];
    // 类型不匹配（脏存档/旧方言缺省）→ 跳过，保持该键 schema 默认（setEnvState 兜底同口径）
    if (def.type === "number") {
      if (typeof v !== "number") continue;
      if ((envState as unknown as Record<string, unknown>)[key] === v) continue;
      setEnvState({ [key]: v } as Partial<EnvState>, {
        source: RESTORE_SOURCE.source,
        skipMiddleware: true,
      });
      applied = true;
    } else if (def.type === "boolean") {
      if (typeof v !== "boolean") continue;
      if ((envState as unknown as Record<string, unknown>)[key] === v) continue;
      setEnvState({ [key]: v } as Partial<EnvState>, {
        source: RESTORE_SOURCE.source,
        skipMiddleware: true,
      });
      applied = true;
    }
    // enum / 其他类型键不在此处理（调用方 spec 单独接）
  }
  return applied;
}
