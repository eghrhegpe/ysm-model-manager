// ===== 全局 rAF 渲染循环（2026 锐评整改：自 mount-preview-core §4b 拆出）=====
// 首个 session 启动 loop，后续 session 只追加 perFrame 回调；所有 session 共享同一
// renderer。cleanupPreview 停止（stopIfIdle：perFrame 清空才 cancel）。
// 状态（_globalAnimId/_globalPerFrames/_lastPerFrameWarnTs）收敛在本模块，
// mount-preview-core 经 registerPerFrame/removePerFrame/stopIfIdle/resetLoopState 访问。

import * as THREE from "three";
import { logWarn } from "@/utils/base/log.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import {
  cullModelGroups,
  isFrustumCullEnabled,
  markCullMatricesDirty,
  restoreModelGroupsVisible,
} from "../frustum-cull.ts";
import type { TdKeyAction } from "../keymap.ts";
import {
  createAdaptiveRenderBudget,
  getFrameIntervalMs,
  PREVIEW_FRAME_INTERVAL_MS,
  previewPixelRatio,
  sampleAdaptivePixelRatio,
  shouldRenderAtFps,
} from "../render-budget.ts";
import { getSceneCaps, type SharedInfra } from "./shared-infra.ts";
import { applyWasdCameraMotion } from "./wasd-camera.ts";

/** perFrame 回调单次执行超过该阈值（ms）即告警（仅测回调段，非整帧） */
const PER_FRAME_WARN_MS = 50;
/** 告警节流间隔：持续超阈值帧最多每 N ms 报一条，防刷屏加重卡顿 */
const PER_FRAME_WARN_THROTTLE_MS = 5000;

/** rAF 全局唯一标识（0 = 循环未运行） */
let _globalAnimId = 0;
/** 所有 session 的 perFrame 回调（共享同一 renderer） */
const _globalPerFrames: Array<(dt: number) => void> = [];
/** 上次 perFrame 告警时间戳（节流用） */
let _lastPerFrameWarnTs = 0;
/** perFrame 快照缓存（dirty 重建）：注册表变更才分配，rAF 热路径零分配（R1-P1-1） */
let _perFrameSnapshot: Array<(dt: number) => void> | null = null;
let _perFramesDirty = true;

/** 当前活跃输入会话（render-loop 每帧动态读取 keys/camSpeed/orbitMode 驱动相机运动）。
 *  P0 修复：替代原 startGlobalRenderLoop 闭包捕获首个 session 参数的方式——后续 session
 *  的输入状态不再被忽略，WASD 不再失灵。mount-preview-core 在 build 成功后置活跃、
 *  cleanup 时注销活跃。 */
let _activeInputSession: {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
} | null = null;

/** 存活输入会话列表（升序 = commit 顺序；末尾 = 最新）——
 *  code_review ece0d4a4 #2/#3/#9：注销活跃会话时晋升最新存活的，而非无条件置 null，
 *  否则 coop 多会话下关掉 active 的那个 → 存活会话的 WASD/相机移动永久死 */
const _liveInputSessions: Array<{
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
}> = [];

/** 注册活跃输入会话（build 成功后调用；重复注册同一引用为 no-op） */
export function setActiveInputSession(s: {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
}): void {
  if (!_liveInputSessions.includes(s)) _liveInputSessions.push(s);
  _activeInputSession = s;
}

/** 注销活跃输入会话（cleanup 时调用）：从存活列表移除并置 active 为最新存活者，
 *  仅当列表空时才置 null（code_review ece0d4a4 #2/#3/#9——原实现关掉 active 后
 *  无条件置 null，coop 下存活 session 的 WASD 永久失活） */
export function unregisterActiveInputSession(s: {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
}): void {
  const idx = _liveInputSessions.indexOf(s);
  if (idx >= 0) _liveInputSessions.splice(idx, 1);
  if (_activeInputSession === s) {
    _activeInputSession =
      _liveInputSessions.length > 0 ? _liveInputSessions[_liveInputSessions.length - 1] : null;
  }
}

/** 取当前活跃输入会话（rAF 热路径调用；null 表示无活跃 session，跳过相机运动） */
export function getActiveInputSession(): {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
} | null {
  return _activeInputSession;
}

/** 注册 perFrame 回调（setPerFrame 统一入口的落点） */
export function registerPerFrame(f: (dt: number) => void): void {
  _globalPerFrames.push(f);
  _perFramesDirty = true;
}

/** 注销 perFrame 回调（setPerFrame 换回调 / unloadModel / fullCleanup 用） */
export function removePerFrame(f: (dt: number) => void): void {
  const idx = _globalPerFrames.indexOf(f);
  if (idx >= 0) _globalPerFrames.splice(idx, 1);
  _perFramesDirty = true;
}

/** 取本次帧迭代快照：仅注册表变更时重建（每帧 spread 会无条件分配，见 animate 注释） */
function perFrameIterable(): Array<(dt: number) => void> {
  if (_perFramesDirty || _perFrameSnapshot === null) {
    _perFrameSnapshot = [..._globalPerFrames];
    _perFramesDirty = false;
  }
  return _perFrameSnapshot;
}

