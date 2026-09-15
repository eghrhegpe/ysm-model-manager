// ===== 地面能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// ground 结构：
//   - ground-visible：平铺 toggle（ground 无 getMasterToggle——visible 是 params 级）
//   - 材质组 folder（preview.groundGroupMaterial）：mat-source select + 3 color +
//     9 slider 原生节点；2 button（texture/clear，variant/getHint）→ controls 通道节点
//     （PreviewControlDef 树内嵌，保 variant/disabled/getHint 语义——节点 button 不承载）
// visibleWhen 谓词（B 轨快照驱动）原样挂节点。

import type { PreviewControlDef, PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { GroundCapability } from "./ground-capability.ts";
import type { GroundSurfaceMode } from "./ground-surface-spec.ts";

const MAT_GROUP = "preview.groundGroupMaterial";

/** B 轨唯一条件显隐谓词：地面承接面开启（matSource ≠ none）时材质子控件可见 */
const groundSurfaceOn = (s: Partial<PreviewSnapshot>) => s["env.groundMatSource"] !== "none";

function colorNode(
  id: string,
  labelKey: string,
  getValue: () => number,
  setValue: (v: number) => void,
): PreviewMenuNode {
  return {
    id,
    kind: "color",
    labelKey,
    visibleWhen: groundSurfaceOn,
    control: {
      get: () => getValue(),
      set: (v) => setValue(v as number),
    },
  };
}

function sliderNode(
  id: string,
  labelKey: string,
  slider: { min: number; max: number; step: number; unit?: string },
  getValue: () => number,
  setValue: (v: number) => void,
): PreviewMenuNode {
  return {
    id,
    kind: "slider",
    labelKey,
    visibleWhen: groundSurfaceOn,
    control: {
      min: slider.min,
      max: slider.max,
      step: slider.step,
      ...(slider.unit !== undefined ? { unit: slider.unit } : {}),
      get: () => getValue(),
      set: (v) => setValue(v as number),
    },
  };
}

/** 贴图按钮（PreviewControlDef 保 variant/getHint——controls 通道节点承载） */
function textureButtonsNode(cap: GroundCapability): PreviewMenuNode {
  const buttons: PreviewControlDef[] = [
    {
      id: "ground-mat-texture",
      kind: "button",
      labelKey: "preview.groundMatPick",
      fallback: "选择贴图",
      group: MAT_GROUP,
      button: {
        textKey: "preview.groundMatPick",
        getHint: () => cap.getCustomTexName() || "",
        variant: "primary",
        action: () => cap.openTexturePicker(),
      },
      getValue: () => null,
      setValue: () => {},
      visibleWhen: (s) => s["env.groundMatSource"] === "texture",
    },
    {
      id: "ground-mat-clear",
      kind: "button",
      labelKey: "preview.groundMatClear",
      fallback: "清除贴图",
      group: MAT_GROUP,
      button: {
        textKey: "preview.groundMatClear",
        variant: "ghost",
        action: () => cap.clearCustomTexture(),
      },
      getValue: () => null,
      setValue: () => {},
      visibleWhen: (s) => s["env.groundMatSource"] === "texture",
    },
  ];
  return { id: "cap-group-ground-texture-buttons", kind: "controls", controls: buttons };
}

/** 材质组 folder：mat-source + 原生 color/slider 按原控件顺序排布，
 *  texture/clear 按钮位插 controls 通道节点（保序保语义）。 */
function groundBuildMatFolder(cap: GroundCapability): PreviewMenuNode {
  const children: PreviewMenuNode[] = [
    {
      id: "ground-mat-source",
      kind: "select",
      labelKey: "preview.groundMatSource",
      control: {
        options: [
          { value: "none", label: "无" },
          { value: "solid", label: "纯色" },
          { value: "plain", label: "素面" },
          { value: "grid", label: "网格" },
          { value: "checker", label: "棋盘" },
          { value: "stripes", label: "条纹" },
          { value: "diamond", label: "菱格" },
          { value: "marble", label: "大理石" },
          { value: "texture", label: "自定义贴图" },
        ],
        get: () => cap.getMatSource(),
        set: (v) => cap.setMatSource(v as GroundSurfaceMode),
      },
    },
    colorNode(
      "ground-mat-color",
      "preview.groundMatColor",
      () => cap.getMatColor(),
      (v) => cap.setMatColor(v),
    ),
    colorNode(
      "ground-mat-color2",
      "preview.groundMatColor2",
      () => cap.getMatColor2(),
      (v) => cap.setMatColor2(v),
    ),
    colorNode(
      "ground-mat-line-color",
      "preview.groundMatLineColor",
      () => cap.getMatLineColor(),
      (v) => cap.setMatLineColor(v),
    ),
    sliderNode(
      "ground-mat-grid-size",
      "preview.groundMatGridSize",
      { min: 2, max: 32, step: 1 },
      () => cap.getMatGridSize(),
      (v) => cap.setMatGridSize(Math.round(v)),
    ),
    sliderNode(
      "ground-mat-density",
      "preview.groundMatDensity",
      { min: 0.25, max: 8, step: 0.25 },
      () => cap.getMatDensity(),
      (v) => cap.setMatDensity(v),
    ),
    sliderNode(
      "ground-mat-angle",
      "preview.groundMatAngle",
      { min: 0, max: 360, step: 5, unit: "°" },
      () => cap.getMatAngle(),
      (v) => cap.setMatAngle(v),
    ),
    textureButtonsNode(cap),
    sliderNode(
      "ground-mat-opacity",
      "preview.groundMatOpacity",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getMatOpacity(),
      (v) => cap.setMatOpacity(v),
    ),
    sliderNode(
      "ground-mat-scale",
      "preview.groundMatScale",
      { min: 0.25, max: 8, step: 0.25 },
      () => cap.getMatScale(),
      (v) => cap.setMatScale(v),
    ),
    sliderNode(
      "ground-mat-rotation",
      "preview.groundMatRotation",
      { min: 0, max: 360, step: 5, unit: "°" },
      () => cap.getMatRotation(),
      (v) => cap.setMatRotation(v),
    ),
    sliderNode(
      "ground-mat-roughness",
      "preview.groundMatRoughness",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getMatRoughness(),
      (v) => cap.setMatRoughness(v),
    ),
    sliderNode(
      "ground-mat-metalness",
      "preview.groundMatMetalness",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getMatMetalness(),
      (v) => cap.setMatMetalness(v),
    ),
  ];
  return {
    id: "cap-group-ground-material",
    kind: "folder",
    labelKey: MAT_GROUP,
    children,
  };
}

/** 完整参数面板节点树：ground-visible 平铺 + 材质组 folder——ADR-195 刀2 入口。
 *  ground 无能力总开关（visible 是 params 级，非 getMasterToggle 语义）。 */
export function buildGroundNodes(cap: GroundCapability): PreviewMenuNode[] {
  return [
    {
      id: "ground-visible",
      kind: "toggle",
      labelKey: "preview.ground",
      control: {
        get: () => cap.getVisible(),
        set: (v) => cap.setVisible(v as boolean),
      },
    },
    groundBuildMatFolder(cap),
  ];
}
