// ===== 环境能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// environment 是刀2 最复杂一例——含 preset-thumb/image/histogram 复杂控件 + 组分裂修复：
//   - background 组（use-as-background/intensity/histogram）在 getMenuControls 里被拆两段
//     （ecBuildBasic 与末尾 ecBuildHistogram），节点化后正确合并进同一个 folder。
//   - preset-thumb/image/histogram 的控件定义保持原样（含 group 字段），
//     进 controls 节点后由 renderCapControls 消费。
//   - env-pick-hdr/env-clear-hdr 为原生 button 节点（rmAppendButton 按钮臂，
//     PreviewControlDef 已无 button kind——复杂件仅余 image/timeline/histogram/preset-thumb）。
// 顶层顺序：
//   1. env-enabled toggle 原生（无 group——能力总开关）
//   2. folder preview.envGroupPreset：env-preset → controls 通道节点
//   3. folder preview.envGroupBackground：use-as-background toggle 原生 + intensity slider 原生
//      + env-histogram → controls 通道节点（组分裂修复）
//   4. folder preview.envGroupCustomHdr：env-hdr-preview → controls 节点（image）
//      + env-pick-hdr/env-clear-hdr → 原生 button 节点
// [双折叠头修复] folder 内 controls 通道控件一律去掉 group：folder 即折叠容器，
//   若控件保留 group 会令 renderCapControls 按同名分组再建一个同名 cap-section →
//   同组折叠头重复（预设/背景/自定义HDR 三处均曾双头）。ENV_GROUP_* 常量仅供 folder
//   labelKey 消费。凡「folder 包裹 + 控件原带同名 group」都适用此约定。

import type { LocaleKey } from "@/core/i18n/t.ts";
import type {
  NodeFor,
  PreviewControlDef,
  PreviewMenuNode,
} from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { EnvironmentCapability } from "./environment-capability.ts";
import type { EnvSource } from "./environment-migrations.ts";
import type { EnvPresetId } from "./environment-state.ts";
import { ENV_PRESETS } from "./environment-state.ts";

const ENV_GROUP_PRESET: LocaleKey = "preview.envGroupPreset";
const ENV_GROUP_BACKGROUND: LocaleKey = "preview.envGroupBackground";
const ENV_GROUP_CUSTOM_HDR: LocaleKey = "preview.envGroupCustomHdr";

/**
 * [ADR-292 D3/D7] 环境贴图「来源」选择——scene.environment 唯一槽位的供图者。
 *
 * 收口前该槽位有两个写者（天空面板的「环境贴图」开关 + 本面板），互不知晓、后写者赢，
 * UI 显示两个开关都「开」却只有一个生效。收口后写者唯一 = 本 cap，来源由此单选表达。
 *
 * ⚠️ 与「预设」folder 的分工：来源选**走哪条取图通路**（预设 Canvas / 跟随天空 / 自定义 HDR），
 * 预设选**具体哪张图**。故本节点置于 preset folder **之外**（顶层），避免被误读为预设的子选项。
 */
function envSourceNode(cap: EnvironmentCapability): NodeFor<"select"> {
  return {
    id: "env-source",
    kind: "select",
    labelKey: "preview.envSource",
    hintKey: "preview.envSourceHint",
    control: {
      options: [
        { value: "preset", labelKey: "preview.envSourcePreset" },
        { value: "sky", labelKey: "preview.envSourceSky" },
        { value: "custom", labelKey: "preview.envSourceCustom" },
      ],
      get: () => cap.getSource(),
      set: (v) => cap.setSource(v as EnvSource),
    },
  };
}

/** ENV_PRESETS 预设 id → i18n 键（与 env.ts 快捷预设 select 同源复用 presetQuick*，
 *  使同一预设在一级快捷选与 cap 缩略图两处文案恒等）。 */
const ENV_PRESET_LABEL_KEY: Record<string, LocaleKey> = {
  sky: "preview.presetQuickSky",
  studio: "preview.presetQuickStudio",
  sunset: "preview.presetQuickSunset",
  night: "preview.presetQuickNight",
  forest: "preview.presetQuickForest",
};
/** 预设缩略图复杂控件（preset-thumb——非纯数据，走 controls 通道节点承载） */
function envPresetControlsNode(cap: EnvironmentCapability): NodeFor<"controls"> {
  const preset: PreviewControlDef = {
    id: "env-preset",
    kind: "preset-thumb",
    labelKey: "preview.envPresetThumbnail",
    fallback: "预设预览",
    // [双折叠头修复] 控件已在外层 folder（cap-group-env-preset）内，folder 即折叠容器，
    // 若再带 group 会令 renderCapControls 按同名字符串再建一个「预设」cap-section →
    // 同组折叠头重复。去掉 group = 平铺进 folder body，消除双头。
    // 注：ENV_GROUP_* 常量仍被 folder 的 labelKey 消费，保留定义。
    thumb: {
      size: 64,
      // [预设冗余标签] 外层 folder 折叠头已叫「预设」，隐藏控件内部多余的「预设预览」label 行
      hideLabel: true,
      options: (() => {
        const keys = Object.keys(ENV_PRESETS) as Array<Exclude<EnvPresetId, "custom">>;
        return keys.map((id) => ({
          value: id,
          label: ENV_PRESETS[id].label,
          labelKey: ENV_PRESET_LABEL_KEY[id],
          getThumb: () => cap.getPresetThumbnail(id, 64),
        }));
      })(),
      activeValue: () => cap.getPresetId(),
      onSelect: (v) => cap.setPresetId(v as EnvPresetId),
    },
    getValue: () => "",
    setValue: () => {
      /* 由 thumb.onSelect 处理 */
    },
  };
  return { id: "cap-group-env-preset-thumb", kind: "controls", controls: [preset] };
}

