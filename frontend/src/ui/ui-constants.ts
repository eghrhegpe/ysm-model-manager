// 🥉 ui-helpers 组件库 — UI 与场景常量收敛。
// 自 MikuMikuAR ui-constants.ts 迁移，仅保留 🥉 组件实际引用的滑块四分位步进分数。
// （DEFAULT_GRAVITY / ENV_LIGHT_MAX / SCENE_EVENTS 等为 MikuMikuAR 领域常量，未带入。）

/** 左区大幅减步进：全范围 15% */
export const SLIDER_QUARTER_LARGE_STEP = 0.15;
/** 中左/中右微调步进：全范围 5% */
export const SLIDER_QUARTER_SMALL_STEP = 0.05;

/** 3D 全屏预览 overlay 根容器 ID（mount-preview-core 挂载 / app-tree 快捷键门禁共用） */
export const PREVIEW_OVERLAY_ID = "ysm-overlay-3d";
