// ===== 渲染宿主（preview-3d P1 单例收敛：模块级 let 集群 → 实例字段）=====
// 原 render-loop.ts 持有 7 个模块级可变单例（_globalAnimId/_globalPerFrames/
// _lastPerFrameWarnTs/_perFrameSnapshot/_perFramesDirty/_activeInputSession/
// _liveInputSessions），属「单一渲染宿主」应聚敛的状态。本类把它们收为实例字段，
// 取代散落模块级 let——与兄弟会话 A1（_globalPause → createPerceptionPauseRef 实例
// 注入）同一战役、同一步伐（P1 根因修复：运行态不再靠模块级全局变量撑着）。
//
// 设计边界（方案 A「RendererHost 单例」）：WebGLRenderer 受浏览器 context 数量硬约束
// 必须唯一 → 单一 rAF loop 天然合理；故本宿主为**单例实例**（rendererHost），但内部
// perFrame / 活跃输入会话等状态均为实例字段，未来多预览实例只需各自持 host 引用，
// 不再依赖模块级全局。外部经 render-loop.ts 的薄门面函数访问，签名零变更。
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import {
  cullModelGroups,
  isFrustumCullEnabled,
  markCullMatricesDirty,
  restoreModelGroupsVisible,
} from "@/preview-3d/infra/frustum-cull.ts";
import type { TdKeyAction } from "@/preview-3d/infra/keymap.ts";
import {
  createAdaptiveRenderBudget,
  getFrameIntervalMs,
  PREVIEW_FRAME_INTERVAL_MS,
  previewPixelRatio,
  sampleAdaptivePixelRatio,
  shouldRenderAtFps,
} from "@/preview-3d/infra/render-budget.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { getSceneCaps, type SharedInfra } from "./shared-infra.ts";
import { applyWasdCameraMotion } from "./wasd-camera.ts";

/** render-loop 活跃输入会话形状（mount-preview-core 经 set/unregister 注入；rAF 每帧读） */
export interface ActiveInputSession {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
}

/** perFrame 回调单次执行超过该阈值（ms）即告警（仅测回调段，非整帧） */
const PER_FRAME_WARN_MS = 50;
/** 告警节流间隔：持续超阈值帧最多每 N ms 报一条，防刷屏加重卡顿 */
const PER_FRAME_WARN_THROTTLE_MS = 5000;

/**
 * 渲染宿主：持有单 rAF loop 的全部可变状态（原 render-loop.ts 模块级 let 集群）。
 * 仅此一处创建/驱动 global rAF；perFrame 回调与活跃输入会话均为实例字段，
 * 调用方经薄门面（render-loop.ts）访问，签名与重构前一致。
 */
export class RendererHost {
  /** rAF 全局唯一标识（0 = 循环未运行） */
  private _animId = 0;
  /** 所有 session 的 perFrame 回调（共享同一 renderer） */
  private _perFrames: Array<(dt: number) => void> = [];
  /** 上次 perFrame 告警时间戳（节流用） */
  private _lastPerFrameWarnTs = 0;
  /** perFrame 快照缓存（dirty 重建）：注册表变更才分配，rAF 热路径零分配（R1-P1-1） */
  private _perFrameSnapshot: Array<(dt: number) => void> | null = null;
  private _perFramesDirty = true;

  /** 当前活跃输入会话（rAF 每帧动态读取 keys/camSpeed/orbitMode 驱动相机运动）。
   *  P0 修复：替代原 startGlobalRenderLoop 闭包捕获首个 session 参数的方式——后续
   *  session 的输入状态不再被忽略，WASD 不再失灵。 */
  private _activeInputSession: ActiveInputSession | null = null;

  /** 存活输入会话列表（升序 = commit 顺序；末尾 = 最新）——
   *  code_review ece0d4a4 #2/#3/#9：注销活跃会话时晋升最新存活的，而非无条件置 null，
   *  否则 coop 多会话下关掉 active 的那个 → 存活会话的 WASD/相机移动永久死。 */
  private _liveInputSessions: ActiveInputSession[] = [];

