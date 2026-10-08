// ===== 环境持久化数据面（ADR-326：schema 单一事实源派生键轨）=====
// 先例 = water-persist.ts（锐评 2026-10-08 P1-0/P3-1 下沉）+ light-persist.ts（ADR-281）。
// 病根：environment-capability.ts 的 saveState **手摘 6 键**、loadState **手写双轨还原表**，
// schema 加键而两处任一漏登记 ⇒ **自动持久化、静默不还原**（用户改了下次启动就没了，零报错）。
// 2026-10-08 才补 [P1-5] 契约锁，此前零守卫。
//
// 收口：键轨从 `getPresetKeys("environment")` 派生，存档键名经 `getArchiveKey`（ARCHIVE_ALIAS）
// 映射——environment 是全仓唯一**存档键名 ≠ schema 键名**的 cap（preset/intensity/
// resolution/useAsBackground 沿用无前缀历史方言，有跨代读者，故不改名只登记别名）。
//
// ⚠️ 本叶只处理「标量键批量派生」——custom HDR 无缓存回落 studio 属**运行时事实**
// （customHdrTex 有无），不可由 schema 派生，保留在 cap 侧 loadState 的 override 裁决。

import { envState } from "@/preview-3d/state/env-state.ts";
import {
  ENV_STATE_SCHEMA,
  type EnvState,
  type EnvStateKey,
  getArchiveKey,
  getPresetKeys,
} from "@/preview-3d/state/env-state-schema.ts";

/**
 * [ADR-326] 存档恢复来源纪律（ground F-2 / light L-1 / water P1-0 同口径）：
 * 恢复是**程序化动作**，非用户手改——恢复站点打 `manual` 会把 env 组键 lastWriteSource
 * 冻死，此后同轨 auto-model 写入（模型默认 / 氛围预设）被 shouldOverwrite 静默拒绝
 * （「切氛围环境不跟改」）。收敛成单一常量（water-persist.ts 同款范式）。
 */
export const RESTORE_SOURCE = { source: "auto-model" } as const;

/** 环境组 schema 键集（导出一份供守卫/测试复用，避免各处重复 getPresetKeys） */
export const ENV_KEYS: readonly EnvStateKey[] = getPresetKeys("environment");

/**
 * 从 envState 派生 environment 存档对象（ADR-326，写侧对称派生）。
 *
 * - 键轨 = `ENV_KEYS`（schema 单一事实源），存档键名经 `getArchiveKey` 映射别名。
 * - `override` 接 cap 专用**运行时裁决**：如 custom 通路无 HDR 缓存时 saveState 要把
 *   `preset` 落成 "studio"（原实现的手写 `savePreset` 变量）。裁决是运行时事实，不可派生。
 *
 * 不持久化 custom HDR 二进制/文件名（blob/base64 会炸 localStorage；重启后文件名也没意义）。
 */
export function saveEnvState(override?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ENV_KEYS) {
    out[getArchiveKey(key)] = envState[key];
  }
  if (override) Object.assign(out, override);
  return out;
}

/**
 * 从 environment 存档对象派生 `Partial<EnvState>`（ADR-326，读侧对称派生）。
 *
 * - 键轨同 `saveEnvState`（`ENV_KEYS` + `getArchiveKey`），读写两侧同源 → 漏登记结构性不可能。
 * - 按 `ENV_STATE_SCHEMA[key].type` 分派 number/boolean/enum；类型不匹配（脏存档 / 旧方言
 *   缺省）跳过，保持 schema 默认（对齐 water `restoreWaterSchemaKeys` 语义）。
 * - 返回 `Partial<EnvState>` 供 cap **一次性** setEnvState 落地（environment 无 setter 委托
 *   站点，统一写入口更简；ground 的 setter 委托形态另走 restoreFields）。
 * - 来源纪律由 cap 侧 setEnvState 的 `RESTORE_SOURCE` 承担（本函数只产数据不写 envState）。
 */
export function restoreEnvPartial(
  state: Record<string, unknown> | null | undefined,
): Partial<EnvState> {
  if (!state) return {};
  const partial: Partial<EnvState> = {};
  for (const key of ENV_KEYS) {
    if (!(getArchiveKey(key) in state)) continue;
    const v = state[getArchiveKey(key)];
    const def = ENV_STATE_SCHEMA[key] as { type?: string; values?: readonly string[] };
    if (def.type === "number") {
      if (typeof v === "number") partial[key] = v as never;
    } else if (def.type === "boolean") {
      if (typeof v === "boolean") partial[key] = v as never;
    } else if (def.type === "enum") {
      // enum 白名单（ADR-283 枚举收敛）：脏存档非法枚举直漏 cap setter 会建成错误 Three 对象
      if (typeof v === "string" && def.values?.includes(v)) partial[key] = v as never;
    }
    // 其他类型（tuple3/nullable-*）environment 组现无，跳过（与 restoreWaterSchemaKeys 同边界）
  }
  return partial;
}
