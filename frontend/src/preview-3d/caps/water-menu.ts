// ===== 水面能力菜单节点工厂（自 water-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()（ADR-195 刀2）。
// 改控件定义只动此文件，不触碰 Three 装配核。

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { WaterCapability } from "./water-capability.ts";
import type { WaterMode } from "./water-state.ts";

// 水面菜单分组 i18n 键（与 water-capability.ts 原常量同源）
const WATER_GROUP_FORM: LocaleKey = "preview.waterGroupForm"; // 形态
const WATER_GROUP_LOOK: LocaleKey = "preview.waterGroupLook"; // 外观
const WATER_GROUP_POOL: LocaleKey = "preview.waterGroupPool"; // 水池
const WATER_GROUP_WAVE: LocaleKey = "preview.waterGroupWave"; // 波纹

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

/** 水面为 film 模式谓词 */
const waterFilmOn = (s: Partial<PreviewSnapshot>) => s["env.waterMode"] === "film";
/** 水面为 pool 模式谓词 */
const waterPoolOn = (s: Partial<PreviewSnapshot>) => s["env.waterMode"] === "pool";

/** slider 原生节点（wSlider 的节点版） */
function wSliderNode(
  id: string,
  labelKey: LocaleKey,
  slider: { min: number; max: number; step: number; unit?: string },
  control: { get: () => number; set: (v: number) => void },
  visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean,
): PreviewMenuNode {
  return {
    id,
    kind: "slider",
    labelKey,
    ...(visibleWhen ? { visibleWhen } : {}),
    control: {
      min: slider.min,
      max: slider.max,
      step: slider.step,
      ...(slider.unit !== undefined ? { unit: slider.unit } : {}),
      get: () => control.get(),
      set: (v) => control.set(v as number),
    },
  };
}

/** color 原生节点（wColor 的节点版） */
function wColorNode(
  id: string,
  labelKey: LocaleKey,
  getValue: () => number,
  setValue: (v: number) => void,
  visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean,
): PreviewMenuNode {
  return {
    id,
    kind: "color",
    labelKey,
    ...(visibleWhen ? { visibleWhen } : {}),
    control: {
      get: () => getValue(),
      set: (v) => setValue(v as number),
    },
  };
}

/** 完整参数面板节点树：ground-water-enabled 平铺 toggle + 4 组 folder
 *  （form/look/pool/wave 全原生 toggle/select/color/slider，无复杂控件）。
 *  water 无能力总开关（无 getMasterToggle——enabled 为 params 级根行主控件）。 */
