// ===== 地面能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// ground 结构：
//   - ground-visible：平铺 toggle（ground 无 getMasterToggle——visible 是 params 级）
//   - ground-grid-visible：参考网格（GridHelper 层）平铺 toggle，与总开关/材质层正交
//   - 网格组 folder（preview.groundGroupGrid，锐评 P3 补齐 2026-09-21）：尺寸/密度滑杆 +
//     中心线/网格线 color——此四键早有渲染接线与持久化，此前却零 UI 出口
//   - 材质组 folder（preview.groundGroupMaterial）：mat-source select + 3 color +
//     9 slider 原生节点；2 button（texture/clear）原生 button 节点直持
//     variant/getHint/action（rmAppendButton 按钮臂，锐评修复 2026-09-20）
// visibleWhen 谓词（B 轨快照驱动）原样挂节点。

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { NodeFor, PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { GroundCapability } from "./ground-capability.ts";
import {
  type GroundMaterialPreset,
  type GroundMatParam,
  type GroundOverlayStyle,
  type GroundSourceKind,
  groundMatSourceFromAxes,
  paramIsEffective,
} from "./ground-surface-spec.ts";

const MAT_GROUP: LocaleKey = "preview.groundGroupMaterial";
const OVERLAY_GROUP: LocaleKey = "preview.groundGroupOverlay";
const GRID_GROUP: LocaleKey = "preview.groundGroupGrid";
/** ADR-249 §2.4：参数级显隐谓词——控件可见 ⇔ 矩阵判定该参在当前模式生效。
 *
 * 历史：全部控件共用一条粗谓词（仅判 ≠ none），导致 solid/plain/grid 等模式下
 * 「线色/副色/格数」等控件可见、可拖、可写入、可触发重建，但渲染不读该参数
 * ——零视觉反馈的死控件（用户实测反馈「选纯色还显示线色」）。
 * 现改为逐参数 × 逐模式判定，事实源 = ground-surface-spec.ts 的 paramIsEffective，
 * 不在此重写一套判断（防两处漂移）。 */
function paramVisible(param: GroundMatParam) {
  return (s: Partial<PreviewSnapshot>): boolean => {
    // ADR-249 §2.1 拆轴：由来源轴 + 样式轴派生当前模式
    // [锐评 F-3 家族收口] 探针已收窄为精确联合（PROBE_ENUM_VALUES ⇄ schema enum 同集），
    // 快照类型与 GroundSourceKind / GroundCanvasStyle 逐字相同——原两处 `as … | undefined`
    // 化石 cast 退役，类型漂移由编译器代管。
    const sourceKind = s["env.groundSourceKind"];
    const canvasStyle = s["env.groundCanvasStyle"];
    if (!sourceKind) return false;
    const mode = groundMatSourceFromAxes(sourceKind, canvasStyle);
    return paramIsEffective(mode, param);
  };
}

function colorNode(
  id: string,
  labelKey: LocaleKey,
  param: GroundMatParam,
  getValue: () => number,
  setValue: (v: number) => void,
): NodeFor<"color"> {
  return {
    id,
    kind: "color",
    labelKey,
    visibleWhen: paramVisible(param),
    control: {
      get: () => getValue(),
      set: (v) => setValue(v as number),
    },
  };
}

function sliderNode(
  id: string,
  labelKey: LocaleKey,
  param: GroundMatParam,
  slider: { min: number; max: number; step: number; unit?: string },
  control: { get: () => number; set: (v: number) => void },
): NodeFor<"slider"> {
  return {
    id,
    kind: "slider",
    labelKey,
    visibleWhen: paramVisible(param),
    control: {
      min: slider.min,
      max: slider.max,
      step: slider.step,
      ...(slider.unit !== undefined ? { unit: slider.unit } : {}),
      get: () => control.get(),
      set: (v) => control.set(v as number),
    },
  };
}

/** 贴图按钮：原生 button 节点直持 variant/getHint（锐评修复 2026-09-20——
 *  rmAppendButton 补齐 control 按钮臂后，不再绕道 controls 通道塞空桩 getValue/setValue）。 */
function textureButtonsNode(cap: GroundCapability): PreviewMenuNode[] {
  const sourceIsTexture = (s: Partial<PreviewSnapshot>): boolean =>
    s["env.groundSourceKind"] === "texture";
  return [
    {
      id: "ground-mat-texture",
      kind: "button",
      labelKey: "preview.groundMatPick",
      visibleWhen: sourceIsTexture,
      control: {
        variant: "primary",
        getHint: () => cap.getCustomTexName() || "",
        action: () => cap.openTexturePicker(),
      },
    },
    {
      id: "ground-mat-clear",
      kind: "button",
      labelKey: "preview.groundMatClear",
      visibleWhen: sourceIsTexture,
      control: {
        variant: "ghost",
        action: () => cap.clearCustomTexture(),
      },
    },
  ];
}

/** 网格组 folder（锐评 P3 补齐 2026-09-21）：参考网格几何四键的 UI 出口。
 *  groundSize / groundDivisions / groundColorCenter / groundColorGrid 早有渲染接线
 *  （syncGeometry → PlaneGeometry 换装 + GridHelper 重建）与持久化，却纯靠存档通路活着；
 *  水面尺寸滑杆早已可达而地面不能改，拖大 waterSize 即水陆脱锚。
 *  值域一律 getParamRange（ADR-283 单源），落地归 ground 回调单路径（setter 只写状态）。 */
function groundBuildGridFolder(cap: GroundCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-ground-grid",
    kind: "folder",
    labelKey: GRID_GROUP,
    children: [
      {
        id: "ground-size",
        kind: "slider",
        labelKey: "preview.groundSize",
        control: {
          ...getParamRange("groundSize"),
          get: () => cap.getSize(),
          set: (v) => cap.setSize(v as number),
        },
      },
      {
        id: "ground-divisions",
        kind: "slider",
        labelKey: "preview.groundDivisions",
        control: {
          ...getParamRange("groundDivisions"),
          get: () => cap.getDivisions(),
          set: (v) => cap.setDivisions(v as number),
        },
      },
      {
        id: "ground-color-center",
        kind: "color",
        labelKey: "preview.groundColorCenter",
        control: {
          get: () => cap.getColorCenter(),
          set: (v) => cap.setColorCenter(v as number),
        },
      },
      {
        id: "ground-color-grid",
        kind: "color",
        labelKey: "preview.groundColorGrid",
        control: {
          get: () => cap.getColorGrid(),
          set: (v) => cap.setColorGrid(v as number),
        },
      },
    ],
  };
}

