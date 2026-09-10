// ===== 渲染模式能力菜单节点工厂（ADR-195 刀2：cap 直产 PreviewMenuNode[]）=====
// 纯声明层：仅构造 PreviewMenuNode 供 cap.getMenuNodes()。
// render-mode 全为简单控件（toggle/select）→ 全原生节点，无 controls 通道；
// 无 group 无 master——5 控件平铺，各带 settingsOrder（并入 ⚙️ 设置面板聚合）。

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import type { RenderModeCapability } from "./render-mode-capability.ts";

/** 混合模式选项（与旧 getMenuControls 内联常量同值） */
function blendingOptions(): Array<{ value: string; label: string }> {
  return [
    { value: String(THREE.NormalBlending), label: "正常" },
    { value: String(THREE.AdditiveBlending), label: "叠加" },
    { value: String(THREE.MultiplyBlending), label: "正片叠底" },
    { value: String(THREE.SubtractiveBlending), label: "减去" },
  ];
}

/** 面剔除选项（与旧 getMenuControls 内联常量同值） */
function sideOptions(): Array<{ value: string; label: string }> {
  return [
    { value: String(THREE.FrontSide), label: "正面" },
    { value: String(THREE.BackSide), label: "背面" },
    { value: String(THREE.DoubleSide), label: "双面" },
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
      fallback: "线框",
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
      fallback: "混合模式",
      settingsOrder: 31,
      control: {
        options: blendingOptions(),
        get: () => String(cap.getBlending() ?? THREE.NormalBlending),
        set: (v) => cap.setBlending(v as unknown as THREE.Blending),
      },
    },
    // 💀 X光透视（深度测试关闭 = 可看穿模型）
    {
      id: "rm-depth-test",
      kind: "toggle",
      labelKey: "preview.renderModeXray",
      fallback: "X光透视",
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
      fallback: "面剔除",
      settingsOrder: 33,
      control: {
        options: sideOptions(),
        get: () => String(cap.getSide() ?? THREE.FrontSide),
        set: (v) => cap.setSide(v as unknown as THREE.Side),
      },
    },
    // ⚡ 深度写入
    {
      id: "rm-depth-write",
      kind: "toggle",
      labelKey: "preview.renderModeDepthWrite",
      fallback: "深度写入",
      hintKey: "preview.renderModeDepthWriteDesc",
      settingsOrder: 34,
      control: {
        get: () => cap.getDepthWrite() !== false,
        set: (v) => cap.setDepthWrite(v ? null : false),
      },
    },
  ];
}
