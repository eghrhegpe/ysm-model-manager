// ===== 雾效能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// fog 全为简单控件（toggle/color/select/slider）→ 全原生节点，无 controls 通道。
//
// 结构（对齐旧控件分组）：
//   - fog-enabled：toggle（能力总开关；env 一级行 headerToggle 语义由消费者抽 master）
//   - 参数组 folder（preview.fogGroupParams）：color/mode/density/near/far

import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type { FogCapability, FogMode } from "./fog-capability.ts";

const FOG_PARAMS_GROUP = "preview.fogGroupParams";

/** 能力总开关节点（folder 聚合器/行 headerToggle 抽 master 用；与 getMenuNodes 同源） */
export function fcMasterToggleNode(cap: FogCapability): PreviewMenuNode {
  return {
    id: "fog-enabled",
    kind: "toggle",
    labelKey: "preview.fog",
    fallback: "雾效",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 参数组 folder（color/mode/density/near/far） */
function fcBuildParamsFolder(cap: FogCapability): PreviewMenuNode {
  const children: PreviewMenuNode[] = [
    {
      id: "fog-color",
      kind: "color",
      labelKey: "preview.fogColor",
      fallback: "雾色",
      control: {
        get: () => cap.getColor(),
        set: (v) => cap.setColor(v as number),
      },
    },
    {
      id: "fog-mode",
      kind: "select",
      labelKey: "preview.fogMode",
      fallback: "雾型",
      control: {
        options: [
          { value: "linear", label: "线性" },
          { value: "exp2", label: "指数" },
        ],
        get: () => cap.getMode(),
        set: (v) => cap.setMode(v as FogMode),
      },
    },
    {
      id: "fog-density",
      kind: "slider",
      labelKey: "preview.fogDensity",
      fallback: "密度",
      control: {
        min: 0.001,
        max: 0.1,
        step: 0.001,
        get: () => cap.getDensity(),
        set: (v) => cap.setDensity(v as number),
      },
    },
    {
      id: "fog-near",
      kind: "slider",
      labelKey: "preview.fogNear",
      fallback: "近距",
      control: {
        min: 0,
        max: 500,
        step: 1,
        unit: "",
        get: () => cap.getNear(),
        set: (v) => cap.setLinearRange(v as number, undefined),
      },
    },
    {
      id: "fog-far",
      kind: "slider",
      labelKey: "preview.fogFar",
      fallback: "远距",
      control: {
        min: 10,
        max: 2000,
        step: 10,
        unit: "",
        get: () => cap.getFar(),
        set: (v) => cap.setLinearRange(undefined, v as number),
      },
    },
  ];
  return {
    id: "cap-group-fog-params",
    kind: "folder",
    labelKey: FOG_PARAMS_GROUP,
    fallback: "雾效参数",
    children,
  };
}

/** 完整参数面板节点树（能力总开关 + 参数组 folder）——ADR-195 刀2 cap 直产节点入口。
 *  消费者需「除总开关外」子树时按 getMasterToggle() id 剔除顶层节点
 *  （env.ts envCapSubNodes 通用处理）。 */
export function buildFogNodes(cap: FogCapability): PreviewMenuNode[] {
  return [fcMasterToggleNode(cap), fcBuildParamsFolder(cap)];
}
