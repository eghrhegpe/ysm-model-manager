// ===== 统一 Shared Infra 契约（ADR-066 §5.7 shared 模式基础设施收窄）=====
// 所有富格式适配器（ysm / vrm / litematic / pack-model）在 shared 模式下由
// mount-preview-core 统一提供 scene/camera/controls/renderer。过去每个适配器靠
// `ctx.scene!` 非空断言表达「核心必供」契约——类型系统无法验证，且 vrm/litematic
// 连显式守卫都没有（纯靠断言）。本文件把契约收口为单一事实来源：
//   - `SharedInfra`：已收窄（非可选）的基础设施类型，适配器内部一律消费它。
//   - `requireSharedInfra(ctx)`：在构建入口（或首次访问）窄化并 fail-fast，
//     把「shared 模式缺基础设施」从运行时崩溃转为明确报错。
// 这样四适配器访问 infra 统一为 `infra.scene` 等，消除 `!` 断言漂移，且 vrm/litematic
// 补齐了原本缺失的守卫。
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewBuildCtx } from "@/preview-3d/adapters/mount-preview-core.ts";

/** shared 模式核心必供的完整基础设施（已收窄，非可选） */
export interface SharedInfra {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
}

/**
 * 把可选基础设施窄化为 SharedInfra；任一缺失即抛错（shared 模式契约违约）。
 * 调用廉价（4 次真值判断），可在构建入口或各 helper 内联调用——幂等，
 * 已通过入口守卫后再次调用不会抛错。
 */
export function requireSharedInfra(ctx: PreviewBuildCtx): SharedInfra {
  if (!ctx.scene || !ctx.camera || !ctx.controls || !ctx.renderer) {
    throw new Error(
      `${ctx.adapterId ?? "adapter"} shared 模式需要核心提供完整基础设施（scene/camera/controls/renderer）`,
    );
  }
  return {
    scene: ctx.scene,
    camera: ctx.camera,
    controls: ctx.controls,
    renderer: ctx.renderer,
  };
}
