// ===== LightCapability 菜单定义（ADR-177 拆分：职责④从 LightCapability 抽离）=====
// 经 `import type` 取 LightCapability（仅类型，不引入运行时环），全部调用其公开 API。
// [ADR-195 刀3] 删旧 getLightMenuControls + lcBuild*（旧控件工厂）；
// 仅保留 buildLightNodes 直产 PreviewMenuNode[]（cap.getMenuNodes 用）。
//
// [ADR-246] 三项菜单层收敛：
//   D1 删「锥引擎」下拉（postprocess 空壳引擎已移除，控件本就只会关掉体积光）
//   D2 体积光 5 参数收编为 3 个语义滑块 + 1 个上下亮度比（base/tip 不再各自暴露）
//   D3 聚光灯与体积光合并进同一可折叠卡（用户裁定：不做 visibleWhen 隐藏，只折叠）

import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { toModelType } from "@/preview-3d/state/model-defaults.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { DeepPartial, LightCapability, LightParams } from "./light-capability.ts";

// 共享 options 常量——节点树路径（buildLightNodes 的 `control.options:`）
const LIGHT_PRESET_OPTIONS: Array<{ value: string; label: string; labelKey?: string }> = [
  { value: "default", label: "默认", labelKey: "preview.lightPresetDefault" },
  { value: RESOURCE_TYPES.YSM, label: "YSM方块", labelKey: "preview.lightPresetYsm" },
  { value: "vrm", label: "VRM角色", labelKey: "preview.lightPresetVrm" },
  { value: "mmd", label: "MMD角色", labelKey: "preview.lightPresetMmd" },
  { value: "litematic", label: "体素", labelKey: "preview.lightPresetLitematic" },
  { value: "resourcepack", label: "MC块包", labelKey: "preview.lightPresetResourcepack" },
];

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

const LIGHT_PARAMS_GROUP = "preview.lightGroupParams";
const SPOT_VOL_CARD = "cap-group-spot-vol";

/** 灯光能力总开关 toggle（首行；读 isEnabled/setEnabled——setEnabled(false) 移除场景全部灯）。
 *  真值源/持久化与 shadow-enabled / pp-enabled 同构；light 面板直达平铺，不升 getMasterNodeId。 */
