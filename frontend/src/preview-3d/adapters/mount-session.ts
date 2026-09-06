// ===== mount3D 会话生命周期（2026 锐评整改：mount3D 五层闭包 → MountCtx 模块级函数）=====
// 原 mount3D 内嵌的 finishSession / closeOverlay / fullCleanup / unloadSessionModel
// 提为接收 MountCtx 上下文的模块级函数（switch-preview.ts 的 SwitchContext 同款模式）。
// 本文件仅承载「会话终结/清理/卸载」生命周期；菜单/rAF/外壳装配仍归 mount-preview-core。

import { returnFocus } from "../../utils/dom/focus-restore.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { clearModelRoots } from "../frustum-cull.ts";
import type { TdKeyAction } from "../keymap.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import { setPerceptionPaused } from "../perception/core.ts";
import { safeDispose } from "../safe-dispose.ts";
import { textureCache } from "../texture-cache.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import type {
  Mount3DOptions,
  PreviewAdapter,
  PreviewHandle,
  PreviewScene,
} from "./mount-preview-core.ts";
import { removePerFrame, stopIfIdle, unregisterActiveInputSession } from "./render-loop.ts";
import { sceneRegistry } from "./scene-registry.ts";
import type { SharedInfra } from "./shared-infra.ts";
import { clearSceneCaps } from "./shared-infra.ts";
import type { SwitchContext } from "./switch-preview.ts";
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
  /** 拾取器内部监听器的解绑函数（pointerdown 记拖拽起点；canvas 共享单例，须成对解绑） */
  onUnifiedPickDispose: (() => void) | null;
  /** 可变 ESC handler（switchTo 后替换，cleanup 经当前引用卸载） */
  escH: (e: KeyboardEvent) => void;
  /** 提示条自动消失定时器（cleanup 时 clearTimeout） */
  tipTimeoutId: ReturnType<typeof setTimeout> | undefined;
  /** 当前会话的键盘输入状态（render-loop 动态读取驱动相机运动） */
  keys: Partial<Record<TdKeyAction, boolean>>;
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
  // 终止标志置位（code review #7：原恒 false 死标志，switch-preview 三处守卫
  // 只靠 aborted/gen 撑着——本字段既已存在就让它真实生效）
  ctx.session.isDisposed.v = true;
  document.removeEventListener("keydown", ctx.session.escH);
  // 早期路径（cleanupFn 尚未赋值）：清理 tip 定时器 + 菜单，再拆 overlay
  clearTipTimer(ctx.session);
  ctx.menuHandle.dispose();
  if (ctx.overlay?.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  finishSession(ctx);
}

/** ② 提示条定时器清除（closeOverlay / runFailedMountCleanup / runFullCleanup 三路共用）。 */
function clearTipTimer(session: MpSessionState): void {
  if (session.tipTimeoutId) {
    clearTimeout(session.tipTimeoutId);
    session.tipTimeoutId = undefined;
  }
}

/**
 * ⑦ 输入监听解绑 + perFrame/rAF 收尾（runFullCleanup 与 runFailedMountCleanup 共用段）。
 * bindInputHandlers 已注册于 build 前；漏解绑跨会话累积。removePerFrame 对未注册回调
 * 为 no-op 安全；若这是唯一活跃会话则停全局 rAF。
 */
function unbindInputsAndStopLoop(ctx: MountCtx): void {
  const session = ctx.session;
  const h = ctx.handlers;
  document.removeEventListener("keydown", h.onKeyDown);
  document.removeEventListener("keyup", h.onKeyUp);
  window.removeEventListener("pointerup", h.onDragPointerUp);
  window.removeEventListener("pointercancel", h.onDragPointerUp);
  window.removeEventListener("pointermove", h.onDragPointerMove);
  window.removeEventListener("resize", h.onResize);
  h.cancelPendingResize?.(); // 取消已在途 resize rAF 帧（容器已拆，防幽灵 setSize）
  const infra = ctx.getInfra();
  if (infra) {
    infra.renderer.domElement.removeEventListener("pointerdown", h.onDragPointerDown);
    if (session.onUnifiedPick)
      infra.renderer.domElement.removeEventListener("click", session.onUnifiedPick);
    session.onUnifiedPickDispose?.();
    session.onUnifiedPickDispose = null;
  }
  // 从全局 perFrame 回调列表移除本 session；全部清空后停 rAF
  if (session.perFrame) removePerFrame(session.perFrame);
  stopIfIdle();
}

/**
 * build 失败路径轻量清理（mount-preview-core.ts catch 段调用）。
 * 与 runFullCleanup 的区别：失败路径**保留 overlay**（其上是 showLoadFailure 的错误提示，
 * 用户需能看到失败原因），不清场景能力/纹理缓存（可能被其他活跃会话共享）——
 * 只解绑本会话已注册的输入监听 + 停 rAF + 拆菜单 + 清 tip 定时器，防止跨会话累积泄漏。
 *
 * 复用 runFullCleanup 的 ②③⑦ 共用段；① escH 与 ⑥ content/scene 差量由调用方
 * （catch 段）自行处理（顺序：先解绑监听再拆资源）。
 * 注意：不调 finishSession——失败后会话仍存活（用户看错误提示后 ESC 走 closeOverlay）。
 */
