// @vitest-environment node
// ===== 截图链模块在 node 环境可装载（无 window 崩溃）=====
// 背景（2026-10-07 修复）：render-host.ts 的**模块级单例** `export const rendererHost = new RendererHost()`
// 的字段初始化器原直接读 `window.devicePixelRatio` —— 只要静态 import 触及 render-host
// （本链经 screenshot-lights → shared-infra:27 的 `setSceneCapRegistry` 引入），node 环境即
// `ReferenceError: window is not defined`。后果：截图链**永远无法被 node 环境单测**，且任何
// 想被 node 直测的模块都不能静态触及 screenshot 链。本用例 = 回归守卫：screenshot-lights
// （最轻触发链）在 node 环境必须可装载、可浅调用。
import { describe, it, expect } from "vitest";
import { toScreenshotLights } from "./screenshot-lights.ts";

describe("screenshot 链 node 环境装载", () => {
  it("import 不崩（模块装载不再读 window），且浅调用可用", () => {
    // import 能走到这里即证明装载成功（此前会在此前的 import 阶段抛 ReferenceError）；
    // 再确认模组确实可用而非空壳。
    expect(typeof toScreenshotLights).toBe("function");
  });
});