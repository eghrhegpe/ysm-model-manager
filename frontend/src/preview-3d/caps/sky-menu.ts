// ===== 天空能力菜单控件工厂（自 sky-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 MenuControlDef / PreviewMenuNode 供
// cap.getMenuControls() / cap.getMenuNodes()（ADR-195 刀2）。改控件定义只动此文件，
// 不触碰 Three 装配核。

import type { PreviewMenuNode } from "../menu-node-types.ts";
import type { MenuControlDef } from "./scene-capability.ts";
import type { SkyCapability } from "./sky-capability.ts";

const SKY_GROUP_ADVANCED = "preview.skyGroupAdvanced"; // 高级（云量/太阳/昼夜/光束）

/** 时间轴 + 时间滑块 */
export function skcBuildTime(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-timeline",
      kind: "timeline",
      labelKey: "preview.skyTimeline",
      fallback: "光影时间轴",
      getValue: () => cap.getTimeOfDay(),
      setValue: (v) => cap.setTime(v as number),
    },
    {
      id: "sky-time",
      kind: "slider",
      labelKey: "preview.timeOfDay",
      fallback: "时间",
      slider: { min: 0, max: 24, step: 0.5, unit: "h" },
      getValue: () => cap.getTimeOfDay(),
      setValue: (v) => cap.setTime(v as number),
    },
  ];
}

/** 散射参数（环境贴图 / 云量 / 太阳耦合 / 太阳盘） */
export function skcBuildScattering(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-env",
      kind: "toggle",
      labelKey: "preview.environmentMapping",
      fallback: "环境贴图",
      // 环境菜单基座级开关（无 group、无 settingsOrder）：同 ground/shadow 形态——
      // 总开关一眼可见，云量等参数留在「高级」折叠分组内；不再复制进设置面板画质分组
      getValue: () => cap.isEnvironmentEnabled(),
      setValue: (v) => cap.setEnvironmentEnabled(v as boolean),
    },
    {
      id: "sky-cloud",
      kind: "slider",
      labelKey: "preview.cloudCoverage",
      fallback: "云量",
      group: SKY_GROUP_ADVANCED,
      slider: { min: 0, max: 1, step: 0.05, unit: "%" },
      getValue: () => cap.getCloudCoverage(),
      setValue: (v) => cap.setCloudCoverage(v as number, true),
    },
    // §4 解耦：两个太阳耦合尺度作为高级滑块（默认在 0.75/0.5 已做过优化，高级用户可再调）
    {
      id: "sky-sun-intensity",
      kind: "slider",
      labelKey: "preview.skySunIntensityScale",
      fallback: "天空×太阳耦合",
      hintKey: "preview.skySunIntensityScaleHint",
      group: SKY_GROUP_ADVANCED,
      slider: { min: 0.3, max: 1.2, step: 0.05 },
      getValue: () => cap.getSunIntensityScale(),
      setValue: (v) => cap.setSunIntensityScale(v as number),
    },
    {
      id: "sky-sun-disc",
      kind: "slider",
      labelKey: "preview.skySunDiscScale",
      fallback: "太阳盘强度",
      hintKey: "preview.skySunDiscScaleHint",
      group: SKY_GROUP_ADVANCED,
      slider: { min: 0.0, max: 1.2, step: 0.05 },
      getValue: () => cap.getSunDiscScale(),
      setValue: (v) => cap.setSunDiscScale(v as number),
    },
  ];
}

/** 昼夜循环 toggle */
export function skcBuildAutoRotate(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-auto-rotate",
      kind: "toggle",
      labelKey: "preview.skyAutoRotate",
      fallback: "昼夜循环",
      hintKey: "preview.skyAutoRotateHint",
      group: SKY_GROUP_ADVANCED,
      getValue: () => cap.isAutoRotating(),
      setValue: (v) => {
        if (v) cap.startAutoRotate();
        else cap.stopAutoRotate();
      },
    },
  ];
}

/** 大气特效（体积光束 God Rays） */
export function skcBuildAtmosphereFX(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-godrays",
      kind: "toggle",
      labelKey: "preview.skyGodRays",
      fallback: "体积光束",
      hintKey: "preview.skyGodRaysHint",
      group: SKY_GROUP_ADVANCED,
      getValue: () => cap.isGodRaysEnabled(),
      setValue: (v) => cap.setGodRaysEnabled(v as boolean),
    },
  ];
}

