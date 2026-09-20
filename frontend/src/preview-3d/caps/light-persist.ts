// ===== LightCapability 持久化数据层（锐评 §三 下沉：职责⑤的纯数据面）=====
// 从 light-capability.ts 抽离：saveState 的参数映射 + loadState 的开关/参数恢复块。
// 均为「envState ↔ localStorage 嵌套结构」的纯数据映射，不触达 cap 私有字段
//（私有态：enabled 仍由主类 saveState/loadState 编排；顺序敏感段——开关恢复→
// syncConeMount→锥组重建——留在主类）。
// [ADR-282] 原 currentPreset/manualPreset 两个私有态键已随灯光与模型类别解耦退役。
// [ADR-246 D1] 原 volumetricEngine 维度已删（postprocess 空壳引擎移除）。
// 对齐 light-presets.ts（参数面）/ light-controls.ts（菜单面）的拆分先例。

import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import type { LightInstanceParams } from "./light-presets.ts";
import { restoreFields } from "./scene-capability.ts";

/* ============ saveState：envState → 持久化嵌套结构（纯读） ============ */

export function buildLightPersistPayload(): Record<string, unknown> {
  return {
    keyEnabled: envState.lightKeyEnabled,
    fillEnabled: envState.lightFillEnabled,
    rimEnabled: envState.lightRimEnabled,
    // 灯光全量持久化（含 type + spot 参数），跨会话不丢类型/方向/强度/颜色
    key: {
      type: envState.lightKeyType,
      enabled: envState.lightKeyEnabled,
      color: envState.lightKeyColor,
      intensity: envState.lightKeyIntensity,
      azimuth: envState.lightKeyAzimuth,
      elevation: envState.lightKeyElevation,
      angle: envState.lightKeyAngle,
      penumbra: envState.lightKeyPenumbra,
      distance: envState.lightKeyDistance,
      decay: envState.lightKeyDecay,
    },
    fill: {
      type: envState.lightFillType,
      enabled: envState.lightFillEnabled,
      color: envState.lightFillColor,
      intensity: envState.lightFillIntensity,
      azimuth: envState.lightFillAzimuth,
      elevation: envState.lightFillElevation,
      angle: envState.lightFillAngle,
      penumbra: envState.lightFillPenumbra,
      distance: envState.lightFillDistance,
      decay: envState.lightFillDecay,
    },
    rim: {
      type: envState.lightRimType,
      enabled: envState.lightRimEnabled,
      color: envState.lightRimColor,
      intensity: envState.lightRimIntensity,
      azimuth: envState.lightRimAzimuth,
      elevation: envState.lightRimElevation,
      angle: envState.lightRimAngle,
      penumbra: envState.lightRimPenumbra,
      distance: envState.lightRimDistance,
      decay: envState.lightRimDecay,
    },
    ambient: {
      color: envState.lightAmbientColor,
      intensity: envState.lightAmbientIntensity,
    },
    volumetric: {
      enabled: envState.lightVolumetricEnabled,
      opacity: envState.lightVolumetricOpacity,
      fogPower: envState.lightVolumetricFogPower,
      edgeFade: envState.lightVolumetricEdgeFade,
      baseStrength: envState.lightVolumetricBaseStrength,
      tipStrength: envState.lightVolumetricTipStrength,
    },
  };
}

/* ============ loadState：持久化结构 → envState（逐字段 typeof 校验，manual 源） ============ */

/** 灯光字段表：saved 键 → [envState 后缀, 期望 typeof]。
 *  [light-type-switch] 每盏灯 10 字段结构统一后，逐字段 if 链换成表驱动（单一事实源，
 *  新增字段只改此表）；旧版 10 条 `if (typeof s.X === ...)` 等价保留。 */
const LIGHT_FIELDS = {
  type: ["Type", "string"],
  enabled: ["Enabled", "boolean"],
  color: ["Color", "number"],
  intensity: ["Intensity", "number"],
  azimuth: ["Azimuth", "number"],
  elevation: ["Elevation", "number"],
  angle: ["Angle", "number"],
  penumbra: ["Penumbra", "number"],
  distance: ["Distance", "number"],
  decay: ["Decay", "number"],
} as const satisfies Record<
  keyof LightInstanceParams,
  readonly [string, "string" | "number" | "boolean"]
>;

type LightFieldKey = keyof typeof LIGHT_FIELDS;

const ALL_LIGHT_FIELDS = Object.keys(LIGHT_FIELDS) as LightFieldKey[];

