// ===== 全局 rAF 渲染循环（2026 锐评整改：自 mount-preview-core §4b 拆出）=====
// 首个 session 启动 loop，后续 session 只追加 perFrame 回调；所有 session 共享同一
// renderer。cleanupPreview 停止（stopIfIdle：perFrame 清空才 cancel）。
// 状态（_globalAnimId/_globalPerFrames/_lastPerFrameWarnTs）收敛在本模块，
// mount-preview-core 经 registerPerFrame/removePerFrame/stopIfIdle/resetLoopState 访问。

import * as THREE from "three";
import { logWarn } from "../../utils/core/log.ts";
import type { TdKeyAction } from "../keymap.ts";
import {
  cullModelGroups,
  isFrustumCullEnabled,
  restoreModelGroupsVisible,
} from "../frustum-cull.ts";
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

/** 注册 perFrame 回调（setPerFrame 统一入口的落点） */
export function registerPerFrame(f: (dt: number) => void): void {
  _globalPerFrames.push(f);
}

/** 注销 perFrame 回调（setPerFrame 换回调 / unloadModel / fullCleanup 用） */
export function removePerFrame(f: (dt: number) => void): void {
  const idx = _globalPerFrames.indexOf(f);
  if (idx >= 0) _globalPerFrames.splice(idx, 1);
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
}

/**
 * 首个 session 启动全局 loop（幂等：仅未运行时创建；后续 session 只追加 perFrame）。
 * keys/session/viewContainer/infra 按调用时刻捕获——与拆分前闭包语义一致（首个
 * session 的 WASD 键位与相机偏好持续驱动 loop，后续 session 仅贡献 perFrame 回调）。
 */
export function startGlobalRenderLoop(
  keys: Partial<Record<TdKeyAction, boolean>>,
  session: { readonly camSpeed: number; readonly orbitMode: boolean },
  viewContainer: HTMLElement,
  infra: SharedInfra,
): void {
  if (_globalAnimId !== 0) return;
  const cam = infra.camera;
  const ctr = infra.controls;
  const ot = infra.orbitTarget;
  const lightCap = infra.lightCap;
  const postProc = infra.postProc;
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
      // 跳过帧（隐藏/节流）：推进采样起点——隐藏期间墙钟继续走但 sampleFrames
      // 不涨，恢复后平均帧时虚高会把像素比误降级，重复最小化渐进降到地板（code review P3）
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
    applyWasdCameraMotion(keys, cam, ctr, session.camSpeed, dt, session.orbitMode, ot, {
      camDir: _camDir,
      forward: _forward,
      right: _right,
      move: _move,
    });
    // 驱动所有 session 的 perFrame 回调
    for (const fn of _globalPerFrames) {
      const pfStart = performance.now();
      try {
        fn(dt);
      } catch (err) {
        logWarn("perFrame", `session 回调异常: ${String(err)}`);
      }
      const pfMs = performance.now() - pfStart;
      const pfNow = performance.now();
      if (
        pfMs > PER_FRAME_WARN_MS &&
        pfNow - _lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS
      ) {
        _lastPerFrameWarnTs = pfNow;
        logWarn("perFrame", `阻塞 ${pfMs.toFixed(1)}ms (>${PER_FRAME_WARN_MS}ms 阈值)`);
      }
    }
    // 视锥裁剪（设置开关：关 → 跳过并恢复可见性——剔除失误会误藏模型，可关闭）
    if (isFrustumCullEnabled()) cullModelGroups(cam);
    else restoreModelGroupsVisible();
    // ADR-081 L2：后处理体积光管线
    const rendered = postProc ? postProc.render(dt, lightCap) : false;
    if (!rendered) infra.renderer.render(infra.scene, cam);
    const nextPixelRatio = sampleAdaptivePixelRatio(adaptiveBudget, now, interval);
    if (nextPixelRatio !== null) {
      infra.renderer.setPixelRatio(nextPixelRatio);
      infra.renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
      postProc?.setPixelRatio?.(nextPixelRatio);
      postProc?.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    }
  }
  animate();
}
