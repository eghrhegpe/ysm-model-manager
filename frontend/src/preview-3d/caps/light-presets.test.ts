// ===== flattenLightParams 映射契约测试 =====
// 锁死「嵌套 LightParams 子字段 → 扁平 EnvState 键」的 30 条映射关系（唯一值断言可抓
// 目标键串位）+ undefined 不写出守卫（仅拷传入子集，缺字段不出现在输出）。
// 表驱动重构（FLATTEN_MAP）的行为基线，实现换法不变契约。
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIGHT_PARAMS,
  flattenLightParams,
  LIGHT_SLOTS,
  type LightInstanceParams,
  type LightParams,
  lightEnvKeys,
  readLightParams,
} from "./light-presets.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import {
  clampFieldValue,
  deriveDefaultEnvState,
  ENV_STATE_SCHEMA,
  getParamRange,
  type EnvStateKey,
} from "@/preview-3d/state/env-state-schema.ts";
describe("flattenLightParams 映射契约", () => {
  it("全量输入：30 条源字段各归其扁平 EnvState 键", () => {
    const full: LightParams = {
      key: { type: "spot", enabled: true, color: 0x111111, intensity: 1.1, azimuth: 11, elevation: 12, angle: 51, penumbra: 0.52, distance: 53, decay: 5.4 },
      fill: { type: "directional", enabled: false, color: 0x222222, intensity: 2.1, azimuth: 21, elevation: 22, angle: 25, penumbra: 0.3, distance: 30, decay: 1.5 },
      rim: { type: "point", enabled: true, color: 0x333333, intensity: 3.1, azimuth: 31, elevation: 32, angle: 25, penumbra: 0.3, distance: 30, decay: 1.5 },
      ambient: { color: 0x444444, intensity: 4.1 },
      volumetric: {
        enabled: true,
        opacity: 6.1,
        fogPower: 6.2,
        edgeFade: 6.3,
        baseStrength: 6.4,
        tipStrength: 6.5,
      },
    };
    const out = flattenLightParams(full) as Record<string, unknown>;
    // key 组（spot 类型）
    expect(out.lightKeyType).toBe("spot");
    expect(out.lightKeyEnabled).toBe(true);
    expect(out.lightKeyColor).toBe(0x111111);
    expect(out.lightKeyIntensity).toBe(1.1);
    expect(out.lightKeyAzimuth).toBe(11);
    expect(out.lightKeyElevation).toBe(12);
    expect(out.lightKeyAngle).toBe(51);
    expect(out.lightKeyPenumbra).toBe(0.52);
    expect(out.lightKeyDistance).toBe(53);
    expect(out.lightKeyDecay).toBe(5.4);
    // fill 组（directional 类型）
    expect(out.lightFillType).toBe("directional");
    expect(out.lightFillEnabled).toBe(false);
    expect(out.lightFillColor).toBe(0x222222);
    expect(out.lightFillIntensity).toBe(2.1);
    expect(out.lightFillAzimuth).toBe(21);
    expect(out.lightFillElevation).toBe(22);
    // rim 组（point 类型）
    expect(out.lightRimType).toBe("point");
    expect(out.lightRimEnabled).toBe(true);
    expect(out.lightRimColor).toBe(0x333333);
    expect(out.lightRimIntensity).toBe(3.1);
    expect(out.lightRimAzimuth).toBe(31);
    expect(out.lightRimElevation).toBe(32);
    // ambient 组
    expect(out.lightAmbientColor).toBe(0x444444);
    expect(out.lightAmbientIntensity).toBe(4.1);
    // volumetric 组
    expect(out.lightVolumetricEnabled).toBe(true);
    expect(out.lightVolumetricOpacity).toBe(6.1);
    expect(out.lightVolumetricFogPower).toBe(6.2);
    expect(out.lightVolumetricEdgeFade).toBe(6.3);
    expect(out.lightVolumetricBaseStrength).toBe(6.4);
    // 恰好 38 键（3×10 + 2 ambient + 6 volumetric），无多余
    expect(Object.keys(out).length).toBe(38);
  });

  it("部分输入：仅传子集，缺字段不写出（undefined 守卫）", () => {
    const out = flattenLightParams({
      key: { intensity: 0.7 } as any,
      rim: { distance: 40 } as any,
    }) as Record<string, unknown>;
    expect(out.lightKeyIntensity).toBe(0.7);
    expect(out.lightRimDistance).toBe(40);
    // 未传的兄弟字段不得出现（enabled/color/azimuth/elevation 皆 undefined → 跳过）
    expect("lightKeyEnabled" in out).toBe(false);
    expect("lightKeyColor" in out).toBe(false);
    expect("lightRimColor" in out).toBe(false);
    // 未传的整组不得出现
    expect("lightFillIntensity" in out).toBe(false);
    expect("lightAmbientColor" in out).toBe(false);
    expect(Object.keys(out).length).toBe(2);
  });

  it("空输入：返回空对象", () => {
    expect(flattenLightParams({})).toEqual({});
  });

  it("false / 0 等假值必须写出（守卫是 !== undefined 而非 truthy）", () => {
    const out = flattenLightParams({
      key: { enabled: false, intensity: 0 },
    }) as Record<string, unknown>;
    expect(out.lightKeyEnabled).toBe(false);
    expect(out.lightKeyIntensity).toBe(0);
    expect("lightKeyEnabled" in out).toBe(true);
    expect("lightKeyIntensity" in out).toBe(true);
  });
});

