// ===== 后处理能力菜单控件工厂（自 postprocessing-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()
// （ADR-195 刀2）。改控件定义只动此文件，不触碰 Three 装配核。
//
// 顶层顺序与 getMenuControls() 渲染等价：
//   pp-enabled 基座 → Color 文件夹 → pp-bloom-enabled 基座 → Bloom 文件夹
//   → pp-ssao-enabled 基座 → SSAO 文件夹 → Reflection 文件夹 → SSR 文件夹

import type { LocaleKey } from "@/core/i18n/t.ts";
import type { NodeFor, PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type {
  PostprocessingCapability,
  PostprocessingParams,
  ReflectionMode,
} from "./postprocessing-capability.ts";

// tone mapping 选项常量（与 ppcBuildBasic 内 select 保持一致）
const TONE_MAPPING_OPTIONS: ReadonlyArray<{
  value: PostprocessingParams["toneMapping"];
  label: string;
  labelKey?: LocaleKey;
}> = [
  { value: "none", label: "无", labelKey: "preview.toneMappingNone" },
  { value: "linear", label: "线性", labelKey: "preview.toneMappingLinear" },
  { value: "reinhard", label: "Reinhard", labelKey: "preview.toneMappingReinhard" },
  { value: "aces", label: "ACES Filmic", labelKey: "preview.toneMappingAces" },
  { value: "cineon", label: "Cineon", labelKey: "preview.toneMappingCineon" },
];

// 反射模式选项常量（与 ppcBuildSSR 内 select 保持一致）
const REFLECTION_MODE_OPTIONS: ReadonlyArray<{
  value: ReflectionMode;
  label: string;
  labelKey?: LocaleKey;
}> = [
  { value: "envmap-only", label: "仅环境贴图", labelKey: "preview.reflectionModeEnvmapOnly" },
  {
    value: "envmap+ssr",
    label: "环境贴图 + 屏幕空间",
    labelKey: "preview.reflectionModeEnvmapSsr",
  },
  { value: "ssr-only", label: "仅屏幕空间", labelKey: "preview.reflectionModeSsrOnly" },
];

// [2026-10 锐评 P1-3] 总开关门：总开关关闭时，子控件的写入一律不产生可见效果
// （composer 未建 / 未参与每帧），原实现让它们照常可点 → 用户「开了没反应」。
// 这里不改成「关闭时惰性建 composer」——那会重新打开 ADR-299 已关掉的默认路径每帧过载
// （实测 1.05ms/帧、+35.3MB 常驻缓冲），牺牲的是全体用户的默认启动开销。
// 正解 = 诚实反馈：灰化 + hint 说明「需先开启后处理」，交互不静默。
/** 子控件统一的禁用谓词：总开关关闭即灰化（语义为「当前不具备生效前提」）。 */
function disabledWhenOff(cap: PostprocessingCapability): () => boolean {
  return () => !cap.isEnabled();
}

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

// 每个节点组一个具名构造器：`buildPostprocessingNodes` 退化为可一眼读完的
// 「节点清单索引」，组内细节下沉到各自函数。节点 id / 顺序 / labelKey 契约不变
// （回归守卫：postprocessing-capability.test.ts 的顶层结构与子节点读写断言）。

/** pp-enabled 基座 toggle（无 group）：总开关。 */
function enabledNode(cap: PostprocessingCapability): NodeFor<"toggle"> {
  return {
    id: "pp-enabled",
    kind: "toggle",
    labelKey: "preview.postprocessing",
    control: {
      get: () => cap.isEnabled(),
      set: (v) => cap.setEnabled(v as boolean),
    },
  };
}

/** Color 文件夹：toneMapping select + exposure slider。 */
function colorFolder(cap: PostprocessingCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-postprocessing-color",
    kind: "folder",
    labelKey: "preview.postprocessingGroupColor",
    children: [
      {
        id: "pp-toneMapping",
        kind: "select",
        labelKey: "preview.toneMapping",
        control: {
          options: [...TONE_MAPPING_OPTIONS],
          get: () => cap.getParams().toneMapping,
          set: (v) => cap.setToneMapping(v as PostprocessingParams["toneMapping"]),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-exposure",
        kind: "slider",
        labelKey: "preview.exposure",
        control: {
          ...getParamRange("ppExposure"),
          get: () => cap.getParams().exposure,
          set: (v) => cap.setExposure(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
    ],
  };
}

/** pp-bloom-enabled 基座 toggle（无 group）：辉光总开关。 */
function bloomEnabledNode(cap: PostprocessingCapability): NodeFor<"toggle"> {
  return {
    id: "pp-bloom-enabled",
    kind: "toggle",
    labelKey: "preview.bloomEnabled",
    control: {
      get: () => cap.getParams().bloomEnabled,
      set: (v) => cap.setBloomEnabled(v as boolean),
      disabled: disabledWhenOff(cap),
    },
  };
}

/** Bloom 文件夹：strength/threshold/radius slider + follow toggle。 */
function bloomFolder(cap: PostprocessingCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-postprocessing-bloom",
    kind: "folder",
    labelKey: "preview.postprocessingGroupBloom",
    children: [
      {
        id: "pp-bloom-strength",
        kind: "slider",
        labelKey: "preview.bloomStrength",
        control: {
          ...getParamRange("ppBloomStrength"),
          get: () => cap.getParams().bloomStrength,
          set: (v) => cap.setBloomStrength(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-bloom-threshold",
        kind: "slider",
        labelKey: "preview.bloomThreshold",
        control: {
          ...getParamRange("ppBloomThreshold"),
          get: () => cap.getParams().bloomThreshold,
          set: (v) => cap.setBloomThreshold(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-bloom-radius",
        kind: "slider",
        labelKey: "preview.bloomRadius",
        control: {
          ...getParamRange("ppBloomRadius"),
          get: () => cap.getParams().bloomRadius,
          set: (v) => cap.setBloomRadius(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-bloom-follow",
        kind: "toggle",
        labelKey: "preview.bloomFollowVolumetric",
        control: {
          get: () => cap.getParams().bloomFollowVolumetric,
          set: (v) => cap.setBloomFollowVolumetric(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
    ],
  };
}

/** pp-ssao-enabled 基座 toggle（无 group）：环境光遮蔽总开关。 */
function ssaoEnabledNode(cap: PostprocessingCapability): NodeFor<"toggle"> {
  return {
    id: "pp-ssao-enabled",
    kind: "toggle",
    labelKey: "preview.ssao",
    control: {
      get: () => cap.getParams().ssaoEnabled,
      set: (v) => cap.setSSAOEnabled(v as boolean),
      disabled: disabledWhenOff(cap),
    },
  };
}

/** SSAO 文件夹：radius/mindist/maxdist slider。 */
function ssaoFolder(cap: PostprocessingCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-postprocessing-ssao",
    kind: "folder",
    labelKey: "preview.postprocessingGroupSsao",
    children: [
      {
        id: "pp-ssao-radius",
        kind: "slider",
        labelKey: "preview.ssaoRadius",
        control: {
          ...getParamRange("ppSsaoRadius"),
          get: () => cap.getParams().ssaoRadius,
          set: (v) => cap.setSSAORadius(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssao-mindist",
        kind: "slider",
        labelKey: "preview.ssaoMinDist",
        control: {
          ...getParamRange("ppSsaoMinDist"),
          get: () => cap.getParams().ssaoMinDist,
          set: (v) => cap.setSSAOMinDist(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssao-maxdist",
        kind: "slider",
        labelKey: "preview.ssaoMaxDist",
        control: {
          ...getParamRange("ppSsaoMaxDist"),
          get: () => cap.getParams().ssaoMaxDist,
          set: (v) => cap.setSSAOMaxDist(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
    ],
  };
}

/** Reflection 文件夹：mode select + reflector-disable toggle。 */
function reflectionFolder(cap: PostprocessingCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-postprocessing-reflection",
    kind: "folder",
    labelKey: "preview.postprocessingGroupReflection",
    children: [
      {
        id: "pp-reflection-mode",
        kind: "select",
        labelKey: "preview.reflectionMode",
        control: {
          options: [...REFLECTION_MODE_OPTIONS],
          get: () => cap.getParams().reflectionMode,
          set: (v) => cap.setReflectionMode(v as ReflectionMode),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-reflector-disable-when-ssr",
        kind: "toggle",
        labelKey: "preview.reflectorDisableWhenSSR",
        control: {
          get: () => cap.getParams().reflectorDisableWhenSSR,
          set: (v) => cap.setReflectorDisableWhenSSR(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
    ],
  };
}

/** SSR 文件夹：opacity/maxdistance/thickness slider + blur/attenuation/fresnel/bouncing toggle。 */
function ssrFolder(cap: PostprocessingCapability): NodeFor<"folder"> {
  return {
    id: "cap-group-postprocessing-ssr",
    kind: "folder",
    labelKey: "preview.postprocessingGroupSsr",
    children: [
      {
        id: "pp-ssr-opacity",
        kind: "slider",
        labelKey: "preview.ssrOpacity",
        control: {
          ...getParamRange("ppSsrOpacity"),
          get: () => cap.getParams().ssrOpacity,
          set: (v) => cap.setSSROpacity(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-maxdistance",
        kind: "slider",
        labelKey: "preview.ssrMaxDistance",
        control: {
          ...getParamRange("ppSsrMaxDistance"),
          get: () => cap.getParams().ssrMaxDistance,
          set: (v) => cap.setSSRMaxDistance(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-thickness",
        kind: "slider",
        labelKey: "preview.ssrThickness",
        control: {
          ...getParamRange("ppSsrThickness"),
          get: () => cap.getParams().ssrThickness,
          set: (v) => cap.setSSRThickness(v as number),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-blur",
        kind: "toggle",
        labelKey: "preview.ssrBlur",
        control: {
          get: () => cap.getParams().ssrBlur,
          set: (v) => cap.setSSRBlur(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-distanceAttenuation",
        kind: "toggle",
        labelKey: "preview.ssrDistanceAttenuation",
        control: {
          get: () => cap.getParams().ssrDistanceAttenuation,
          set: (v) => cap.setSSRDistanceAttenuation(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-fresnel",
        kind: "toggle",
        labelKey: "preview.ssrFresnel",
        control: {
          get: () => cap.getParams().ssrFresnel,
          set: (v) => cap.setSSRFresnel(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
      {
        id: "pp-ssr-bouncing",
        kind: "toggle",
        labelKey: "preview.ssrBouncing",
        control: {
          get: () => cap.getParams().ssrBouncing,
          set: (v) => cap.setSSRBouncing(v as boolean),
          disabled: disabledWhenOff(cap),
        },
      },
    ],
  };
}

/**
 * 完整后处理节点树：3 基座 toggle + 5 文件夹（Color/Bloom/SSAO/Reflection/SSR）。
 * 顶层顺序与 getMenuControls() 渲染等价，与旧实现逐节点一致（节点 id 由测试锁定）。
 */
export function buildPostprocessingNodes(cap: PostprocessingCapability): PreviewMenuNode[] {
  return [
    enabledNode(cap), // 1. 基座：后处理总开关
    colorFolder(cap), // 2. 色彩
    bloomEnabledNode(cap), // 3. 基座：辉光开关
    bloomFolder(cap), // 4. 辉光
    ssaoEnabledNode(cap), // 5. 基座：SSAO 开关
    ssaoFolder(cap), // 6. 环境光遮蔽
    reflectionFolder(cap), // 7. 反射
    ssrFolder(cap), // 8. 屏幕空间反射
  ];
}
