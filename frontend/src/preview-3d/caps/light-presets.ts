// ===== LightCapability 参数层（ADR-177 拆分：职责③数据面）=====
// 从 light-capability.ts 抽离：参数类型、默认值、合并函数。
// [ADR-282] 模型类别预设（原 LIGHT_PRESETS）已废除——灯光与模型类别解耦，
//   本文件只剩「参数面」：类型/默认值/嵌套↔扁平映射。
// 行为与原实现逐字节一致。
// [ADR-281] 本文件是灯光字段全集（LightInstanceParams 10 字段 × key/fill/rim）的**唯一真相源**：
//   FLATTEN_MAP 声明的嵌套→扁平映射既有 `satisfies` 锁死键拼写，又派生出
//   lightEnvKeys / LIGHT_SLOTS / readLightParams——变更集与读参数全由它计算，
//   不再各自手抄（新增字段只改本文件 + 接口）。DEFAULT_LIGHT_PARAMS（重置锚点）
//   同样不再是第二套字面量：逐字段从 envState schema 默认值经 readLightParams 派生。
// 曾经 light-capability.ts 用 `export * from` 重导出本文件（ADR-177 拆分期的兼容垫层），
// 该转发桶已删：消费方一律直接 import 本文件，同一符号不再两处合法入口。
// P3 下沉（对齐 P1 sun-beams.ts / ADR-177 light-cone.ts 拆出先例）：纯参数映射样板
// flattenLightParams（嵌套 DeepPartial<LightParams> → 扁平 Partial<EnvState>）自
// light-capability.ts 下沉至本层——纯函数、不触达任何 cap 私有状态，正文与注释逐字
// 等价保留。
//
// [锐评根治 2026-09] DEFAULT_LIGHT_PARAMS 从 envState schema 默认值派生（ADR-249 §2.6
// 默认值单一事实源延伸到灯光组）：旧实现平行手抄 38 个字面量，schema default 与本表
// 一旦分叉即「重置」回到一个 schema 认为不存在的状态。现派生方向 = FLATTEN_MAP 逆读口
// readLightParams(envStateSchemaDefaults, slot)，字面量全部退场；防回退闸在 light-presets.test.ts。
// 默认值段引用 FLATTEN_MAP 逆读口，故文件顺序为：类型 → FLATTEN_MAP/槽位/读口 → 默认值派生。

import {
  deriveDefaultEnvState,
  type EnvState,
  type EnvStateKey,
} from "@/preview-3d/state/env-state-schema.ts";

/* ============ 参数类型 ============ */

/** 递归 Partial：允许任意深度只传子集字段 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type LightType = "directional" | "point" | "spot";

export interface LightInstanceParams {
  type: LightType;
  enabled: boolean;
  color: number;
  intensity: number;
  /** 方位角（度，0=+X 东，90=+Z 南，180=-X 西，270=-Z 北；Y-up 坐标系） */
  azimuth: number;
  /** 仰角（度，0=水平，90=正上；负值=地面下） */
  elevation: number;
  /** spot 锥角半角（度，越大越宽；directional 时忽略） */
  angle: number;
  /** spot 半影（0=硬边，1=全软边；directional 时忽略） */
  penumbra: number;
  /** spot/point 衰减截止距离（0=不衰减；directional 时忽略）。[锐评根治 2026-10]
   *  spot/point 同语义：强度=「到达靶点处照度」（candela 反推补偿两型同吃），
   *  拖本滑块不改变靶点亮度，只收窄「光在何处归零」的截止窗。 */
  distance: number;
  /** spot/point 衰减指数（0=无衰减，2=经典物理衰减；directional 时忽略） */
  decay: number;
}

// [死代码清偿 2026-09-22] 原 DirectionalLightParams（@deprecated 别名）与 SpotlightParams
//（Pick 子集）两个导出具已无消费者——light-type-switch 后统一实例参数即 LightInstanceParams，
// 锥体参数面亦直取实例类型（knip 基线闸点名，删除防复活）。

export interface AmbientLightParams {
  color: number;
  intensity: number;
}

/** [ADR-290] 体积光锥驱动源："auto" = 槽位顺序第一盏启用的 spot；其余 = 严格绑定该槽位 */
export type VolumetricDriver = "auto" | LightSlot;