export function buildWaterNodes(cap: WaterCapability): PreviewMenuNode[] {
  return [
    {
      id: "ground-water-enabled",
      kind: "toggle",
      labelKey: "preview.groundWaterEnabled",
      control: {
        get: () => cap.getWaterEnabled(),
        set: (v) => cap.setWaterEnabled(v as boolean),
      },
    },
    {
      id: "cap-group-water-form",
      kind: "folder",
      labelKey: WATER_GROUP_FORM,
      children: [
        {
          id: "ground-water-mode",
          kind: "select",
          labelKey: "preview.groundWaterMode",
          control: {
            options: [
              { value: "film", label: "薄膜", labelKey: "preview.groundWaterModeFilm" },
              { value: "pool", label: "水池", labelKey: "preview.groundWaterModePool" },
            ],
            get: () => cap.getWaterMode(),
            set: (v) => cap.setWaterMode(v as WaterMode),
          },
        },
        // ADR-257：水位跨形态通用，故**不带 visibleWhen**——film 下也能抬水面。
        // 这是本次改造对用户最直接的可感收益（旧：只有 pool 才有高度入口）。
        wSliderNode("ground-water-level", "preview.groundWaterLevel", getParamRange("waterLevel"), {
          get: () => cap.getLevel(),
          set: (v) => cap.setLevel(v),
        }),
        // ADR-272：尺寸与水位同属性——跨形态通用、且两形态都零重建（策略表 transformLinks：
        // film 单件 scale、pool 逐件 transform + 定位），故同理**不带 visibleWhen**。
        // 展示域 10–300（默认 80 居中）来自 schema `uiRange`，合法域 ≥1（ADR-283：值域单一事实源）；
        // 与 groundSize 同默认值，即「水膜刚好铺满地面」。step=1 足够细（拖满全程 290 步），
        // 且避开小数累加误差。
        wSliderNode("ground-water-size", "preview.groundWaterSize", getParamRange("waterSize"), {
          get: () => cap.getWaterSize(),
          set: (v) => cap.setWaterSize(v),
        }),
      ],
    },
    {
      id: "cap-group-water-look",
      kind: "folder",
      labelKey: WATER_GROUP_LOOK,
      children: [
        wSliderNode(
          "ground-wetness",
          "preview.waterFilmDensity",
          getParamRange("waterWetness"),
          { get: () => cap.getWetness(), set: (v) => cap.setWetness(v) },
          waterFilmOn,
        ),
        wColorNode(
          "ground-water-color",
          "preview.groundWaterColor",
          () => cap.getWaterColor(),
          (v) => cap.setWaterColor(v),
        ),
        wSliderNode(
          "ground-water-opacity",
          "preview.groundWaterOpacity",
          getParamRange("waterOpacity"),
          { get: () => cap.getWaterOpacity(), set: (v) => cap.setWaterOpacity(v) },
        ),
        wSliderNode(
          "ground-normal-strength",
          "preview.groundNormalStrength",
          getParamRange("waterNormalStrength"),
          { get: () => cap.getNormalStrength(), set: (v) => cap.setNormalStrength(v) },
        ),
        wSliderNode(
          "ground-water-clarity",
          "preview.groundWaterClarity",
          getParamRange("waterClarity"),
          { get: () => cap.getClarity(), set: (v) => cap.setClarity(v) },
          waterPoolOn, // 仅 pool 生效（film 无体积光学，supportsVolumeOptics=false 已拦截），消歧义
        ),
        wSliderNode(
          "ground-water-choppiness",
          "preview.groundWaterChoppiness",
          getParamRange("waterChoppiness"),
          { get: () => cap.getChoppiness(), set: (v) => cap.setChoppiness(v) },
        ),
      ],
    },
    {
      id: "cap-group-water-pool",
      kind: "folder",
      labelKey: WATER_GROUP_POOL,
      children: [
        wSliderNode(
          "ground-pool-height",
          "preview.groundPoolHeight",
          getParamRange("waterPoolHeight"),
          { get: () => cap.getPoolHeight(), set: (v) => cap.setPoolHeight(v) },
          waterPoolOn,
        ),
        wSliderNode(
          "ground-pool-wall-thickness",
          "preview.groundPoolWallThickness",
          getParamRange("waterPoolWallThickness"),
          { get: () => cap.getPoolWallThickness(), set: (v) => cap.setPoolWallThickness(v) },
          waterPoolOn,
        ),
        wColorNode(
          "ground-pool-wall-color",
          "preview.groundPoolWallColor",
          () => cap.getPoolWallColor(),
          (v) => cap.setPoolWallColor(v),
          waterPoolOn,
        ),
        wSliderNode(
          "ground-pool-roundness",
          "preview.groundPoolRoundness",
          getParamRange("waterPoolRoundness"),
          { get: () => cap.getPoolRoundness(), set: (v) => cap.setPoolRoundness(v) },
          waterPoolOn,
        ),
      ],
    },
    {
      id: "cap-group-water-wave",
      kind: "folder",
      labelKey: WATER_GROUP_WAVE,
      children: [
        wSliderNode(
          "ground-wave-speed",
          "preview.groundWaveSpeed",
          getParamRange("waterWaveSpeed"),
          { get: () => cap.getWaveSpeed(), set: (v) => cap.setWaveSpeed(v) },
        ),
      ],
    },
  ];
}