  // ===== start() 捕获的 loop 局部态（原 startGlobalRenderLoop 闭包变量，提升为实例字段）=====
  private _viewContainer: HTMLElement | null = null;
  private _infra: SharedInfra | null = null;
  private _cam: THREE.PerspectiveCamera | null = null;
  private _ctr: OrbitControls | null = null;
  private _ot: THREE.Vector3 | null = null;
  private _lastTime = 0;
  private _nextFrameTime = 0;
  private _adaptiveBudget = createAdaptiveRenderBudget(
    previewPixelRatio(window.devicePixelRatio),
    performance.now(),
  );
  // rAF 每帧复用 Vector3 实例，避免 5 次 GC 分配（R1-P1-1）
  private readonly _camDir = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _move = new THREE.Vector3();

  /** 注册活跃输入会话（build 成功后调用；重复注册同一引用为 no-op） */
  setActiveInputSession(s: ActiveInputSession): void {
    if (!this._liveInputSessions.includes(s)) this._liveInputSessions.push(s);
    this._activeInputSession = s;
  }

  /** 注销活跃输入会话（cleanup 时调用）：从存活列表移除并置 active 为最新存活者，
   *  仅当列表空时才置 null（code_review ece0d4a4 #2/#3/#9——原实现关掉 active 后
   *  无条件置 null，coop 下存活 session 的 WASD 永久失活） */
  unregisterActiveInputSession(s: ActiveInputSession): void {
    const idx = this._liveInputSessions.indexOf(s);
    if (idx >= 0) this._liveInputSessions.splice(idx, 1);
    if (this._activeInputSession === s) {
      this._activeInputSession =
        this._liveInputSessions.length > 0
          ? this._liveInputSessions[this._liveInputSessions.length - 1]
          : null;
    }
  }

  /** 取当前活跃输入会话（rAF 热路径调用；null 表示无活跃 session，跳过相机运动） */
  getActiveInputSession(): ActiveInputSession | null {
    return this._activeInputSession;
  }

  /** 注册 perFrame 回调（setPerFrame 统一入口的落点） */
  registerPerFrame(f: (dt: number) => void): void {
    this._perFrames.push(f);
    this._perFramesDirty = true;
  }

  /** 注销 perFrame 回调（setPerFrame 换回调 / unloadModel / fullCleanup 用） */
  removePerFrame(f: (dt: number) => void): void {
    const idx = this._perFrames.indexOf(f);
    if (idx >= 0) this._perFrames.splice(idx, 1);
    this._perFramesDirty = true;
  }

  /** 取本次帧迭代快照：仅注册表变更时重建（每帧 spread 会无条件分配，见 animate 注释） */
  private perFrameIterable(): Array<(dt: number) => void> {
    if (this._perFramesDirty || this._perFrameSnapshot === null) {
      this._perFrameSnapshot = [...this._perFrames];
      this._perFramesDirty = false;
    }
    return this._perFrameSnapshot;
  }

  /** 所有 session 的 perFrame 清空后停 rAF（fullCleanup 尾部调用） */
  stopIfIdle(): void {
    if (this._perFrames.length === 0) {
      cancelAnimationFrame(this._animId);
      this._animId = 0;
    }
  }

  /** 测试用：重置全部循环状态（对应旧 resetLoopState） */
  reset(): void {
    this._animId = 0;
    this._perFrames.length = 0;
    // 快照缓存随注册表清空失效（防 stale 快照残留到下次 loop）
    this._perFrameSnapshot = null;
    this._perFramesDirty = true;
    this._activeInputSession = null;
    this._liveInputSessions.length = 0;
  }

  /**
   * 首个 session 启动全局 loop（幂等：仅未运行时创建；后续 session 只追加 perFrame）。
   * viewContainer 仍作为参数传入（不影响 session 切换），但 keys/camSpeed/orbitMode
   * 不再闭包捕获——改为从「当前活跃输入会话」动态读取（每帧读一次），后续 session
   * 的 WASD 键位与相机偏好均可在激活时生效。
   */
  start(viewContainer: HTMLElement, infra: SharedInfra): void {
    if (this._animId !== 0) return;
    this._viewContainer = viewContainer;
    this._infra = infra;
    this._cam = infra.camera;
    this._ctr = infra.controls;
    this._ot = infra.orbitTarget;
    this._lastTime = performance.now() - PREVIEW_FRAME_INTERVAL_MS;
    this._nextFrameTime = performance.now();
    this._adaptiveBudget = createAdaptiveRenderBudget(
      previewPixelRatio(window.devicePixelRatio),
      performance.now(),
    );
    this.animate();
  }

