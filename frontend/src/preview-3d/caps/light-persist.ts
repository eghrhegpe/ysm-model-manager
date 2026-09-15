// ===== LightCapability 持久化数据层（锐评 §三 下沉：职责⑤的纯数据面）=====
// 从 light-capability.ts 抽离：saveState 的参数映射 + loadState 的开关/参数恢复块。
// 均为「envState ↔ localStorage 嵌套结构」的纯数据映射，不触达 cap 私有字段
//（私有态：enabled/currentPreset/manualPreset 仍由主类 saveState/loadState
// 编排；顺序敏感段——预设先套用→开关恢复→syncConeMount→锥组重建——留在主类）。
// [ADR-246 D1] 原 volumetricEngine 维度已删（postprocess 空壳引擎移除）。
// 对齐 light-presets.ts（参数面）/ light-controls.ts（菜单面）的拆分先例。

import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import { restoreFields } from "./scene-capability.ts";

/* ============ saveState：envState → 持久化嵌套结构（纯读） ============ */

export function buildLightPersistPayload(): Record<string, unknown> {
  return {
    keyEnabled: envState.lightKeyEnabled,
    fillEnabled: envState.lightFillEnabled,
    rimEnabled: envState.lightRimEnabled,
    // 方向灯全量持久化（azimuth/elevation/color/intensity），跨会话不丢方向/强度/颜色
    key: {
      enabled: envState.lightKeyEnabled,
      color: envState.lightKeyColor,
      intensity: envState.lightKeyIntensity,
      azimuth: envState.lightKeyAzimuth,
      elevation: envState.lightKeyElevation,
    },
    fill: {
      enabled: envState.lightFillEnabled,
      color: envState.lightFillColor,
      intensity: envState.lightFillIntensity,
      azimuth: envState.lightFillAzimuth,
      elevation: envState.lightFillElevation,
    },
    rim: {
      enabled: envState.lightRimEnabled,
      color: envState.lightRimColor,
      intensity: envState.lightRimIntensity,
      azimuth: envState.lightRimAzimuth,
      elevation: envState.lightRimElevation,
    },
    ambient: {
      color: envState.lightAmbientColor,
      intensity: envState.lightAmbientIntensity,
    },
    spotlight: {
      enabled: envState.lightSpotEnabled,
      color: envState.lightSpotColor,
      intensity: envState.lightSpotIntensity,
      angle: envState.lightSpotAngle,
      penumbra: envState.lightSpotPenumbra,
      distance: envState.lightSpotDistance,
      decay: envState.lightSpotDecay,
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

/** 恢复方向灯全量字段（key/fill/rim），逐字段 typeof 校验后写入 accumulator（不派发）。 */
function restoreDir(
  which: "key" | "fill" | "rim",
  saved: unknown,
  acc: Record<string, unknown>,
): void {
  if (!saved || typeof saved !== "object") return;
  const s = saved as Record<string, unknown>;
  const prefix = `light${which.charAt(0).toUpperCase()}${which.slice(1)}`;
  if (typeof s.enabled === "boolean") acc[`${prefix}Enabled`] = s.enabled;
  if (typeof s.color === "number") acc[`${prefix}Color`] = s.color;
  if (typeof s.intensity === "number") acc[`${prefix}Intensity`] = s.intensity;
  if (typeof s.azimuth === "number") acc[`${prefix}Azimuth`] = s.azimuth;
  if (typeof s.elevation === "number") acc[`${prefix}Elevation`] = s.elevation;
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
  if (typeof state.spotlightEnabled === "boolean") {
    acc.lightSpotEnabled = state.spotlightEnabled;
  }
  if (typeof state.volumetricEnabled === "boolean") {
    acc.lightVolumetricEnabled = state.volumetricEnabled;
  }
  // ②.b 全量参数恢复（方向灯 key/fill/rim 并入同一 accumulator）
  restoreDir("key", state.key, acc);
  restoreDir("fill", state.fill, acc);
  restoreDir("rim", state.rim, acc);
  if (state.ambient && typeof state.ambient === "object") {
    restoreFields(state.ambient as Record<string, unknown>, {
      intensity: { number: (v) => (acc.lightAmbientIntensity = v) },
      color: { number: (v) => (acc.lightAmbientColor = v) },
    });
  }
  if (state.spotlight && typeof state.spotlight === "object") {
    restoreFields(state.spotlight as Record<string, unknown>, {
      enabled: { boolean: (v) => (acc.lightSpotEnabled = v) },
      color: { number: (v) => (acc.lightSpotColor = v) },
      intensity: { number: (v) => (acc.lightSpotIntensity = v) },
      angle: { number: (v) => (acc.lightSpotAngle = v) },
      penumbra: { number: (v) => (acc.lightSpotPenumbra = v) },
      distance: { number: (v) => (acc.lightSpotDistance = v) },
      decay: { number: (v) => (acc.lightSpotDecay = v) },
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