/** 所有 session 的 perFrame 清空后停 rAF（fullCleanup 尾部调用） */
export function stopIfIdle(): void {
  if (_globalPerFrames.length === 0) {
    cancelAnimationFrame(_globalAnimId);
    _globalAnimId = 0;
  }
}

/** 测试用：重置循环状态（对应 mount-preview-core._resetSingletons） */
export function resetLoopState(): void {
  _globalAnimId = 0;
  _globalPerFrames.length = 0;
  // 快照缓存随注册表清空失效（防 stale 快照残留到下次 loop）
  _perFrameSnapshot = null;
  _perFramesDirty = true;
  _activeInputSession = null;
  _liveInputSessions.length = 0;
}

/**
 * 首个 session 启动全局 loop（幂等：仅未运行时创建；后续 session 只追加 perFrame）。
 * viewContainer 仍作为参数传入（不影响 session 切换），但 keys/camSpeed/orbitMode
 * 不再闭包捕获——改为从「当前活跃输入会话」动态读取（每帧读一次），后续 session
 * 的 WASD 键位与相机偏好均可在激活时生效。
 */
export function startGlobalRenderLoop(viewContainer: HTMLElement, infra: SharedInfra): void {
  if (_globalAnimId !== 0) return;
  const cam = infra.camera;
  const ctr = infra.controls;
  const ot = infra.orbitTarget;
  // postProc/lightCap 不闭包捕获首个 session 的实例：coop 多会话下旧会话 dispose 后
  // rAF 若未停，仍会调用已 dispose 的旧 cap（enabled 残留 true 会重建 composer），
  // 新会话 cap 反而拿不到每帧 render。改为每帧经 registry 动态读取（同 getSceneCaps() 模式）。
  // rAF 每帧复用 Vector3 实例，避免 5 次 GC 分配（R1-P1-1）
  const _camDir = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _move = new THREE.Vector3();
  let lastTime = performance.now() - PREVIEW_FRAME_INTERVAL_MS;
  let nextFrameTime = performance.now();
  const adaptiveBudget = createAdaptiveRenderBudget(
    previewPixelRatio(window.devicePixelRatio),
    performance.now(),
  );
  function animate(): void {
    _globalAnimId = requestAnimationFrame(animate);
    const now = performance.now();
    const interval = getFrameIntervalMs();
    if (!shouldRenderAtFps(now, nextFrameTime, interval, document.hidden === true)) {
      adaptiveBudget.sampleStart = now;
      return;
    }
    nextFrameTime += interval;
    if (nextFrameTime < now - interval) {
      nextFrameTime = now + interval;
    }
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    // 推进逐帧动态效果（水面波纹/弹簧骨骼等；能力自行决定是否需要更新）
    for (const c of getSceneCaps()) c.update?.(dt);
    // P0 修复：每帧从动态活跃输入会话读取 keys/camSpeed/orbitMode，不再闭包捕获首个 session
    const activeInput = _activeInputSession;
    if (activeInput) {
      applyWasdCameraMotion(
        activeInput.keys,
        cam,
        ctr,
        activeInput.camSpeed,
        dt,
        activeInput.orbitMode,
        ot,
        { camDir: _camDir, forward: _forward, right: _right, move: _move },
      );
    }
    // 驱动所有 session 的 perFrame 回调（快照迭代）
    for (const fn of perFrameIterable()) {
      const pfStart = performance.now();
      try {
        fn(dt);
      } catch (err) {
        logWarn("perFrame", `session 回调异常: ${String(err)}`);
      }
      const pfNow = performance.now();
      const pfMs = pfNow - pfStart;
      if (pfMs > PER_FRAME_WARN_MS && pfNow - _lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS) {
        _lastPerFrameWarnTs = pfNow;
        logWarn("perFrame", `阻塞 ${pfMs.toFixed(1)}ms (>${PER_FRAME_WARN_MS}ms 阈值)`);
      }
    }
    if (isFrustumCullEnabled()) {
      const caps = getSceneCaps();
      const hasCapUpdate = caps.length > 0 && caps.some((c) => typeof c.update === "function");
      if (_globalPerFrames.length > 0 || hasCapUpdate) markCullMatricesDirty();
      cullModelGroups(cam);
    } else restoreModelGroupsVisible();
    // 每帧动态解析（coop 会话切换后指向当前存活 cap；全清后为 null 走直渲兜底）
    const postProcCap = sceneCapabilityRegistry.getById("postprocessing");
    const lightCap = sceneCapabilityRegistry.getById("light") ?? null;
    const rendered = postProcCap ? postProcCap.render(dt, lightCap) : false;
    if (!rendered) infra.renderer.render(infra.scene, cam);
    const nextPixelRatio = sampleAdaptivePixelRatio(adaptiveBudget, now, interval);
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
  }
  animate();
}
