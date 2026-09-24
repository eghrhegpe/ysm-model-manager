import { safeGet } from "@/utils/base/primitives/storage.ts";
import type { GpuLoadSample } from "./gpu-load.ts";
import { resolveGpuLoadLimits } from "./gpu-load-calibrate.ts";
import { TD_PIXEL_RATIO } from "./settings-schema.ts";

const PREVIEW_MAX_PIXEL_RATIO_DEFAULT = TD_PIXEL_RATIO.default;
// 存储键单一事实来源（ADR-303：规格归 settings-schema；此处保留原导出名供
// preview-state / 测试复用——派生值而非第二份字面量）
export const MAX_PIXEL_RATIO_KEY = TD_PIXEL_RATIO.key;

/** 读取用户设置的渲染分辨率上限（设置面板 slider 持久化）；缺省见 TD_PIXEL_RATIO.default。
 *  clamp 到控件值域 [min, max]（陈旧/手改 localStorage 值（"0.01"/"100"）不产生
 *  离谱像素比——与设置面板显示/控件同源，规格见 ADR-303）。 */
export function getMaxPixelRatio(): number {
  const v = safeGet(MAX_PIXEL_RATIO_KEY);
  if (v === null) return PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
  const n = Number(v);
  return Number.isFinite(n) && n > 0
    ? Math.min(TD_PIXEL_RATIO.max, Math.max(TD_PIXEL_RATIO.min, n))
    : PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
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

export function createAdaptiveRenderBudget(pixelRatio: number, now: number): AdaptiveRenderBudget {
  return { pixelRatio, sampleStart: now, sampleFrames: 0 };
}

/** GPU 饱和软线 = 拦截硬顶的 50%。两者用途不同：
 *  - 硬顶（gpu-load|DEFAULT_GPU_LOAD_LIMITS）= 「再加就要炸了」→ 拦追加/拦加载；
 *  - 软线（本处）= 「GPU 已在高位，该降质了」→ 预防性降像素比。
 *  复用同一常量派生而非另拍数值，避免两套阈值各自漂移。 */
const GPU_SATURATION_RATIO = 0.5;

/** GPU 是否处于高位（draw calls / 三角面 超软线）。
 *
 *  ⚠️ 语义边界（勿误读）：降像素比只减**填充率**压力，**不减少** draw calls 与
 *  三角面本身。故这里是**预防性**降质——GPU 已在高位时提前减轻片元阶段负担，
 *  避免队列进一步堆积成可感卡顿；它**不是**对已发生卡顿的根治，也不该被当成
 *  「降分辨率能治 draw call 过多」的证据。真治 draw call 靠 gpu-budget 拦追加。
 *
 *  软线取 `resolveGpuLoadLimits()`（跟随真机标定）而非写死默认常量——否则低端机
 *  标定放宽硬顶到 5000 后，软线仍停在 800：4000 draw calls 的场景会被**持续反压到
 *  0.75 地板**而硬顶一路放行，形成隐性双源（审查 P3-4）。读取频率 = 每
 *  ADAPTIVE_SAMPLE_FRAMES 帧一次（非每帧），localStorage 读开销可接受。 */
function isGpuSaturated(gpu: Pick<GpuLoadSample, "drawCalls" | "triangles">): boolean {
  const limits = resolveGpuLoadLimits();
  return (
    gpu.drawCalls > limits.drawCalls * GPU_SATURATION_RATIO ||
    gpu.triangles > limits.triangles * GPU_SATURATION_RATIO
  );
}

/** Returns a new pixel ratio only when sustained frame delivery is too slow.
 *  capIntervalMs = 用户帧率上限的帧间隔（FPS cap——code review P2：30fps 时
 *  帧间隔 ~33ms > SLOW_FRAME_MS(22ms)，采样器会把用户强制节流误判为慢机器而
 *  降级到 0.75 地板——阈值为 max(SLOW_FRAME_MS, capInterval) 不降级）。
 *
 *  gpu = GPU 负载采样（可选，2026 锐评 P2）：CPU 帧时是「提交速度」代理指标，
 *  GPU 已排队时主线程仍可能 16ms 完成提交——单看帧时会漏掉 GPU 饱和。
 *  传入后 GPU 高位即使帧时正常也降一档（预防性，见 isGpuSaturated 语义边界）。 */
export function sampleAdaptivePixelRatio(
  budget: AdaptiveRenderBudget,
  now: number,
  capIntervalMs = 0,
  gpu?: Pick<GpuLoadSample, "drawCalls" | "triangles">,
): number | null {
  budget.sampleFrames++;
  if (budget.sampleFrames < ADAPTIVE_SAMPLE_FRAMES) return null;
  const averageFrameMs = (now - budget.sampleStart) / budget.sampleFrames;
  budget.sampleStart = now;
  budget.sampleFrames = 0;
  const threshold = Math.max(SLOW_FRAME_MS, capIntervalMs || 0);
  const slowFrame = averageFrameMs > threshold;
  const gpuHigh = gpu !== undefined && isGpuSaturated(gpu);
  if ((!slowFrame && !gpuHigh) || budget.pixelRatio <= MIN_PIXEL_RATIO) return null;
  budget.pixelRatio = Math.max(MIN_PIXEL_RATIO, budget.pixelRatio - 0.25);
  return budget.pixelRatio;
}

export function shouldRenderPreviewFrame(now: number, nextFrame: number, hidden: boolean): boolean {
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
