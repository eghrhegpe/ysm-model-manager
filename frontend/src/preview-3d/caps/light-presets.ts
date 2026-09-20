// ===== LightCapability 参数层（ADR-177 拆分：职责③数据面）=====
// 从 light-capability.ts 抽离：参数类型、默认值、合并函数。
// [ADR-282] 模型类别预设（原 LIGHT_PRESETS）已废除——灯光与模型类别解耦，
//   本文件只剩「参数面」：类型/默认值/嵌套↔扁平映射。
// 行为与原实现逐字节一致。
// [ADR-281] 本文件是灯光字段全集（LightInstanceParams 10 字段 × key/fill/rim）的**唯一真相源**：
//   FLATTEN_MAP 声明的嵌套→扁平映射既有 `satisfies` 锁死键拼写，又派生出
//   lightEnvKeys / LIGHT_SLOTS / readLightParams——变更集与读参数全由它计算，
//   不再各自手抄（新增字段只改本文件 + 接口）。
// 曾经 light-capability.ts 用 `export * from` 重导出本文件（ADR-177 拆分期的兼容垫层），
// 该转发桶已删：消费方一律直接 import 本文件，同一符号不再两处合法入口。
// P3 下沉（对齐 P1 sun-beams.ts / ADR-177 light-cone.ts 拆出先例）：纯参数映射样板
// flattenLightParams（嵌套 DeepPartial<LightParams> → 扁平 Partial<EnvState>）自
// light-capability.ts 下沉至本层——纯函数、不触达任何 cap 私有状态，正文与注释逐字
// 等价保留。

import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";

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
  /** spot/point 衰减距离（directional 时忽略） */
  distance: number;
  /** spot/point 衰减指数（0=无衰减，2=经典物理衰减；directional 时忽略） */
  decay: number;
}

/** @deprecated 使用 LightInstanceParams */
export type DirectionalLightParams = LightInstanceParams;

/** 聚光灯参数子集（VolumetricCone.rebuild 消费；与旧 SpotlightParams 接口兼容） */
export type SpotlightParams = Pick<
  LightInstanceParams,
  "enabled" | "color" | "intensity" | "angle" | "penumbra" | "distance" | "decay"
>;

export interface AmbientLightParams {
  color: number;
  intensity: number;
}

export interface VolumetricParams {
  enabled: boolean;
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
/* ============ 默认值与预设 ============ */

const DEFAULT_KEY: LightInstanceParams = {
  type: "directional",
  enabled: true,
  color: 0xffffff,
  intensity: 1.2,
  azimuth: 30,
  elevation: 45,
  angle: 25,
  penumbra: 0.3,
  distance: 30,
  decay: 1.5,
};
const DEFAULT_FILL: LightInstanceParams = {
  type: "directional",
  enabled: true,
  color: 0xffffff,
  intensity: 0.4,
  azimuth: -30,
  elevation: 20,
  angle: 25,
  penumbra: 0.3,
  distance: 30,
  decay: 1.5,
};
const DEFAULT_RIM: LightInstanceParams = {
  type: "directional",
  enabled: true,
  color: 0xffffff,
  intensity: 0.3,
  azimuth: 180,
  elevation: 25,
  angle: 25,
  penumbra: 0.3,
  distance: 30,
  decay: 1.5,
};
const DEFAULT_AMBIENT: AmbientLightParams = { color: 0xffffff, intensity: 0.5 };
const DEFAULT_VOLUMETRIC: VolumetricParams = {
  enabled: false,
  opacity: 0.45,
  fogPower: 1.5,
  edgeFade: 0.4,
  baseStrength: 0.9,
  tipStrength: 0.25,
};

export const DEFAULT_LIGHT_PARAMS: LightParams = {
  key: { ...DEFAULT_KEY },
  fill: { ...DEFAULT_FILL },
  rim: { ...DEFAULT_RIM },
  ambient: { ...DEFAULT_AMBIENT },
  volumetric: { ...DEFAULT_VOLUMETRIC },
};

// 注：LIGHT_PRESETS（v1.14 风格预设表）已并入 state/model-defaults.ts 的 MODEL_DEFAULTS，
// applyModelPreset 不再读此文件。DEFAULT_LIGHT_PARAMS（参数默认值基线）保留。

// ⚠️ 刀⑳：`deepMergeLightParams` 已删除（零消费者）。此前 check-orphan-exports 的
// ADR-196 豁免规则在 2026-09-11 被误删——理由是「经 light-capability.ts 的
// `export * from "./light-presets.ts"` 转发消费」，但 `export *` 只是让**检测器漏检**，
// 不等于真有消费者：全仓 grep 该符号仅命中定义处，light-capability 实际只 import
// 具体符号。检测器修复后它暴露为真孤儿，此处直接清理（而非重新加豁免）。
// 嵌套→扁平仍走下方 flattenLightParams（活代码）。

/* ============ 嵌套 ↔ 扁平映射（ADR-196，P3 下沉自 light-capability.ts） ============ */

type LightGroupKey = keyof LightParams;

// 「分组 → (子字段 → 扁平 EnvState 键)」映射表。取代手写 30 段 `if (x !== undefined)` 扇出
// （认知 66🟥）。值取 `keyof EnvState`：目标键拼写经编译期校验（原实现经 Record<string,unknown>
// 增量构建 + 末尾 cast，目标键拼写零守卫——cast 掩盖了它）；映射对各分组子字段穷尽（`-?` 必填），
// 某组新增字段而此处漏配即编译报错，与 renderMenu MENU_HANDLERS 非 Partial Record 同款「并行结构编译期锁死」纪律。
const FLATTEN_MAP = {
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
    opacity: "lightVolumetricOpacity",
    fogPower: "lightVolumetricFogPower",
    edgeFade: "lightVolumetricEdgeFade",
    baseStrength: "lightVolumetricBaseStrength",
    tipStrength: "lightVolumetricTipStrength",
  },
} as const satisfies {
  [G in LightGroupKey]: { [F in keyof LightParams[G]]-?: keyof EnvState };
};

/** 灯光三槽位（key/fill/rim）——与 ambient/volumetric 的单例参数面区分：
 *  只有这三者是「可切换类型的灯实例」，故灯对象管理 / 菜单 / 持久化 / 变更集共用此枚举。 */
export const LIGHT_SLOTS = ["key", "fill", "rim"] as const;
export type LightSlot = (typeof LIGHT_SLOTS)[number];

/** 槽位 → 该槽位全部 envState 键（由 FLATTEN_MAP 派生，无手抄副本）。 */
export function lightEnvKeys(which: LightSlot): (keyof EnvState)[] {
  return Object.values(FLATTEN_MAP[which]);
}

// [ADR-282] 原 LIGHT_ENV_KEYS / VOLUMETRIC_ENV_KEYS 已删：唯一消费者是 LightCapability.applyModelPreset
// （按模型类别挑参），该函数随灯光与模型类别解耦一并退役。字段全集真相源仍由上方
// lightEnvKeys / FLATTEN_MAP / readLightParams 提供（变更集与读参数继续消费）。

/** envState → 单盏灯参数（flattenLightParams 的逆方向）。
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
