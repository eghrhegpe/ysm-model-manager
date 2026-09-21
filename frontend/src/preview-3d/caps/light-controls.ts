// ===== LightCapability 菜单定义（ADR-177 拆分：职责④从 LightCapability 抽离）=====
// 经 `import type` 取 LightCapability（仅类型，不引入运行时环），全部调用其公开 API。
// [ADR-195 刀3] 删旧 getLightMenuControls + lcBuild*（旧控件工厂）；
// 仅保留 buildLightNodes 直产 PreviewMenuNode[]（cap.getMenuNodes 用）。
//
// [ADR-246] 三项菜单层收敛：
//   D1 删「锥引擎」下拉（postprocess 空壳引擎已移除，控件本就只会关掉体积光）
//   D2 体积光 5 参数收编为 3 个语义滑块 + 1 个上下亮度比（base/tip 不再各自暴露）
//   D3 聚光灯与体积光合并进同一可折叠卡（用户裁定：不做 visibleWhen 隐藏，只折叠）
//
// [light-type-switch] 统一实例重构：
//   三盏灯（key/fill/rim）各可在 directional / point / spot 之间切换，参数结构统一。
//   UI 改为「选择编辑哪盏灯（light-select）→ 同一套设置条读写该灯」，取代原先
//   key/fill/rim 各自的平铺 toggle + 独立滑块组（那会让每盏灯都要复制一份 spot 参数）。
//   类型专属参数（锥角/半影/距离/衰减）按当前灯 type 条件显示；类型 select 带
//   refreshOnChange → 切换后重建节点树，参数区随之增减。

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { LightCapability, LightKey } from "./light-capability.ts";
import { FLATTEN_MAP, type LightType, type VolumetricDriver } from "./light-presets.ts";

/** 统一设置条内「有值域」的参数字段（type/enabled/color 不在其列）。 */
type LightSliderField =
  | "intensity"
  | "azimuth"
  | "elevation"
  | "angle"
  | "penumbra"
  | "distance"
  | "decay";

// 共享 options 常量——节点树路径（buildLightNodes 的 `control.options:`）

/** 三盏灯槽位（[light-type-switch] 「编辑灯光」select；旧注释称「按钮组」与实现不符已修） */
const LIGHT_SLOTS: Array<{ value: string; label: string; labelKey: LocaleKey }> = [
  { value: "key", label: "主灯", labelKey: "preview.keyLight" },
  { value: "fill", label: "补灯", labelKey: "preview.fillLight" },
  { value: "rim", label: "轮廓灯", labelKey: "preview.rimLight" },
];

/** 灯光类型选项（每盏灯可自由切换） */
const LIGHT_TYPE_OPTIONS: Array<{ value: LightType; label: string; labelKey: LocaleKey }> = [
  { value: "directional", label: "方向光", labelKey: "preview.lightTypeDirectional" },
  { value: "point", label: "点光源", labelKey: "preview.lightTypePoint" },
  { value: "spot", label: "聚光灯", labelKey: "preview.lightTypeSpot" },
];

/** [ADR-290] 体积光锥驱动源选项：auto = 槽位顺序第一盏启用 spot；显式槽位 = 严格绑定 */
const VOLUMETRIC_DRIVER_OPTIONS: Array<{
  value: VolumetricDriver;
  label: string;
  labelKey: LocaleKey;
}> = [
  { value: "auto", label: "自动", labelKey: "preview.volumetricDriverAuto" },
  { value: "key", label: "主灯", labelKey: "preview.keyLight" },
  { value: "fill", label: "补灯", labelKey: "preview.fillLight" },
  { value: "rim", label: "轮廓灯", labelKey: "preview.rimLight" },
];

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

const LIGHT_PARAMS_GROUP = "preview.lightGroupParams";
const SPOT_VOL_CARD = "cap-group-spot-vol";

/** 能力总开关节点 id：本文件（产节点）/ LightCapability.getMasterNodeId（声明）/
 *  面板 filter（消费）三方共用的唯一常量——裸字符串散在三处即平行手抄，改名时
 *  import 侧有 compiler 盯，字符串各写各的没人盯。 */
export const LIGHT_MASTER_NODE_ID = "light-enabled";

