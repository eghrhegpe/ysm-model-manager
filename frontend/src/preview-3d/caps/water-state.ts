// ===== 水面能力状态/序列化层（拆轴自 water-capability.ts）=====
// 收口「巨型 cap 混装状态与 Three 装配」的锐评结论：本文件收敛纯数据 + 纯类型轴
// （WaterParams / 默认值 / 呈现模式），零 THREE 依赖、无顶层副作用；
// water-capability.ts 保留波浪 shader / 法线贴图 / 容器装配等渲染轴。

/** 水面呈现模式：film=贴地薄水膜；pool=立体水池（有侧壁 + 高度） */
export type WaterMode = "film" | "pool";

export const WATER_MODES: readonly WaterMode[] = ["film", "pool"];

export interface WaterParams {
  /** 水面平面尺寸（世界单位；默认对齐地面 size=80，保证视觉一致） */
  size: number;
  /** 水面是否独立启用（总开关；默认 true） */
  enabled: boolean;
  /** 水面呈现模式 */
  mode: WaterMode;
  /** 湿润度 0=干 1=完全湿润；film 模式下相当于乘 opacity 的遮罩 */
  wetness: number;
  /** 水面颜色（film/pool 顶部共用） */
  waterColor: number;
  /** 水面不透明度 0=透明 1=不透明 */
  waterOpacity: number;
  /** 波浪法线强度 0=无效果 1=完全按波浪法线 */
  normalStrength: number;
  /** （pool）水池高度（从 y=0 起的正高度，世界单位） */
  poolHeight: number;
  /** （pool）池壁厚度（太小会 z-fighting；≥0.05） */
  poolWallThickness: number;
  /** （pool）池壁外侧面颜色（与水面形成内外对比） */
  poolWallColor: number;
  /** （pool）边缘羽化/圆角半径 0~0.5（0=直角；材质级，无几何重建成本） */
  poolRoundness: number;
  /** 波纹动画速度倍率（1=原速；0=静止） */
  waveSpeed: number;
  /** 水体通透度（物理 transmission：0=完全浑浊，1=完全透射） */
  clarity: number;
}

export const DEFAULT_WATER_PARAMS: WaterParams = {
  size: 80,
  enabled: true,
  mode: "film",
  wetness: 0.15,
  waterColor: 0x335577,
  waterOpacity: 0.25,
  normalStrength: 0.08,
  poolHeight: 0.3,
  poolWallThickness: 0.15,
  poolWallColor: 0x1a2a44,
  poolRoundness: 0,
  waveSpeed: 1.0,
  clarity: 0.6,
};
