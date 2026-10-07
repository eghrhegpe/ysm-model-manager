// ===== 环境预设类型 + 每预设默认强度 唯一事实源 =====
// （[锐评 2026-10-07] EnvPresetId 下沉自 caps/environment-state.ts；
//   [锐评 P0-② 收口 2026-10-07] 再收编 ENV_PRESET_DEFAULT_INTENSITY——原「常量双源」。）
//
// 切 state → caps 的类型倒置：state/atmosphere-presets.ts 引环境预设枚举，本是 state 层
// 依赖 cap 侧定义（分层倒置）。下沉为 state 层零依赖叶子（ADR-168 preview-paths 同法），
// caps/environment-state.ts 反向从 state 引并 re-export 保公共面——方向归位 caps → state。

/** 环境贴图预设 id（"custom" = 用户手改脱离预设，非可选预设项） */
export type EnvPresetId = "sky" | "studio" | "sunset" | "night" | "forest" | "custom";

/** 可选预设 id（排除 "custom"）——ENV_PRESETS / ATMOSPHERE_PRESETS 的公共键域 */
export type SelectableEnvPresetId = Exclude<EnvPresetId, "custom">;

/**
 * 每预设默认 envMapIntensity（**唯一事实源**）。
 *
 * [锐评 P0-② 收口 2026-10-07] 收编原「常量双源」：`caps/environment-state.ts` 的
 * `ENV_PRESETS[].defaultIntensity` 与 `state/atmosphere-presets.ts` 的
 * `ATMOSPHERE_PRESETS[].envIntensity` 曾各自手写同一组数值（sky1.0/studio1.6/sunset1.4/
 * night0.7/forest1.1），两表零派生、零对账——正是本仓反复点名的「常量双源」病
 * （MikuMikuAR bd65c02f；`env-state-schema.ts` 头注同款病例）。今两表均由此表派生。
 *
 * 落在 state 层而非 caps 层：atmosphere-presets（state）与 environment-state（caps）
 * 都要读，唯一不违反 caps → state 单向依赖的位置就是 state 零依赖叶子。
 *
 * `satisfies` 保证**穷尽**：新增预设却漏填此表 → 编译期报错（防再次分叉的机器守卫）。
 */
export const ENV_PRESET_DEFAULT_INTENSITY = {
  sky: 1.0,
  studio: 1.6,
  sunset: 1.4,
  night: 0.7,
  forest: 1.1,
} as const satisfies Record<SelectableEnvPresetId, number>;
