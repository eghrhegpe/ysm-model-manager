// ===== GPU 预算门禁（共享判定 + 提示，收一处防口径漂移）=====
// 两个入口共用同一道门：
//   1. switch-preview|beginSwitch —— 会话内**追加**模型（keep 通道）
//   2. mount-preview-core|mount3D —— **直挂**（有残留会话时；无活跃会话则不判，见该处注释）
// 判定口径 + toast 文案收在本模块，避免两处各写一遍导致漂移。

import type * as THREE from "three";
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { textureCache } from "@/preview-3d/texture/texture-cache.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { evaluateGpuLoad, sampleGpuLoad } from "./gpu-load.ts";
import { resolveGpuLoadLimits } from "./gpu-load-calibrate.ts";
import { getLastSceneTextureBytes } from "./texture-bytes.ts";

/**
 * 纹理字节取值：**场景图快照**与**池内累计**取大者。
 *
 * 两者覆盖不同集合，缺一即漏计（刀⑪ 审查 P3-1 教训）：
 * - 场景图快照（`register-built-scene` 于构建后写入）覆盖 **全部格式**
 *   ——含 MMD / VRM / FBX（自带 loader，**不进池**，池口径对它们恒 0）；
 * - 池累计（`textureCache`）覆盖「已 acquire 但尚未挂进场景 / 已从场景移除但未归零」
 *   的 YSM / pack 纹理。
 * 取大者不会低估；代价是理论上可能高估（同一批纹理两边都算）——但预算是
 * 「病态堆叠早拦」的护栏，保守优于漏拦。首挂（快照为 0）自然退化为池口径。
 */
function resolveTextureBytes(): number {
  return Math.max(getLastSceneTextureBytes(), textureCache.getTotalBytes());
}

/**
 * 采样当前 GPU 负载并对照预算；超限则 toast 并返回 `false`。
 *
 * 调用方负责决定**如何中止**——本函数只判不中止：
 * - switch 通道：直接 `return false`（不触发 build，inFlight 未置位不卡死）；
 * - mount 直挂：`cleanupPreview()` + return（门前置于装配之前，详见 mount3D 注释）。
 *
 * 读 `renderer.info` 无副作用（calls/triangles 为上一帧值），采样本身不触发渲染。
 * 纹理字节经 `resolveTextureBytes()` 聚合注入——纹理**数量**判不出
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
    sampleGpuLoad(renderer, resolveTextureBytes()),
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
