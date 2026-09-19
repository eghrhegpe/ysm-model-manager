// ===== 渲染模式能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// render-mode 全为简单控件（toggle/select）→ 全原生节点，无 controls 通道；
// 无 group 无 master——5 控件平铺，各带 settingsOrder（并入 ⚙️ 设置面板聚合）。

import * as THREE from "three";
import type { LocaleKey } from "@/core/i18n/t.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import type { RenderModeCapability } from "./render-mode-capability.ts";

/** 混合模式选项（与旧 getMenuControls 内联常量同值） */
function blendingOptions(): Array<{ value: string; label: string; labelKey?: LocaleKey }> {
  return [
    {
      value: String(THREE.NormalBlending),
      label: "正常",
      labelKey: "preview.renderModeBlendingNormal",
    },
    {
      value: String(THREE.AdditiveBlending),
      label: "叠加",
      labelKey: "preview.renderModeBlendingAdditive",
    },
    {
      value: String(THREE.MultiplyBlending),
      label: "正片叠底",
      labelKey: "preview.renderModeBlendingMultiply",
    },
    {
      value: String(THREE.SubtractiveBlending),
      label: "减去",
      labelKey: "preview.renderModeBlendingSubtractive",
    },
  ];
}

/** 面剔除选项（与旧 getMenuControls 内联常量同值） */
function sideOptions(): Array<{ value: string; label: string; labelKey?: LocaleKey }> {
  return [
    { value: String(THREE.FrontSide), label: "正面", labelKey: "preview.renderModeSideFront" },
    { value: String(THREE.BackSide), label: "背面", labelKey: "preview.renderModeSideBack" },
    { value: String(THREE.DoubleSide), label: "双面", labelKey: "preview.renderModeSideDouble" },
  ];
}

/** 完整参数面板节点树（5 控件平铺，各带 settingsOrder）——ADR-195 刀2 入口 */
export function buildRenderModeNodes(cap: RenderModeCapability): PreviewMenuNode[] {
  return [
    // 📐 线框
    {
      id: "rm-wireframe",
      kind: "toggle",
      labelKey: "preview.wireframe",
      hintKey: "preview.wireframeDesc",
      settingsOrder: 30,
      control: {
        get: () => cap.getWireframe() === true,
        set: (v) => cap.setWireframe(v ? true : null),
      },
    },
    // 🌈 混合模式
    {
      id: "rm-blending",
      kind: "select",
      labelKey: "preview.renderModeBlending",
      settingsOrder: 31,
      control: {
        options: blendingOptions(),
        get: () => String(cap.getBlending() ?? THREE.NormalBlending),
        // 渲染层恒传 string（sel.value）——转 number 后交 cap（setter 内 normalizeEnum 兜底）。
        // three 的 blending 是数值枚举；原 `as unknown as THREE.Blending` 是「类型其实不是」
        // 的信号，运行期 string 落库致混合模式控件完全失效（刀⑳ 修复）。
        set: (v) => cap.setBlending(Number(v) as THREE.Blending),
      },
    },
    // 💀 X光透视（深度测试关闭 = 可看穿模型）
    {
      id: "rm-depth-test",
      kind: "toggle",
      labelKey: "preview.renderModeXray",
      hintKey: "preview.renderModeXrayDesc",
      settingsOrder: 32,
      control: {
        get: () => cap.getDepthTest() === false,
        set: (v) => cap.setDepthTest(v ? false : null),
      },
    },
    // 🔄 面剔除
    {
      id: "rm-side",
      kind: "select",
      labelKey: "preview.renderModeSide",
      settingsOrder: 33,
      control: {
        options: sideOptions(),
        get: () => String(cap.getSide() ?? THREE.FrontSide),
        // 同上：渲染层传 string，此处转 number 后交 cap（setter 内 normalizeEnum 兜底）。
        // 原 `as unknown as THREE.Side` 是「类型其实不是」的信号（刀⑳ 修复）。
        set: (v) => cap.setSide(Number(v) as THREE.Side),
      },
    },
    // ⚡ 深度写入
    {
      id: "rm-depth-write",
      kind: "toggle",
      labelKey: "preview.renderModeDepthWrite",
      hintKey: "preview.renderModeDepthWriteDesc",
      settingsOrder: 34,
      control: {
        get: () => cap.getDepthWrite() !== false,
        set: (v) => cap.setDepthWrite(v ? null : false),
      },
    },
  ];
}
