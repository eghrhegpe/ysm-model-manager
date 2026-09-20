// ===== 雾效能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// fog 全为简单控件（toggle/color/select/slider）→ 全原生节点，无 controls 通道。
//
// 结构（对齐旧控件分组）：
//   - fog-enabled：toggle（能力总开关；env 一级行 headerToggle 语义由消费者抽 master）
//   - 参数组 folder（preview.fogGroupParams）：color/mode/density/near/far
//     density 仅 exp2、near/far 仅 linear 可见（visibleWhen 吃 env.fogMode 快照，B 轨）

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { FogCapability, FogMode } from "./fog-capability.ts";

const FOG_PARAMS_GROUP: LocaleKey = "preview.fogGroupParams";

/** 能力总开关节点（folder 聚合器/行 headerToggle 抽 master 用；与 getMenuNodes 同源） */
export function fcMasterToggleNode(cap: FogCapability): PreviewMenuNode {
  return {
    id: "fog-enabled",
    kind: "toggle",
    labelKey: "preview.fog",
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
      control: {
        get: () => cap.getColor(),
        set: (v) => cap.setColor(v as number),
      },
    },
    {
      id: "fog-mode",
      kind: "select",
      labelKey: "preview.fogMode",
      control: {
        options: [
          { value: "linear", labelKey: "preview.fogModeLinear" },
          { value: "exp2", labelKey: "preview.fogModeExp2" },
        ],
        get: () => cap.getMode(),
        set: (v) => cap.setMode(v as FogMode),
      },
    },
    {
      id: "fog-density",
      kind: "slider",
      labelKey: "preview.fogDensity",
      // 密度仅指数雾（FogExp2）读——线性雾下隐藏，避免拖了没反应的死控件
      visibleWhen: (s) => s["env.fogMode"] === "exp2",
      control: {
        ...getParamRange("fogDensity"),
        get: () => cap.getDensity(),
        set: (v) => cap.setDensity(v as number),
      },
    },
    {
      id: "fog-near",
      kind: "slider",
      labelKey: "preview.fogNear",
      // 近距仅线性雾（THREE.Fog）读——指数雾下隐藏
      visibleWhen: (s) => s["env.fogMode"] === "linear",
      control: {
        ...getParamRange("fogNear"),
        get: () => cap.getNear(),
        set: (v) => cap.setLinearRange(v as number, undefined),
      },
    },
    {
      id: "fog-far",
      kind: "slider",
      labelKey: "preview.fogFar",
      // 远距仅线性雾读——指数雾下隐藏
      visibleWhen: (s) => s["env.fogMode"] === "linear",
      control: {
        ...getParamRange("fogFar"),
        get: () => cap.getFar(),
        set: (v) => cap.setLinearRange(undefined, v as number),
      },
    },
  ];
  return {
    id: "cap-group-fog-params",
    kind: "folder",
    labelKey: FOG_PARAMS_GROUP,
    children,
  };
}

/** 完整参数面板节点树（能力总开关 + 参数组 folder）——ADR-195 刀2 cap 直产节点入口。
 *  消费者需「除总开关外」子树时按 getMasterToggle() id 剔除顶层节点
 *  （env.ts envCapSubNodes 通用处理）。 */
export function buildFogNodes(cap: FogCapability): PreviewMenuNode[] {
  return [fcMasterToggleNode(cap), fcBuildParamsFolder(cap)];
}
