// ===== mount3D 会话生命周期（2026 锐评整改：mount3D 五层闭包 → MountCtx 模块级函数）=====
// 原 mount3D 内嵌的 finishSession / closeOverlay / fullCleanup / unloadSessionModel
// 提为接收 MountCtx 上下文的模块级函数（switch-preview.ts 的 SwitchContext 同款模式）。
// 本文件仅承载「会话终结/清理/卸载」生命周期；菜单/rAF/外壳装配仍归 mount-preview-core。

import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import { clearModelRoots } from "@/preview-3d/infra/frustum-cull.ts";
import type { TdKeyAction } from "@/preview-3d/infra/keymap.ts";
import { showLoadFailure } from "@/preview-3d/infra/preview-loading.ts";
import {
  removePerFrame,
  stopIfIdle,
  unregisterActiveInputSession,
} from "@/preview-3d/infra/render-loop.ts";
import { disposeObject3D, safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import { resetSceneTextureBytes } from "@/preview-3d/infra/texture-bytes.ts";
import { unloadModel } from "@/preview-3d/infra/unload-model.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import { textureCache } from "@/preview-3d/texture/texture-cache.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { returnFocus } from "@/utils/dom/focus-restore.ts";
import type {
  Mount3DOptions,
  PreviewAdapter,
  PreviewHandle,
  PreviewScene,
} from "./mount-preview-core.ts";
import type { SharedInfra } from "./shared-infra.ts";
import { clearSceneCaps } from "./shared-infra.ts";
import type { SwitchContext } from "./switch-preview.ts";

/**
 * 会话生命周期状态（ADR-233：取代散装布尔的单一可读来源）。
 * 过渡期与 isDisposed/finished/aborted 并存：teardown 起始置 disposing/aborting，
 * finishSession 置 finished；mount-preview-core 在 idle→mounting→mounted 迁移。
 */
export type SessionStatus =
  | "idle" // mount3D 入口，尚未 build
  | "mounting" // build 进行中
  | "mounted" // build 成功、活跃
  | "switching" // 会话内切换中（原 inFlight）
  | "aborting" // ESC / invalidate 打断（原 aborted.v）
  | "disposing" // teardown 进行中
  | "finished"; // finishSession 已收尾（幂等出口）

/** guardSessionAlive 所需生命周期字段形态（SwitchContext / MountCtx 均满足） */
export interface SessionLifecycle {
  aborted: { v: boolean };
  isDisposed: { v: boolean };
  myGen: number;
  getGen: () => number;
}

/**
 * 会话存活守卫（ADR-233：取代 switch-preview 三处逐字咒语
 * `aborted.v || isDisposed.v || myGen !== getGen()`）。返回 true=存活。
 */
export function guardSessionAlive(lc: SessionLifecycle): boolean {
  return !(lc.aborted.v || lc.isDisposed.v || lc.myGen !== lc.getGen());
}

/**
 * mount3D 会话级可变状态收敛体（原 30+ 裸 let，收敛后仅剩 keys/mouseDown/lastMouse 等少量 input let）。
 * infra 字段（scene/camera/renderer/controls/orbitTarget + mount 链消费的 cap 引用）复用 {@link SharedInfra}，
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
  /** 会话生命周期状态（ADR-233 单一事实源；过渡期与 isDisposed/finished/aborted 并存） */
  status: SessionStatus;
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
 * Gen-scoped 会话句柄解析（2026 锐评 P1：收敛 5+ 处手写 `handles.find(h => h.gen === myGen)`）。
 * code_review ece0d4a4 #10 的模式单点化：coop 多会话下按 gen 精确定位本会话句柄，
 * 绝不取「最后 commit 的 session」——camBridge.reset / menuCtx.switchTo / runBuild /
 * buildSwitchContent / finishSession 统一经此解析，避免各调用点 find 语义漂移。
 * 结构参数（MountCtx 与 SwitchContext 均满足形状），两侧零环引入。
 */
export function ownHandle(ctx: {
  handles: Array<{ handle: PreviewHandle; gen: number }>;
  myGen: number;
}): PreviewHandle | undefined {
  return ctx.handles.find((h) => h.gen === ctx.myGen)?.handle;
}

/** 从句柄列表摘除本会话条目（finishSession 专用；与 ownHandle 同构参数） */
export function removeOwnHandle(ctx: {
  handles: Array<{ handle: PreviewHandle; gen: number }>;
  myGen: number;
}): void {
  const idx = ctx.handles.findIndex((h) => h.gen === ctx.myGen);
  if (idx >= 0) ctx.handles.splice(idx, 1);
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
  session.status = "finished"; // ADR-233：收尾即终态（幂等出口）
  // 从模块级 handles 列表移除当前 session（hasActivePreview 以该列表为依据）
  removeOwnHandle(ctx);
  // 无障碍：释放焦点陷阱 + 把焦点还给触发 3D 的 FAB 按钮（rememberTrigger 在
  // mount3D 入口已记下 activeElement；元素已离文档时 returnFocus 静默跳过）
  ctx.focusTrap.cleanup?.();
  ctx.focusTrap.cleanup = null;
  returnFocus();
  // 通知调用方会话已关闭（UI 状态复位 / android-back 注销依赖此回调）
  ctx.adapter.onClose?.();
}

/**
 * 会话清理单出口（ADR-233：原 closeOverlay / runFailedMountCleanup / runFullCleanup
 * 三函数共用段 ②③④⑦ 收敛于此，按 level 差异展开）。行为与原三函数逐段等价：
 * - early：原 closeOverlay（早期 ESC，cleanupFn 未赋值；保留 ⑤ overlay + finishSession）。
 *   2026-09 修正：原实现（及 ADR-233 迁移时「逐段等价」的搬运）不含 ⑦ 输入解绑，但
 *   buildInfra 在 await build 之前就已绑定 escH/输入/拾取/rAF——加载中按 ESC 放弃这条
 *   真实路径会漏解绑（跨会话累积监听器 + render-loop 继续驱动已终结会话）。现补齐 ⑦ 与
 *   unregisterActiveInputSession；两者幂等，与 abort 后迟到 resolve 触发的 full 档叠加无副作用。
 * - failed：原 runFailedMountCleanup（build 失败；保留 overlay 与场景能力/纹理缓存；不调 finishSession）
 * - full：原 runFullCleanup（完整关闭；④⑤⑥⑧⑨ + finishSession）
 */
export type TeardownLevel = "early" | "failed" | "full";

export function teardown(ctx: MountCtx, level: TeardownLevel): void {
  const session = ctx.session;
  // ① 终止标志置位（三路共用，与旧三函数首行一致）
  session.isDisposed.v = true;
  session.status = level === "failed" ? "aborting" : "disposing";
  // ①b escH 解绑（三路共用）：ESC 监听挂在 document 上，且闭包捕获整个 ctx
  // （session.cleanupFn / menuHandle / getInfra）——任何一档漏解绑都是跨会话泄漏 +
  // 会话已拆但 ESC 仍触发陈旧 handler。此前 failed 档漏解绑、由调用方
  // recoverMountFailure 手动补（注释自述「它不清 escH，调用方负责」），是 ADR-233
  // 「三档收敛到单一出口」未收敛干净的残留：新增 failed 调用点一旦忘记补解绑即静默泄漏。
  // 现提到共用区，三档行为一致；调用方的手动补丁已同步删除。
  document.removeEventListener("keydown", session.escH);

  if (level === "early") {
    // 早期 ESC：会话中止且完整收尾（finishSession 幂等）
    session.aborted.v = true;
    clearTipTimer(session); // ②
    ctx.menuHandle.dispose(); // ③
    unbindInputsAndStopLoop(ctx); // ⑦：buildInfra 早于 await build 绑输入，早期 ESC 须同样解绑
    unregisterActiveInputSession(session); // 会话已终结，render-loop 不再驱动其相机状态
    if (ctx.overlay?.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay); // ⑤
    finishSession(ctx);
    return;
  }

  // failed + full 共用段
  clearTipTimer(session); // ②
  ctx.menuHandle.dispose(); // ③
  unbindInputsAndStopLoop(ctx); // ⑦

  if (level === "failed") {
    // 保留 overlay（错误提示可见），不清场景能力/纹理缓存（可能被其他活跃会话共享）
    return;
  }

  // full：原 runFullCleanup ④⑤⑥⑧⑨ + finishSession
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
  // dispose 前先按 content 匹配定位本会话注册的 entry——不能在 allContent 清空后再找
  const myIds = sceneRegistry
    .getAll()
    .filter((e) => session.allContent.includes(e.content) || e.content === session.content)
    .map((e) => e.id);
  for (const b of session.allContent) {
    safeDispose(b);
  }
  session.allContent.length = 0;
  // 本会话关闭 → 仅注销本会话注册的模型（避免 reset 清空全部 session 的注册记录）
  for (const id of myIds) sceneRegistry.unregister(id);
  // 选择性注销只覆盖「仍在 allContent 的 entry」——mid-session 被 dispose 的 ghost entry
  // 不在 myIds，会在会话关闭后滞留；本会话是最后一个存活会话时整体 reset 兜底
  if (!ctx.handles.some((h) => h.gen !== ctx.myGen)) {
    sceneRegistry.reset();
  }
  // ⑧ 场景能力：保存状态 + 释放 GPU（下次 mount 由 createAll 重建）；清空能力引用。
  // cooperate 多会话共享同一 scene/caps/纹理池——仅当本会话是最后存活会话时才 dispose，
  // 否则同台其他会话的 sky/ground/light 与池内纹理会被误拆（2026-09-14 真 bug 修复；
  // 守卫语义对齐上方 sceneRegistry.reset：teardown 内 finishSession 在末尾才摘本句柄，
  // 二次调用时 handles 已不含本会话，`some(gen!==myGen)` 仍正确表达「有无其他存活会话」）。
  sceneCapabilityRegistry.saveAll();
  if (!ctx.handles.some((h) => h.gen !== ctx.myGen)) {
    sceneCapabilityRegistry.dispose();
    clearSceneCaps();
    // ⑨ 纹理缓存池 session 结束统一释放（仅最后会话——同台其他会话的模型材质
    // 仍引用池内 Texture，误 disposeAll 会释放其 GPU 纹理导致贴图失效）
    textureCache.disposeAll();
    // 场景字节快照随场景消亡——残留会在下个轻模型 mount 时被 GPU 预算门误读（假阳性拦截）
    resetSceneTextureBytes();
    clearModelRoots();
  }
  // 清掉 loadingEl（已从 viewContainer 一并移除，此处为兜底）
  if (ctx.loadingEl.parentNode) ctx.loadingEl.remove();
  // 本会话关闭 → 注销活跃输入会话（render-loop 不再驱动已释放的相机状态）
  unregisterActiveInputSession(session);
  // 收尾：摘句柄 + 通知调用方 + 焦点归还（幂等，与 closeOverlay 共用同一出口）
  finishSession(ctx);
}

/** 早期关闭（build 尚未成功，cleanupFn 未赋值时的 ESC 出口）—— ADR-233 退化为 teardown("early") */
export function closeOverlay(ctx: MountCtx): void {
  teardown(ctx, "early");
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
/** build 失败路径轻量清理（mount-preview-core.ts catch 段调用）—— ADR-233 退化为 teardown("failed") */
export function runFailedMountCleanup(ctx: MountCtx): void {
  teardown(ctx, "failed");
}

/**
 * 完整清理（原 mount3D 内嵌 fullCleanup）—— ADR-233 退化为 teardown("full")；
 * 实现见 teardown 的 full 分支（④⑤⑥⑧⑨ + finishSession，行为逐段等价）。
 */
export function runFullCleanup(ctx: MountCtx): void {
  teardown(ctx, "full");
}

/**
 * mount3D 失败路径恢复（catch 体抽为叶函数）。adapter.build 抛错时 session.content 为
 * null，session.content?.dispose() 是 no-op，half-built mesh 留在 scene 中成为幽灵基线
 * ——下次 mount 把垃圾快照进 baseline。此处不移除 overlay/DOM（保留 showLoadFailure 错误
 * 提示），只清场景中的半成品 + dispose 已注册 content + 解绑输入监听/停 rAF/拆菜单。
 */
export function recoverMountFailure(ctx: MountCtx, loadingEl: HTMLElement, e: unknown): void {
  const session = ctx.session;
  // escH 解绑已归位 teardown 共用区（本文件 teardown ①b）——三档统一，本处不再手动补。
  runFailedMountCleanup(ctx);
  const infra = ctx.getInfra();
  if (infra && session.sceneBaseline) {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
    // [P1 对齐] 与 switch-preview 的 keep 失败分支（switch-preview.ts:289-290）保持一致：
    // 半成品子树只从 scene 摘除而不释放 → geometry/material 常驻 GPU。`adapter.build` 在
    // `scene.add` 之后才抛错的形态（如 MMD alloc 失败）必然命中此路径，且它没有自愈机会
    // （内容层未生成、不会重建同内容），故必须在此把资源一并收走。
    for (const c of stale) {
      infra.scene.remove(c);
      disposeObject3D(c);
    }
  }
  for (const b of session.allContent) safeDispose(b);
  session.allContent.length = 0;
  // 不单独调 session.content?.dispose()——content 已在 allContent 中，
  // P2 守卫（对齐旧 skeleton close3D 语义）：加载期间被 ESC/切模型/invalidate
  // 打断后迟到的失败不得再弹错——否则关闭后 1~2s 突然冒「加载失败」toast，
  // 掩盖用户主动关闭的意图（旧实现 skeleton.ts 的 gen 守卫，迁移到核心统一承担）。
  if (session.aborted.v || ctx.myGen !== ctx.getGen()) return;
  logError("preview 3D", "加载失败", e);
  showLoadFailure(loadingEl, e);
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
