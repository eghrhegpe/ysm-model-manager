// ===== 天空能力菜单节点工厂（自 sky-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()（ADR-195 刀2）。
// 改控件定义只动此文件，不触碰 Three 装配核。

import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type { PreviewControlDef } from "./scene-capability.ts";
import type { SkyCapability } from "./sky-capability.ts";

const SKY_GROUP_ADVANCED = "preview.skyGroupAdvanced"; // 高级（云量/太阳/昼夜/光束）

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

/** 天空能力总开关 toggle（环境一级行 headerToggle 语义由消费者抽 master） */
function skyEnabledNode(cap: SkyCapability): PreviewMenuNode {
  return {
    id: "sky-enabled",
    kind: "toggle",
    labelKey: "preview.sky",
    fallback: "天空",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 时间轴复杂控件（timeline——非纯数据，走 controls 通道节点承载） */
function skyTimelineControlsNode(cap: SkyCapability): PreviewMenuNode {
  const timeline: PreviewControlDef = {
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
 *  顶层：sky-enabled 能力总开关 → timeline → sky-time/sky-env 平铺 + 高级组 folder。
 *  （sky 原被注释为「无能力总开关」——误将 sky-env 视作总开关；实则有
 *   isEnabled/setEnabled 真总开关，enabled 已被 saveState/loadState 持久化。） */
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
    skyEnabledNode(cap),
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
