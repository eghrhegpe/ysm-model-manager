// ===== 反光地面能力菜单节点工厂（ADR-195 刀2 试点：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes() / 消费。
// 与兄弟 sky-menu.ts（拆控件）不同——本文件是刀2 试点，cap 侧直产节点，
// 不经过控件定义层/桥接，验证「cap → 节点树 → renderMenu」全链路。
//
// 节点形态（全部原生节点，reflector 无复杂控件）：
//   - reflector-enabled：toggle（能力总开关；env 一级行 headerToggle 语义由消费者抽 master）
//   - 参数组（reflectorGroupParams）folder：opacity/resolution/size 三 slider

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange, type RangedKey } from "@/preview-3d/state/env-state-schema.ts";
import type { ReflectorCapability } from "./reflector-capability.ts";

const REFLECTOR_PARAMS_GROUP: LocaleKey = "preview.reflectorGroupParams";

/** 能力总开关节点（folder 聚合器/行 headerToggle 抽 master 用；与 getMenuNodes 同源） */
export function rcMasterToggleNode(cap: ReflectorCapability): PreviewMenuNode {
  return {
    id: "reflector-enabled",
    kind: "toggle",
    labelKey: "preview.reflector",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** 参数组 folder（opacity/resolution/size 三 slider） */
function rcBuildParamsFolder(cap: ReflectorCapability): PreviewMenuNode {
  const slider = (
    id: string,
    labelKey: LocaleKey,
    key: RangedKey,
    getValue: () => number,
    setValue: (v: number) => void,
  ): PreviewMenuNode => ({
    id,
    kind: "slider",
    labelKey,
    control: {
      ...getParamRange(key),
      get: () => getValue(),
      set: (v) => setValue(v as number),
    },
  });
  return {
    id: `cap-group-reflector-params`,
    kind: "folder",
    labelKey: REFLECTOR_PARAMS_GROUP,
    children: [
      slider(
        "reflector-opacity",
        "preview.reflectorOpacity",
        "reflectorOpacity",
        () => cap.getParams().opacity,
        (v) => cap.setOpacity(v),
      ),
      slider(
        "reflector-resolution",
        "preview.reflectorResolution",
        "reflectorResolution",
        () => cap.getParams().resolution,
        (v) => cap.setResolution(v),
      ),
      slider(
        "reflector-size",
        "preview.reflectorSize",
        "reflectorSize",
        () => cap.getParams().size,
        (v) => cap.setSize(v),
      ),
    ],
  };
}

/** 完整参数面板节点树（能力总开关 + 参数组）——ADR-195 刀2 cap 直产节点入口。
 *  消费者若需「除总开关外」的子树（如 env 二级子视图：master 已升一级行 headerToggle），
 *  按 getMasterToggle() id 从结果剔除顶层节点即可（env.ts envCapSubNodes 通用处理）。 */
export function buildReflectorNodes(cap: ReflectorCapability): PreviewMenuNode[] {
  return [rcMasterToggleNode(cap), rcBuildParamsFolder(cap)];
}
