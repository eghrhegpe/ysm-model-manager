// ===== LightCapability 持久化数据层（锐评 §三 下沉：职责⑤的纯数据面）=====
// 从 light-capability.ts 抽离：saveState 的参数映射 + loadState 的开关/参数恢复块。
// 均为「envState ↔ localStorage 嵌套结构」的纯数据映射。
// [ADR-293] 能力总开关（lightEnabled）与线框可见性（lightHelperVisible）入 schema 后，
// 本层不再是「envState 纯读 + 主类编排私有态」的混合体——enabled 私有字段已退场，
// payload 全部 envState 纯读派生、restore 全部并入 acc 单批写回，无主类特判。
//（顺序敏感段——开关恢复→syncLight 重建→锥组重建——留在主类 loadState。）
// [ADR-282] 原 currentPreset/manualPreset 两个私有态键已随灯光与模型类别解耦退役。
// [ADR-246 D1] 原 volumetricEngine 维度已删（postprocess 空壳引擎移除）。
// 对齐 light-presets.ts（参数面）/ light-controls.ts（菜单面）的拆分先例。

import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import {
  ENV_STATE_SCHEMA,
  type EnvState,
  type EnvStateKey,
} from "@/preview-3d/state/env-state-schema.ts";
import {
  FLATTEN_MAP,
  type LightInstanceParams,
  type LightSlot,
  readLightParams,
} from "./light-presets.ts";
import { oneOf, restoreFields } from "./scene-capability.ts";
/* ============ saveState：envState → 持久化嵌套结构（纯读，由 FLATTEN_MAP 逆读口派生） ============ */

/** [锐评根治 2026-09] 旧实现逐字段手抄 30 个 envState 键裸字面量——新增灯光字段时
 *  FLATTEN_MAP 漏配编译报错，本函数漏加却静默不持久化。现三盏灯经 readLightParams
 *  （FLATTEN_MAP 真逆口）派生，ambient/volumetric 直读各自键：字段全集只在
 *  light-presets.ts 声明一次，本文件零手抄。顶层冗余键 keyEnabled/fillEnabled/rimEnabled
 *  保留：与旧存档格式向后兼容（restore 侧只读 state.key.enabled，不消费它们，但外部工具
 *  可能直读），删之无收益。 */
export function buildLightPersistPayload(): Record<string, unknown> {
  return {
    // [ADR-293] 总开关与线框可见性（顶层键，格式向后兼容：旧存档缺键 restore 不写，
    // 新会话即落 schema 默认 true/true，行为与旧「恒挂载恒可见」一致）
    enabled: envState.lightEnabled,
    helperVisible: envState.lightHelperVisible,
    keyEnabled: envState.lightKeyEnabled,
    fillEnabled: envState.lightFillEnabled,
    rimEnabled: envState.lightRimEnabled,
    // 灯光全量持久化（含 type + spot 参数），跨会话不丢类型/方向/强度/颜色
    key: { ...readLightParams(envState, "key") },
    fill: { ...readLightParams(envState, "fill") },
    rim: { ...readLightParams(envState, "rim") },
    ambient: {
      color: envState.lightAmbientColor,
      intensity: envState.lightAmbientIntensity,
    },
    volumetric: {
      enabled: envState.lightVolumetricEnabled,
      driver: envState.lightVolumetricDriver,
      opacity: envState.lightVolumetricOpacity,
      fogPower: envState.lightVolumetricFogPower,
      edgeFade: envState.lightVolumetricEdgeFade,
      baseStrength: envState.lightVolumetricBaseStrength,
      tipStrength: envState.lightVolumetricTipStrength,
    },
  };
}

/* ============ loadState：持久化结构 → envState（逐字段 typeof 校验，manual 源） ============ */

