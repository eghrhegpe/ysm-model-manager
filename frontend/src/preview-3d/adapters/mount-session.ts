// ===== mount3D 会话生命周期（2026 锐评整改：mount3D 五层闭包 → MountCtx 模块级函数）=====
// 原 mount3D 内嵌的 finishSession / closeOverlay / fullCleanup / unloadSessionModel
// 提为接收 MountCtx 上下文的模块级函数（switch-preview.ts 的 SwitchContext 同款模式）。
// 本文件仅承载「会话终结/清理/卸载」生命周期；菜单/rAF/外壳装配仍归 mount-preview-core。

import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { clearModelRoots } from "../frustum-cull.ts";
import { returnFocus } from "../../utils/dom/focus-restore.ts";
import { safeDispose } from "../safe-dispose.ts";
import { textureCache } from "../texture-cache.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import { removePerFrame, stopIfIdle } from "./render-loop.ts";
import { sceneRegistry } from "./scene-registry.ts";
import type {
  Mount3DOptions,
  PreviewAdapter,
  PreviewHandle,
  PreviewScene,
} from "./mount-preview-core.ts";
import type { SharedInfra } from "./shared-infra.ts";
import type { SwitchContext } from "./switch-preview.ts";
import { clearSceneCaps } from "./shared-infra.ts";
import { unloadModel } from "./unload-model.ts";

/**
 * mount3D 会话级可变状态收敛体（原 30+ 裸 let，收敛后仅剩 keys/mouseDown/lastMouse 等少量 input let）。
 * infra 字段（scene/camera/renderer/controls/orbitTarget + 全部 cap）复用 {@link SharedInfra}，
 * 本接口仅收敛 session 级可变状态——闭包读写统一经此对象，降低认知负担。
 */
export interface MpSessionState {
  /** 当前模型路径（switchTo 时变更，getSiblings 据此动态过滤） */
  currentPath: string;
  /** disposed 标记（可变引用） */
  isDisposed: { v: boolean };
  /** 会话收尾已完成标记：closeOverlay（早期路径）与 runFullCleanup（post-build 路径）共用，
   *  保证「摘句柄 + 通知调用方 + 焦点归还」只发生一次（abort 路径会二次进入 runFullCleanup） */
  finished: boolean;
  /** 中止标记（可变引用，ESC/invalidate 打断） */
  aborted: { v: boolean };
  /** cleanup 函数引用（build 成功后赋值） */
  cleanupFn: (() => void) | null;
  /** 相机移动速度（camBridge.setSpeed 变更） */
  camSpeed: number;
  /** 轨道/自由模式开关（camBridge.setOrbit 变更） */
  orbitMode: boolean;
  /** 每帧复用的临时欧拉角（WASD 自由相机时读 camera.quaternion） */
  euler: import("three").Euler;
  /** 当前会话内容层（switchTo 后会被替换） */
  content: PreviewScene | null;
  /** 场景子节点基线快照（区分固有装饰与内容层增量） */
  sceneBaseline: Set<import("three").Object3D> | null;
  /** cooperate 模式下已追加的内容句柄列表（runFullCleanup 逐一 dispose） */
  allContent: PreviewScene[];
  /** 每帧回调（setPerFrame 统一注册/注销） */
  perFrame: ((dt: number) => void) | null;
  /** 统一多模型拾取器（仅 count>=2 激活） */
  onUnifiedPick: ((e: MouseEvent) => void) | null;
  /** 可变 ESC handler（switchTo 后替换，cleanup 经当前引用卸载） */
  escH: (e: KeyboardEvent) => void;
  /** 提示条自动消失定时器（cleanup 时 clearTimeout） */
  tipTimeoutId: ReturnType<typeof setTimeout> | undefined;
}

/** 输入事件 handler 集合（bindInputHandlers 返回；cleanup 按当前引用解绑） */
interface MountHandlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onDragPointerDown: (e: PointerEvent) => void;
  onDragPointerUp: (e: PointerEvent) => void;
  onDragPointerMove: (e: PointerEvent) => void;
  onResize: () => void;
  cancelPendingResize: (() => void) | undefined;
}

