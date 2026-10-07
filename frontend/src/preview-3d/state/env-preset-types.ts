// ===== EnvPresetId 唯一事实源（[锐评 2026-10-07] 下沉自 caps/environment-state.ts）=====
// 切 state → caps 的类型倒置：state/atmosphere-presets.ts 引环境预设枚举，本是 state 层
// 依赖 cap 侧定义（分层倒置）。下沉为 state 层零依赖类型叶子（ADR-168 preview-paths 同法），
// caps/environment-state.ts 反向从 state 引并 re-export 保公共面——方向归位 caps → state。

/** 环境贴图预设 id（"custom" = 用户手改脱离预设，非可选预设项） */
export type EnvPresetId = "sky" | "studio" | "sunset" | "night" | "forest" | "custom";