export interface VolumetricParams {
  enabled: boolean;
  /** [ADR-290] 锥体驱动灯（渲染输入显式化——原隐式挂钩 activeLight 焦点态，不入存档致会话间漂移）。
   *  "auto" = 槽位顺序第一盏启用的 spot；"key"/"fill"/"rim" = 严格绑定该槽位（不满足前提则无锥）。 */
  driver: VolumetricDriver;
  opacity: number;
  fogPower: number;
  edgeFade: number;
  baseStrength: number;
  tipStrength: number;
}

export interface LightParams {
  key: LightInstanceParams;
  fill: LightInstanceParams;
  rim: LightInstanceParams;
  ambient: AmbientLightParams;
  volumetric: VolumetricParams;
}

/* ============ 嵌套 ↔ 扁平映射（ADR-196，P3 下沉自 light-capability.ts） ============ */

type LightGroupKey = keyof LightParams;

// 「分组 → (子字段 → 扁平 EnvState 键)」映射表。取代手写 30 段 `if (x !== undefined)` 扇出
// （认知 66🟥）。值取 `EnvStateKey`：目标键拼写经编译期校验（原实现经 Record<string,unknown>
// 增量构建 + 末尾 cast，目标键拼写零守卫——cast 掩盖了它）；映射对各分组子字段穷尽（`-?` 必填），
// 某组新增字段而此处漏配即编译报错，与 renderMenu MENU_HANDLERS 非 Partial Record 同款「并行结构编译期锁死」纪律。
export const FLATTEN_MAP = {
  key: {
    type: "lightKeyType",
    enabled: "lightKeyEnabled",
    color: "lightKeyColor",
    intensity: "lightKeyIntensity",
    azimuth: "lightKeyAzimuth",
    elevation: "lightKeyElevation",
    angle: "lightKeyAngle",
    penumbra: "lightKeyPenumbra",
    distance: "lightKeyDistance",
    decay: "lightKeyDecay",
  },
  fill: {
    type: "lightFillType",
    enabled: "lightFillEnabled",
    color: "lightFillColor",
    intensity: "lightFillIntensity",
    azimuth: "lightFillAzimuth",
    elevation: "lightFillElevation",
    angle: "lightFillAngle",
    penumbra: "lightFillPenumbra",
    distance: "lightFillDistance",
    decay: "lightFillDecay",
  },
  rim: {
    type: "lightRimType",
    enabled: "lightRimEnabled",
    color: "lightRimColor",
    intensity: "lightRimIntensity",
    azimuth: "lightRimAzimuth",
    elevation: "lightRimElevation",
    angle: "lightRimAngle",
    penumbra: "lightRimPenumbra",
    distance: "lightRimDistance",
    decay: "lightRimDecay",
  },
  ambient: {
    color: "lightAmbientColor",
    intensity: "lightAmbientIntensity",
  },
  volumetric: {
    enabled: "lightVolumetricEnabled",
    driver: "lightVolumetricDriver",
    opacity: "lightVolumetricOpacity",
    fogPower: "lightVolumetricFogPower",
    edgeFade: "lightVolumetricEdgeFade",
    baseStrength: "lightVolumetricBaseStrength",
    tipStrength: "lightVolumetricTipStrength",
  },
} as const satisfies {
  [G in LightGroupKey]: { [F in keyof LightParams[G]]-?: EnvStateKey };
};

/** 灯光三槽位（key/fill/rim）——与 ambient/volumetric 的单例参数面区分：
 *  只有这三者是「可切换类型的灯实例」，故灯对象管理 / 菜单 / 持久化 / 变更集共用此枚举。 */
export const LIGHT_SLOTS = ["key", "fill", "rim"] as const;
export type LightSlot = (typeof LIGHT_SLOTS)[number];

/** state → 单盏灯参数（flattenLightParams 的逆方向；入参显式传入，不隐式依赖单例）。
 *  [light-type-switch] 字段名逐个取自 FLATTEN_MAP——键拼写由 `satisfies` 锁死、值类型由返回
 *  类型 `LightInstanceParams` 反向校验：漏读 / 读错键 / 类型不符任一即编译报错。
 *  取代旧实现 `${prefix}${X}` 拼串 + 两层 `as`（拼串键天然不是 keyof，类型系统全程缺席）。 */
