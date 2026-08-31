import { safeGet } from "../utils/dom/storage.ts";

const PREVIEW_MAX_PIXEL_RATIO_DEFAULT = 1.5;
// 存储键单一事实来源（code review P3：preview-menu 设置面板写同一键——不再双份硬编码）
export const MAX_PIXEL_RATIO_KEY = "ysm_3d_maxPixelRatio";

/** 读取用户设置的渲染分辨率上限（设置面板 slider 持久化）；缺省 1.5。
 *  clamp 到滑块范围 [0.5, 2]（code review P3：陈旧/手改 localStorage 值
 *  （"0.01"/"100"）不产生离谱像素比——与设置面板显示/控件一致）。 */
export function getMaxPixelRatio(): number {
  const v = safeGet(MAX_PIXEL_RATIO_KEY);
  if (v === null) return PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(2, Math.max(0.5, n)) : PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
}

export const PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;

// ===== 帧率上限开关 =====
// 用户可在 3D 预览器 ⚙️ 设置弹窗调（30/60/120/无限制）。
// 仅控制 3D 渲染器的 rAF 循环节流，不影响弹窗 UI 响应（DOM 事件驱动）。
export const MAX_FPS_DEFAULT = 60;
export const MAX_FPS_KEY = "ysm_3d_maxFps";
const FPS_UNCAPPED = 0; // 0 = 不限制（rAF 原生 ~60fps 或显示器刷新率）

/** 读取用户设置的帧率上限；缺省 60。返回 fps 数值（0 = 不限制）。 */
// code review P3：getMaxFps 模块级缓存——rAF 热路径每帧调用（60-144fps 下每秒
// 60-144 次同步 localStorage 读）——设置变更时由 preview-menu 调 invalidateMaxFpsCache
let _maxFpsCache: number | null = null;
export function invalidateMaxFpsCache(): void {
  _maxFpsCache = null;
}
export function getMaxFps(): number {
  if (_maxFpsCache !== null) return _maxFpsCache;
  const v = safeGet(MAX_FPS_KEY);
  if (v === null) return MAX_FPS_DEFAULT;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return MAX_FPS_DEFAULT;
  _maxFpsCache = n;
  return n;
}

/** 当前帧间隔（ms）：fps=0（不限制）→ 极小间隔（rAF 每帧都渲染）。 */
export function getFrameIntervalMs(): number {
  const fps = getMaxFps();
  return fps === FPS_UNCAPPED ? 0 : 1000 / fps;
}
const ADAPTIVE_SAMPLE_FRAMES = 30;
const SLOW_FRAME_MS = 22;
const MIN_PIXEL_RATIO = 0.75;

export interface AdaptiveRenderBudget {
  pixelRatio: number;
  sampleStart: number;
  sampleFrames: number;
}

export function previewPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, getMaxPixelRatio());
}

export function createAdaptiveRenderBudget(
  pixelRatio: number,
  now: number,
): AdaptiveRenderBudget {
  return { pixelRatio, sampleStart: now, sampleFrames: 0 };
}

/** Returns a new pixel ratio only when sustained frame delivery is too slow.
 *  capIntervalMs = 用户帧率上限的帧间隔（FPS cap——code review P2：30fps 时
 *  帧间隔 ~33ms > SLOW_FRAME_MS(22ms)，采样器会把用户强制节流误判为慢机器而
 *  降级到 0.75 地板——阈值为 max(SLOW_FRAME_MS, capInterval) 不降级）。 */
export function sampleAdaptivePixelRatio(
  budget: AdaptiveRenderBudget,
  now: number,
  capIntervalMs = 0,
): number | null {
  budget.sampleFrames++;
  if (budget.sampleFrames < ADAPTIVE_SAMPLE_FRAMES) return null;
  const averageFrameMs = (now - budget.sampleStart) / budget.sampleFrames;
  budget.sampleStart = now;
  budget.sampleFrames = 0;
  const threshold = Math.max(SLOW_FRAME_MS, capIntervalMs || 0);
  if (averageFrameMs <= threshold || budget.pixelRatio <= MIN_PIXEL_RATIO) return null;
  budget.pixelRatio = Math.max(MIN_PIXEL_RATIO, budget.pixelRatio - 0.25);
  return budget.pixelRatio;
}

export function shouldRenderPreviewFrame(
  now: number,
  nextFrame: number,
  hidden: boolean,
): boolean {
  if (hidden) return false;
  return now >= nextFrame - 0.5;
}

/** 帧率上限节流版：now 已到/过 nextFrame 才渲染。
 *  interval=0（不限）→ 恒 true（rAF 每帧都渲染）。 */
export function shouldRenderAtFps(
  now: number,
  nextFrame: number,
  interval: number,
  hidden: boolean,
): boolean {
  if (hidden) return false;
  if (interval <= 0) return true;
  return now >= nextFrame - 0.5;
}
