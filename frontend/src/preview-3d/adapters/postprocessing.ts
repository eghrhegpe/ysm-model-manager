// ===== 后处理管线契约接口（ADR-081 L2）=====
// PostprocessingManager 已退役，由 PostprocessingCapability（caps/）统一接管。
// 保留 PostprocessingLike 作为跨层最小契约（mount-preview-core / cleanup-3d 使用）。

import type { LightCapability } from "../caps/light-capability.ts";

/** 后处理对外最小契约（PostprocessingCapability 实现此接口） */
export interface PostprocessingLike {
  /** 每帧渲染；返回 true 表示已接管渲染（composer.render），false 表示调用方需 renderer.render */
  render(dt: number, lightCap: LightCapability | null): boolean;
  setSize(width: number, height: number): void;
  setPixelRatio?(pixelRatio: number): void;
  dispose(): void;
}