  private readonly animate = (): void => {
    this._animId = requestAnimationFrame(this.animate);
    const infra = this._infra;
    const viewContainer = this._viewContainer;
    const cam = this._cam;
    const ctr = this._ctr;
    const ot = this._ot;
    if (!infra || !viewContainer || !cam || !ctr || !ot) return;
    const now = performance.now();
    const interval = getFrameIntervalMs();
    if (!shouldRenderAtFps(now, this._nextFrameTime, interval, document.hidden === true)) {
      this._adaptiveBudget.sampleStart = now;
      return;
    }
    this._nextFrameTime += interval;
    if (this._nextFrameTime < now - interval) {
      this._nextFrameTime = now + interval;
    }
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;
    // 推进逐帧动态效果（水面波纹/弹簧骨骼等；能力自行决定是否需要更新）
    for (const c of getSceneCaps()) c.update?.(dt);
    // P0 修复：每帧从动态活跃输入会话读取 keys/camSpeed/orbitMode，不再闭包捕获首个 session
    const activeInput = this._activeInputSession;
    if (activeInput) {
      applyWasdCameraMotion(
        activeInput.keys,
        cam,
        ctr,
        activeInput.camSpeed,
        dt,
        activeInput.orbitMode,
        ot,
        { camDir: this._camDir, forward: this._forward, right: this._right, move: this._move },
      );
    }
    // 驱动所有 session 的 perFrame 回调（快照迭代）
    for (const fn of this.perFrameIterable()) {
      const pfStart = performance.now();
      try {
        fn(dt);
      } catch (err) {
        logWarn("perFrame", `session 回调异常: ${String(err)}`);
      }
      const pfNow = performance.now();
      const pfMs = pfNow - pfStart;
      if (
        pfMs > PER_FRAME_WARN_MS &&
        pfNow - this._lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS
      ) {
        this._lastPerFrameWarnTs = pfNow;
        logWarn("perFrame", `阻塞 ${pfMs.toFixed(1)}ms (>${PER_FRAME_WARN_MS}ms 阈值)`);
      }
    }
    if (isFrustumCullEnabled()) {
      const caps = getSceneCaps();
      const hasCapUpdate = caps.length > 0 && caps.some((c) => typeof c.update === "function");
      if (this._perFrames.length > 0 || hasCapUpdate) markCullMatricesDirty();
      cullModelGroups(cam);
    } else restoreModelGroupsVisible();
    // 每帧动态解析（coop 会话切换后指向当前存活 cap；全清后为 null 走直渲兜底）
    const postProcCap = sceneCapabilityRegistry.getById("postprocessing");
    const lightCap = sceneCapabilityRegistry.getById("light") ?? null;
    const rendered = postProcCap ? postProcCap.render(dt, lightCap) : false;
    if (!rendered) infra.renderer.render(infra.scene, cam);
    const nextPixelRatio = sampleAdaptivePixelRatio(this._adaptiveBudget, now, interval);
    if (nextPixelRatio !== null) {
      infra.renderer.setPixelRatio(nextPixelRatio);
      // 容器已脱离文档（cleanup 拆单例 → stopIfIdle 停环前的窗口帧）或尺寸为 0 时跳过
      // resize：setSize(0, h) 会把画布打没、cam.aspect=0/N 直接坏画面（一帧也不行）
      if (
        viewContainer.isConnected &&
        viewContainer.clientWidth > 0 &&
        viewContainer.clientHeight > 0
      ) {
        infra.renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
        postProcCap?.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
      }
      postProcCap?.setPixelRatio?.(nextPixelRatio);
    }
  };
}

/** 全局唯一渲染宿主（renderer 受 WebGL context 数量硬约束必须唯一，单 host 合理） */
export const rendererHost = new RendererHost();