/** 灯光字段表：saved 字段 → 期望 typeof。
 *  [light-type-switch] 每盏灯 10 字段结构统一后，逐字段 if 链换成表驱动；
 *  [锐评根治 2026-10] 原表还携「envState 后缀」列、经 `cap(which)` 拼串取键——与
 *  ADR-281 在 presets 侧消灭的 `${prefix}${X}` 拼串同款病灶：与 FLATTEN_MAP 的对齐
 *  纯靠命名巧合，schema 键重命名时前者编译报错、此侧静默丢字段（typeof 不匹配即
 *  skip，用户灯光参数无声蒸发）。现后缀列退场，envState 键一律查 FLATTEN_MAP——
 *  键映射唯一真相源在 light-presets.ts，本表只剩 typeof 校验列。 */
const LIGHT_FIELD_TYPES = {
  type: "string",
  enabled: "boolean",
  color: "number",
  intensity: "number",
  azimuth: "number",
  elevation: "number",
  angle: "number",
  penumbra: "number",
  distance: "number",
  decay: "number",
} as const satisfies Record<keyof LightInstanceParams, "string" | "number" | "boolean">;

type LightFieldKey = keyof typeof LIGHT_FIELD_TYPES;

const ALL_LIGHT_FIELDS = Object.keys(LIGHT_FIELD_TYPES) as LightFieldKey[];

/** 旧存档 `spotlight` 块只有这些参数（enabled 归 `keyEnabled`、type 由迁移行决定）。 */
const SPOT_MIGRATION_FIELDS: LightFieldKey[] = [
  "color",
  "intensity",
  "angle",
  "penumbra",
  "distance",
  "decay",
];

/** 按（可选）字段子集把 saved 对象的已校验字段写入 acc，envState 键经 FLATTEN_MAP 查取。
 *  末尾一次 setEnvState 的合批约定不变——本函数只写 accumulator，不派发。 */
function pickLightFields(
  which: LightSlot,
  s: Record<string, unknown>,
  acc: Record<string, unknown>,
  fields: LightFieldKey[] = ALL_LIGHT_FIELDS,
): void {
  for (const key of fields) {
    const v = s[key];
    if (typeof v === LIGHT_FIELD_TYPES[key]) acc[FLATTEN_MAP[which][key]] = v;
  }
}

function restoreDir(which: LightSlot, saved: unknown, acc: Record<string, unknown>): void {
  if (!saved || typeof saved !== "object") return;
  pickLightFields(which, saved as Record<string, unknown>, acc);
}

/**
 * 用户显式保存的灯开关与全量参数恢复（须在模型预设套用之后调用——
 * 「预设以 envState 为准，后恢复的用户值优先」，ADR-126 P5「手动优先」同口径）。
 */
