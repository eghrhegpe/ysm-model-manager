// ===== 后处理能力菜单控件工厂（自 postprocessing-capability.ts 迁出）=====
// 纯声明层：零 THREE 依赖，仅构造 PreviewMenuNode 供 cap.getMenuNodes()
// （ADR-195 刀2）。改控件定义只动此文件，不触碰 Three 装配核。
//
// 顶层顺序与 getMenuControls() 渲染等价：
//   pp-enabled 基座 → Color 文件夹 → pp-bloom-enabled 基座 → Bloom 文件夹
//   → pp-ssao-enabled 基座 → SSAO 文件夹 → Reflection 文件夹 → SSR 文件夹

import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type {
  PostprocessingCapability,
  PostprocessingParams,
  ReflectionMode,
} from "./postprocessing-capability.ts";

// tone mapping 选项常量（与 ppcBuildBasic 内 select 保持一致）
const TONE_MAPPING_OPTIONS: ReadonlyArray<{
  value: PostprocessingParams["toneMapping"];
  label: string;
}> = [
  { value: "none", label: "无" },
  { value: "linear", label: "线性" },
  { value: "reinhard", label: "Reinhard" },
  { value: "aces", label: "ACES Filmic" },
  { value: "cineon", label: "Cineon" },
];

// 反射模式选项常量（与 ppcBuildSSR 内 select 保持一致）
const REFLECTION_MODE_OPTIONS: ReadonlyArray<{ value: ReflectionMode; label: string }> = [
  { value: "envmap-only", label: "仅环境贴图" },
  { value: "envmap+ssr", label: "环境贴图 + 屏幕空间" },
  { value: "ssr-only", label: "仅屏幕空间" },
];

/* ============ ADR-195 刀2：直产 PreviewMenuNode[] ============ */

// 每个节点组一个具名构造器：`buildPostprocessingNodes` 退化为可一眼读完的
// 「节点清单索引」，组内细节下沉到各自函数。节点 id / 顺序 / labelKey 契约不变
// （回归守卫：postprocessing-capability.test.ts 的顶层结构与子节点读写断言）。

/** pp-enabled 基座 toggle（无 group）：总开关。 */
function enabledNode(cap: PostprocessingCapability): PreviewMenuNode {
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
function colorFolder(cap: PostprocessingCapability): PreviewMenuNode {
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
        },
      },
      {
        id: "pp-exposure",
        kind: "slider",
        labelKey: "preview.exposure",
        control: {
          min: 0.1,
          max: 3,
          step: 0.05,
          get: () => cap.getParams().exposure,
          set: (v) => cap.setExposure(v as number),
        },
      },
    ],
  };
}

/** pp-bloom-enabled 基座 toggle（无 group）：辉光总开关。 */
function bloomEnabledNode(cap: PostprocessingCapability): PreviewMenuNode {
  return {
    id: "pp-bloom-enabled",
    kind: "toggle",
    labelKey: "preview.bloomEnabled",
    control: {
      get: () => cap.getParams().bloomEnabled,
      set: (v) => cap.setBloomEnabled(v as boolean),
    },
  };
}

/** Bloom 文件夹：strength/threshold/radius slider + follow toggle。 */
function bloomFolder(cap: PostprocessingCapability): PreviewMenuNode {
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
          min: 0,
          max: 3,
          step: 0.05,
          get: () => cap.getParams().bloomStrength,
          set: (v) => cap.setBloomStrength(v as number),
        },
      },
      {
        id: "pp-bloom-threshold",
        kind: "slider",
        labelKey: "preview.bloomThreshold",
        control: {
          min: 0,
          max: 1,
          step: 0.02,
          get: () => cap.getParams().bloomThreshold,
          set: (v) => cap.setBloomThreshold(v as number),
        },
      },
      {
        id: "pp-bloom-radius",
        kind: "slider",
        labelKey: "preview.bloomRadius",
        control: {
          min: 0,
          max: 2,
          step: 0.02,
          get: () => cap.getParams().bloomRadius,
          set: (v) => cap.setBloomRadius(v as number),
        },
      },
      {
        id: "pp-bloom-follow",
        kind: "toggle",
        labelKey: "preview.bloomFollowVolumetric",
        control: {
          get: () => cap.getParams().bloomFollowVolumetric,
          set: (v) => cap.setBloomFollowVolumetric(v as boolean),
        },
      },
    ],
  };
}

