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
/** 回升滞回：连续多少个「健康采样窗口」（每窗 30 帧 ≈ 1.5s）才回升一档。
 *  防抖语义与降档的「单窗口立即降」互补：降档要快（护帧率），回升要慢（防边缘抖动）。
 *  0.75 → 1.5 全程回升需 (1.5-0.75)/0.25 × 3 ≈ 9 个窗口 ≈ 4.5s 稳定健康。 */
const RECOVER_WINDOWS = 3;

export interface AdaptiveRenderBudget {
  pixelRatio: number;
  /** 创建时的初始像素比（= previewPixelRatio(devicePixelRatio)）——回升上限。
   *  降档可到底板 MIN_PIXEL_RATIO；回升**不可越过初值**（不升超用户 DPR 上限）。 */
  initialPixelRatio: number;
  sampleStart: number;
  sampleFrames: number;
  /** 连续健康采样窗口计数（跌破即复位 0）——回升滞回的判据状态（锐评 2026-10-11 P1）。 */
  healthyWindows: number;
}

export function previewPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, getMaxPixelRatio());
}

export function createAdaptiveRenderBudget(pixelRatio: number, now: number): AdaptiveRenderBudget {
  return {
    pixelRatio,
    initialPixelRatio: pixelRatio,
    sampleStart: now,
    sampleFrames: 0,
    healthyWindows: 0,
  };
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
 *  gpu = GPU 负载采样函数（可选，2026 锐评 P2 / 2026-10-11 惰性化）：GPU 已排队时
 *  主线程仍可能 16ms 完成提交——单看帧时会漏掉 GPU 饱和。传入后 GPU 高位即使帧时
 *  正常也降一档（预防性，见 isGpuSaturated 语义边界）。
 *  ⚠️ 惰性化（锐评 2026-10-11 P1）：gpu 由「每帧构造对象」改为「仅窗口结算帧调用
 *  的采样函数」——ADAPTIVE_SAMPLE_FRAMES(30) 帧里只有 1 帧消费采样结果，其余 29 帧
 *  构造对象是白造的。调用方传同一函数引用（render-host 实例字段），rAF 热路径零分配。
 *
 *  回升（锐评 2026-10-11 P1 新增）：降档是单向不可逆的旧行为——GPU 压力消失后
 *  像素比永不回升，用户「越看越糊且不可感知」。现为双向：窗口结算时健康（不慢帧
 *  且 GPU 不饱和）累计 healthyWindows，连续 RECOVER_WINDOWS 个窗口才 +0.25 回升一档，
 *  上限 initialPixelRatio（创建时初值）；慢帧/GPU 高位任一命中即复位计数并降档。
 *  回升慢、降档快 = 滞回设计，防边缘抖动乒乓。 */
export function sampleAdaptivePixelRatio(
  budget: AdaptiveRenderBudget,
  now: number,
  capIntervalMs = 0,
  gpu?: () => Pick<GpuLoadSample, "drawCalls" | "triangles"> | undefined,
): number | null {
  budget.sampleFrames++;
  if (budget.sampleFrames < ADAPTIVE_SAMPLE_FRAMES) return null;
  const averageFrameMs = (now - budget.sampleStart) / budget.sampleFrames;
  budget.sampleStart = now;
  budget.sampleFrames = 0;
  const threshold = Math.max(SLOW_FRAME_MS, capIntervalMs || 0);
  const slowFrame = averageFrameMs > threshold;
  // 惰性：仅窗口结算帧才调用采样函数（其余帧零调用零分配）
  const gpuSample = gpu?.();
  const gpuHigh = gpuSample !== undefined && isGpuSaturated(gpuSample);
  const degraded = slowFrame || gpuHigh;
  if (degraded) {
    // 降档分支（原行为）：复位回升计数——健康连续性被打破
    budget.healthyWindows = 0;
    if (budget.pixelRatio <= MIN_PIXEL_RATIO) return null;
    budget.pixelRatio = Math.max(MIN_PIXEL_RATIO, budget.pixelRatio - 0.25);
    return budget.pixelRatio;
  }
  // 健康窗口：累计；连续满档且未回满初值才回升一档（滞回防抖）
  budget.healthyWindows++;
  if (budget.healthyWindows >= RECOVER_WINDOWS && budget.pixelRatio < budget.initialPixelRatio) {
    budget.healthyWindows = 0;
    budget.pixelRatio = Math.min(budget.initialPixelRatio, budget.pixelRatio + 0.25);
    return budget.pixelRatio;
  }
  return null;
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
