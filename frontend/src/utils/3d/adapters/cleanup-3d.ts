// ===== 3D 预览清理函数（从 mount-preview-core.ts 抽出）=====
// 涵盖全量 GPU 资源释放 + 事件监听解绑 + 外壳拆除
//
// 拆分原则（ADR-066 P3）：
// - fullCleanup：mount3D 内嵌闭包，改写成接受 CleanupContext 的纯函数
// - safeDisposeMat：材质+纹理安全释放，无外部依赖

import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "./preview-menu.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import type { FogCapability } from "../caps/fog-capability.ts";
import { ShadowCapability } from "../caps/shadow-capability.ts";
import { ReflectorCapability } from "../caps/reflector-capability.ts";
import { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { PostprocessingLike } from "./postprocessing.ts";
import type { PostprocessingCapability } from "../caps/postprocessing-capability.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { textureCache } from "../texture-cache.ts";
import { clearModelRoots } from "../frustum-cull.ts";
import { dbg } from "../../../utils/debug/debug.ts";
import { safeDispose } from "../safe-dispose.ts";

// ── GPU Info 类型（替代 as unknown as 类型断言）─────────────────────────────
interface GpuMemoryInfo {
  geometries: number;
  textures: number;
}

interface GpuRendererInfo {
  memory?: GpuMemoryInfo;
}

// ── CleanupContext ────────────────────────────────────────────────────────
// 所有可从 mount3D 作用域松绑的外部引用，统一经此接口注入。
// 可变 let 变量通过 setter 回调传递，允许纯函数内赋值。

export interface CleanupContext {
  menuHandle: PreviewMenuHandle;
  isDisposed: { v: boolean };
  animId: number;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  /** 当前 ESC 处理函数（可变：switchTo 后重新赋值，getter 保证读到最新值） */
  getEscH: () => (e: KeyboardEvent) => void;
  onDragPointerDown: (e: PointerEvent) => void;
  onDragPointerUp: (e: PointerEvent) => void;
  onDragPointerMove: (e: PointerEvent) => void;
  onResize: () => void;
  onUnifiedPick: ((e: MouseEvent) => void) | null;
  allBuilt: { dispose(): void }[];
  nullBuilt: () => void;
  skyCap: SkyCapability | null;
  groundCap: GroundCapability | null;
  lightCap: LightCapability | null;
  fogCap: FogCapability | null;
  shadowCap: ShadowCapability | null;
  reflectorCap: ReflectorCapability | null;
  environmentCap: EnvironmentCapability | null;
  postProc: PostprocessingLike | null;
  nullPostProc: () => void;
  postProcCap: PostprocessingCapability | null;
  renderer: THREE.WebGLRenderer | undefined;
  scene: THREE.Scene | undefined;
  controls: OrbitControls | undefined;
  overlay: HTMLElement;
  nullHandle: () => void;
  adapter: { onClose?: () => void };
  /** tip 自动消失定时器 ID（可变，undefined 表示无） */
  getTipTimeoutId: () => ReturnType<typeof setTimeout> | undefined;
}

// ── fullCleanup ────────────────────────────────────────────────────────────
// 全量释放：事件监听解绑 + caps dispose + 内容层 dispose + 外壳拆除
// 替代原 mount3D 内嵌闭包（L561-622）

export function runFullCleanup(ctx: CleanupContext): void {
  // GPU 内存泄漏检测：记录清理前的 renderer.info.memory
  if (ctx.renderer) {
    const info = (ctx.renderer as unknown as { info?: GpuRendererInfo }).info;
    const memBefore = info?.memory;
    if (memBefore) {
      dbg("gpu-leak", { phase: "cleanup before", geometries: memBefore.geometries, textures: memBefore.textures });
    }
  }
  ctx.menuHandle.dispose();
  // ADR-093 T2：重置场景注册表（随会话生命周期；释放由下方 allBuilt dispose 负责）
  sceneRegistry.reset();
  if (ctx.isDisposed.v) return;
  ctx.isDisposed.v = true;
  cancelAnimationFrame(ctx.animId);
  // tip 自动消失定时器：防止 cleanup 后回调执行
  const tipId = ctx.getTipTimeoutId();
  if (tipId) clearTimeout(tipId);
  document.removeEventListener("keydown", ctx.onKeyDown);
  document.removeEventListener("keyup", ctx.onKeyUp);
  // 当前 ESC 处理函数：switchTo 后 escH 被重新赋值，通过 getter 读取最新值
  document.removeEventListener("keydown", ctx.getEscH());
  // renderer.domElement 上的拖拽监听：之前遗漏，cleanup 链中完全缺失
  ctx.renderer?.domElement?.removeEventListener("pointerdown", ctx.onDragPointerDown);
  window.removeEventListener("pointerup", ctx.onDragPointerUp);
  window.removeEventListener("pointermove", ctx.onDragPointerMove);
  window.removeEventListener("resize", ctx.onResize);
  // R1-P2-1：click 拾取处理器显式解绑（之前仅靠 GC，多会话切换时残留）
  if (ctx.onUnifiedPick && ctx.renderer?.domElement) {
    ctx.renderer.domElement.removeEventListener("click", ctx.onUnifiedPick);
  }
  // 内容层先释放自身资源，核心再回收外壳
  // cooperate 模式下需逐一 dispose 所有已追加模型（adapter 专属 GPU 资源）
  for (const b of ctx.allBuilt) {
    safeDispose(b);
  }
  ctx.allBuilt.length = 0;
  ctx.nullBuilt();
  // 程序化天空（ADR-073 L1）：还原 tone mapping 并释放 PMREM/几何/材质
  // 统一注册表：保存状态后由 registry 统一 dispose（已遍历所有能力，无需再逐个 dispose）
  try { sceneCapabilityRegistry.saveAll(); } catch (_) { /* 防御性 */ }
  safeDispose(sceneCapabilityRegistry);
  // P0 纹理缓存池：session 结束释放所有缓存纹理
  try { textureCache.disposeAll(); } catch (_) { /* 防御性释放 */ }
  // 视锥裁剪：清空模型根节点注册
  try { clearModelRoots(); } catch (_) { /* 防御性释放 */ }
  // 不再逐个 dispose 各能力（已由 sceneCapabilityRegistry.dispose 统一处理），
  // 避免双重 dispose 导致 SkyCapability 重复还原 toneMapping / PMREM 等问题
  // 后处理体积光管线（ADR-081 L2）：释放 EffectComposer + bloom
  try {
    ctx.postProcCap?.dispose();
    ctx.postProc?.dispose();
    ctx.nullPostProc();
  } catch (_) { /* 防御性释放 */ }
  // 防御性遍历：释放内容层可能遗漏的几何/材质/纹理
  // 仅移除本 session 添加的 DOM 子节点（viewContainer 含 renderer.domElement）。
  // renderer/controls 的 dispose 由 _resetSingletons 或下次 mount 时自然处理。
  if (ctx.overlay.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  ctx.nullHandle();
  ctx.adapter.onClose?.();
  // GPU 内存泄漏检测：记录清理后的 renderer.info.memory（renderer.dispose 后 info 仍可读）
  if (ctx.renderer) {
    const info = (ctx.renderer as unknown as { info?: GpuRendererInfo }).info;
    const memAfter = info?.memory;
    if (memAfter) {
      dbg("gpu-leak", { phase: "cleanup after", geometries: memAfter.geometries, textures: memAfter.textures });
    }
  }
}