/**
 * mount3D 会话上下文：跨模块级生命周期函数共享的可变句柄袋。
 * 字段在 mount3D 装配各阶段就位（menuHandle/handlers/switchCtx 后赋值），调用时机
 * 均在装配完成后（菜单点击/ESC/cleanup），读取时必然已初始化。
 */
export interface MountCtx {
  adapter: PreviewAdapter;
  opts: Mount3DOptions;
  /** 本 mount 代际（invalidate/inFlight 守卫） */
  myGen: number;
  selfMode: boolean;
  sessionId: string;
  session: MpSessionState;
  /** infra 延迟读取（shared 模式在 mount3D 中段才赋值；self 模式恒 null） */
  getInfra(): SharedInfra | null;
  getGen(): number;
  /** 模块级句柄列表（core 持有，传引用共享；finishSession 摘除自身用） */
  handles: Array<{ handle: PreviewHandle; gen: number }>;
  /** switchCtx 延迟读取（unloadSessionModel 的 setPerFrame 落点） */
  getSwitchCtx(): SwitchContext;
  /** 单例外壳清零（core 模块级单例属主；runFullCleanup 完整关闭语义时调用） */
  clearSingletons(): void;
  /** 本 mount 的 overlay host（可能复用单例；closeOverlay 拆除用） */
  overlay: HTMLElement | null;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  /** 装配后赋值（mountPreviewRootMenu 返回） */
  menuHandle: PreviewMenuHandle;
  camBridge: CameraControlBridge;
  /** 焦点陷阱 cleanup（finishSession 释放；可变引用容器） */
  focusTrap: { cleanup: (() => void) | null };
  /** 输入 handler（shared 模式 bindInputHandlers 后填充；self 模式保持 no-op） */
  handlers: MountHandlers;
}

/**
 * 会话收尾（幂等，closeOverlay 早期路径与 runFullCleanup post-build 路径共用）：
 * 摘句柄 → 通知调用方 → 无障碍焦点归还。
 * 必须单一出口：ESC 早期中断会先走 closeOverlay，build 随后 resolve 时中止守卫
 * 又会进入 runFullCleanup，两条路径都会调到这里——不幂等则 onClose 会重复触发。
 */
function finishSession(ctx: MountCtx): void {
  const session = ctx.session;
  if (session.finished) return;
  session.finished = true;
  // 从模块级 handles 列表移除当前 session（hasActivePreview 以该列表为依据）
  const idx = ctx.handles.findIndex((h) => h.gen === ctx.myGen);
  if (idx >= 0) ctx.handles.splice(idx, 1);
  // 无障碍：释放焦点陷阱 + 把焦点还给触发 3D 的 FAB 按钮（rememberTrigger 在
  // mount3D 入口已记下 activeElement；元素已离文档时 returnFocus 静默跳过）
  ctx.focusTrap.cleanup?.();
  ctx.focusTrap.cleanup = null;
  returnFocus();
  // 通知调用方会话已关闭（UI 状态复位 / android-back 注销依赖此回调）
  ctx.adapter.onClose?.();
}

