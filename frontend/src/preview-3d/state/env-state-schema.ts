// ===== 统一场景状态 Schema（ADR-196 刀 0）=====
// 收口全部 cap 参数声明：类型 + 默认值 + dispatch 组。
// 仿 MikuMikuAR ENV_STATE_SCHEMA 模式，新增字段只需在此追加。
//
// ⚠️ 默认值单一事实源（ADR-249 §2.6）：地面材质字段的默认值取自
// ground-surface-spec.ts 的 DEFAULT_GROUND_SURFACE_PARAMS，**不在此重写字面量**。
// 历史缺陷：两处各自声明默认值且不一致（matGridSize 10 vs 8、matRoughness 0.8 vs 0.85、
// matLineColor/matColor2 亦分歧），实际渲染读 spec 侧 → schema 侧为死值，
// 用户看到的数值与 schema 声明对不上。同类病例参照 MikuMikuAR bd65c02f（常量双源）。
import {
  GROUND_CANVAS_STYLES,
  DEFAULT_GROUND_SURFACE_PARAMS as GROUND_DEFAULTS,
  GROUND_MATERIAL_PRESET_IDS,
  GROUND_OVERLAY_STYLES,
  GROUND_SOURCE_KINDS,
} from "@/preview-3d/caps/ground-surface-spec.ts";
import { clamp } from "@/utils/base/pure/clamp.ts";

type FieldDefaultMap = {
  number: number;
  boolean: boolean;
  string: string;
  enum: string;
  /** 三维分量（RGB 等）。⚠️ 当前 schema 无使用者（原 ground tuple3 三键系死键，2026-09-21
   *  锐评清理删除）；deriveDefaultEnvState 的深拷贝分支保留为通用能力，勿随手删。 */
  tuple3: readonly [number, number, number];
  "nullable-boolean": boolean | null;
  "nullable-number": number | null;
};

/** 数值值域描述符（ADR-283）：schema 是值域的**唯一事实源**。
 *  - `range`   = **合法域**：`setEnvState` 唯一写入口按此钳制（step/unit 不参与钳制，仅供菜单）；
 *  - `uiRange` = **展示域**（可选，缺省 = range）：滑杆行程的手感设计，可与合法域不同
 *               （`waterSize` 合法 ≥1，但滑杆 10–300 才是常用区）。
 *  只声明在 `type: "number"` 字段上（颜色虽为 number，但无值域语义，故不声明）。 */
export type NumericRange = {
  readonly min: number;
  readonly max: number;
  /** 步长（**必填**：值域的实际消费者是滑杆；给个缺省值反而会成为隐藏的第二事实源）。 */
  readonly step: number;
  readonly unit?: string;
};

type _FieldDef<TType extends keyof FieldDefaultMap> = {
  type: TType;
  default: FieldDefaultMap[TType];
  /** dispatch 分组：字段变化时触发哪些 cap 回调。未指定 = 不触发。 */
  group?: string | readonly string[];
} & (TType extends "enum" ? { values: readonly string[] } : object) &
  (TType extends "number" ? { range?: NumericRange; uiRange?: NumericRange } : object);

type _AnyFieldDef = {
  [TType in keyof FieldDefaultMap]: _FieldDef<TType>;
}[keyof FieldDefaultMap];

// ======== Schema 定义 ========
// 按 sky / ground / water / environment / fog / shadow / reflector / renderMode / postprocessing / light 分组

