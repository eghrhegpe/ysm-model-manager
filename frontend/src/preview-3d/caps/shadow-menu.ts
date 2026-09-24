// ===== 阴影能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// shadow 全为简单控件（toggle/select/slider）→ 全原生节点，无 controls 通道。
//
// 结构（对齐旧控件分组）：
//   - shadow-enabled：toggle（真能力总开关——isEnabled/setEnabled 与 fog/reflector
//     同构，setEnabled 全量 apply/关闭。因 shadow 面板是场景组直达平铺（非「行+下钻」），
//     首行即此开关可一键启停，故无需 getMasterNodeId 升 headerToggle）
//   - 参数组 folder（preview.shadowGroupParams）：soft/map-size/bias/normal-bias/camera-size

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { NodeFor, PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { ShadowCapability } from "./shadow-capability.ts";

const SHADOW_PARAMS_GROUP: LocaleKey = "preview.shadowGroupParams";

// 与 shadow-capability.ts 源值一致（影子镜像；刀3 收口时源删除、本文件为唯一声明层）
const MAP_SIZE_OPTIONS: Array<{ value: string; label: string; labelKey?: LocaleKey }> = [
  { value: "512", label: "512（性能优先）", labelKey: "preview.shadowMapSize512" },
  { value: "1024", label: "1024（均衡）", labelKey: "preview.shadowMapSize1024" },
  { value: "2048", label: "2048（清晰）", labelKey: "preview.shadowMapSize2048" },
  { value: "4096", label: "4096（精细）", labelKey: "preview.shadowMapSize4096" },
];

/** shadow-enabled toggle（真能力总开关；直达面板首行即切，不升 headerToggle） */
function shcEnabledNode(cap: ShadowCapability): NodeFor<"toggle"> {
  return {
    id: "shadow-enabled",
    kind: "toggle",
    labelKey: "preview.shadow",
    hintKey: "preview.shadowEnabledHint",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 参数组 folder（soft/map-size/bias/normal-bias/camera-size） */
function shcBuildParamsFolder(cap: ShadowCapability): NodeFor<"folder"> {
  const children: PreviewMenuNode[] = [
    {
      id: "shadow-soft",
      kind: "toggle",
      labelKey: "preview.shadowSoft",
      control: {
        get: () => cap.isSoft(),
        set: (v) => cap.setSoft(v as boolean),
      },
    },
    {
      id: "shadow-map-size",
      kind: "select",
      labelKey: "preview.shadowMapSize",
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
      hintKey: "preview.shadowBiasDesc",
      control: {
        ...getParamRange("shadowBias"),
        get: () => cap.getBias(),
        set: (v) => cap.setBias(v as number),
      },
    },
    {
      id: "shadow-normal-bias",
      kind: "slider",
      labelKey: "preview.shadowNormalBias",
      hintKey: "preview.shadowNormalBiasDesc",
      control: {
        ...getParamRange("shadowNormalBias"),
        get: () => cap.getNormalBias(),
        set: (v) => cap.setNormalBias(v as number),
      },
    },
    {
      id: "shadow-camera-size",
      kind: "slider",
      labelKey: "preview.shadowCameraSize",
      hintKey: "preview.shadowCameraSizeDesc",
      control: {
        ...getParamRange("shadowCameraSize"),
        get: () => cap.getCameraSize(),
        set: (v) => cap.setCameraSize(v as number),
      },
    },
  ];
  return {
    id: "cap-group-shadow-params",
    kind: "folder",
    labelKey: SHADOW_PARAMS_GROUP,
    children,
  };
}

/** 完整参数面板节点树——ADR-195 刀2 cap 直产节点入口。
 *  shadow-enabled 为能力总开关（直达面板首行即切），参数组 folder 折叠。 */
export function buildShadowNodes(cap: ShadowCapability): PreviewMenuNode[] {
  return [shcEnabledNode(cap), shcBuildParamsFolder(cap)];
}
