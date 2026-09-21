// ===== 截图灯光（ADR-136 第四刀归位）=====
// 原 views/app-preview/skeleton-render.ts:202 toScreenshotLights + screenshot-renderer.ts ScreenshotLights
// 归位 preview-3d——截图领域单一事实源，消灭「改一处两处同步」分叉。
//
// 从预览 LightCapability 提取截图灯光（仅 light cap 缺失才回退标准灯——三点全关是用户
// 刻意的暗场景，截图必须保持暗——[doc:adr-126-p5] 截图灯光割裂修复：所见即所得）。
import { attenuateAmbientForSky } from "@/preview-3d/caps/light-capability.ts";
import type { LightInstanceParams } from "@/preview-3d/caps/light-presets.ts";
import {
  isSkyEnvironmentOn,
  sceneCapabilityRegistry,
} from "@/preview-3d/caps/scene-capability-registry.ts";

/** 截图灯光描述（与预览 light-capability 三点布光同构——截图所见即所得）。
 *  `radius` = 预览的 targetHeight：灯位 = 模型中心 + 方位角/仰角 × radius，
 *  spot/point 属位置敏感光源，缺此值截图与预览会不一致。 */
export interface ScreenshotLights {
  ambient: { color: number; intensity: number };
  /** 灯光定位半径（预览 LightCapability.getTargetHeight()） */
  radius: number;
  key: LightInstanceParams;
  fill: LightInstanceParams;
  rim: LightInstanceParams;
}

/** 从预览 LightCapability 提取截图灯光；cap 缺失 → undefined（渲染方回退标准灯） */
export function toScreenshotLights(): ScreenshotLights | undefined {
  const cap = sceneCapabilityRegistry.getById("light");
  if (!cap) return undefined;
  const p = cap.getParams();
  // [ADR-293] 总开关门禁：预览关总闸时场景无任何灯光（含 ambient 也被 detach），
  // 截图须同样全黑——旧实现不看 isEnabled()，预览全黑而截图灯火通明，WYSIWYG 破洞。
  const on = cap.isEnabled();
  return {
    // 镜像预览的 PMREM 环境光衰减——截图与预览 ambient 同构：
    // 开关读组合根 isSkyEnvironmentOn，系数/公式走 light-capability 的 attenuateAmbientForSky 单源
    ambient: {
      color: p.ambient.color,
      intensity: on ? attenuateAmbientForSky(p.ambient.intensity, isSkyEnvironmentOn()) : 0,
    },
    radius: cap.getTargetHeight(),
    key: { ...p.key, enabled: p.key.enabled && on },
    fill: { ...p.fill, enabled: p.fill.enabled && on },
    rim: { ...p.rim, enabled: p.rim.enabled && on },
  };
}