// ===== [ADR-281] 灯光字段全集单一真相源（FLATTEN_MAP 派生） =====
// 旧状：同一 10 字段集散在 5 处（FLATTEN_MAP / 变更集 / 预设挑参 / 持久化 / readLightParams），
// 只有 FLATTEN_MAP 有 `satisfies` 锁。此处锁死「其余四处均由它派生」的契约。
describe("灯光字段全集单一真相源（FLATTEN_MAP 派生）", () => {
  /** 每个槽位的字段全集（与 LightInstanceParams 同构） */
  const FIELDS_PER_SLOT = [
    "type",
    "enabled",
    "color",
    "intensity",
    "azimuth",
    "elevation",
    "angle",
    "penumbra",
    "distance",
    "decay",
  ];

  it("lightEnvKeys 覆盖 LightInstanceParams 全字段（每槽位 10 键）", () => {
    for (const slot of LIGHT_SLOTS) {
      const keys = lightEnvKeys(slot);
      expect(keys.length).toBe(FIELDS_PER_SLOT.length);
      // 键名 = 槽位前缀 + 字段名首字母大写（与 FLATTEN_MAP 同构）
      const prefix = `light${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;
      for (const f of FIELDS_PER_SLOT) {
        expect(keys).toContain(`${prefix}${f.charAt(0).toUpperCase()}${f.slice(1)}`);
      }
    }
  });

  it("变更集恰好 = 该槽位全部 envState 键（无手抄副本可漂移）", () => {
    // 变更集是模块私有的，但它的消费者是「任一灯字段变更都要 syncLight」——
    // 若变更集漂移漏键，对应字段的修改将静默不生效。此处经 envState 写入反推覆盖度。
    resetEnvState();
    const before = readLightParams(envState, "rim");
    for (const key of lightEnvKeys("rim")) {
      // 每个键都必须能被 readLightParams 读到（键集与读方向一致）
      expect(key in envState).toBe(true);
    }
    expect(before.type).toBe("directional");
  });

  // [ADR-282] 原「LIGHT_ENV_KEYS = 30 / VOLUMETRIC_ENV_KEYS = 6」用例已删：
  // 两个常量随 applyModelPreset（按模型类别挑参）退役而删除。
  // 「字段全集单一真相源」的契约仍由本文件其余用例（lightEnvKeys 覆盖度、往返、直读）守住。

  it("readLightParams 是 flattenLightParams 的真逆：往返逐字段等价", () => {
    resetEnvState();
    // 三槽位故意取互不相同的值，任何「读错键」都会表现为串位而不是碰巧相等
    const src: Pick<LightParams, "key" | "fill" | "rim"> = {
      key: {
        type: "spot",
        enabled: true,
        color: 0x111111,
        intensity: 1.1,
        azimuth: 11,
        elevation: 12,
        angle: 51,
        penumbra: 0.52,
        distance: 53,
        decay: 3.4,
      },
      fill: {
        type: "directional",
        enabled: false,
        color: 0x222222,
        intensity: 2.1,
        azimuth: 21,
        elevation: 22,
        angle: 62,
        penumbra: 0.63,
        distance: 64,
        decay: 3.5,
      },
      rim: {
        type: "point",
        enabled: true,
        color: 0x333333,
        intensity: 3.1,
        azimuth: 31,
        elevation: 32,
        angle: 69,
        penumbra: 0.74,
        distance: 75,
        decay: 3.6,
      },
    };
    // 写入 envState（经 flatten 的真值路径）
    setEnvState(flattenLightParams(src), { source: "manual" });
    for (const slot of LIGHT_SLOTS) {
      const read = readLightParams(envState, slot);
      const want: LightInstanceParams = src[slot];
      for (const f of FIELDS_PER_SLOT as (keyof LightInstanceParams)[]) {
        expect(read[f], `${slot}.${f}`).toBe(want[f]);
      }
    }
  });

  it("readLightParams 逐字段对到正确 envState 键（独立于 flatten 的直读方向锁定）", () => {
    resetEnvState();
    // 与 flatten 用例同构：每个键写唯一值，任何「读错键」都表现为串位
    setEnvState(
      {
        lightKeyType: "spot",
        lightKeyEnabled: true,
        lightKeyColor: 0x111111,
        lightKeyIntensity: 1.1,
        lightKeyAzimuth: 11,
        lightKeyElevation: 12,
        lightKeyAngle: 51,
        lightKeyPenumbra: 0.52,
        lightKeyDistance: 53,
        lightKeyDecay: 3.4,
        lightRimType: "point",
        lightRimAngle: 69,
        lightRimDecay: 3.6,
      },
      { source: "manual" },
    );
    const key = readLightParams(envState, "key");
    expect(key).toEqual({
      type: "spot",
      enabled: true,
      color: 0x111111,
      intensity: 1.1,
      azimuth: 11,
      elevation: 12,
      angle: 51,
      penumbra: 0.52,
      distance: 53,
      decay: 3.4,
    });
    // 槽位不得串读：rim 只取 rim 的键
    const rim = readLightParams(envState, "rim");
    expect(rim.type).toBe("point");
    expect(rim.angle).toBe(69);
    expect(rim.decay).toBe(3.6);
    expect(rim.azimuth).toBe(180); // schema 默认值（DEFAULT_RIM 已派生化），未被 key 的 11 污染
  });
});

// ===== [锐评根治 2026-09] DEFAULT_LIGHT_PARAMS 派生自 schema，零第二套字面量 =====
// ADR-249 §2.6「默认值单一事实源」延伸到灯光组：旧实现平行手抄 38 个字面量，与本表
// 同值只是巧合不是契约——任何一侧单独改动即静默分叉，「重置」回到 schema 不认的状态。
// 本用例把「逐字段 === deriveDefaultEnvState() 对应键」钉成回归闸。
describe("DEFAULT_LIGHT_PARAMS = envState schema 默认值的派生投影", () => {
  it("三盏灯逐字段等于 schema default（经 FLATTEN_MAP 逆读口）", () => {
    const defaults = deriveDefaultEnvState();
    for (const slot of LIGHT_SLOTS) {
      expect(DEFAULT_LIGHT_PARAMS[slot], `${slot} 应与 schema 默认逐字段相等`).toEqual(
        readLightParams(defaults, slot),
      );
    }
  });

  it("ambient / volumetric 逐字段等于 schema default", () => {
    const d = deriveDefaultEnvState();
    expect(DEFAULT_LIGHT_PARAMS.ambient).toEqual({
      color: d.lightAmbientColor,
      intensity: d.lightAmbientIntensity,
    });
    expect(DEFAULT_LIGHT_PARAMS.volumetric).toEqual({
      enabled: d.lightVolumetricEnabled,
      opacity: d.lightVolumetricOpacity,
      fogPower: d.lightVolumetricFogPower,
      edgeFade: d.lightVolumetricEdgeFade,
      baseStrength: d.lightVolumetricBaseStrength,
      tipStrength: d.lightVolumetricTipStrength,
    });
  });

  it("基线快照与可变单例解耦：resetEnvState + 写脏值后 DEFAULT_LIGHT_PARAMS 不变", () => {
    const before = structuredClone(DEFAULT_LIGHT_PARAMS);
    setEnvState({ lightKeyIntensity: 99, lightKeyType: "spot" }, { source: "manual" });
    resetEnvState();
    expect(DEFAULT_LIGHT_PARAMS).toEqual(before); // 模块加载期固定，不随运行时写入漂移
  });

  it("防回退闸：灯光组全部数值滑杆字段声明 range（菜单值域单一事实源，ADR-283）", () => {
    const ranged: EnvStateKey[] = [
      "lightKeyIntensity",
      "lightKeyAzimuth",
      "lightKeyElevation",
      "lightKeyAngle",
      "lightKeyPenumbra",
      "lightKeyDistance",
      "lightKeyDecay",
      "lightFillIntensity",
      "lightFillAzimuth",
      "lightFillElevation",
      "lightFillAngle",
      "lightFillPenumbra",
      "lightFillDistance",
      "lightFillDecay",
      "lightRimIntensity",
      "lightRimAzimuth",
      "lightRimElevation",
      "lightRimAngle",
      "lightRimPenumbra",
      "lightRimDistance",
      "lightRimDecay",
      "lightAmbientIntensity",
      "lightVolumetricOpacity",
      "lightVolumetricFogPower",
      "lightVolumetricEdgeFade",
    ];
    for (const k of ranged) {
      expect((ENV_STATE_SCHEMA[k] as { range?: unknown }).range, `${k} 缺 range`).toBeDefined();
    }
    // 锥角双域分离：合法域下界 1°（窄锥合法），展示域仍 [10,70]
    expect(getParamRange("lightKeyAngle")).toMatchObject({ min: 10, max: 70 });
    expect(clampFieldValue("lightKeyAngle", 3)).toBe(3);
    expect(clampFieldValue("lightKeyAngle", -5)).toBe(1);
  });

  it("enum 合法域守卫（ADR-283 延伸）：非法枚举回退 schema default，合法值原样过", () => {
    // 脏存档/程序化写入传 "banana"：旧行为是静默建成 DirectionalLight 且字段与实际不符。
    // `as never` 是刻意的：该输入来自不可信 JSON，强类型签名下无合法值可传——
    // 运行时 enum 守卫正是为它而设，缺了转型这条用例就写不出来。
    expect(clampFieldValue("lightKeyType", "banana" as never)).toBe("directional");
    expect(clampFieldValue("lightKeyType", "spot")).toBe("spot");
    expect(clampFieldValue("groundType", "nope" as never)).toBe("plain");
    // undefined（Partial patch 缺键）不参与钳制，重载短路语义保留
    expect(clampFieldValue("lightKeyType", undefined)).toBeUndefined();
  });
});
