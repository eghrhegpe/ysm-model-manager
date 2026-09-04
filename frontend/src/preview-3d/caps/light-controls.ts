// ===== LightCapability 菜单定义（ADR-177 拆分：职责④从 LightCapability 抽离）=====
// 原 4 个 lcBuild* 顶层函数与 getMenuControls 的聚合逻辑迁入本模块。
// 经 `import type` 取 LightCapability（仅类型，不引入运行时环），全部调用其公开 API。

import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { LightCapability } from "./light-capability.ts";
import type { MenuControlDef } from "./scene-capability.ts";

function lcBuildMain(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-key",
      kind: "toggle",
      labelKey: "preview.keyLight",
      fallback: "主灯",
      getValue: () => cap.getParams().key.enabled,
      setValue: (v) => cap.setParams({ key: { enabled: v as boolean } }),
    },
  ];
}

function lcBuildSpotlight(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-fill",
      kind: "toggle",
      labelKey: "preview.fillLight",
      fallback: "补灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().fill.enabled,
      setValue: (v) => cap.setParams({ fill: { enabled: v as boolean } }),
    },
    {
      id: "light-rim",
      kind: "toggle",
      labelKey: "preview.rimLight",
      fallback: "轮廓灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().rim.enabled,
      setValue: (v) => cap.setParams({ rim: { enabled: v as boolean } }),
    },
    {
      id: "light-ambient",
      kind: "slider",
      labelKey: "preview.ambientIntensity",
      fallback: "环境光",
      group: "preview.lightGroupParams",
      slider: { min: 0, max: 2, step: 0.1 },
      getValue: () => cap.getParams().ambient.intensity,
      setValue: (v) => cap.setParams({ ambient: { intensity: v as number } }),
    },
    {
      id: "light-spotlight",
      kind: "toggle",
      labelKey: "preview.spotlight",
      fallback: "聚光灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().spotlight.enabled,
      setValue: (v) => cap.setSpotlight({ enabled: v as boolean }),
    },
  ];
}

function lcBuildVolumetric(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-volumetric",
      kind: "toggle",
      labelKey: "preview.volumetric",
      fallback: "体积光",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().volumetric.enabled,
      setValue: (v) => cap.setVolumetric({ enabled: v as boolean }),
    },
    {
      id: "light-engine",
      kind: "select",
      labelKey: "preview.volumetricEngine",
      fallback: "锥引擎",
      group: "preview.lightGroupParams",
      select: [
        { value: "cone", label: "锥形" },
        { value: "postprocess", label: "后处理" },
      ],
      getValue: () => cap.getVolumetricEngine(),
      setValue: (v) => cap.setVolumetricEngine(v as "cone" | "postprocess"),
    },
    {
      id: "light-cone-angle",
      kind: "slider",
      labelKey: "preview.coneAngle",
      fallback: "锥角",
      group: "preview.lightGroupParams",
      slider: { min: 10, max: 60, step: 1, unit: "°" },
      getValue: () => cap.getParams().spotlight.angle,
      setValue: (v) => cap.setSpotlight({ angle: v as number }),
    },
  ];
}

function lcBuildThreePoint(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-preset",
      kind: "select",
      labelKey: "preview.lightPreset",
      fallback: "灯光预设",
      group: "preview.lightGroupParams",
      select: [
        { value: "default", label: "默认" },
        { value: RESOURCE_TYPES.YSM, label: "YSM方块" },
        { value: "vrm", label: "VRM角色" },
        { value: "mmd", label: "MMD角色" },
        { value: "litematic", label: "体素" },
        { value: "resourcepack", label: "MC块包" },
      ],
      getValue: () => cap.getCurrentPreset(),
      setValue: (v) => cap.setPreset(v as string, { manual: true }),
    },
  ];
}

/** 返回灯光能力菜单控件定义（框架自动渲染） */
export function getLightMenuControls(cap: LightCapability): MenuControlDef[] {
  return [
    ...lcBuildMain(cap),
    ...lcBuildSpotlight(cap),
    ...lcBuildVolumetric(cap),
    ...lcBuildThreePoint(cap),
  ];
}