/** 灯光能力总开关 toggle（面板首行；读 isEnabled/setEnabled——setEnabled(false) 移除场景全部灯）。
 *  [ADR-293] 真值源 = envState.lightEnabled，与 pp-enabled（ADR-250）/ fog-enabled（ADR-196）
 *  同口径——旧注释宣称「与 shadow 同构」实为双轨（shadow-enabled 仍是 cap 私有态，同病另刀）。
 *  本节点经 getMasterNodeId 升场景组根视图 headerToggle，二级面板渲染时由 capPanelNodes 按
 *  LIGHT_MASTER_NODE_ID filter 掉，防一二级双份。 */
function lightEnabledNode(cap: LightCapability): PreviewMenuNode {
  return {
    id: LIGHT_MASTER_NODE_ID,
    kind: "toggle",
    labelKey: "preview.lighting",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** [ADR-293] 灯架线框（helper）可见性开关：视口 gizmo 总闸。
 *  三副线框是渲染输出的一部分却曾长期不可见地恒挂载——无 schema 键、无控件、无存档，
 *  正是 ADR-290 给锥体驱动源清偿的「渲染输入未显式化」同款债，本节点收口。
 *  不入 LightParams/FLATTEN_MAP（那映射的是「灯光参数面」，线框不是灯光参数），
 *  直接挂 schema 布尔键，持久化走顶层 helperVisible 键（light-persist.ts）。
 *  默认 true = 现状观感（线框随各灯开关），此开关只增加撤销权。 */
function lightHelperNode(cap: LightCapability): PreviewMenuNode {
  return {
    id: "light-helper",
    kind: "toggle",
    labelKey: "preview.lightHelper",
    hintKey: "preview.lightHelperHint",
    control: {
      get: () => cap.isHelperVisible(),
      set: (v) => cap.setHelperVisible(v as boolean),
    },
  };
}

/** [light-type-switch] 统一设置条：读写「当前编辑的那盏灯」，参数结构三类型共用。
 *  类型专属参数（angle/penumbra/distance/decay）按 type 条件展开——同一套 UI 服务三盏灯，
 *  消灭「每盏灯复制一份 spot 参数」的 N×M 重复。 */
function unifiedLightNodes(cap: LightCapability): PreviewMenuNode[] {
  const which = cap.getActiveLight();
  const getP = () => cap.getParams()[which];
  const setField = (field: string, v: unknown) =>
    cap.setLightParams(which, { [field]: v } as never);

  // 滑杆值域唯一事实源 = schema（ADR-283）：键由 FLATTEN_MAP（light-presets.ts，which→字段→键 唯一映射）
  // 决定——which 是动态槽位，同一控件对应 key/fill/rim 三键之一；三键均已在 schema 声明 range，
  // 故此处的窄化由编译期保证（若某槽位漏声明 range，`RangedKey` 约束即报错）。
  const rangeOf = (field: LightSliderField) => getParamRange(FLATTEN_MAP[which][field]);

  const type = getP().type;
  const nodes: PreviewMenuNode[] = [
    {
      id: `light-${which}-type`,
      kind: "select",
      labelKey: "preview.lightType",
      control: {
        options: LIGHT_TYPE_OPTIONS,
        get: () => getP().type,
        set: (v) => setField("type", v),
        // 类型变化 → 重建节点树，参数区随之增减（锥角/半影/距离/衰减条件显示）
        refreshOnChange: true,
      },
    },
    {
      id: `light-${which}-enabled`,
      kind: "toggle",
      labelKey: "preview.lightEnabled",
      control: {
        get: () => getP().enabled,
        set: (v) => setField("enabled", v),
      },
    },
    {
      id: `light-${which}-color`,
      kind: "color",
      labelKey: "preview.lightColor",
      control: {
        get: () => getP().color,
        set: (v) => setField("color", v),
      },
    },
    {
      id: `light-${which}-intensity`,
      kind: "slider",
      labelKey: "preview.lightIntensity",
      control: {
        ...rangeOf("intensity"),
        get: () => getP().intensity,
        set: (v) => setField("intensity", v),
      },
    },
    {
      id: `light-${which}-azimuth`,
      kind: "slider",
      labelKey: "preview.lightAzimuth",
      control: {
        ...rangeOf("azimuth"),
        get: () => getP().azimuth,
        set: (v) => setField("azimuth", v),
      },
    },
    {
      id: `light-${which}-elevation`,
      kind: "slider",
      labelKey: "preview.lightElevation",
      control: {
        ...rangeOf("elevation"),
        get: () => getP().elevation,
        set: (v) => setField("elevation", v),
      },
    },
  ];

  // spot 专属：锥角 / 半影
  if (type === "spot") {
    nodes.push(
      {
        id: `light-${which}-angle`,
        kind: "slider",
        labelKey: "preview.lightAngle",
        control: {
          ...rangeOf("angle"),
          get: () => getP().angle,
          set: (v) => setField("angle", v),
        },
      },
      {
        id: `light-${which}-penumbra`,
        kind: "slider",
        labelKey: "preview.lightPenumbra",
        control: {
          ...rangeOf("penumbra"),
          get: () => getP().penumbra,
          set: (v) => setField("penumbra", v),
        },
      },
    );
  }

  // spot / point 共用：衰减距离 / 衰减指数（directional 无衰减概念）
  if (type !== "directional") {
    nodes.push(
      {
        id: `light-${which}-distance`,
        kind: "slider",
        labelKey: "preview.lightDistance",
        control: {
          ...rangeOf("distance"),
          get: () => getP().distance,
          set: (v) => setField("distance", v),
        },
      },
      {
        id: `light-${which}-decay`,
        kind: "slider",
        labelKey: "preview.lightDecay",
        control: {
          ...rangeOf("decay"),
          get: () => getP().decay,
          set: (v) => setField("decay", v),
        },
      },
    );
  }

  return nodes;
}

/** [ADR-246 D3] 体积光卡：聚光灯锥体的可见化。
 *  [ADR-290] 锥体驱动源由卡内「驱动灯光」select（lightVolumetricDriver，schema 化 +
 *  入存档）显式决定：auto = 槽位顺序第一盏启用的 spot；显式槽位 = 严格绑定（前提不满足
 *  则无锥）。hint 告知「需一盏启用的聚光灯」前提。 */
function spotVolCardNode(cap: LightCapability): PreviewMenuNode {
  return {
    id: SPOT_VOL_CARD,
    kind: "card",
    collapsible: true,
    labelKey: "preview.spotlightVolume",
    // [锐评根治 2026-09] 不做 visibleWhen（ADR-246 D3 用户裁定），但无启用 spot 灯时
    // 本卡滑块零效果——hintKey 把隐藏耦合显式化，免用户对 directional 灯拖满滑块发懵。
    hintKey: "preview.spotlightVolumeHint",
    children: [
      {
        id: "light-volumetric",
        kind: "toggle",
        labelKey: "preview.volumetric",
        hintKey: "preview.volumetricHint",
        control: {
          get: () => cap.getParams().volumetric.enabled,
          set: (v) => cap.setVolumetric({ enabled: v as boolean }),
        },
      },
      // [ADR-290] 驱动灯光：渲染输入显式化，替换原「随编辑焦点漂移」的隐式行为
      {
        id: "light-volumetric-driver",
        kind: "select",
        labelKey: "preview.volumetricDriver",
        hintKey: "preview.volumetricDriverHint",
        control: {
          options: VOLUMETRIC_DRIVER_OPTIONS,
          get: () => cap.getParams().volumetric.driver,
          set: (v) => cap.setVolumetric({ driver: v as VolumetricDriver }),
        },
      },
      // [ADR-246 D2] 三个语义滑块：覆盖「多浓 / 衰减多快 / 边缘多软」
      {
        id: "light-volumetric-density",
        kind: "slider",
        labelKey: "preview.volumetricDensity",
        control: {
          ...getParamRange("lightVolumetricOpacity"),
          get: () => cap.getParams().volumetric.opacity,
          set: (v) => cap.setVolumetric({ opacity: v as number }),
        },
      },
      {
        id: "light-volumetric-falloff",
        kind: "slider",
        labelKey: "preview.volumetricFalloff",
        control: {
          ...getParamRange("lightVolumetricFogPower"),
          get: () => cap.getParams().volumetric.fogPower,
          set: (v) => cap.setVolumetric({ fogPower: v as number }),
        },
      },
      {
        id: "light-volumetric-edge-fade",
        kind: "slider",
        labelKey: "preview.volumetricEdgeFade",
        control: {
          ...getParamRange("lightVolumetricEdgeFade"),
          get: () => cap.getParams().volumetric.edgeFade,
          set: (v) => cap.setVolumetric({ edgeFade: v as number }),
        },
      },
      // [ADR-246 D2] base/tip 合并为单一「上下亮度比」——原两参数是 shader 的 mix() 两端
      {
        id: "light-volumetric-ratio",
        kind: "slider",
        labelKey: "preview.volumetricTipRatio",
        control: {
          // 比值域 [0,1] 属派生标量（tip = base × ratio），不是 envState 键值 → 不迁 schema（ADR-283 §2.5 例外）
          min: 0,
          max: 1,
          step: 0.05,
          get: () => cap.getVolumetricTipRatio(),
          set: (v) => cap.setVolumetricTipRatio(v as number),
        },
      },
    ],
  };
}

/** 环境光（三盏灯之外的独立轴）。color 控件补齐 [锐评根治 2026-10]：lightAmbientColor
 *  在 schema / FLATTEN_MAP / 持久化三处全链路注册，唯独控件面无入口——「参数面 ⊋ 控件面」
 *  使其成为只随存档陪跑的幽灵字段。现两轴各一控件，与统一设置条的 color+intensity 同构。 */
function ambientNodes(cap: LightCapability): PreviewMenuNode[] {
  return [
    {
      id: "light-ambient-color",
      kind: "color",
      labelKey: "preview.ambientColor",
      control: {
        get: () => cap.getParams().ambient.color,
        set: (v) => cap.setParams({ ambient: { color: v as number } }),
      },
    },
    {
      id: "light-ambient",
      kind: "slider",
      labelKey: "preview.ambientIntensity",
      control: {
        ...getParamRange("lightAmbientIntensity"),
        get: () => cap.getParams().ambient.intensity,
        set: (v) => cap.setParams({ ambient: { intensity: v as number } }),
      },
    },
  ];
}

/** 完整参数面板节点树：light-enabled 能力总开关（首行）+ 编辑灯选择（三灯按钮）
 *  + [ADR-293] light-helper 线框可见性开关 + 统一设置条（类型/颜色/强度/方位角/仰角
 *  + 类型专属参数）+ 环境光 + 体积光卡。 */
export function buildLightNodes(cap: LightCapability): PreviewMenuNode[] {
  return [
    lightEnabledNode(cap),
    // [light-type-switch] 顶栏三灯按钮：选择当前编辑的灯，其下统一设置条读写该灯
    {
      id: "light-select",
      kind: "select",
      labelKey: "preview.lightSelect",
      control: {
        options: LIGHT_SLOTS,
        get: () => cap.getActiveLight(),
        set: (v) => cap.setActiveLight(v as LightKey),
        // 切换编辑对象 → 重建节点树（设置条各闭包绑定新槽位）
        refreshOnChange: true,
      },
    },
    // [ADR-293] 视口线框总闸（编辑焦点之下、参数组之上——它管「怎么看」不管「怎么亮」）
    lightHelperNode(cap),
    {
      id: "cap-group-light-params",
      kind: "folder",
      labelKey: LIGHT_PARAMS_GROUP,
      children: [
        ...unifiedLightNodes(cap),
        ...ambientNodes(cap),
        spotVolCardNode(cap),
        {
          // [ADR-282] 取代原「灯光预设」下拉：重置锚定模型无关的 DEFAULT_LIGHT_PARAMS。
          // 旧下拉列的是 ModelType 枚举（YSM方块/VRM角色/…），实际只含三个光强数字，
          // 且选中任一项（含「默认」）会设 manualPreset 永久冻结后续模型预设——已删。
          id: "light-reset",
          kind: "button",
          labelKey: "preview.lightReset",
          action: () => cap.resetLightParams(),
        },
      ],
    },
  ];
}