export function runFailedMountCleanup(ctx: MountCtx): void {
  const session = ctx.session;
  // 终止标志置位（同 runFullCleanup/closeOverlay）
  session.isDisposed.v = true;
  // ② 提示条定时器（成功路径由 timeout 自移除；失败时取消避免迟到移除）
  clearTipTimer(session);
  // ③ 声明式根菜单（移除 dock/popup + 解绑 view click 监听）
  ctx.menuHandle.dispose();
  // ⑦ 输入监听解绑 + perFrame/rAF 收尾（runFullCleanup 同段共用）
  unbindInputsAndStopLoop(ctx);
}

/**
 * 完整清理（原 mount3D 内嵌 fullCleanup，P0 修复：中止/退出路径完整拆除 DOM + 解绑监听，防泄漏）。
 * ① ESC 监听器（escH 可能已被 switchTo 替换，移除当前引用）→ ② 提示条定时器 →
 * ③ 声式根菜单 → ④ viewContainer → ⑤ overlay + 单例清零 → ⑥ 内容层 dispose + scene 差量
 * 清理 → ⑦ 输入监听解绑 + perFrame/rAF 收尾（与 runFailedMountCleanup 共用段）→
 * ⑧ 场景能力 save/dispose → ⑨ 纹理缓存 → loadingEl 兜底 → finishSession。
 */
export function runFullCleanup(ctx: MountCtx): void {
  const session = ctx.session;
  // 终止标志置位（code review #7，同 closeOverlay）
  session.isDisposed.v = true;
  // ① ESC 监听器（escH 经 switchTo 可能已被替换，移除当前引用）
  document.removeEventListener("keydown", session.escH);
  // ② 提示条定时器
  clearTipTimer(session);
  // ③ 声式根菜单（移除 dock/popup + 解绑 view click 监听）
  ctx.menuHandle.dispose();
  // ④ viewContainer（含 loadingEl；首次挂载时可能含 renderer.domElement）
  if (ctx.viewContainer.parentNode) ctx.viewContainer.parentNode.removeChild(ctx.viewContainer);
  // ⑤ overlay 本体移除 + 清模块级单例：runFullCleanup 是「完整关闭」语义。
  // switchTo 的复用外壳走 switch-preview.ts（不经过此处），故移除 overlay 不影响模型内切换。
  if (ctx.overlay?.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  ctx.clearSingletons();
  // ⑥ 只清理内容层（dispose content + 移除 scene children），保留 renderer/canvas 存活
  //    避免销毁 WebGL context 导致黑屏窗口期
  const infra = ctx.getInfra();
  if (infra && session.sceneBaseline) {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
    for (const c of stale) infra.scene.remove(c);
  }
  // P0 修复：dispose 前先按 content 匹配定位本会话注册的 entry——
  // 不能在 allContent 清空后再找（数组已空，filter 全 miss）。
  const myIds = sceneRegistry
    .getAll()
    .filter((e) => session.allContent.includes(e.content) || e.content === session.content)
    .map((e) => e.id);
  for (const b of session.allContent) {
    safeDispose(b);
  }
  session.allContent.length = 0;
  // P0 修复：本会话关闭 → 仅注销本会话注册的模型（避免 reset 清空全部 session 的注册记录）
  for (const id of myIds) sceneRegistry.unregister(id);
  // code_review ece0d4a4 #1/#11 ghost 清扫：选择性注销只覆盖「仍在 allContent 的 entry」——
  // mid-session 被 dispose（keep→非 keep 切换 pushSwitchHistory dispose 旧内容并移出
  // allContent、但从不 unregister，switch-preview 注释自认「残留由下次 mount 的 reset
  // 兜底」）的 ghost entry 不在 myIds，会在会话关闭后滞留——count() 虚高误触 MAX_MODELS
  // 上限 / 陈旧 roots 参与取景 / objToEntry 映射已释放对象。本会话是最后一个存活会话时
  // 整体 reset 兜底（还原旧 close-time sweep 语义）；coop 尚有其它会话则保留选择性注销
  //（不误伤他人——原 reset 正是在此多会话场景被本 P0 修复替换掉的原因）
  if (!ctx.handles.some((h) => h.gen !== ctx.myGen)) {
    sceneRegistry.reset();
  }
  // ⑦ 输入监听解绑 + perFrame/rAF 收尾（runFailedMountCleanup 同段共用）
  unbindInputsAndStopLoop(ctx);
  // ⑧ 场景能力：保存状态 + 释放 GPU（下次 mount 由 createAll 重建）；清空能力引用
  sceneCapabilityRegistry.saveAll();
  sceneCapabilityRegistry.dispose();
  clearSceneCaps();
  // ⑨ 纹理缓存池 session 结束统一释放 + 视锥裁剪注册清空
  textureCache.disposeAll();
  clearModelRoots();
  // 感知暂停标志复位：该标志由各 adapter 的 update() 每帧覆盖写入（模块级单例，
  // 无属主）——adapter 崩溃/提前退出/切到无感知模型时残留旧值会静默冻结感知。
  // 会话完整关闭即归零，下次 mount 从干净状态开始（code review P2）。
  setPerceptionPaused(false);
  // 清掉 loadingEl（已从 viewContainer 一并移除，此处为兜底）
  if (ctx.loadingEl.parentNode) ctx.loadingEl.remove();
  // P0 修复：本会话关闭 → 注销活跃输入会话（render-loop 不再驱动已释放的相机状态）
  unregisterActiveInputSession(session);
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
