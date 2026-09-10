// ===== 环境能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// environment 是刀2 最复杂一例——含 preset-thumb/image/histogram 复杂控件 + 组分裂修复：
//   - background 组（use-as-background/intensity/histogram）在 getMenuControls 里被拆两段
//     （ecBuildBasic 与末尾 ecBuildHistogram），节点化后正确合并进同一个 folder。
//   - preset-thumb/image/histogram/button 的控件定义保持原样（含 group 字段），
//     进 controls 节点后由 renderCapControls 消费。
// 顶层顺序：
//   1. env-enabled toggle 原生（无 group——能力总开关）
//   2. folder preview.envGroupPreset：env-preset → controls 通道节点
//   3. folder preview.envGroupBackground：use-as-background toggle 原生 + intensity slider 原生
//      + env-histogram → controls 通道节点（组分裂修复）
//   4. folder preview.envGroupCustomHdr：env-hdr-preview → controls 节点（image）
//      + env-pick-hdr/env-clear-hdr → controls 节点（button 打包）

import type { PreviewControlDef, PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type { EnvironmentCapability } from "./environment-capability.ts";
import type { EnvPresetId } from "./environment-state.ts";
import { ENV_PRESETS } from "./environment-state.ts";

const ENV_GROUP_PRESET = "preview.envGroupPreset";
const ENV_GROUP_BACKGROUND = "preview.envGroupBackground";
const ENV_GROUP_CUSTOM_HDR = "preview.envGroupCustomHdr";

/** 预设缩略图复杂控件（preset-thumb——非纯数据，走 controls 通道节点承载） */
function envPresetControlsNode(cap: EnvironmentCapability): PreviewMenuNode {
  const preset: PreviewControlDef = {
    id: "env-preset",
    kind: "preset-thumb",
    labelKey: "preview.envPresetThumbnail",
    fallback: "预设预览",
    group: ENV_GROUP_PRESET,
    thumb: {
      size: 64,
      options: (() => {
        const keys = Object.keys(ENV_PRESETS) as Array<Exclude<EnvPresetId, "custom">>;
        return keys.map((id) => ({
          value: id,
          label: ENV_PRESETS[id].label,
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
function envHistogramControlsNode(cap: EnvironmentCapability): PreviewMenuNode {
  const hist: PreviewControlDef = {
    id: "env-histogram",
    kind: "histogram",
    labelKey: "preview.envHistogram",
    fallback: "亮度直方图",
    group: ENV_GROUP_BACKGROUND,
    getValue: () => cap.getLuminanceHistogram(),
    setValue: () => {
      /* 只读 */
    },
  };
  return { id: "cap-group-env-histogram", kind: "controls", controls: [hist] };
}

/** 自定义 HDR 控件组：image 预览 + pick/clear 按钮（全部走 controls 通道） */
function envCustomHdrControlsNodes(cap: EnvironmentCapability): PreviewMenuNode[] {
  const image: PreviewControlDef = {
    id: "env-hdr-preview",
    kind: "image",
    labelKey: "preview.envHdrPreview",
    fallback: "HDR 预览",
    group: ENV_GROUP_CUSTOM_HDR,
    getValue: () => cap.getCustomHdrThumbnail(),
    setValue: () => {
      /* 只读 */
    },
  };
  const buttons: PreviewControlDef[] = [
    {
      id: "env-pick-hdr",
      kind: "button",
      labelKey: "preview.envPickHdr",
      fallback: "自定义 HDR",
      group: ENV_GROUP_CUSTOM_HDR,
      button: {
        textKey: "preview.envPickHdrBtn",
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
      getValue: () => "",
      setValue: () => {
        /* ignore */
      },
    },
    {
      id: "env-clear-hdr",
      kind: "button",
      labelKey: "preview.envClearHdr",
      fallback: "清除自定义 HDR",
      group: ENV_GROUP_CUSTOM_HDR,
      button: {
        textKey: "preview.envClearHdrBtn",
        variant: "ghost",
        action: () => cap.onClearCustomHdr(),
        disabled: () => !cap.hasCustomHdr(),
        hintKey: "preview.envClearHdrHint",
        getHint: () => (cap.hasCustomHdr() ? "已清空将回到工作室预设" : ""),
      },
      getValue: () => "",
      setValue: () => {
        /* ignore */
      },
    },
  ];
  return [
    { id: "cap-group-env-hdr-preview", kind: "controls", controls: [image] },
    { id: "cap-group-env-hdr-buttons", kind: "controls", controls: buttons },
  ];
}

/** 预设组 folder（preset-thumb 复杂控件） */
function envBuildPresetFolder(cap: EnvironmentCapability): PreviewMenuNode {
  return {
    id: "cap-group-env-preset",
    kind: "folder",
    labelKey: ENV_GROUP_PRESET,
    fallback: "预设",
    children: [envPresetControlsNode(cap)],
  };
}

/** 背景组 folder（use-as-background toggle + intensity slider + histogram controls）——组分裂修复 */
function envBuildBackgroundFolder(cap: EnvironmentCapability): PreviewMenuNode {
  return {
    id: "cap-group-env-background",
    kind: "folder",
    labelKey: ENV_GROUP_BACKGROUND,
    fallback: "背景",
    children: [
      {
        id: "env-use-as-background",
        kind: "toggle",
        labelKey: "preview.envUseAsBackground",
        fallback: "用作背景",
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
        fallback: "反射强度",
        control: {
          min: 0,
          max: 3,
          step: 0.05,
          get: () => cap.getIntensity(),
          set: (v) => cap.setIntensity(v as number),
        },
      },
      envHistogramControlsNode(cap),
    ],
  };
}

/** 自定义 HDR 组 folder（image 预览 + pick/clear 按钮） */
function envBuildCustomHdrFolder(cap: EnvironmentCapability): PreviewMenuNode {
  return {
    id: "cap-group-env-custom-hdr",
    kind: "folder",
    labelKey: ENV_GROUP_CUSTOM_HDR,
    fallback: "自定义 HDR",
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
      fallback: "环境贴图",
      control: {
        get: () => cap.isEnabled(),
        set: (v) => cap.setEnabled(v as boolean),
      },
    },
    envBuildPresetFolder(cap),
    envBuildBackgroundFolder(cap),
    envBuildCustomHdrFolder(cap),
  ];
}
