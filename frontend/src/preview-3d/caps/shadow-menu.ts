// ===== 阴影能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// shadow 全为简单控件（toggle/select/slider）→ 全原生节点，无 controls 通道。
//
// 结构（对齐旧控件分组；shadow 无 getMasterToggle——shadow-enabled 是
// 平铺 toggle 非「能力总开关」，与 fog/reflector 不同）：
//   - shadow-enabled：toggle（平铺，带 hintKey 提示）
//   - 参数组 folder（preview.shadowGroupParams）：soft/map-size/bias/normal-bias/camera-size

import type { PreviewMenuNode } from "../menu-node-types.ts";
import type { ShadowCapability } from "./shadow-capability.ts";

const SHADOW_PARAMS_GROUP = "preview.shadowGroupParams";

// 与 shadow-capability.ts 源值一致（影子镜像；刀3 收口时源删除、本文件为唯一声明层）
const MAP_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "512", label: "512（性能优先）" },
  { value: "1024", label: "1024（均衡）" },
  { value: "2048", label: "2048（清晰）" },
  { value: "4096", label: "4096（精细）" },
];

/** shadow-enabled toggle（平铺，非能力总开关——shadow 无 getMasterToggle） */
function shcEnabledNode(cap: ShadowCapability): PreviewMenuNode {
  return {
    id: "shadow-enabled",
    kind: "toggle",
    labelKey: "preview.shadow",
    fallback: "阴影",
    hintKey: "preview.shadowEnabledHint",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 参数组 folder（soft/map-size/bias/normal-bias/camera-size） */
function shcBuildParamsFolder(cap: ShadowCapability): PreviewMenuNode {
  const children: PreviewMenuNode[] = [
    {
      id: "shadow-soft",
      kind: "toggle",
      labelKey: "preview.shadowSoft",
      fallback: "软阴影",
      control: {
        get: () => cap.isSoft(),
        set: (v) => cap.setSoft(v as boolean),
      },
    },
    {
      id: "shadow-map-size",
      kind: "select",
      labelKey: "preview.shadowMapSize",
      fallback: "分辨率",
      hintKey: "preview.shadowMapSizeDesc",
      control: {
        options: MAP_SIZE_OPTIONS,
        get: () => String(cap.getMapSize()),
        set: (v) => cap.setMapSize(Number(v)),
      },
    },
    {
      id: "shadow-bias",
      kind: "slider",
      labelKey: "preview.shadowBias",
      fallback: "阴影偏移",
      hintKey: "preview.shadowBiasDesc",
      control: {
        min: -0.01,
        max: 0.001,
        step: 0.0001,
        get: () => cap.getBias(),
        set: (v) => cap.setBias(v as number),
      },
    },
    {
      id: "shadow-normal-bias",
      kind: "slider",
      labelKey: "preview.shadowNormalBias",
      fallback: "法线偏移",
      hintKey: "preview.shadowNormalBiasDesc",
      control: {
        min: 0,
        max: 0.1,
        step: 0.005,
        get: () => cap.getNormalBias(),
        set: (v) => cap.setNormalBias(v as number),
      },
    },
    {
      id: "shadow-camera-size",
      kind: "slider",
      labelKey: "preview.shadowCameraSize",
      fallback: "视锥大小",
      hintKey: "preview.shadowCameraSizeDesc",
      control: {
        min: 5,
        max: 80,
        step: 1,
        get: () => cap.getCameraSize(),
        set: (v) => cap.setCameraSize(v as number),
      },
    },
  ];
  return {
    id: "cap-group-shadow-params",
    kind: "folder",
    labelKey: SHADOW_PARAMS_GROUP,
    fallback: "阴影参数",
    children,
  };
}

/** 完整参数面板节点树——ADR-195 刀2 cap 直产节点入口。
 *  shadow 无能力总开关（无 getMasterToggle），全量平铺+folder 返回。 */
export function buildShadowNodes(cap: ShadowCapability): PreviewMenuNode[] {
  return [shcEnabledNode(cap), shcBuildParamsFolder(cap)];
}
