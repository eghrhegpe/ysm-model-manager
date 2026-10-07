// ===== 地面材质默认值/取值集单一事实源（[锐评 2026-10-07] 自 caps/ground-surface-spec.ts 下沉）=====
// 切 state→caps 分层倒置：env-state-schema.ts 引地面默认值/取值集，本是 state 层依赖 cap
// 实现文件（分层倒置）。下沉为 state 层零依赖纯数据叶子（ADR-168 preview-paths / EnvPresetId
// 下沉同法），caps/ground-surface-spec.ts 反向从 state 引并 re-export 保公共面——方向归位
// caps → state。⚠️ 默认值/取值集**仍不在此重写字面量**：此处即唯一事实源（ADR-249 §2.6），
// schema 与 cap 都从本叶子读，历史 4 处分歧（matGridSize 10 vs 8 / matRoughness 0.8 vs 0.85 /
// matLineColor / matColor2）不再有第二份可漂移。

/** 地面表面模式（当前 = 来源 × **材质**；几何图案已迁至叠加层轴——ADR-252）。 */
export type GroundSurfaceMode =
  | "none"
  | "solid"
  | "plain"
  | "marble"
  | "sand"
  | "grass"
  | "texture";

/** 来源轴：颜色从哪来（决定渲染管线） */
export type GroundSourceKind = "none" | "solid" | "canvas" | "texture";

/** 样式轴：程序化画布长什么样（**纯材质**；仅 sourceKind === "canvas" 有效）。 */
export type GroundCanvasStyle = "plain" | "marble" | "sand" | "grass";

/** 叠加层样式（独立于来源轴/样式轴，可叠加在任意底层之上） */
export type GroundOverlayStyle = "none" | "grid" | "checker" | "stripes" | "diamond";

export interface GroundMaterialParams {
  /** 表面模式 */
  matSource: GroundSurfaceMode;
  /** 底色 / 素面色（0xRRGGBB） */
  matColor: number;
  // ADR-252：原 `matLineColor` 已删除——几何图案（唯一读线色者）已迁至叠加层轴，
  // 叠加层用自己的 `groundOverlayColor`。旧存档的该值由迁移搬入 `groundOverlayColor`。
  /** 渐变副色 / 大理石纹线色（0xRRGGBB） */
  matColor2: number;
  /** 噪声材质粒度基准（ADR-252：图案离场后仅噪声材质读它） */
  matGridSize: number;
  /** 表面不透明度 0=全透 1=不透明 */
  matOpacity: number;
  /** 纹理缩放倍率（越大重复越多越细） */
  matScale: number;
  /** 纹理旋转角（度，UI 直读） */
  matRotationDeg: number;
  /** PBR 粗糙度 */
  matRoughness: number;
  /** PBR 金属度 */
  matMetalness: number;
  /** 图案密度（条纹/大理石 有效，控制粗细/频率） */
  matDensity: number;
  /** 图案角度（度，条纹/菱形/大理石 生效；UI 直读 0~360） */
  matAngleDeg: number;
  /** [P1 批 2026-10-04] 微噪点纹理幅度（±/255；0=关）——plain 系生成器（solid/plain）消费 */
  matMicroNoise: number;
  /** [P1 批 2026-10-04] IBL 反射强度（极低值=「坐地」接地呼应，不抢模型焦点） */
  matEnvMapIntensity: number;
}

export const DEFAULT_GROUND_SURFACE_PARAMS: GroundMaterialParams = {
  matSource: "none",
  matColor: 0x9a8b78,
  matColor2: 0x6b5d4c,
  matGridSize: 8,
  matOpacity: 1,
  matScale: 1,
  matRotationDeg: 0,
  matRoughness: 0.85,
  matMetalness: 0,
  matDensity: 1,
  matAngleDeg: 0,
  // [P1 批 2026-10-04] 默认 ±6/255 高频微噪点（人眼几乎不觉察，破除纯色塑料感）
  matMicroNoise: 6,
  // [P1 批 2026-10-04] 极低 IBL 反射（摄影棚 floor 接地手法）
  matEnvMapIntensity: 0.15,
};

/** 来源轴取值集合（ADR-249 §2.1；loadState 校验 + 菜单来源 select 选项用） */
export const GROUND_SOURCE_KINDS = [
  "none",
  "solid",
  "canvas",
  "texture",
] as const satisfies readonly GroundSourceKind[];

/** 样式轴取值集合（纯材质，仅 sourceKind === "canvas" 有效；ADR-252 起不含几何图案）。 */
export const GROUND_CANVAS_STYLES = [
  "plain",
  "marble",
  "sand",
  "grass",
] as const satisfies readonly GroundCanvasStyle[];

/** 菜单可选的预设项（不含 custom） */
export const GROUND_MATERIAL_PRESET_IDS = [
  "plain",
  "marble",
  "sand",
  "grass",
] as const satisfies readonly GroundCanvasStyle[];

/** 叠加层样式取值集合（ADR-249 §2.3 架构；ADR-251 补齐几何图案集） */
export const GROUND_OVERLAY_STYLES = [
  "none",
  "grid",
  "checker",
  "stripes",
  "diamond",
] as const satisfies readonly GroundOverlayStyle[];