function lightEnabledNode(cap: LightCapability): PreviewMenuNode {
  return {
    id: "light-enabled",
    kind: "toggle",
    labelKey: "preview.lighting",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 单盏方向光灯的参数滑块（方位角/仰角/强度，可选颜色）——数据模型本就带这些字段，
 *  此前 UI 在 ADR-195/246 收敛时被砍成纯 toggle，用户完全摸不到位置/强度；此处补齐暴露。
 *  setParams 经现有 envState 管线落到 updateDirectional，零额外胶水。 */
function dirParamSliders(
  which: "key" | "fill" | "rim",
  cap: LightCapability,
  keys: { azimuth: string; elevation: string; intensity: string; color?: string },
): PreviewMenuNode[] {
  const getP = () => cap.getParams()[which];
  const setField = (field: "azimuth" | "elevation" | "intensity", v: number) =>
    cap.setParams({ [which]: { [field]: v } } as DeepPartial<LightParams>);
  const sliders: PreviewMenuNode[] = [
    {
      id: `light-${which}-azimuth`,
      kind: "slider",
      labelKey: keys.azimuth,
      control: {
        min: -180,
        max: 180,
        step: 1,
        unit: "°",
        get: () => getP().azimuth,
        set: (v) => setField("azimuth", v as number),
      },
    },
    {
      id: `light-${which}-elevation`,
      kind: "slider",
      labelKey: keys.elevation,
      control: {
        min: -90,
        max: 90,
        step: 1,
        unit: "°",
        get: () => getP().elevation,
        set: (v) => setField("elevation", v as number),
      },
    },
    {
      id: `light-${which}-intensity`,
      kind: "slider",
      labelKey: keys.intensity,
      control: {
        min: 0,
        max: 3,
        step: 0.1,
        get: () => getP().intensity,
        set: (v) => setField("intensity", v as number),
      },
    },
  ];
  if (keys.color) {
    sliders.push({
      id: `light-${which}-color`,
      kind: "color",
      labelKey: keys.color,
      control: {
        get: () => getP().color,
        set: (v) => cap.setParams({ [which]: { color: v as number } } as DeepPartial<LightParams>),
      },
    });
  }
  return sliders;
}

/** 三点布光 + ambient 节点（与聚光灯/体积光分卡，保持「基础光照」与「戏剧光」语义分离）。
 *  主灯 key 的 toggle 在顶层平铺，其参数滑块随下方 folder 内 key 滑块组一并暴露。 */
function baseLightingNodes(cap: LightCapability): PreviewMenuNode[] {
  return [
    {
      id: "light-fill",
      kind: "toggle",
      labelKey: "preview.fillLight",
      control: {
        get: () => cap.getParams().fill.enabled,
        set: (v) => cap.setParams({ fill: { enabled: v as boolean } }),
      },
    },
    ...dirParamSliders("fill", cap, {
      azimuth: "preview.fillAzimuth",
      elevation: "preview.fillElevation",
      intensity: "preview.fillIntensity",
    }),
    {
      id: "light-rim",
      kind: "toggle",
      labelKey: "preview.rimLight",
      control: {
        get: () => cap.getParams().rim.enabled,
        set: (v) => cap.setParams({ rim: { enabled: v as boolean } }),
      },
    },
    ...dirParamSliders("rim", cap, {
      azimuth: "preview.rimAzimuth",
      elevation: "preview.rimElevation",
      intensity: "preview.rimIntensity",
    }),
    {
      id: "light-ambient",
      kind: "slider",
      labelKey: "preview.ambientIntensity",
      control: {
        min: 0,
        max: 2,
        step: 0.1,
        get: () => cap.getParams().ambient.intensity,
        set: (v) => cap.setParams({ ambient: { intensity: v as number } }),
      },
    },
    // 主灯 key 的参数（toggle 在顶层平铺，此处补方位角/仰角/强度/颜色）
    ...dirParamSliders("key", cap, {
      azimuth: "preview.keyAzimuth",
      elevation: "preview.keyElevation",
      intensity: "preview.keyIntensity",
      color: "preview.keyColor",
    }),
  ];
}

/** [ADR-246 D3] 聚光灯与体积光折叠卡：两者是同一光学事件的「光源」与「可见化」，同卡呈现即传达依赖。
 *  体积光是聚光灯锥体的可见化——故聚光灯未开时体积光无效果（物理设定，非缺陷）；
 *  用户在卡内一眼可同时开关两者，不靠隐藏控件去「解释」依赖。 */
function spotVolCardNode(cap: LightCapability): PreviewMenuNode {
  return {
    id: SPOT_VOL_CARD,
    kind: "card",
    collapsible: true,
    labelKey: "preview.spotlightVolume",
    children: [
      {
        id: "light-spotlight",
        kind: "toggle",
        labelKey: "preview.spotlight",
        hintKey: "preview.spotlightHint",
        control: {
          get: () => cap.getParams().spotlight.enabled,
          set: (v) => cap.setSpotlight({ enabled: v as boolean }),
        },
      },
      {
        // [spot-fix] 暴露强度控件：UI 值语义 = 到达目标处照度(lx)，与衰减解耦，所见即所得。
        // 此前缺此滑块，聚光灯强度被距离衰减吃掉后用户无任何补救入口（「开了没效果」的体验根因之一）。
        id: "light-spot-intensity",
        kind: "slider",
        labelKey: "preview.spotlightIntensity",
        hintKey: "preview.spotlightIntensityHint",
        control: {
          min: 0,
          max: 6,
          step: 0.1,
          get: () => cap.getParams().spotlight.intensity,
          set: (v) => cap.setSpotlight({ intensity: v as number }),
        },
      },
      {
        id: "light-cone-angle",
        kind: "slider",
        labelKey: "preview.coneAngle",
        control: {
          min: 10,
          max: 60,
          step: 1,
          unit: "°",
          get: () => cap.getParams().spotlight.angle,
          set: (v) => cap.setSpotlight({ angle: v as number }),
        },
      },
      {
        id: "light-volumetric",
        kind: "toggle",
        labelKey: "preview.volumetric",
        hintKey: "preview.volumetricHint",
        control: {
          get: () => cap.getParams().volumetric.enabled,
          set: (v) => cap.setVolumetric({ enabled: v as boolean }),
        },
      },
      // [ADR-246 D2] 三个语义滑块：覆盖「多浓 / 衰减多快 / 边缘多软」
      {
        id: "light-volumetric-density",
        kind: "slider",
        labelKey: "preview.volumetricDensity",
        control: {
          min: 0,
          max: 1,
          step: 0.05,
          get: () => cap.getParams().volumetric.opacity,
          set: (v) => cap.setVolumetric({ opacity: v as number }),
        },
      },
      {
        id: "light-volumetric-falloff",
        kind: "slider",
        labelKey: "preview.volumetricFalloff",
        control: {
          min: 0.5,
          max: 3,
          step: 0.1,
          get: () => cap.getParams().volumetric.fogPower,
          set: (v) => cap.setVolumetric({ fogPower: v as number }),
        },
      },
      {
        id: "light-volumetric-edge-fade",
        kind: "slider",
        labelKey: "preview.volumetricEdgeFade",
        control: {
          min: 0,
          max: 1,
          step: 0.05,
          get: () => cap.getParams().volumetric.edgeFade,
          set: (v) => cap.setVolumetric({ edgeFade: v as number }),
        },
      },
      // [ADR-246 D2] base/tip 合并为单一「上下亮度比」——原两参数是 shader 的 mix() 两端
      // （实现细节），对用户不是可理解的概念
      {
        id: "light-volumetric-ratio",
        kind: "slider",
        labelKey: "preview.volumetricTipRatio",
        control: {
          min: 0,
          max: 1,
          step: 0.05,
          get: () => cap.getVolumetricTipRatio(),
          set: (v) => cap.setVolumetricTipRatio(v as number),
        },
      },
    ],
  };
}

/** 完整参数面板节点树：light-enabled 能力总开关（首行）+ light-key 平铺 toggle
 *  + 参数组 folder（预设 + 三点布光 + 聚光灯/体积光折叠卡）。
 *  light-key 是主灯 params 开关（单盏主灯），非能力总开关——总开关是首行 light-enabled。 */
export function buildLightNodes(cap: LightCapability): PreviewMenuNode[] {
  return [
    lightEnabledNode(cap),
    {
      id: "light-key",
      kind: "toggle",
      labelKey: "preview.keyLight",
      control: {
        get: () => cap.getParams().key.enabled,
        set: (v) => cap.setParams({ key: { enabled: v as boolean } }),
      },
    },
    {
      id: "cap-group-light-params",
      kind: "folder",
      labelKey: LIGHT_PARAMS_GROUP,
      children: [
        {
          id: "light-preset",
          kind: "select",
          labelKey: "preview.lightPreset",
          control: {
            options: LIGHT_PRESET_OPTIONS,
            get: () => cap.getCurrentPreset(),
            set: (v) => cap.applyModelPreset(toModelType(v as string), { manual: true }),
          },
        },
        ...baseLightingNodes(cap),
        spotVolCardNode(cap),
      ],
    },
  ];
}