export function readLightParams(state: EnvState, which: LightSlot): LightInstanceParams {
  const m = FLATTEN_MAP[which];
  return {
    type: state[m.type],
    enabled: state[m.enabled],
    color: state[m.color],
    intensity: state[m.intensity],
    azimuth: state[m.azimuth],
    elevation: state[m.elevation],
    angle: state[m.angle],
    penumbra: state[m.penumbra],
    distance: state[m.distance],
    decay: state[m.decay],
  };
}

/* ============ 默认值（从 envState schema 派生，零字面量）============ */

/** schema 默认值基线（deriveDefaultEnvState 的一次性快照）：灯光字段全集的**唯一值源**。
 *  注意与可变单例 envState 无关——本快照在模块加载期固定，不随运行时写入漂移。 */
const ENV_DEFAULTS = deriveDefaultEnvState();

/** 灯光参数默认值基线（重置锚点）：逐字段取自 ENV_DEFAULTS 的对应 envState 键（经
 *  FLATTEN_MAP 逆读口组装）——「重置」语义 = 回到 schema 声明的初始态，
 *  不存在第二套可漂移的字面量；防回退闸见 light-presets.test.ts。 */
export const DEFAULT_LIGHT_PARAMS: LightParams = {
  key: readLightParams(ENV_DEFAULTS, "key"),
  fill: readLightParams(ENV_DEFAULTS, "fill"),
  rim: readLightParams(ENV_DEFAULTS, "rim"),
  ambient: {
    color: ENV_DEFAULTS.lightAmbientColor,
    intensity: ENV_DEFAULTS.lightAmbientIntensity,
  },
  volumetric: {
    enabled: ENV_DEFAULTS.lightVolumetricEnabled,
    driver: ENV_DEFAULTS.lightVolumetricDriver,
    opacity: ENV_DEFAULTS.lightVolumetricOpacity,
    fogPower: ENV_DEFAULTS.lightVolumetricFogPower,
    edgeFade: ENV_DEFAULTS.lightVolumetricEdgeFade,
    baseStrength: ENV_DEFAULTS.lightVolumetricBaseStrength,
    tipStrength: ENV_DEFAULTS.lightVolumetricTipStrength,
  },
};

// ⚠️ 刀⑳：`deepMergeLightParams` 已删除（零消费者）。此前 check-orphan-exports 的
// ADR-196 豁免规则在 2026-09-11 被误删——理由是「经 light-capability.ts 的
// `export * from "./light-presets.ts"` 转发消费」，但 `export *` 只是让**检测器漏检**，
// 不等于真有消费者：全仓 grep 该符号仅命中定义处，light-capability 实际只 import
// 具体符号。检测器修复后它暴露为真孤儿，此处直接清理（而非重新加豁免）。
// 嵌套→扁平仍走下方 flattenLightParams（活代码）。

/** 槽位 → 该槽位全部 envState 键（由 FLATTEN_MAP 派生，无手抄副本）。 */
export function lightEnvKeys(which: LightSlot): (keyof EnvState)[] {
  return Object.values(FLATTEN_MAP[which]);
}

// [ADR-282] 原 LIGHT_ENV_KEYS / VOLUMETRIC_ENV_KEYS 已删：唯一消费者是 LightCapability.applyModelPreset
// （按模型类别挑参），该函数随灯光与模型类别解耦一并退役。字段全集真相源仍由上方
// lightEnvKeys / FLATTEN_MAP / readLightParams 提供（变更集与读参数继续消费）。
// （readLightParams / LIGHT_SLOTS 定义已前移至 FLATTEN_MAP 之后——默认值段需要它。）

export function flattenLightParams(p: DeepPartial<LightParams>): Partial<EnvState> {
  const out: Record<string, unknown> = {};
  for (const group of Object.keys(FLATTEN_MAP) as LightGroupKey[]) {
    const src = p[group] as Record<string, unknown> | undefined;
    if (!src) continue;
    const map = FLATTEN_MAP[group];
    for (const field of Object.keys(map)) {
      const v = src[field];
      // 守卫用 `!== undefined` 而非真值判断：false / 0 是合法值，必须写出。
      if (v !== undefined) out[map[field as keyof typeof map] as string] = v;
    }
  }
  return out as Partial<EnvState>;
}