/** 直方图复杂控件（histogram——非纯数据，走 controls 通道节点承载） */
function envHistogramControlsNode(cap: EnvironmentCapability): NodeFor<"controls"> {
  const hist: PreviewControlDef = {
    id: "env-histogram",
    kind: "histogram",
    labelKey: "preview.envHistogram",
    fallback: "亮度直方图",
    // [双折叠头修复] 同 preset：histogram 已在外层 background folder 内，去掉 group 避免重复「背景」头
    getValue: () => cap.getLuminanceHistogram(),
    setValue: () => {
      /* 只读 */
    },
  };
  return { id: "cap-group-env-histogram", kind: "controls", controls: [hist] };
}

/** 自定义 HDR 控件组：image 预览（controls 通道）+ pick/clear 原生 button 节点。
 *  [ADR-195 走法甲收口] button 已可被节点 kind 承载（rmAppendButton 按钮臂，
 *  锐评修复 2026-09-20）——不再经 controls 通道塞空桩 getValue/setValue，
 *  对齐 ground-menu.ts textureButtonsNode 先例。PreviewControlDef 仅余
 *  image/timeline/histogram/preset-thumb 四复杂件（button 已从 PreviewControlKind 移除）。 */
function envCustomHdrControlsNodes(cap: EnvironmentCapability): PreviewMenuNode[] {
  const image: PreviewControlDef = {
    id: "env-hdr-preview",
    kind: "image",
    labelKey: "preview.envHdrPreview",
    fallback: "HDR 预览",
    // [双折叠头修复] 同 preset：image 已在外层 customHdr folder 内，去掉 group 避免重复「自定义 HDR」头
    getValue: () => cap.getCustomHdrThumbnail(),
    setValue: () => {
      /* 只读 */
    },
  };
  return [
    { id: "cap-group-env-hdr-preview", kind: "controls", controls: [image] },
    {
      id: "env-pick-hdr",
      kind: "button",
      labelKey: "preview.envPickHdr",
      // [双折叠头修复] 按钮已在外层 customHdr folder 内，无需 group
      control: {
        text: "preview.envPickHdrBtn",
        variant: "primary",
        action: async () => cap.onPickCustomHdr(),
        disabled: () => cap.isCustomHdrLoading(),
        getHint: () => {
          if (cap.isCustomHdrLoading()) return "加载中…";
          const n = cap.getCustomHdrName();
          return n ? `已加载：${n}` : "";
        },
        hintKey: "preview.envPickHdrHint",
      },
    },
    {
      id: "env-clear-hdr",
      kind: "button",
      labelKey: "preview.envClearHdr",
      control: {
        text: "preview.envClearHdrBtn",
        variant: "ghost",
        action: () => cap.onClearCustomHdr(),
        disabled: () => !cap.hasCustomHdr(),
        hintKey: "preview.envClearHdrHint",
        getHint: () => (cap.hasCustomHdr() ? "已清空将回到工作室预设" : ""),
      },
    },
  ];
}

/** 预设组 folder（preset-thumb 复杂控件） */
function envBuildPresetFolder(cap: EnvironmentCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-env-preset",
    kind: "folder",
    labelKey: ENV_GROUP_PRESET,
    children: [envPresetControlsNode(cap)],
  };
}

/** 背景组 folder（use-as-background toggle + intensity slider + histogram controls）——组分裂修复 */
function envBuildBackgroundFolder(cap: EnvironmentCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-env-background",
    kind: "folder",
    labelKey: ENV_GROUP_BACKGROUND,
    children: [
      {
        id: "env-use-as-background",
        kind: "toggle",
        labelKey: "preview.envUseAsBackground",
        hintKey: "preview.envUseAsBackgroundHint",
        control: {
          get: () => cap.isUseAsBackground(),
          set: (v) => cap.setUseAsBackground(v as boolean),
        },
      },
      {
        id: "env-intensity",
        kind: "slider",
        labelKey: "preview.envIntensity",
        control: {
          ...getParamRange("envIntensity"),
          get: () => cap.getIntensity(),
          set: (v) => cap.setIntensity(v as number),
        },
      },
      envHistogramControlsNode(cap),
    ],
  };
}

/** 自定义 HDR 组 folder（image 预览 + pick/clear 按钮） */
function envBuildCustomHdrFolder(cap: EnvironmentCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-env-custom-hdr",
    kind: "folder",
    labelKey: ENV_GROUP_CUSTOM_HDR,
    children: envCustomHdrControlsNodes(cap),
  };
}

/** 完整参数面板节点树——ADR-195 刀2 cap 直产节点入口。
 *  顶层：env-enabled 平铺 toggle（能力总开关）+ preset/background/customHdr 三 folder。
 *  background 组合并修复：use-as-background/intensity/histogram 同归一个 folder。 */
export function buildEnvironmentNodes(cap: EnvironmentCapability): PreviewMenuNode[] {
  return [
    {
      id: "env-enabled",
      kind: "toggle",
      labelKey: "preview.environment",
      control: {
        get: () => cap.isEnabled(),
        set: (v) => cap.setEnabled(v as boolean),
      },
    },
    // [ADR-292 D3] 来源选择紧随总开关（决定「谁供图」），再往下才是各来源的参数
    envSourceNode(cap),
    envBuildPresetFolder(cap),
    envBuildBackgroundFolder(cap),
    envBuildCustomHdrFolder(cap),
  ];
}