export function restoreLightParams(state: Record<string, unknown>): void {
  // 合批派发：所有校验通过的字段并入单一 accumulator，末尾一次 setEnvState。
  // 对齐 render-mode-capability.ts 批量化先例（N 次全场景材质遍历 → 1 次）。
  // [锐评 L-1 收口 2026-09-22] source:"auto-model"——存档恢复是**程序化动作**非用户手改
  //（fog F-2 / env E-2 / ground 同口径先例）。原 manual 把 light 组全部键的 lastWriteSource
  // 打成 manual，此后 auto-atmosphere 氛围预设写 lightKeyIntensity 等被 shouldOverwrite
  // 静默拒绝——重启后选 sunset 氛围灯光不变暗（ATMOSPHERE_PRESETS 五档均携 light 连续键）。
  // 回归锁：light-capability.test.ts「[锐评 L-1] loadState 后氛围预设仍能写灯强度」。
  // [ADR-293] acc 升型 Partial<Record<EnvStateKey, unknown>>：裸键拼写自此有编译期守卫
  //（原 Record<string, unknown> 下 typo 键静默蒸发——FLATTEN_MAP 查键路径守得住，
  // 直写 acc.lightXxx 的旁路守不住，一并上闸）。
  const acc: Partial<Record<EnvStateKey, unknown>> = {};
  // [ADR-293] 能力总开关与线框可见性（顶层键；旧档缺键 = 不写，落 envState 现值——
  // 新会话现值即 schema 默认，同进程宿主复用时尊重现值，与 ADR-250 ppEnabled 同口径）
  if (typeof state.enabled === "boolean") acc.lightEnabled = state.enabled;
  if (typeof state.helperVisible === "boolean") acc.lightHelperVisible = state.helperVisible;
  // ② 用户显式保存的灯开关优先于模型预设
  if (typeof state.ambientIntensity === "number") {
    acc.lightAmbientIntensity = state.ambientIntensity;
  }
  if (typeof state.keyEnabled === "boolean") {
    acc.lightKeyEnabled = state.keyEnabled;
  }
  if (typeof state.fillEnabled === "boolean") {
    acc.lightFillEnabled = state.fillEnabled;
  }
  if (typeof state.rimEnabled === "boolean") {
    acc.lightRimEnabled = state.rimEnabled;
  }
  // spot 参数已下沉到每盏灯的 restoreDir 中，此处不再单独恢复旧 lightSpot* 字段
  // 兼容旧存档：如果存在旧 spotlight 字段，迁移到 key 灯的 spot 参数
  if (state.spotlight && typeof state.spotlight === "object") {
    const sp = state.spotlight as Record<string, unknown>;
    // 旧存档有 spotlight 启用 → 迁移到 key 灯（type 与 enabled 归属不同，不走字段表；
    // 键仍查 FLATTEN_MAP，不留拼串裸字面量）
    if (sp.enabled === true) acc[FLATTEN_MAP.key.type] = "spot";
    pickLightFields("key", sp, acc, SPOT_MIGRATION_FIELDS);
  }
  if (typeof state.volumetricEnabled === "boolean") {
    acc.lightVolumetricEnabled = state.volumetricEnabled;
  }
  // ②.b 全量参数恢复（灯光 key/fill/rim 并入同一 accumulator）
  restoreDir("key", state.key, acc);
  restoreDir("fill", state.fill, acc);
  restoreDir("rim", state.rim, acc);
  if (state.ambient && typeof state.ambient === "object") {
    // [锐评根治 2026-10] 键一律查 FLATTEN_MAP，与三盏灯同口径（原裸字面量 acc.lightAmbient*
    // 在 Record<string,unknown> 上无类型守卫）
    restoreFields(state.ambient as Record<string, unknown>, {
      intensity: { number: (v) => (acc[FLATTEN_MAP.ambient.intensity] = v) },
      color: { number: (v) => (acc[FLATTEN_MAP.ambient.color] = v) },
    });
  }
  if (state.volumetric && typeof state.volumetric === "object") {
    restoreFields(state.volumetric as Record<string, unknown>, {
      enabled: { boolean: (v) => (acc[FLATTEN_MAP.volumetric.enabled] = v) },
      // [ADR-290] driver 走 oneOf 白名单（值集从 schema 声明派生，零手抄）；
      // 旧存档缺此键 / 脏值 → 不写，落 schema 默认 "auto" = 旧「槽位顺序」行为
      driver: oneOf(ENV_STATE_SCHEMA.lightVolumetricDriver.values, (v) => {
        acc[FLATTEN_MAP.volumetric.driver] = v;
      }),
      opacity: { number: (v) => (acc[FLATTEN_MAP.volumetric.opacity] = v) },
      fogPower: { number: (v) => (acc[FLATTEN_MAP.volumetric.fogPower] = v) },
      edgeFade: { number: (v) => (acc[FLATTEN_MAP.volumetric.edgeFade] = v) },
      baseStrength: { number: (v) => (acc[FLATTEN_MAP.volumetric.baseStrength] = v) },
      tipStrength: { number: (v) => (acc[FLATTEN_MAP.volumetric.tipStrength] = v) },
    });
  }
  if (Object.keys(acc).length > 0) {
    setEnvState(acc as Partial<EnvState>, { source: "auto-model" });
  }
}
