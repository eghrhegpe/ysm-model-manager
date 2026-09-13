// ===== LightCapability 菜单定义（ADR-177 拆分：职责④从 LightCapability 抽离）=====
// 经 `import type` 取 LightCapability（仅类型，不引入运行时环），全部调用其公开 API。
// [ADR-195 刀3] 删旧 getLightMenuControls + lcBuild*（旧控件工厂）；
// 仅保留 buildLightNodes 直产 PreviewMenuNode[]（cap.getMenuNodes 用）。

import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { toModelType } from "@/preview-3d/state/model-defaults.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { LightCapability } from "./light-capability.ts";

// code_review ADR-195 #5：共享 options 常量——节点树路径（buildLightNodes 的 `control.options:`）
const LIGHT_ENGINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cone", label: "锥形" },
  { value: "postprocess", label: "后处理" },
];
const LIGHT_PRESET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "default", label: "默认" },
  { value: RESOURCE_TYPES.YSM, label: "YSM方块" },
  { value: "vrm", label: "VRM角色" },
  { value: "mmd", label: "MMD角色" },
  { value: "litematic", label: "体素" },
  { value: "resourcepack", label: "MC块包" },
];

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

const LIGHT_PARAMS_GROUP = "preview.lightGroupParams";

/** 完整参数面板节点树：light-key 平铺 toggle + 参数组 folder（8 控件）——
 *  light 无能力总开关（light-key 是主灯 params 开关，非启停），无 getMasterNodeId。 */
export function buildLightNodes(cap: LightCapability): PreviewMenuNode[] {
  const children: PreviewMenuNode[] = [
    {
      id: "light-fill",
      kind: "toggle",
      labelKey: "preview.fillLight",
      fallback: "补灯",
      control: {
        get: () => cap.getParams().fill.enabled,
        set: (v) => cap.setParams({ fill: { enabled: v as boolean } }),
      },
    },
    {
      id: "light-rim",
      kind: "toggle",
      labelKey: "preview.rimLight",
      fallback: "轮廓灯",
      control: {
        get: () => cap.getParams().rim.enabled,
        set: (v) => cap.setParams({ rim: { enabled: v as boolean } }),
      },
    },
    {
      id: "light-ambient",
      kind: "slider",
      labelKey: "preview.ambientIntensity",
      fallback: "环境光",
      control: {
        min: 0,
        max: 2,
        step: 0.1,
        get: () => cap.getParams().ambient.intensity,
        set: (v) => cap.setParams({ ambient: { intensity: v as number } }),
      },
    },
    {
      id: "light-spotlight",
      kind: "toggle",
      labelKey: "preview.spotlight",
      fallback: "聚光灯",
      control: {
        get: () => cap.getParams().spotlight.enabled,
        set: (v) => cap.setSpotlight({ enabled: v as boolean }),
      },
    },
    {
      id: "light-volumetric",
      kind: "toggle",
      labelKey: "preview.volumetric",
      fallback: "体积光",
      control: {
        get: () => cap.getParams().volumetric.enabled,
        set: (v) => cap.setVolumetric({ enabled: v as boolean }),
      },
    },
    {
      id: "light-engine",
      kind: "select",
      labelKey: "preview.volumetricEngine",
      fallback: "锥引擎",
      control: {
        options: LIGHT_ENGINE_OPTIONS,
        get: () => cap.getVolumetricEngine(),
        set: (v) => cap.setVolumetricEngine(v as "cone" | "postprocess"),
      },
    },
    {
      id: "light-cone-angle",
      kind: "slider",
      labelKey: "preview.coneAngle",
      fallback: "锥角",
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
      id: "light-preset",
      kind: "select",
      labelKey: "preview.lightPreset",
      fallback: "灯光预设",
      control: {
        options: LIGHT_PRESET_OPTIONS,
        get: () => cap.getCurrentPreset(),
        set: (v) => cap.applyModelPreset(toModelType(v as string), { manual: true }),
      },
    },
  ];
  return [
    {
      id: "light-key",
      kind: "toggle",
      labelKey: "preview.keyLight",
      fallback: "主灯",
      control: {
        get: () => cap.getParams().key.enabled,
        set: (v) => cap.setParams({ key: { enabled: v as boolean } }),
      },
    },
    {
      id: "cap-group-light-params",
      kind: "folder",
      labelKey: LIGHT_PARAMS_GROUP,
      fallback: "灯光参数",
      children,
    },
  ];
}
