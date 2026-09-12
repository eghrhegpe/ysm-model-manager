// ===== GPU 预算门禁（共享判定 + 提示，收一处防口径漂移）=====
// 两个入口共用同一道门：
//   1. switch-preview|beginSwitch —— 会话内**追加**模型（keep 通道）
//   2. mount-preview-core|mount3D —— **首次直挂**（无活跃会话时 cooperate 退化为直挂，
//      不经 beginSwitch，曾是无预算门的缺口）
// 判定口径 + toast 文案收在本模块，避免两处各写一遍导致漂移。

import type * as THREE from "three";
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { textureCache } from "@/preview-3d/texture/texture-cache.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { evaluateGpuLoad, sampleGpuLoad } from "./gpu-load.ts";
import { resolveGpuLoadLimits } from "./gpu-load-calibrate.ts";

/**
 * 采样当前 GPU 负载并对照预算；超限则 toast 并返回 `false`。
 *
 * 调用方负责决定**如何中止**——本函数只判不中止：
 * - switch 通道：直接 `return false`（不触发 build，inFlight 未置位不卡死）；
 * - mount 直挂：走 `runFullCleanup(ctx)` + return（外壳已装配，须完整回收）。
 *
 * 读 `renderer.info` 无副作用（calls/triangles 为上一帧值），采样本身不触发渲染。
 * 纹理字节经 `textureCache.getTotalBytes()` 聚合注入——纹理**数量**判不出
 * 「1024 张 16×16」与「1024 张 4K」的差别，字节维度补上这一刀。
 *
 * 预算上限取 `resolveGpuLoadLimits()`（真机标定值优先，缺省回落默认常量）——
 * 标定不是打印建议，而是真的改变这里的拦截线。
 *
 * @param renderer    已就绪的渲染器
 * @param exceededKey 超限文案 key（须含 `{reasons}` 占位符）
 */
export function guardGpuBudget(renderer: THREE.WebGLRenderer, exceededKey: LocaleKey): boolean {
  const verdict = evaluateGpuLoad(
    sampleGpuLoad(renderer, textureCache.getTotalBytes()),
    resolveGpuLoadLimits(),
  );
  if (verdict.ok) return true;
  bus.emit("toast:show", {
    msg: t(exceededKey, { reasons: verdict.reasons.join("，") }),
    duration: TOAST_MS.verbose,
    type: "warn",
  });
  return false;
}
