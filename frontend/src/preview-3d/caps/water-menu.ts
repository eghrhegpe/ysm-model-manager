// ===== 水面能力菜单控件工厂（自 water-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 MenuControlDef 供 cap.getMenuControls() /
// ADR-195 cap-to-node 消费。改控件定义只动此文件，不触碰 Three 装配核。

import type { PreviewSnapshot } from "../state/preview-paths.ts";
import { type MenuControlDef, makeColorDef, makeSliderDef } from "./scene-capability.ts";
import type { WaterCapability } from "./water-capability.ts";
import type { WaterMode } from "./water-state.ts";

// 水面菜单分组 i18n 键（与 water-capability.ts 原常量同源）
const WATER_GROUP_FORM = "preview.waterGroupForm"; // 形态
const WATER_GROUP_LOOK = "preview.waterGroupLook"; // 外观
const WATER_GROUP_POOL = "preview.waterGroupPool"; // 水池
const WATER_GROUP_WAVE = "preview.waterGroupWave"; // 波纹

/** 水面菜单控件工厂（保留 buildWaterGroup 名，对齐既有测试/ADR-195 引用） */
export function buildWaterGroup(cap: WaterCapability): MenuControlDef[] {
  const wSlider = (
    id: string,
    labelKey: string,
    fallback: string,
    group: string,
    slider: { min: number; max: number; step: number; unit?: string },
    getValue: () => number,
    setValue: (v: number) => void,
    visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean,
  ): MenuControlDef =>
    makeSliderDef(group, id, labelKey, fallback, slider, getValue, setValue, visibleWhen);
  const wColor = (
    id: string,
    labelKey: string,
    fallback: string,
    group: string,
    getValue: () => number,
    setValue: (v: number) => void,
    visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean,
  ): MenuControlDef => makeColorDef(group, id, labelKey, fallback, getValue, setValue, visibleWhen);
  return [
    {
      // 无 group → 成为 cap 根行主控件（与 sky/ground 对齐），下钻子视图不再重复出现
      id: "ground-water-enabled",
      kind: "toggle",
      labelKey: "preview.groundWaterEnabled",
      fallback: "启用水面",
      getValue: () => cap.getWaterEnabled(),
      setValue: (v) => cap.setWaterEnabled(v as boolean),
    },
    // ── 形态 ──
    {
      id: "ground-water-mode",
      kind: "select",
      labelKey: "preview.groundWaterMode",
      fallback: "水面形态",
      group: WATER_GROUP_FORM,
      select: [
        { value: "film", label: "薄膜" },
        { value: "pool", label: "水池" },
      ],
      getValue: () => cap.getWaterMode(),
      setValue: (v) => cap.setWaterMode(v as WaterMode),
    },
    wSlider(
      "ground-wetness",
      "preview.waterFilmDensity",
      "水膜浓度",
      WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getWetness(),
      (v) => cap.setWetness(v),
      (s) => s["env.waterMode"] === "film", // 仅薄膜模式：pool 下 wetness 不参与 opacity（见 buildWaveWaterMaterial）
    ),
    // ── 外观 ──
    wColor(
      "ground-water-color",
      "preview.groundWaterColor",
      "水色",
      WATER_GROUP_LOOK,
      () => cap.getWaterColor(),
      (v) => cap.setWaterColor(v),
    ),
    wSlider(
      "ground-water-opacity",
      "preview.groundWaterOpacity",
      "不透明度",
      WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getWaterOpacity(),
      (v) => cap.setWaterOpacity(v),
    ),
    wSlider(
      "ground-normal-strength",
      "preview.groundNormalStrength",
      "法线强度",
      WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getNormalStrength(),
      (v) => cap.setNormalStrength(v),
    ),
    wSlider(
      "ground-water-clarity",
      "preview.groundWaterClarity",
      "水体通透度",
      WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getClarity(),
      (v) => cap.setClarity(v),
    ),
    // ── 水池（仅 pool 模式可见；film 下为死控件，故条件隐藏）──
    wSlider(
      "ground-pool-height",
      "preview.groundPoolHeight",
      "水池高度",
      WATER_GROUP_POOL,
      { min: 0.01, max: 5, step: 0.05, unit: "m" },
      () => cap.getPoolHeight(),
      (v) => cap.setPoolHeight(v),
      (s) => s["env.waterMode"] === "pool",
    ),
    wSlider(
      "ground-pool-wall-thickness",
      "preview.groundPoolWallThickness",
      "池壁厚度",
      WATER_GROUP_POOL,
      { min: 0.01, max: 2, step: 0.01, unit: "m" },
      () => cap.getPoolWallThickness(),
      (v) => cap.setPoolWallThickness(v),
      (s) => s["env.waterMode"] === "pool",
    ),
    wColor(
      "ground-pool-wall-color",
      "preview.groundPoolWallColor",
      "池壁颜色",
      WATER_GROUP_POOL,
      () => cap.getPoolWallColor(),
      (v) => cap.setPoolWallColor(v),
      (s) => s["env.waterMode"] === "pool",
    ),
    wSlider(
      "ground-pool-roundness",
      "preview.groundPoolRoundness",
      "边缘圆角",
      WATER_GROUP_POOL,
      { min: 0, max: 0.5, step: 0.01 },
      () => cap.getPoolRoundness(),
      (v) => cap.setPoolRoundness(v),
      (s) => s["env.waterMode"] === "pool",
    ),
    // ── 波纹 ──
    wSlider(
      "ground-wave-speed",
      "preview.groundWaveSpeed",
      "波速",
      WATER_GROUP_WAVE,
      { min: 0, max: 3, step: 0.05, unit: "x" },
      () => cap.getWaveSpeed(),
      (v) => cap.setWaveSpeed(v),
    ),
  ];
}
