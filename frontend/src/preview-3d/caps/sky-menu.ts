// ===== 天空能力菜单节点工厂（自 sky-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()（ADR-195 刀2）。
// 改控件定义只动此文件，不触碰 Three 装配核。

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { PreviewControlDef } from "./scene-capability.ts";
import type { SkyCapability } from "./sky-capability.ts";

const SKY_GROUP_ADVANCED: LocaleKey = "preview.skyGroupAdvanced"; // 高级（云量/太阳/昼夜/光束）

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

/** 天空能力总开关 toggle（环境一级行 headerToggle 语义由消费者抽 master） */
function skyEnabledNode(cap: SkyCapability): PreviewMenuNode {
  return {
    id: "sky-enabled",
    kind: "toggle",
    labelKey: "preview.sky",
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

/** 完整参数面板节点树：timeline controls 节点 + sky-env 平铺原生
 *  + 高级组 folder（cloud/sun-intensity/sun-disc/auto-rotate/godrays 全原生）。
 *  顶层：sky-enabled 能力总开关 → timeline → sky-env 平铺 + 高级组 folder。
 *  （sky 原被注释为「无能力总开关」——误将 sky-env 视作总开关；实则有
 *   isEnabled/setEnabled 真总开关，enabled 已被 saveState/loadState 持久化。）
 *  （「时间」slider 已删：与 timeline 同源同槽，timeline 自带 HH:MM 读数 + 拖动，
 *   精度远高于原 0.5h 步进；同一参数不重复声明两条控件。） */
export function buildSkyNodes(cap: SkyCapability): PreviewMenuNode[] {
  const advanced: PreviewMenuNode[] = [
    {
      id: "sky-cloud",
      kind: "slider",
      labelKey: "preview.cloudCoverage",
      control: {
        ...getParamRange("skyCloudCoverage"),
        get: () => cap.getCloudCoverage(),
        set: (v) => cap.setCloudCoverage(v as number, true),
      },
    },
    {
      id: "sky-sun-intensity",
      kind: "slider",
      labelKey: "preview.skySunIntensityScale",
      hintKey: "preview.skySunIntensityScaleHint",
      control: {
        ...getParamRange("skySunIntensityScale"),
        get: () => cap.getSunIntensityScale(),
        set: (v) => cap.setSunIntensityScale(v as number),
      },
    },
    {
      id: "sky-sun-disc",
      kind: "slider",
      labelKey: "preview.skySunDiscScale",
      hintKey: "preview.skySunDiscScaleHint",
      control: {
        ...getParamRange("skySunDiscScale"),
        get: () => cap.getSunDiscScale(),
        set: (v) => cap.setSunDiscScale(v as number),
      },
    },
    {
      id: "sky-auto-rotate",
      kind: "toggle",
      labelKey: "preview.skyAutoRotate",
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
    // [ADR-292 D4] 原「环境贴图」toggle（sky-env）已删除：它与环境面板的总开关互不知晓、
    // 后写者赢，UI 上两个开关都「开」却只有一个生效。scene.environment 的供图者现在由
    // 环境面板的「来源」单选统一表达（选「跟随天空」即旧 toggle=开的效果）。
    {
      id: "cap-group-sky-advanced",
      kind: "folder",
      labelKey: SKY_GROUP_ADVANCED,
      children: advanced,
    },
  ];
}