/** 天空菜单控件全量装配（时序/散射/昼夜/光束） */
export function buildSkyGroup(cap: SkyCapability): MenuControlDef[] {
  return [
    ...skcBuildTime(cap),
    ...skcBuildScattering(cap),
    ...skcBuildAutoRotate(cap),
    ...skcBuildAtmosphereFX(cap),
  ];
}

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

/** 时间轴复杂控件（timeline——非纯数据，走 controls 通道节点承载） */
function skyTimelineControlsNode(cap: SkyCapability): PreviewMenuNode {
  const timeline: MenuControlDef = {
    id: "sky-timeline",
    kind: "timeline",
    labelKey: "preview.skyTimeline",
    fallback: "光影时间轴",
    getValue: () => cap.getTimeOfDay(),
    setValue: (v) => cap.setTime(v as number),
  };
  return { id: "cap-node-sky-timeline", kind: "controls", controls: [timeline] };
}

/** 完整参数面板节点树：timeline controls 节点 + sky-time/sky-env 平铺原生
 *  + 高级组 folder（cloud/sun-intensity/sun-disc/auto-rotate/godrays 全原生）。
 *  sky 无能力总开关（无 getMasterToggle——env 基座级开关 sky-env 为平铺）。 */
export function buildSkyNodes(cap: SkyCapability): PreviewMenuNode[] {
  const advanced: PreviewMenuNode[] = [
    {
      id: "sky-cloud",
      kind: "slider",
      labelKey: "preview.cloudCoverage",
      fallback: "云量",
      control: {
        min: 0,
        max: 1,
        step: 0.05,
        unit: "%",
        get: () => cap.getCloudCoverage(),
        set: (v) => cap.setCloudCoverage(v as number, true),
      },
    },
    {
      id: "sky-sun-intensity",
      kind: "slider",
      labelKey: "preview.skySunIntensityScale",
      fallback: "天空×太阳耦合",
      hintKey: "preview.skySunIntensityScaleHint",
      control: {
        min: 0.3,
        max: 1.2,
        step: 0.05,
        get: () => cap.getSunIntensityScale(),
        set: (v) => cap.setSunIntensityScale(v as number),
      },
    },
    {
      id: "sky-sun-disc",
      kind: "slider",
      labelKey: "preview.skySunDiscScale",
      fallback: "太阳盘强度",
      hintKey: "preview.skySunDiscScaleHint",
      control: {
        min: 0.0,
        max: 1.2,
        step: 0.05,
        get: () => cap.getSunDiscScale(),
        set: (v) => cap.setSunDiscScale(v as number),
      },
    },
    {
      id: "sky-auto-rotate",
      kind: "toggle",
      labelKey: "preview.skyAutoRotate",
      fallback: "昼夜循环",
      hintKey: "preview.skyAutoRotateHint",
      control: {
        get: () => cap.isAutoRotating(),
        set: (v) => {
          if (v) cap.startAutoRotate();
          else cap.stopAutoRotate();
        },
      },
    },
    {
      id: "sky-godrays",
      kind: "toggle",
      labelKey: "preview.skyGodRays",
      fallback: "体积光束",
      hintKey: "preview.skyGodRaysHint",
      control: {
        get: () => cap.isGodRaysEnabled(),
        set: (v) => cap.setGodRaysEnabled(v as boolean),
      },
    },
  ];
  return [
    skyTimelineControlsNode(cap),
    {
      id: "sky-time",
      kind: "slider",
      labelKey: "preview.timeOfDay",
      fallback: "时间",
      control: {
        min: 0,
        max: 24,
        step: 0.5,
        unit: "h",
        get: () => cap.getTimeOfDay(),
        set: (v) => cap.setTime(v as number),
      },
    },
    {
      id: "sky-env",
      kind: "toggle",
      labelKey: "preview.environmentMapping",
      fallback: "环境贴图",
      control: {
        get: () => cap.isEnvironmentEnabled(),
        set: (v) => cap.setEnvironmentEnabled(v as boolean),
      },
    },
    {
      id: "cap-group-sky-advanced",
      kind: "folder",
      labelKey: SKY_GROUP_ADVANCED,
      fallback: "高级",
      children: advanced,
    },
  ];
}
