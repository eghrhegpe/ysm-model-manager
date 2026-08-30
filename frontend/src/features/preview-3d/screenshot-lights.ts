// ===== 截图灯光（ADR-136 第四刀归位）=====
// 原 views/app-preview/skeleton-render.ts:202 toScreenshotLights + screenshot-renderer.ts ScreenshotLights
// 归位 features/preview-3d——截图领域单一事实源，消灭「改一处两处同步」分叉。
//
// 从预览 LightCapability 提取截图灯光（仅 light cap 缺失才回退标准灯——三点全关是用户
// 刻意的暗场景，截图必须保持暗——[doc:adr-126-p5] 截图灯光割裂修复：所见即所得）。
import {
  type DirectionalLightParams,
  type LightCapability,
  attenuateAmbientForSky,
} from "./caps/light-capability.ts";
import {
  isSkyEnvironmentOn,
  sceneCapabilityRegistry,
} from "./caps/scene-capability-registry.ts";

/** 截图灯光描述（与预览 light-capability 三点布光同构——截图所见即所得） */
export interface ScreenshotLights {
  ambient: { color: number; intensity: number };
  key: DirectionalLightParams;
  fill: DirectionalLightParams;
  rim: DirectionalLightParams;
}

/** 从预览 LightCapability 提取截图灯光；cap 缺失 → undefined（渲染方回退标准灯） */
export function toScreenshotLights(): ScreenshotLights | undefined {
  const cap = sceneCapabilityRegistry.getById("light") as LightCapability | null;
  if (!cap) return undefined;
  const p = cap.getParams();
  return {
    // 镜像预览的 PMREM 环境光衰减——截图与预览 ambient 同构：
    // 开关读组合根 isSkyEnvironmentOn，系数/公式走 light-capability 的 attenuateAmbientForSky 单源
    ambient: { color: p.ambient.color, intensity: attenuateAmbientForSky(p.ambient.intensity, isSkyEnvironmentOn()) },
    key: { ...p.key },
    fill: { ...p.fill },
    rim: { ...p.rim },
  };
}