/** 旧存档 `spotlight` 块只有这些参数（enabled 归 `keyEnabled`、type 由迁移行决定）。 */
const SPOT_MIGRATION_FIELDS: LightFieldKey[] = [
  "color",
  "intensity",
  "angle",
  "penumbra",
  "distance",
  "decay",
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** 按（可选）字段子集把 saved 对象的已校验字段写入 acc；prefix 形如 `lightKey`。
 *  末尾一次 setEnvState 的合批约定不变——本函数只写 accumulator，不派发。 */
function pickLightFields(
  prefix: string,
  s: Record<string, unknown>,
  acc: Record<string, unknown>,
  fields: LightFieldKey[] = ALL_LIGHT_FIELDS,
): void {
  for (const key of fields) {
    const [suffix, expect] = LIGHT_FIELDS[key];
    const v = s[key];
    if (typeof v === expect) acc[`${prefix}${suffix}`] = v;
  }
}

function restoreDir(
  which: "key" | "fill" | "rim",
  saved: unknown,
  acc: Record<string, unknown>,
): void {
  if (!saved || typeof saved !== "object") return;
  pickLightFields(`light${cap(which)}`, saved as Record<string, unknown>, acc);
}

/**
 * 用户显式保存的灯开关与全量参数恢复（须在模型预设套用之后调用——
 * 「预设以 envState 为准，后恢复的用户值优先」，ADR-126 P5「手动优先」同口径）。
 */
export function restoreLightParams(state: Record<string, unknown>): void {
  // 合批派发：所有校验通过的字段并入单一 accumulator，末尾一次 setEnvState。
  // 对齐 render-mode-capability.ts 批量化先例（N 次全场景材质遍历 → 1 次）。
  // manual source 恒过 shouldOverwrite，合批不改变最终值，仅砍冗余派发。
  const acc: Record<string, unknown> = {};
  // ② 用户显式保存的灯开关优先于模型预设
  if (typeof state.ambientIntensity === "number") {
    acc.lightAmbientIntensity = state.ambientIntensity;
  }
  if (typeof state.keyEnabled === "boolean") {
    acc.lightKeyEnabled = state.keyEnabled;
  }
  if (typeof state.fillEnabled === "boolean") {
    acc.lightFillEnabled = state.fillEnabled;
  }
  if (typeof state.rimEnabled === "boolean") {
    acc.lightRimEnabled = state.rimEnabled;
  }
  // spot 参数已下沉到每盏灯的 restoreDir 中，此处不再单独恢复旧 lightSpot* 字段
  // 兼容旧存档：如果存在旧 spotlight 字段，迁移到 key 灯的 spot 参数
  if (state.spotlight && typeof state.spotlight === "object") {
    const sp = state.spotlight as Record<string, unknown>;
    // 旧存档有 spotlight 启用 → 迁移到 key 灯（type 与 enabled 归属不同，不走字段表）
    if (sp.enabled === true) acc.lightKeyType = "spot";
    pickLightFields("lightKey", sp, acc, SPOT_MIGRATION_FIELDS);
  }
  if (typeof state.volumetricEnabled === "boolean") {
    acc.lightVolumetricEnabled = state.volumetricEnabled;
  }
  // ②.b 全量参数恢复（灯光 key/fill/rim 并入同一 accumulator）
  restoreDir("key", state.key, acc);
  restoreDir("fill", state.fill, acc);
  restoreDir("rim", state.rim, acc);
  if (state.ambient && typeof state.ambient === "object") {
    restoreFields(state.ambient as Record<string, unknown>, {
      intensity: { number: (v) => (acc.lightAmbientIntensity = v) },
      color: { number: (v) => (acc.lightAmbientColor = v) },
    });
  }
  if (state.volumetric && typeof state.volumetric === "object") {
    restoreFields(state.volumetric as Record<string, unknown>, {
      enabled: { boolean: (v) => (acc.lightVolumetricEnabled = v) },
      opacity: { number: (v) => (acc.lightVolumetricOpacity = v) },
      fogPower: { number: (v) => (acc.lightVolumetricFogPower = v) },
      edgeFade: { number: (v) => (acc.lightVolumetricEdgeFade = v) },
      baseStrength: { number: (v) => (acc.lightVolumetricBaseStrength = v) },
      tipStrength: { number: (v) => (acc.lightVolumetricTipStrength = v) },
    });
  }
  if (Object.keys(acc).length > 0) {
    setEnvState(acc as Partial<EnvState>, { source: "manual" });
  }
}