/** 早期关闭（build 尚未成功，cleanupFn 未赋值时的 ESC 出口） */
export function closeOverlay(ctx: MountCtx): void {
  ctx.session.aborted.v = true;
  document.removeEventListener("keydown", ctx.session.escH);
  // 早期路径（cleanupFn 尚未赋值）：清理 tip 定时器 + 菜单，再拆 overlay
  if (ctx.session.tipTimeoutId) {
    clearTimeout(ctx.session.tipTimeoutId);
    ctx.session.tipTimeoutId = undefined;
  }
  ctx.menuHandle.dispose();
  if (ctx.overlay && ctx.overlay.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  finishSession(ctx);
}

/**
 * 完整清理（原 mount3D 内嵌 fullCleanup，P0 修复：中止/退出路径完整拆除 DOM + 解绑监听，防泄漏）。
 * ① ESC 监听器（escH 可能已被 switchTo 替换，移除当前引用）→ ② 提示条定时器 →
 * ③ 声式根菜单 → ④ viewContainer → ⑤ overlay + 单例清零 → ⑥ 内容层 dispose + scene 差量
 * 清理 → ⑦ 输入监听解绑 → ⑧ 场景能力 save/dispose → ⑨ 纹理缓存 → perFrame/rAF 收尾。
 */
export function runFullCleanup(ctx: MountCtx): void {
  const session = ctx.session;
  // ① ESC 监听器（escH 经 switchTo 可能已被替换，移除当前引用）
  document.removeEventListener("keydown", session.escH);
  // ② 提示条定时器
  if (session.tipTimeoutId) {
    clearTimeout(session.tipTimeoutId);
    session.tipTimeoutId = undefined;
  }
  // ③ 声式根菜单（移除 dock/popup + 解绑 view click 监听）
  ctx.menuHandle.dispose();
  // ④ viewContainer（含 loadingEl；首次挂载时可能含 renderer.domElement）
  if (ctx.viewContainer.parentNode) ctx.viewContainer.parentNode.removeChild(ctx.viewContainer);
  // ⑤ overlay 本体移除 + 清模块级单例：runFullCleanup 是「完整关闭」语义。
  // switchTo 的复用外壳走 switch-preview.ts（不经过此处），故移除 overlay 不影响模型内切换。
  if (ctx.overlay && ctx.overlay.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  ctx.clearSingletons();
  // ⑥ 只清理内容层（dispose content + 移除 scene children），保留 renderer/canvas 存活
  //    避免销毁 WebGL context 导致黑屏窗口期
  const infra = ctx.getInfra();
  if (infra && session.sceneBaseline) {
    const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
    for (const c of stale) infra.scene.remove(c);
  }
  for (const b of session.allContent) {
    safeDispose(b);
  }
  session.allContent.length = 0;
  sceneRegistry.reset();
  // ⑦ 输入监听解绑（bindInputHandlers 内注册）——旧实现漏解绑，跨会话累积
  const h = ctx.handlers;
  document.removeEventListener("keydown", h.onKeyDown);
  document.removeEventListener("keyup", h.onKeyUp);
  window.removeEventListener("pointerup", h.onDragPointerUp);
  window.removeEventListener("pointermove", h.onDragPointerMove);
  window.removeEventListener("resize", h.onResize);
  h.cancelPendingResize?.(); // 取消已在途 resize rAF 帧（容器已拆，防幽灵 setSize）
  if (infra) {
    infra.renderer.domElement.removeEventListener("pointerdown", h.onDragPointerDown);
    if (session.onUnifiedPick)
      infra.renderer.domElement.removeEventListener("click", session.onUnifiedPick);
  }
  // ⑧ 场景能力：保存状态 + 释放 GPU（下次 mount 由 createAll 重建）；清空能力引用
  sceneCapabilityRegistry.saveAll();
  sceneCapabilityRegistry.dispose();
  clearSceneCaps();
  // ⑨ 纹理缓存池 session 结束统一释放 + 视锥裁剪注册清空
  textureCache.disposeAll();
  clearModelRoots();
  // 清掉 loadingEl（已从 viewContainer 一并移除，此处为兜底）
  if (ctx.loadingEl.parentNode) ctx.loadingEl.remove();
  // 从全局 perFrame 回调列表移除本 session；全部清空后停 rAF
  if (session.perFrame) removePerFrame(session.perFrame);
  stopIfIdle();
  // 收尾：摘句柄 + 通知调用方 + 焦点归还（幂等，与 closeOverlay 共用同一出口）
  finishSession(ctx);
}

/**
 * 卸载单个模型实例（角色面板 ⚙ → 卸载模型，MikuMikuAR buildModelToolsLevel 移植）：
 * 移除其场景根节点 + 释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。
 */
export function unloadSessionModel(ctx: MountCtx, id: string): void {
  unloadModel(
    {
      allContent: ctx.session.allContent,
      scene: ctx.getInfra()?.scene,
      controls: ctx.getInfra()?.controls,
      camera: ctx.getInfra()?.camera,
      menuHandle: ctx.menuHandle,
      getContent: () => ctx.session.content,
      setPerFrame: (f) => ctx.getSwitchCtx().setPerFrame(f),
      // 从全局 perFrame 列表移除指定回调
      removePerFrame: (f) => removePerFrame(f),
    },
    id,
  );
}
