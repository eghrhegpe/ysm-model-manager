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
import { getSceneCaps, type SharedInfra } from "@/preview-3d/adapters/shared-infra.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import {
  cullModelGroups,
  isFrustumCullEnabled,
  markCullMatricesDirty,
  restoreModelGroupsVisible,
} from "./frustum-cull.ts";
import { sampleGpuLoad } from "./gpu-load.ts";
import type { TdKeyAction } from "./keymap.ts";
import {
  createAdaptiveRenderBudget,
  getFrameIntervalMs,
  previewPixelRatio,
  sampleAdaptivePixelRatio,
  shouldRenderAtFps,
} from "./render-budget.ts";
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
  /**
   * 上次 perFrame 阻塞告警时间戳（节流用，见 animate 内超时告警）。
   * 初值 `null` = 「从未告警过」——不能用 0：页面刚加载时 `performance.now()` 本身
   * 小于节流窗（如 900ms < 5000ms），`now - 0 < 窗` 会把**首条**告警吞掉，
   * 而首个卡顿帧恰是最该被看见的（冷启动解析/上传纹理阶段）。
   */
  private _lastPerFrameWarnTs: number | null = null;
  /**
   * removePerFrame 引用失配告警的独立节流时间戳。
   * ⚠️ 不复用 `_lastPerFrameWarnTs`：两者是**互不相关的告警源**（前者=回调执行超时，
   * 后者=注销未命中），共用槽位会互相吞掉对方的告警——实测共用时「超时告警」先写入
   * 时间戳，紧接着的失配告警被静默节流 5s，可观测性归零。
   * ⚠️ 初值用 `null` 而非 `0`：页面刚加载时 `performance.now()` 本身 < 节流窗（如 830ms），
   * `now - 0 < 5000` ⇒ **首条告警被吞**。null 表示「从未告警过」，首条恒放行。
   */
  private _lastRemoveMissWarnTs: number | null = null;
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

  /**
   * 注销 perFrame 回调（setPerFrame 换回调 / unloadModel / fullCleanup 用）。
   *
   * ⚠️ 按**引用相等**（indexOf）移除：调用方必须传注册时那个函数实例。`setPerFrame`
   * 存取同一引用故恒配对；但若有人把 `content.update` 经 `.bind(content)` 或包装闭包
   * 注册、注销时却传原方法，indexOf 恒 -1 → 回调永久驻留 `_perFrames`，rAF 每帧驱动
   * 已 dispose 的内容层。此类失配原先**完全静默**（外层的 `if (idx >= 0)` 让漏移除
   * 看起来像正常 no-op），故此处补一条节流告警留痕。
   *
   * 仅在「本该移除」时告警：列表为空是合法（重复注销/清空后重入），不刷屏。
   */
  removePerFrame(f: (dt: number) => void): void {
    const idx = this._perFrames.indexOf(f);
    if (idx >= 0) {
      this._perFrames.splice(idx, 1);
    } else if (this._perFrames.length > 0) {
      // 列表非空却没找到目标 = 引用失配信号（真正的 no-op 只会发生在列表已空时）
      const now = performance.now();
      if (
        this._lastRemoveMissWarnTs === null ||
        now - this._lastRemoveMissWarnTs > PER_FRAME_WARN_THROTTLE_MS
      ) {
        this._lastRemoveMissWarnTs = now;
        logWarn(
          "preview 3D",
          `removePerFrame 未命中（引用失配）：注册表仍有 ${this._perFrames.length} 个回调，` +
            "该回调不会被移除，可能导致已销毁内容层仍被每帧驱动。请确认注册/注销传同一函数实例。",
        );
      }
    }
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
    // 告警节流时间戳同属循环状态：不清会让「重置后首个告警」被上一轮的时间戳压掉
    // （测试跨用例串扰；生产侧 close→reopen 后首条告警也可能被静默节流）
    this._lastPerFrameWarnTs = null;
    this._lastRemoveMissWarnTs = null;
  }

  /**
   * 首个 session 启动全局 loop（幂等：仅未运行时创建；后续 session 只追加 perFrame）。
   * viewContainer 仍作为参数传入（不影响 session 切换），但 keys/camSpeed/orbitMode
   * 不再闭包捕获——改为从「当前活跃输入会话」动态读取（每帧读一次），后续 session
   * 的 WASD 键位与相机偏好均可在激活时生效。
   */
  start(viewContainer: HTMLElement, infra: SharedInfra): void {
    this._viewContainer = viewContainer;
    this._infra = infra;
    this._cam = infra.camera;
    this._ctr = infra.controls;
    this._ot = infra.orbitTarget;
    if (this._animId !== 0) return; // 已运行：仅刷新上述局部态（_viewContainer/_cam/_ot 跨 session 复用），不二次启动 rAF
    this._lastTime = performance.now();
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
    // 每帧从动态活跃输入会话读取 keys/camSpeed/orbitMode，不再闭包捕获首个 session
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
        (this._lastPerFrameWarnTs === null ||
          pfNow - this._lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS)
      ) {
        this._lastPerFrameWarnTs = pfNow;
        logWarn("perFrame", `阻塞 ${pfMs.toFixed(1)}ms (>${PER_FRAME_WARN_MS}ms 阈值)`);
      }
    }
    if (isFrustumCullEnabled()) {
      // 矩阵置脏只由「真有变换写入」的 perFrame 回调决定：`_perFrames` 非空即置脏。
      //
      // [2026-09 修复] 原条件 `|| hasCapUpdate`（扫描 getSceneCaps 找实现了 update 的 cap）
      // 恒真——10 个内置 cap 里 sky/water 都实现了 update，故标志**每帧**被置脏，
      // 恰好在下一行 cullModelGroups 消费它之前，frustum-cull 的「动静分治」
      // （_matricesDirty=false 时跳过 expandBoxVisible 的全子树 updateWorldMatrix）
      // 永不生效，即其注释宣称已修掉的「每帧双重全树矩阵更新」依然存在。
      // 且判据本身是错的：cap 的 update() 只推进 uniform/时间值（water 写 waterTime、
      // sky 写 beams.time），**从不写 Object3D 变换**，本就不该触发矩阵刷新。
      if (this._perFrames.length > 0) markCullMatricesDirty();
      cullModelGroups(cam);
    } else restoreModelGroupsVisible();
    // 每帧动态解析（coop 会话切换后指向当前存活 cap；全清后为 null 走直渲兜底）
    const postProcCap = sceneCapabilityRegistry.getById("postprocessing");
    const lightCap = sceneCapabilityRegistry.getById("light") ?? null;
    const rendered = postProcCap ? postProcCap.render(dt, lightCap) : false;
    if (!rendered) infra.renderer.render(infra.scene, cam);
    const nextPixelRatio = sampleAdaptivePixelRatio(
      this._adaptiveBudget,
      now,
      interval,
      // 单看 CPU 帧时会漏掉「主线程提交快、GPU 已排队」
      // 的饱和态；传入后 GPU 高位即使帧时正常也预防性降一档（读 info 无副作用）。
      sampleGpuLoad(infra.renderer),
    );
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