/** 材质组 folder：mat-source + 原生 color/slider 按原控件顺序排布，
 *  texture/clear 按钮位插原生 button 节点（保序保语义）。 */
function groundBuildMatFolder(cap: GroundCapability): NodeFor<"folder"> {
  const children: PreviewMenuNode[] = [
    {
      id: "ground-mat-source",
      kind: "select",
      labelKey: "preview.groundMatSource",
      control: {
        options: [
          { value: "none", labelKey: "preview.groundMatSourceNone" },
          { value: "solid", labelKey: "preview.groundMatSourceSolid" },
          { value: "canvas", labelKey: "preview.groundMatSourceCanvas" },
          { value: "texture", labelKey: "preview.groundMatSourceTexture" },
        ],
        get: () => cap.getSourceKind(),
        set: (v) => cap.setSourceKind(v as GroundSourceKind),
      },
    },
    {
      id: "ground-mat-canvas-style",
      kind: "select",
      labelKey: "preview.groundCanvasStyle",
      // ADR-249 §2.1：样式轴仅当来源轴 === canvas 时显示
      visibleWhen: (s) => s["env.groundSourceKind"] === "canvas",
      control: {
        options: [
          // ADR-252：本轴只装**噪声材质**；几何图案已归叠加层 folder。
          // ADR-254：下拉值 = **预设状态**；选材质会一次性套用形状 + 配色（材质名兼现颜色）。
          { value: "plain", labelKey: "preview.groundCanvasStylePlain" },
          { value: "marble", labelKey: "preview.groundCanvasStyleMarble" },
          { value: "sand", labelKey: "preview.groundCanvasStyleSand" },
          { value: "grass", labelKey: "preview.groundCanvasStyleGrass" },
          // 显示项：用户手改过预设关心的字段后由中间件置位，手选它不做事
          { value: "custom", labelKey: "preview.groundCanvasStyleCustom" },
        ],
        get: () => cap.getMaterialPreset(),
        set: (v) => cap.setMaterialPreset(v as GroundMaterialPreset),
      },
    },
    colorNode(
      "ground-mat-color",
      "preview.groundMatColor",
      "matColor",
      () => cap.getMatColor(),
      (v) => cap.setMatColor(v),
    ),
    colorNode(
      "ground-mat-color2",
      "preview.groundMatColor2",
      "matColor2",
      () => cap.getMatColor2(),
      (v) => cap.setMatColor2(v),
    ),
    sliderNode(
      "ground-mat-grid-size",
      "preview.groundMatGridSize",
      "matGridSize",
      getParamRange("groundMatGridSize"),
      // 取整单一收口在 cap.setMatGridSize（数据类型归一），菜单不再重复 Math.round（锐评 P6b）
      { get: () => cap.getMatGridSize(), set: (v) => cap.setMatGridSize(v) },
    ),
    sliderNode(
      "ground-mat-density",
      "preview.groundMatDensity",
      "matDensity",
      getParamRange("groundMatDensity"),
      { get: () => cap.getMatDensity(), set: (v) => cap.setMatDensity(v) },
    ),
    sliderNode(
      "ground-mat-angle",
      "preview.groundMatAngle",
      "matAngleDeg",
      getParamRange("groundMatAngleDeg"),
      { get: () => cap.getMatAngle(), set: (v) => cap.setMatAngle(v) },
    ),
    ...textureButtonsNode(cap),
    sliderNode(
      "ground-mat-opacity",
      "preview.groundMatOpacity",
      "matOpacity",
      getParamRange("groundMatOpacity"),
      { get: () => cap.getMatOpacity(), set: (v) => cap.setMatOpacity(v) },
    ),
    sliderNode(
      "ground-mat-scale",
      "preview.groundMatScale",
      "matScale",
      getParamRange("groundMatScale"),
      { get: () => cap.getMatScale(), set: (v) => cap.setMatScale(v) },
    ),
    sliderNode(
      "ground-mat-rotation",
      "preview.groundMatRotation",
      "matRotationDeg",
      getParamRange("groundMatRotationDeg"),
      { get: () => cap.getMatRotation(), set: (v) => cap.setMatRotation(v) },
    ),
    sliderNode(
      "ground-mat-roughness",
      "preview.groundMatRoughness",
      "matRoughness",
      getParamRange("groundMatRoughness"),
      { get: () => cap.getMatRoughness(), set: (v) => cap.setMatRoughness(v) },
    ),
    sliderNode(
      "ground-mat-metalness",
      "preview.groundMatMetalness",
      "matMetalness",
      getParamRange("groundMatMetalness"),
      { get: () => cap.getMatMetalness(), set: (v) => cap.setMatMetalness(v) },
    ),
  ];
  return {
    id: "cap-group-ground-material",
    kind: "folder",
    labelKey: MAT_GROUP,
    children,
  };
}

