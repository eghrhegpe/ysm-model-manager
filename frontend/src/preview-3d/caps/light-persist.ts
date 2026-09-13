// ===== LightCapability 持久化数据层（锐评 §三 下沉：职责⑤的纯数据面）=====
// 从 light-capability.ts 抽离：saveState 的参数映射 + loadState 的开关/参数恢复块。
// 均为「envState ↔ localStorage 嵌套结构」的纯数据映射，不触达 cap 私有字段
//（私有态：enabled/volumetricEngine/currentPreset/manualPreset 仍由主类 saveState/loadState
// 编排；顺序敏感段——预设先套用→开关恢复→syncConeMount→引擎恢复——留在主类）。
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

/** 恢复方向灯全量字段（key/fill/rim），逐字段 typeof 校验后写入 envState。 */
function restoreDir(which: "key" | "fill" | "rim", saved: unknown): void {
  if (!saved || typeof saved !== "object") return;
  const s = saved as Record<string, unknown>;
  const prefix = `light${which.charAt(0).toUpperCase()}${which.slice(1)}`;
  const assignments: Record<string, unknown> = {};
  if (typeof s.enabled === "boolean") assignments[`${prefix}Enabled`] = s.enabled;
  if (typeof s.color === "number") assignments[`${prefix}Color`] = s.color;
  if (typeof s.intensity === "number") assignments[`${prefix}Intensity`] = s.intensity;
  if (typeof s.azimuth === "number") assignments[`${prefix}Azimuth`] = s.azimuth;
  if (typeof s.elevation === "number") assignments[`${prefix}Elevation`] = s.elevation;
  if (Object.keys(assignments).length > 0) {
    setEnvState(assignments as Partial<EnvState>, { source: "manual" });
  }
}

/**
 * 用户显式保存的灯开关与全量参数恢复（须在模型预设套用之后调用——
 * 「预设以 envState 为准，后恢复的用户值优先」，ADR-126 P5「手动优先」同口径）。
 */
export function restoreLightParams(state: Record<string, unknown>): void {
  // ② 用户显式保存的灯开关优先于模型预设
  if (typeof state.ambientIntensity === "number") {
    setEnvState({ lightAmbientIntensity: state.ambientIntensity }, { source: "manual" });
  }
  if (typeof state.keyEnabled === "boolean") {
    setEnvState({ lightKeyEnabled: state.keyEnabled }, { source: "manual" });
  }
  if (typeof state.fillEnabled === "boolean") {
    setEnvState({ lightFillEnabled: state.fillEnabled }, { source: "manual" });
  }
  if (typeof state.rimEnabled === "boolean") {
    setEnvState({ lightRimEnabled: state.rimEnabled }, { source: "manual" });
  }
  if (typeof state.spotlightEnabled === "boolean") {
    setEnvState({ lightSpotEnabled: state.spotlightEnabled }, { source: "manual" });
  }
  if (typeof state.volumetricEnabled === "boolean") {
    setEnvState({ lightVolumetricEnabled: state.volumetricEnabled }, { source: "manual" });
  }
  // ②.b 全量参数恢复
  restoreDir("key", state.key);
  restoreDir("fill", state.fill);
  restoreDir("rim", state.rim);
  if (state.ambient && typeof state.ambient === "object") {
    const ambAcc: Partial<EnvState> = {};
    if (
      restoreFields(state.ambient as Record<string, unknown>, {
        intensity: { number: (v) => (ambAcc.lightAmbientIntensity = v) },
        color: { number: (v) => (ambAcc.lightAmbientColor = v) },
      })
    ) {
      setEnvState(ambAcc, { source: "manual" });
    }
  }
  if (state.spotlight && typeof state.spotlight === "object") {
    const spAcc: Partial<EnvState> = {};
    if (
      restoreFields(state.spotlight as Record<string, unknown>, {
        enabled: { boolean: (v) => (spAcc.lightSpotEnabled = v) },
        color: { number: (v) => (spAcc.lightSpotColor = v) },
        intensity: { number: (v) => (spAcc.lightSpotIntensity = v) },
        angle: { number: (v) => (spAcc.lightSpotAngle = v) },
        penumbra: { number: (v) => (spAcc.lightSpotPenumbra = v) },
        distance: { number: (v) => (spAcc.lightSpotDistance = v) },
        decay: { number: (v) => (spAcc.lightSpotDecay = v) },
      })
    ) {
      setEnvState(spAcc, { source: "manual" });
    }
  }
  if (state.volumetric && typeof state.volumetric === "object") {
    const volAcc: Partial<EnvState> = {};
    if (
      restoreFields(state.volumetric as Record<string, unknown>, {
        enabled: { boolean: (v) => (volAcc.lightVolumetricEnabled = v) },
        opacity: { number: (v) => (volAcc.lightVolumetricOpacity = v) },
        fogPower: { number: (v) => (volAcc.lightVolumetricFogPower = v) },
        edgeFade: { number: (v) => (volAcc.lightVolumetricEdgeFade = v) },
        baseStrength: { number: (v) => (volAcc.lightVolumetricBaseStrength = v) },
        tipStrength: { number: (v) => (volAcc.lightVolumetricTipStrength = v) },
      })
    ) {
      setEnvState(volAcc, { source: "manual" });
    }
  }
}
