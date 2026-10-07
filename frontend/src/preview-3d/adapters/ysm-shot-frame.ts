// ===== ysm-shot-frame.ts — YSM 离屏多角度截图编排（ADR-270-d6）=====
//
// 【归属：为什么在 preview-3d/adapters 而非 views（ADR-270-d6 决策 1）】
// 本模块原住 `views/app-preview/skeleton-render.ts` 的 `renderFrame`——「取预览截图灯光
// → 组装渲染实参（`buildYsmShotRenderArgs`）→ `renderMultiAngle` 离屏多角度渲染 → 按视角
// key 匹配 name 取 base64」整段是**截图适配器域知识**，视图只留触发（按钮）与展示。
// `skeleton-render.ts` 是模板文件（14 处 HTML 字面量），留在 views。
//
// 【为什么不并入同目录的 ysm-preview-pipeline.ts（ADR-270-d6「同址」意图的受限期）】
// 编排复用该模块的 `buildYsmShotRenderArgs`（真复用，非转发）；但本模块还要拉起
// `screenshot/screenshot-lights.ts` → `adapters/shared-infra.ts` → `infra/render-host.ts`
// （模块装载即读 `window.devicePixelRatio`）。并入流水线会把该 window 依赖带进它的
// `@vitest-environment node` 直测（ysm-preview-pipeline.test.ts，实证 ReferenceError:
// window is not defined），而「既有测试除 import 路径外零改动」是本刀的硬验收——
// 故置为同目录独立叶，流水线保持 node 可装载。
//
// ADR: ADR-270-d6（本迁移的法律依据）、ADR-270-d5（同族 buildYsmShotRenderArgs 迁移）、
//      ADR-270-d2（R10 入口面立法）、ADR-052 P3（活跃渲染器优先 + 离屏 fallback）。

import { toScreenshotLights } from "@/preview-3d/screenshot/screenshot-lights.ts";
import { renderMultiAngle } from "@/preview-3d/screenshot/screenshot-render.ts";
import { buildYsmShotRenderArgs, type YsmShotModel } from "./ysm-preview-pipeline.ts";

/**
 * 渲染指定视角的截图帧（无活跃渲染器时的 fallback 通道）。
 *
 * 编排 = 取预览截图灯光（所见即所得：预览三点布光/体积光/输出设置同构）→ 组装实参
 * （纹理槽 + WASM 解码缝）→ 离屏多角度渲染 → 按视角 key 匹配 name 取 base64。
 *
 * @param model 已加载模型面（纹理清单 + 虚拟路径）
 * @param key 视角名（"front" / "45" / "side" / "back45"）；无匹配帧 / 渲染失败 → null
 */
export async function renderModelShotFrame(
  model: YsmShotModel,
  key: string,
): Promise<string | null> {
  const lights = toScreenshotLights();
  // 纹理槽清单 + 渲染选项（含 WASM 解码缝）由流水线组装（ADR-270-d5）：
  // 解码是 p3d 内部件，视图不再直接注入 decoder。
  const { texUrls, options } = buildYsmShotRenderArgs(model, {
    size: 512,
    ...(lights != null ? { lights } : {}),
  });
  const results = await renderMultiAngle(model._modelPath || "", texUrls, options);
  if (!results) return null;
  const hit = results.find((r) => r.name === key);
  return hit?.base64 ?? null;
}