export const ENV_STATE_SCHEMA = {
  // --- Sky ---
  skyTimeOfDay: { type: "number", default: 9, group: "sky" },
  skyCloudCoverage: {
    type: "number",
    default: 0,
    group: "sky",
    range: { min: 0, max: 1, step: 0.05, unit: "%" },
  },
  skyElevation: { type: "number", default: 10, group: "sky" },
  skyAzimuth: { type: "number", default: 180, group: "sky" },
  skyForceEnv: { type: "boolean", default: true, group: "sky" },
  skyTurbidity: { type: "number", default: 7.5, group: "sky" },
  skyRayleigh: { type: "number", default: 2.5, group: "sky" },
  skyMieCoefficient: { type: "number", default: 0.005, group: "sky" },
  skyMieDirectionalG: { type: "number", default: 0.8, group: "sky" },
  skySunIntensityScale: {
    type: "number",
    default: 0.75,
    group: "sky",
    // 合法域 [0,1.5]（原 setter 钳制）；滑杆 [0.3,1.2] 是手感行程（ADR-283 §2.2 域分离）
    range: { min: 0, max: 1.5, step: 0.05 },
    uiRange: { min: 0.3, max: 1.2, step: 0.05 },
  },
  skySunDiscScale: {
    type: "number",
    default: 0.5,
    group: "sky",
    // 合法域 [0,1.5]（原 setter 钳制）；滑杆 [0,1.2] 是手感行程（ADR-283 §2.2 域分离）
    range: { min: 0, max: 1.5, step: 0.05 },
    uiRange: { min: 0, max: 1.2, step: 0.05 },
  },
  skyExposure: { type: "number", default: 0.5, group: "sky" },
  skyEnvironment: { type: "boolean", default: true, group: "sky" },
  skyGodRaysEnabled: { type: "boolean", default: false, group: "sky" },
  skyAutoRotate: { type: "boolean", default: false, group: "sky" },
  // [锐评 S2-4 收口] 原 `skyScale` 键已摘除——它是**内部实现常量**而非用户状态：
  //   ① 无 UI 控件、cap 回调无 changed 分支 ⇒ 任何途径改它都不重建天空盒（死键）；
  //   ② saveState 从不落盘（见 sky-capability.saveState），故无历史存档依赖，摘除零兼容成本；
  //   ③ 该值有硬物理约束——天空盒半边长须 > 相机 maxDistance(5000)，否则相机拉远即
  //      飞出盒外、天空消失（Side=BackSide + 顶点 z 强制 far）。
  // 现提为 sky-capability.ts 的模块常量 SKY_SCALE，约束出处与被约束者同处一文件。

  // --- Ground ---
  groundVisible: { type: "boolean", default: true, group: "ground" },
  // 2026-09-19：参考网格（GridHelper 层）独立开关——历史遗留（知识卡「已知遗留 1」）是
  // 网格层与表面材质层共用 groundVisible，用户选了纯色/贴图材质也关不掉底下那张 y=0 参考网格，
  // 且菜单无任何网格参数出口。现拆出单轴：网格显隐 = enabled && groundVisible && groundGridVisible。
  groundGridVisible: { type: "boolean", default: true, group: "ground" },
  // ADR-249 §2.1 拆轴：来源轴（颜色从哪来）。替代原单枚举 groundMatSource。
  groundSourceKind: {
    type: "enum",
    values: GROUND_SOURCE_KINDS,
    default: "none",
    group: "ground",
  },
  // ADR-249 §2.1 拆轴：样式轴（程序化画布长什么样，仅 sourceKind===canvas 有效）。
  groundCanvasStyle: {
    type: "enum",
    values: GROUND_CANVAS_STYLES,
    default: "plain",
    group: "ground",
  },
  // ADR-254：材质预设显式状态——「当前处于哪个材质预设」是可见事实。
  // `custom` = 用户手改过预设关心的字段，已脱离预设（由写入中间件置位）。
  groundMaterialPreset: {
    type: "enum",
    values: [...GROUND_MATERIAL_PRESET_IDS, "custom"] as const,
    default: "plain",
    group: "ground",
  },
  // ADR-249 §2.3 叠加层：独立透明格线层（正交于来源/样式两轴）
  groundOverlay: {
    type: "enum",
    values: GROUND_OVERLAY_STYLES,
    default: "none",
    group: "ground",
  },
  groundOverlayColor: { type: "number", default: 0xffffff, group: "ground" },
  groundOverlaySize: {
    type: "number",
    default: 10,
    group: "ground",
    range: { min: 2, max: 64, step: 1 },
  },
  groundOverlayOpacity: {
    type: "number",
    default: 1,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  // ADR-249 §2.6：默认值统一取自 spec（唯一事实源），不在此重写字面量。
  groundSize: {
    type: "number",
    default: 80,
    group: "ground",
    // 合法域对齐 waterSize（≥1）；展示域 10–300 与水面滑杆同手感，两轴分离（ADR-283）。
    range: { min: 1, max: 1000, step: 1 },
    uiRange: { min: 10, max: 300, step: 1, unit: "m" },
  },
  groundDivisions: {
    type: "number",
    default: 60,
    group: "ground",
    range: { min: 2, max: 200, step: 2 },
  },
  groundColorCenter: { type: "number", default: 0x555577, group: "ground" },
  groundColorGrid: { type: "number", default: 0x2a2a3a, group: "ground" },
  groundMatColor: { type: "number", default: GROUND_DEFAULTS.matColor, group: "ground" },
  groundMatColor2: { type: "number", default: GROUND_DEFAULTS.matColor2, group: "ground" },
  groundMatGridSize: {
    type: "number",
    default: GROUND_DEFAULTS.matGridSize,
    group: "ground",
    // 合法域上界 32 取自滑杆（原钳制 Math.max(2, round(n)) 无上界，ADR-283 迁移时补齐）
    range: { min: 2, max: 32, step: 1 },
  },
  groundMatOpacity: {
    type: "number",
    default: GROUND_DEFAULTS.matOpacity,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  groundMatScale: {
    type: "number",
    default: GROUND_DEFAULTS.matScale,
    group: "ground",
    range: { min: 0.25, max: 8, step: 0.25 },
  },
  groundMatRotationDeg: {
    type: "number",
    default: GROUND_DEFAULTS.matRotationDeg,
    group: "ground",
    // 角度域 [0,360]：实际归一靠 setter 的 360 回绕（非钳制），故入口钳制不会触发
    range: { min: 0, max: 360, step: 5, unit: "°" },
  },
  groundMatDensity: {
    type: "number",
    default: GROUND_DEFAULTS.matDensity,
    group: "ground",
    range: { min: 0.25, max: 8, step: 0.25 },
  },
  groundMatAngleDeg: {
    type: "number",
    default: GROUND_DEFAULTS.matAngleDeg,
    group: "ground",
    // 同 rotation：语义是回绕而非钳制
    range: { min: 0, max: 360, step: 5, unit: "°" },
  },
  groundMatRoughness: {
    type: "number",
    default: GROUND_DEFAULTS.matRoughness,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },
  groundMatMetalness: {
    type: "number",
    default: GROUND_DEFAULTS.matMetalness,
    group: "ground",
    range: { min: 0, max: 1, step: 0.05 },
  },

  // --- Water ---
  waterEnabled: { type: "boolean", default: true, group: "water" },
  waterMode: {
    type: "enum",
    values: ["film", "pool"] as const,
    default: "film",
    group: "water",
  },
  // ADR-257：水面世界 y 坐标——「抬高/压低水面」的唯一入口，film 与 pool 共用。
  // 默认 0.01 = film 历史水膜微抬量（原 scene-capability.ts|GROUND_LAYER_OFFSETS.waterFilm
  // 已随 2026-09-18 收口删除，此处成为唯一事实源）；本 schema 为零 THREE 依赖层，故写字面量。
  waterLevel: {
    type: "number",
    default: 0.01,
    group: "water",
    range: { min: 0, max: 5, step: 0.01, unit: "m" },
  },
  waterWetness: {
    type: "number",
    default: 0.5,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterColor: { type: "number", default: 0x335577, group: "water" }, // 颜色：无值域语义，不声明 range
  waterOpacity: {
    type: "number",
    default: 0.25,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterNormalStrength: {
    type: "number",
    default: 0.08,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterClarity: {
    type: "number",
    default: 0.6,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterWaveSpeed: {
    type: "number",
    default: 1.0,
    group: "water",
    range: { min: 0, max: 3, step: 0.05, unit: "x" },
  },
  waterChoppiness: {
    type: "number",
    default: 0.5,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  waterPoolHeight: {
    type: "number",
    default: 0.3,
    group: "water",
    range: { min: 0.01, max: 5, step: 0.05, unit: "m" },
  },
  waterPoolWallThickness: {
    type: "number",
    default: 0.15,
    group: "water",
    range: { min: 0.01, max: 2, step: 0.01, unit: "m" },
  },
  waterPoolWallColor: { type: "number", default: 0x1a2a44, group: "water" }, // 颜色：同上
  waterPoolRoundness: {
    type: "number",
    default: 0,
    group: "water",
    range: { min: 0, max: 0.5, step: 0.01 },
  },
  // 合法域下界 = 1（0/负数会让水面退化成一个点；与 loadState 脏数据同口径）；
  // 展示域 10–300 是滑杆手感设计（默认 80 居中，step=1 避开小数累加误差）。
  waterSize: {
    type: "number",
    default: 80,
    group: "water",
    range: { min: 1, max: 300, step: 1, unit: "m" },
    uiRange: { min: 10, max: 300, step: 1, unit: "m" },
  },
  // ── 水面模型倒影（ADR-297：隐藏 Reflector 借官方 RT + 水 shader 投影采样）──
  // 默认关：倒影 = 每帧多一次整场重渲进 RT，不是白拿的——与地面 reflectorEnabled 同纪律。
  waterReflectionEnabled: { type: "boolean", default: false, group: "water" },
  // 混合权重上限（fresnel 掠射增强乘于其上；0 等于关混合但保留 RT——通常直接关总开关）。
  waterReflectionStrength: {
    type: "number",
    default: 0.6,
    group: "water",
    range: { min: 0, max: 1, step: 0.05 },
  },
  // 反射 RT 边长（px）：step=256 离散档位（256 省 / 512 默认 / 2048 近观）。
  // 变更走 Reflector RT setSize 原位扩缩，不重建载体（water-capability renderReflection）。
  waterReflectionResolution: {
    type: "number",
    default: 512,
    group: "water",
    range: { min: 256, max: 2048, step: 256, unit: "px" },
  },
  // SSR 活跃时抑制水反射（ppReflectorDisableWhenSSR 同范式）：屏幕空间倒影与平面反射
  // 双叠过亮发脏。抑制态归水 cap 持有（ADR-247 D2 口径），逐帧现读 pp 键不另订阅。
  waterReflectDisableWhenSSR: { type: "boolean", default: true, group: "water" },
  // [锐评 F-2 收口 2026-09-23] 镜像裁剪偏置（clipBias）：官方 Reflector 用它把镜像相机
  // 近裁剪面自镜面平面调正（投影视空间调正量，非米制），控制与水面相交内容的倒影裁切。
  // 原为 ensureReflector 内裸字面量 `3`——三无魔法数（无注释/无登记/无测试锁），下沉
  // schema 键收编值域单源纪律（ADR-283）。**默认保持 3 = 现观感零变化**（three 官方
  // 示例 0.003 是默认近平面场景的观感实验值，量级语义不同，勿"对齐"回去）；0 = 裸裁剪。
  // ⚠️ clipBias 烘进 Reflector.onBeforeRender 闭包（r185 源码实证），**不可就地改**——
  // 变更须弃载体懒建重建（消费点 water-capability.ts|ensureReflector，守卫见其测试）。
  waterReflectionClipBias: {
    type: "number",
    default: 3,
    group: "water",
    range: { min: 0, max: 10, step: 0.1 },
  },

  // --- Environment ---
  envPreset: {
    type: "enum",
    values: ["sky", "studio", "sunset", "night", "forest", "custom"] as const,
    default: "sky",
    group: "environment",
  },
  envIntensity: {
    type: "number",
    default: 1.0,
    group: "environment",
    // 合法域 [0,5]（写入钳制：HDR 环境常需 >3）；滑杆展示域 [0,3] 是手感设计（ADR-283 §2.2）
    range: { min: 0, max: 5, step: 0.05 },
    uiRange: { min: 0, max: 3, step: 0.05 },
  },
  envUseAsBackground: { type: "boolean", default: false, group: "environment" },
  envResolution: { type: "number", default: 1024, group: "environment" },
  // [ADR-292 D5] 环境贴图数据源——scene.environment 唯一槽位的「谁在供图」单一事实源。
  // 三者互斥：preset（程序化 Canvas 预设）/ sky（跟随天空，向 SkyCapability 取烘焙图）/
  // custom（用户加载的 HDR 文件）。旧存档迁移见 caps/environment-migrations.ts。
  // ⚠️ 与 envPreset 的分工：envPreset 选「哪张预设图」，envSource 选「走哪条取图通路」。
  // envSource !== "preset" 时 envPreset 无意义但**保留原值**（切回时免于丢失用户选择）。
  envSource: {
    type: "enum",
    values: ["preset", "sky", "custom"] as const,
    default: "preset",
    group: "environment",
  },

  // --- Fog ---
  fogEnabled: { type: "boolean", default: false, group: "fog" },
  fogMode: {
    type: "enum",
    values: ["linear", "exp2"] as const,
    default: "linear",
    group: "fog",
  },
  fogColor: { type: "number", default: 0xaac4e8, group: "fog" },
  fogDensity: {
    type: "number",
    default: 0.015,
    group: "fog",
    range: { min: 0.001, max: 0.1, step: 0.001 },
  },
  fogNear: {
    type: "number",
    default: 10,
    group: "fog",
    range: { min: 0, max: 500, step: 1 },
  },
  fogFar: {
    type: "number",
    default: 200,
    group: "fog",
    range: { min: 10, max: 2000, step: 10 },
  },

  // --- Shadow ---
  shadowEnabled: { type: "boolean", default: true, group: "shadow" },
  shadowType: {
    type: "enum",
    values: ["soft", "hard"] as const,
    default: "hard",
    group: "shadow",
  },
  shadowMapSize: { type: "number", default: 2048, group: "shadow" },
  shadowBias: {
    type: "number",
    default: -0.0005,
    group: "shadow",
    range: { min: -0.01, max: 0.001, step: 0.0001 },
  },
  shadowNormalBias: {
    type: "number",
    default: 0.02,
    group: "shadow",
    range: { min: 0, max: 0.1, step: 0.005 },
  },
  shadowCameraSize: {
    type: "number",
    default: 15,
    group: "shadow",
    range: { min: 5, max: 80, step: 1 },
  },

  // --- Reflector ---
  reflectorEnabled: { type: "boolean", default: false, group: "reflector" },
  reflectorOpacity: {
    type: "number",
    default: 0.6,
    group: "reflector",
    range: { min: 0, max: 1, step: 0.01 },
  },
  reflectorResolution: {
    type: "number",
    default: 1024,
    group: "reflector",
    range: { min: 256, max: 2048, step: 256 },
  },
  reflectorSize: {
    type: "number",
    default: 100,
    group: "reflector",
    range: { min: 20, max: 500, step: 10 },
  },
  reflectorColor: { type: "number", default: 0xffffff, group: "reflector" },
  reflectorClipBias: { type: "number", default: 0.003, group: "reflector" },

  // --- Render Mode ---
  renderModeWireframe: { type: "nullable-boolean", default: null, group: "renderMode" },
  renderModeBlending: { type: "nullable-number", default: null, group: "renderMode" },
  renderModeDepthTest: { type: "nullable-boolean", default: null, group: "renderMode" },
  renderModeSide: { type: "nullable-number", default: null, group: "renderMode" },
  renderModeDepthWrite: { type: "nullable-boolean", default: null, group: "renderMode" },

  // --- Postprocessing ---
  // [ADR-250] ppEnabled = 后处理启用意图，正式入 schema。
  //  历史：该语义曾以 `perTypeGate`（模型类别门禁）形式留 cap 私有，与「能力级挂载」混淆，
  //  导致模型切换翻转它 → composer 整组重建（缓存失效）+ exposure 属主争夺（亮度跳变）。
  //  降参后唯一真值在本层，cap 不再持有该字段，模型类别经 MODEL_DEFAULTS 写本键即可。
  ppEnabled: { type: "boolean", default: false, group: "postprocessing" },
  ppBloomEnabled: { type: "boolean", default: true, group: "postprocessing" },
  ppBloomStrength: {
    type: "number",
    default: 0.6,
    group: "postprocessing",
    range: { min: 0, max: 3, step: 0.05 },
  },
  ppBloomThreshold: {
    type: "number",
    default: 0.6,
    group: "postprocessing",
    range: { min: 0, max: 1, step: 0.02 },
  },
  ppBloomRadius: {
    type: "number",
    default: 0.5,
    group: "postprocessing",
    range: { min: 0, max: 2, step: 0.02 },
  },
  ppBloomFollowVolumetric: { type: "boolean", default: true, group: "postprocessing" },
  ppSsaoEnabled: { type: "boolean", default: false, group: "postprocessing" },
  ppSsaoRadius: {
    type: "number",
    default: 8,
    group: "postprocessing",
    range: { min: 0.5, max: 32, step: 0.5 },
  },
  ppSsaoMinDist: {
    type: "number",
    default: 0.005,
    group: "postprocessing",
    range: { min: 0.001, max: 0.05, step: 0.001 },
  },
  ppSsaoMaxDist: {
    type: "number",
    default: 0.1,
    group: "postprocessing",
    range: { min: 0.01, max: 1, step: 0.01 },
  },
  ppExposure: {
    type: "number",
    default: 1.0,
    group: "postprocessing",
    range: { min: 0.1, max: 3, step: 0.05 },
  },
  ppToneMapping: {
    type: "enum",
    values: ["none", "linear", "reinhard", "aces", "cineon"] as const,
    default: "aces",
    group: "postprocessing",
  },
  ppReflectionMode: {
    type: "enum",
    values: ["envmap-only", "envmap+ssr", "ssr-only"] as const,
    default: "envmap-only",
    group: "postprocessing",
  },
  ppSsrOpacity: {
    type: "number",
    default: 0.5,
    group: "postprocessing",
    range: { min: 0, max: 1, step: 0.02 },
  },
  ppSsrMaxDistance: {
    type: "number",
    default: 180,
    group: "postprocessing",
    range: { min: 10, max: 800, step: 5 },
  },
  ppSsrThickness: {
    type: "number",
    default: 0.018,
    group: "postprocessing",
    range: { min: 0.001, max: 0.1, step: 0.001 },
  },
  ppSsrBlur: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrDistanceAttenuation: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrFresnel: { type: "boolean", default: true, group: "postprocessing" },
  ppSsrBouncing: { type: "boolean", default: false, group: "postprocessing" },
  ppReflectorDisableWhenSSR: { type: "boolean", default: true, group: "postprocessing" },

  // --- Light ---
  // 统一灯光实例（[light-type-switch]）：每盏灯(key/fill/rim)可在
  // directional / point / spot 间切换，参数结构统一。
  // volume 参数仍独立（与任意 spot 灯绑定）。
  //
  // [ADR-293] 两维 schema 化收口：
  //   lightEnabled——能力总开关，对齐 ppEnabled（ADR-250）/ fogEnabled（ADR-196）口径，
  //     LightCapability 不再持私有 enabled 字段，写路径全走 setEnvState 四件套；
  //   lightHelperVisible——视口线框（gizmo）显隐。默认 true = 保持现状观感（线框随各灯
  //     开关），新开关只赋予「一键全收」的撤销能力。
  lightEnabled: { type: "boolean", default: true, group: "light" },
  lightHelperVisible: { type: "boolean", default: true, group: "light" },
  //
  // key 灯
  lightKeyType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightKeyEnabled: { type: "boolean", default: true, group: "light" },
  lightKeyColor: { type: "number", default: 0xffffff, group: "light" },
  lightKeyIntensity: {
    type: "number",
    default: 1.2,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightKeyAzimuth: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightKeyElevation: {
    type: "number",
    default: 45,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightKeyAngle: {
    type: "number",
    default: 25,
    group: "light",
    // 合法域下界 1°（锐评根治 2026-09）：旧 min:10 把 three 合法窄锥（聚光手电效果）
    // 挡在写入口外；滑杆常用行程另声明 uiRange [10,70]，菜单展示不变。
    range: { min: 1, max: 70, step: 1, unit: "°" },
    uiRange: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightKeyPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightKeyDistance: {
    type: "number",
    default: 30,
    group: "light",
    // 0 = 无截止窗（three distance=0 语义）；上界 200 防脏存档把光推到无穷远
    range: { min: 0, max: 200, step: 1, unit: "m" },
  },
  lightKeyDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // fill 灯
  lightFillType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightFillEnabled: { type: "boolean", default: true, group: "light" },
  lightFillColor: { type: "number", default: 0xffffff, group: "light" },
  lightFillIntensity: {
    type: "number",
    default: 0.4,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightFillAzimuth: {
    type: "number",
    default: -30,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightFillElevation: {
    type: "number",
    default: 20,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightFillAngle: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: 1, max: 70, step: 1, unit: "°" },
    uiRange: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightFillPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightFillDistance: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: 0, max: 200, step: 1, unit: "m" },
  },
  lightFillDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // rim 灯
  lightRimType: {
    type: "enum",
    values: ["directional", "point", "spot"] as const,
    default: "directional",
    group: "light",
  },
  lightRimEnabled: { type: "boolean", default: true, group: "light" },
  lightRimColor: { type: "number", default: 0xffffff, group: "light" },
  lightRimIntensity: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 6, step: 0.1 },
  },
  lightRimAzimuth: {
    type: "number",
    default: 180,
    group: "light",
    range: { min: -180, max: 180, step: 1, unit: "°" },
  },
  lightRimElevation: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: -90, max: 90, step: 1, unit: "°" },
  },
  lightRimAngle: {
    type: "number",
    default: 25,
    group: "light",
    range: { min: 1, max: 70, step: 1, unit: "°" },
    uiRange: { min: 10, max: 70, step: 1, unit: "°" },
  },
  lightRimPenumbra: {
    type: "number",
    default: 0.3,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightRimDistance: {
    type: "number",
    default: 30,
    group: "light",
    range: { min: 0, max: 200, step: 1, unit: "m" },
  },
  lightRimDecay: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0, max: 4, step: 0.1 },
  },
  // ambient
  lightAmbientColor: { type: "number", default: 0xffffff, group: "light" },
  lightAmbientIntensity: {
    type: "number",
    default: 0.5,
    group: "light",
    range: { min: 0, max: 2, step: 0.1 },
  },
  // volume（与任意 type=spot 的灯绑定）
  lightVolumetricEnabled: { type: "boolean", default: false, group: "light" },
  // [ADR-290] 锥体驱动源显式化：auto = 槽位顺序（key→fill→rim）第一盏启用的 spot；
  // key/fill/rim = 严格绑定该槽位（该槽位非启用 spot 则无锥，不回落）。
  // 旧存档缺此键 → schema 默认 auto，与「槽位顺序」旧主路径逐字同行为。
  lightVolumetricDriver: {
    type: "enum",
    values: ["auto", "key", "fill", "rim"] as const,
    default: "auto",
    group: "light",
  },
  lightVolumetricOpacity: {
    type: "number",
    default: 0.45,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightVolumetricFogPower: {
    type: "number",
    default: 1.5,
    group: "light",
    range: { min: 0.5, max: 3, step: 0.1 },
  },
  lightVolumetricEdgeFade: {
    type: "number",
    default: 0.4,
    group: "light",
    range: { min: 0, max: 1, step: 0.05 },
  },
  lightVolumetricBaseStrength: { type: "number", default: 0.9, group: "light" },
  lightVolumetricTipStrength: { type: "number", default: 0.25, group: "light" },
} as const satisfies Record<string, _AnyFieldDef>;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;

// ======== 默认值推导 ========

export function deriveDefaultEnvState(): EnvState {
  const out = {} as Record<string, unknown>;
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    // tuple3 深拷贝：数组默认值是可变共享态，逐实例 slice 防跨会话污染。
    // 当前 schema 无 tuple3 使用者（原 ground 三死键已删），经宽化读取保留为通用能力——
    // 窄类型下 "tuple3" 比较会因联合穷尽而报 TS2367。
    const d = def as { type: string; default: unknown };
    out[key] =
      d.type === "tuple3" ? ((d.default as readonly number[]).slice() as unknown) : d.default;
  }
  return out as unknown as EnvState;
}

// ======== Type 派生 ========

export type EnvState = {
  -readonly [K in keyof EnvStateSchema]: EnvStateSchema[K] extends {
    type: infer T;
    values?: infer V;
  }
    ? T extends "number"
      ? number
      : T extends "boolean"
        ? boolean
        : T extends "string"
          ? string
          : T extends "enum"
            ? V extends readonly string[]
              ? V[number]
              : string
            : T extends "tuple3"
              ? [number, number, number]
              : T extends "nullable-boolean"
                ? boolean | null
                : T extends "nullable-number"
                  ? number | null
                  : never
    : never;
};

/** envState 键域——派发层唯一合法键类型（changed.has 拼写错误由编译器拦截） */
export type EnvStateKey = keyof EnvState;

// ======== Dispatch Key 派生 ========

const _groupCache = new Map<string, EnvStateKey[]>();

export function getPresetKeys(group: string): EnvStateKey[] {
  const cached = _groupCache.get(group);
  if (cached) return cached;
  const keys: EnvStateKey[] = [];
  for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
    const g = (def as { group?: string | readonly string[] }).group;
    if (!g) continue;
    if (typeof g === "string" ? g === group : g.includes(group)) {
      keys.push(key as EnvStateKey);
    }
  }
  _groupCache.set(group, keys);
  return keys;
}

// ======== 值域读口（ADR-283）========

/** 声明了 `range` 的键域：菜单取值域的**类型入口**——未声明值域的键在编译期就传不进来。 */
export type RangedKey = {
  [K in EnvStateKey]: EnvStateSchema[K] extends { range: NumericRange } ? K : never;
}[EnvStateKey];

/** 菜单展示域：`uiRange ?? range`（合法域与展示域分离——ADR-283 §2.2）。 */
export function getParamRange(key: RangedKey): NumericRange {
  const def = ENV_STATE_SCHEMA[key] as { range: NumericRange; uiRange?: NumericRange };
  return def.uiRange ?? def.range;
}

/** 唯一写入口的值域钳制（ADR-283 §2.3）：声明了 `range` 的数值字段钳到合法域，其余原样返回。
 *  NaN → range.min（`clamp` 语义），Infinity → range.max。
 *  重载：传入可能缺失的 `Partial` 值（唯一写入口的 patch）时，undefined 原样短路。 */
export function clampFieldValue<K extends EnvStateKey>(key: K, value: EnvState[K]): EnvState[K];
export function clampFieldValue<K extends EnvStateKey>(
  key: K,
  value: EnvState[K] | undefined,
): EnvState[K] | undefined;
export function clampFieldValue(key: EnvStateKey, value: unknown): unknown {
  const def = ENV_STATE_SCHEMA[key] as {
    type?: string;
    values?: readonly string[];
    default?: unknown;
    range?: NumericRange;
  };
  // enum 合法域（锐评根治 2026-09，ADR-283 延伸到非数值字段）：脏存档/程序化写入传
  // 非法枚举值时回退 schema default——否则 createLight 的 else 分支会把 "banana"
  // 静默建成 DirectionalLight，类型字段从此与 Three 实际对象不符。
  // undefined 短路：Partial patch 缺键不参与钳制（重载签名允许 undefined 原样透传）。
  if (def.type === "enum" && def.values && value !== undefined)
    return def.values.includes(value as string) ? value : def.default;
  const range = def.range;
  if (range && typeof value === "number") return clamp(value, range.min, range.max);
  return value;
}