/** ADR-249 §2.3 叠加层 folder：独立透明格线层（正交于来源/样式两轴）。
 *  style 为 none 时子控件全隐（与材质组同一 paramVisible 思路：可见 ⇔ 生效）。 */
function groundBuildOverlayFolder(cap: GroundCapability): NodeFor<"folder"> {
  const overlayOn = (s: Partial<PreviewSnapshot>): boolean => s["env.groundOverlay"] !== "none";
  const children: PreviewMenuNode[] = [
    {
      id: "ground-overlay",
      kind: "select",
      labelKey: "preview.groundOverlay",
      control: {
        options: [
          { value: "none", labelKey: "preview.groundOverlayNone" },
          { value: "grid", labelKey: "preview.groundOverlayGrid" },
          { value: "checker", labelKey: "preview.groundOverlayChecker" },
          { value: "stripes", labelKey: "preview.groundOverlayStripes" },
          { value: "diamond", labelKey: "preview.groundOverlayDiamond" },
        ],
        get: () => cap.getOverlayStyle(),
        set: (v) => cap.setOverlayStyle(v as GroundOverlayStyle),
      },
    },
    {
      id: "ground-overlay-color",
      kind: "color",
      labelKey: "preview.groundOverlayColor",
      visibleWhen: overlayOn,
      control: {
        get: () => cap.getOverlayColor(),
        set: (v) => cap.setOverlayColor(v as number),
      },
    },
    {
      id: "ground-overlay-size",
      kind: "slider",
      labelKey: "preview.groundOverlaySize",
      visibleWhen: overlayOn,
      control: {
        ...getParamRange("groundOverlaySize"),
        get: () => cap.getOverlaySize(),
        set: (v) => cap.setOverlaySize(v as number),
      },
    },
    {
      id: "ground-overlay-opacity",
      kind: "slider",
      labelKey: "preview.groundOverlayOpacity",
      visibleWhen: overlayOn,
      control: {
        ...getParamRange("groundOverlayOpacity"),
        get: () => cap.getOverlayOpacity(),
        set: (v) => cap.setOverlayOpacity(v as number),
      },
    },
  ];
  return {
    id: "cap-group-ground-overlay",
    kind: "folder",
    labelKey: OVERLAY_GROUP,
    children,
  };
}

/** 完整参数面板节点树：ground-visible + ground-grid-visible 平铺 + 网格组 folder +
 *  材质组 folder + 叠加层 folder。
 *  ground 无能力总开关（visible 是 params 级，非 getMasterToggle 语义）。
 *  ground-grid-visible（2026-09-19 新增）：参考网格（GridHelper 层）独立开关——与
 *  表面材质/叠加层正交，补上旧网格层长期缺失的出口（知识卡「已知遗留 1」）。 */
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
    {
      id: "ground-grid-visible",
      kind: "toggle",
      labelKey: "preview.groundGridVisible",
      control: {
        get: () => cap.getGridVisible(),
        set: (v) => cap.setGridVisible(v as boolean),
      },
    },
    groundBuildGridFolder(cap),
    groundBuildMatFolder(cap),
    groundBuildOverlayFolder(cap),
  ];
}