/** pp-ssao-enabled 基座 toggle（无 group）：环境光遮蔽总开关。 */
function ssaoEnabledNode(cap: PostprocessingCapability): PreviewMenuNode {
  return {
    id: "pp-ssao-enabled",
    kind: "toggle",
    labelKey: "preview.ssao",
    control: {
      get: () => cap.getParams().ssaoEnabled,
      set: (v) => cap.setSSAOEnabled(v as boolean),
    },
  };
}

/** SSAO 文件夹：radius/mindist/maxdist slider。 */
function ssaoFolder(cap: PostprocessingCapability): PreviewMenuNode {
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
          min: 0.5,
          max: 32,
          step: 0.5,
          get: () => cap.getParams().ssaoRadius,
          set: (v) => cap.setSSAORadius(v as number),
        },
      },
      {
        id: "pp-ssao-mindist",
        kind: "slider",
        labelKey: "preview.ssaoMinDist",
        control: {
          min: 0.001,
          max: 0.05,
          step: 0.001,
          get: () => cap.getParams().ssaoMinDist,
          set: (v) => cap.setSSAOMinDist(v as number),
        },
      },
      {
        id: "pp-ssao-maxdist",
        kind: "slider",
        labelKey: "preview.ssaoMaxDist",
        control: {
          min: 0.01,
          max: 1,
          step: 0.01,
          get: () => cap.getParams().ssaoMaxDist,
          set: (v) => cap.setSSAOMaxDist(v as number),
        },
      },
    ],
  };
}

/** Reflection 文件夹：mode select + reflector-disable toggle。 */
function reflectionFolder(cap: PostprocessingCapability): PreviewMenuNode {
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
        },
      },
      {
        id: "pp-reflector-disable-when-ssr",
        kind: "toggle",
        labelKey: "preview.reflectorDisableWhenSSR",
        control: {
          get: () => cap.getParams().reflectorDisableWhenSSR,
          set: (v) => cap.setReflectorDisableWhenSSR(v as boolean),
        },
      },
    ],
  };
}

/** SSR 文件夹：opacity/maxdistance/thickness slider + blur/attenuation/fresnel/bouncing toggle。 */
function ssrFolder(cap: PostprocessingCapability): PreviewMenuNode {
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
          min: 0,
          max: 1,
          step: 0.02,
          get: () => cap.getParams().ssrOpacity,
          set: (v) => cap.setSSROpacity(v as number),
        },
      },
      {
        id: "pp-ssr-maxdistance",
        kind: "slider",
        labelKey: "preview.ssrMaxDistance",
        control: {
          min: 10,
          max: 800,
          step: 5,
          get: () => cap.getParams().ssrMaxDistance,
          set: (v) => cap.setSSRMaxDistance(v as number),
        },
      },
      {
        id: "pp-ssr-thickness",
        kind: "slider",
        labelKey: "preview.ssrThickness",
        control: {
          min: 0.001,
          max: 0.1,
          step: 0.001,
          get: () => cap.getParams().ssrThickness,
          set: (v) => cap.setSSRThickness(v as number),
        },
      },
      {
        id: "pp-ssr-blur",
        kind: "toggle",
        labelKey: "preview.ssrBlur",
        control: {
          get: () => cap.getParams().ssrBlur,
          set: (v) => cap.setSSRBlur(v as boolean),
        },
      },
      {
        id: "pp-ssr-distanceAttenuation",
        kind: "toggle",
        labelKey: "preview.ssrDistanceAttenuation",
        control: {
          get: () => cap.getParams().ssrDistanceAttenuation,
          set: (v) => cap.setSSRDistanceAttenuation(v as boolean),
        },
      },
      {
        id: "pp-ssr-fresnel",
        kind: "toggle",
        labelKey: "preview.ssrFresnel",
        control: {
          get: () => cap.getParams().ssrFresnel,
          set: (v) => cap.setSSRFresnel(v as boolean),
        },
      },
      {
        id: "pp-ssr-bouncing",
        kind: "toggle",
        labelKey: "preview.ssrBouncing",
        control: {
          get: () => cap.getParams().ssrBouncing,
          set: (v) => cap.setSSRBouncing(v as boolean),
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
