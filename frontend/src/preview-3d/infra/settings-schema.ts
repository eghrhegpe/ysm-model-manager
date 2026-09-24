// ===== settings-schema.ts — 3D 预览持久化偏好的单一数据源（ADR-303）=====
//
// 为什么需要本文件：相机速度 / 旋转模式 / 分辨率上限这些偏好有**两个写入面**
// ——主设置页 HTML 模板（`views/app-content/settings/tpl-settings.ts`）与
// 3D ⚙ 面板 `PreviewMenuNode`（`preview-3d/menu/panels/settings.ts`）——外加一个
// 存储读取层（`preview-3d/infra/keymap.ts` / `render-budget.ts`）。
// 键此前已收口成常量，但**值域 / 步进 / 默认值 / 枚举**三处各写一份裸字面量：
// 改一处漏一处即静默错位（滑块可拖到区间外，读取层 clamp 回退默认，
// 表现为「拖了没反应且无报错」；默认值同理，分居两文件改一漏一即用户设置被静默重置）。
// 本模块把规格收成唯一声明处——两面的渲染方式仍各自独立，只共享规格数据（ADR-303 §2）。
//
// 纯数据叶：**零依赖**（不 import three / DOM / 上层 / 甚至 i18n）——`views` 与
// `preview-3d` 各面均可安全引用，不给主设置页拉进渲染或预算机械。
// 有意不携带 labelKey：两面文案键域不同（主设置页 `settings.preview3d.*`、
// ⚙ 面板 `preview.cameraRotation*`），值 → 文案的映射归各面（见 ADR-303 §2）。

/** 数值型偏好规格：键 + 值域 + 步进 + 默认。**默认值必落在 [min, max] 内**（由测试断言，非注释约定）。 */
export interface TdNumericSpec {
  /** localStorage 键 */
  readonly key: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

/** 3D 键位映射持久化键。值表 `DEFAULT_TD_KEYMAP` 归 `infra/keymap.ts`——那是键位语义
 *  数据（KeyboardEvent.code 六向映射），不是「值域 / 默认」规格，不属本模块（ADR-303 §2）。 */
export const TD_KEYMAP_KEY = "td-keymap";

/** 相机移动速度：主设置页 slider ↔ 3D ⚙ 面板 slider ↔ `loadTdCamSpeed` clamp 同源 */
export const TD_CAM_SPEED: TdNumericSpec = {
  key: "td-cam-speed",
  min: 2,
  max: 200,
  step: 1,
  default: 20,
};

/**
 * 相机旋转模式：`orbit` = 环绕 / `free` = 自身。
 * 枚举成员具名导出（`TD_ROT_MODE.orbit` / `.free`）——消费面用名字而非裸字符串，
 * 新增模式时 `Record<TdRotMode, _>` 形态的文案表会编译期报错，逼出同步。
 */
export const TD_ROT_MODE = {
  key: "td-rot-mode",
  orbit: "orbit",
  free: "free",
  values: ["orbit", "free"],
  default: "orbit",
} as const;

/** 旋转模式取值（"orbit" | "free"） */
export type TdRotMode = (typeof TD_ROT_MODE)["values"][number];

/** 渲染分辨率上限（3D ⚙ 面板 slider ↔ `getMaxPixelRatio` clamp 同源）。
 *  ⚠️ 自适应降采样的地板 `MIN_PIXEL_RATIO`（`render-budget.ts`）是**另一个旋钮**
 *  （运行时自动降级的地板 ≠ 用户可设上限），有意不并入，避免两个独立旋钮互相误导（ADR-303 §2）。 */
export const TD_PIXEL_RATIO: TdNumericSpec = {
  key: "ysm_3d_maxPixelRatio",
  min: 0.5,
  max: 2,
  step: 0.25,
  default: 1.5,
};
