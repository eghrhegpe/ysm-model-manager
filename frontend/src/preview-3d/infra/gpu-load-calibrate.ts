// ===== GPU 预算真机标定（2026 锐评 P4：默认值是拍的，需实测反推）=====
// 默认预算（drawCalls 1600 / triangles 100 万 / textures 1024 / textureBytes 256MB）
// 是量级参照估算，gpu-load 注释亦自承「待真机低端设备标定」。本模块补上**实测闭环**：
//
//   采样真机峰值 → × 安全系数 → 建议预算 → 落 localStorage → resolveGpuLoadLimits 生效
//
// 不是「打印一个建议数字就算完」——resolveGpuLoadLimits 会被 guardGpuBudget 消费，
// 标定结果**真的改变拦截行为**，否则这就是个自我感动的 dev 工具。
//
// 用法（dev / 调试，钩子由装配层 app-modules 挂载 —— ADR-214 同款）：
//   await window.ysmCalibrateGpuBudget(15000)  // 采样 15s（期间手动堆叠模型到目标负载）
//   window.ysmResetGpuBudget()                 // 清除标定，回到默认预算
//
// 归属：纯逻辑（tracker / suggest / resolve）在 infra 叶子层；**钩子挂载归装配层**
// （与 debugGetSpec 同规矩：叶子不绑 window，生命周期由 app-modules 管理）。

import type * as THREE from "three";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import {
  DEFAULT_GPU_LOAD_LIMITS,
  type GpuLoadLimits,
  type GpuLoadSample,
  sampleGpuLoad,
} from "./gpu-load.ts";

/** 标定结果落盘键。 */
export const GPU_BUDGET_CALIBRATION_KEY = "ysm_3d_gpuBudgetCalibrated";

/** 安全系数：实测峰值 × 1.5——留 50% 余量给采样期未覆盖的组合。 */
export const CALIBRATION_SAFETY_FACTOR = 1.5;

/** 采样频率：10Hz。峰值捕捉足够，又不会自身干扰被测帧率。 */
const CALIBRATION_SAMPLE_MS = 100;

/** 各维度实测峰值。 */
export interface GpuPeak {
  drawCalls: number;
  triangles: number;
  textures: number;
  textureBytes: number;
}

export interface CalibrationResult {
  /** 实测峰值 */
  peak: GpuPeak;
  /** 建议预算（峰值 × 安全系数） */
  suggested: Required<GpuLoadLimits>;
  /** 采样帧数（判断样本是否充分；过少说明采样窗口没覆盖到负载） */
  samples: number;
}

/**
 * 峰值追踪器（纯状态机，无渲染依赖——喂多少快照就记多少峰值）。
 * 分开成纯函数是为了可单测：真机 hook 只是「rAF/定时器喂它」的薄壳。
 */
export function createCalibrationTracker(): {
  observe: (sample: GpuLoadSample) => void;
  snapshot: () => { peak: GpuPeak; samples: number };
} {
  const peak: GpuPeak = { drawCalls: 0, triangles: 0, textures: 0, textureBytes: 0 };
  let samples = 0;
  return {
    observe(sample) {
      samples++;
      peak.drawCalls = Math.max(peak.drawCalls, sample.drawCalls);
      peak.triangles = Math.max(peak.triangles, sample.triangles);
      peak.textures = Math.max(peak.textures, sample.textures);
      peak.textureBytes = Math.max(peak.textureBytes, sample.textureBytes ?? 0);
    },
    snapshot: () => ({ peak: { ...peak }, samples }),
  };
}

/**
 * 峰值 → 建议预算（× 安全系数，向上取整）。
 * 某维度峰值为 0（未采样到 / 该维度未接入）→ 回落默认预算，不把预算压成 0 误拦一切。
 */
export function suggestGpuLimits(
  peak: GpuPeak,
  safetyFactor = CALIBRATION_SAFETY_FACTOR,
): Required<GpuLoadLimits> {
  const scale = (v: number, fallback: number) => (v > 0 ? Math.ceil(v * safetyFactor) : fallback);
  return {
    drawCalls: scale(peak.drawCalls, DEFAULT_GPU_LOAD_LIMITS.drawCalls),
    triangles: scale(peak.triangles, DEFAULT_GPU_LOAD_LIMITS.triangles),
    textures: scale(peak.textures, DEFAULT_GPU_LOAD_LIMITS.textures),
    textureBytes: scale(peak.textureBytes, DEFAULT_GPU_LOAD_LIMITS.textureBytes),
  };
}

/**
 * 读取**生效**预算：标定值优先，缺省 / 损坏 / 非法字段回落默认。
 * fail-open 与 sampleGpuLoad 同语义——预算是护栏，读坏了宁可用默认也别拦死加载。
 */
export function resolveGpuLoadLimits(): Required<GpuLoadLimits> {
  const raw = safeGet(GPU_BUDGET_CALIBRATION_KEY);
  if (!raw) return DEFAULT_GPU_LOAD_LIMITS;
  let parsed: Partial<GpuLoadLimits>;
  try {
    parsed = JSON.parse(raw) as Partial<GpuLoadLimits>;
  } catch {
    return DEFAULT_GPU_LOAD_LIMITS;
  }
  const pick = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    drawCalls: pick(parsed.drawCalls, DEFAULT_GPU_LOAD_LIMITS.drawCalls),
    triangles: pick(parsed.triangles, DEFAULT_GPU_LOAD_LIMITS.triangles),
    textures: pick(parsed.textures, DEFAULT_GPU_LOAD_LIMITS.textures),
    textureBytes: pick(parsed.textureBytes, DEFAULT_GPU_LOAD_LIMITS.textureBytes),
  };
}

/** 清除标定结果，回到默认预算。 */
export function clearGpuBudgetCalibration(): void {
  safeRemove(GPU_BUDGET_CALIBRATION_KEY);
}

/**
 * 采样 durationMs 并落盘标定结果。
 *
 * @param sample     采样器（注入以便测试；生产传 renderer + textureCache 的组合采样）
 * @param durationMs 采样时长
 * @param deps       时间源 / 等待器（注入以便测试，避免真实 sleep）
 */
export async function runGpuBudgetCalibration(
  sample: () => GpuLoadSample,
  durationMs = 15000,
  deps: { now: () => number; wait: (ms: number) => Promise<void> } = {
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
): Promise<CalibrationResult> {
  const tracker = createCalibrationTracker();
  const start = deps.now();
  // do-while 语义：至少采一次（durationMs 为 0 也拿到一个样本，不至于返回全 0 峰值）
  do {
    tracker.observe(sample());
    await deps.wait(CALIBRATION_SAMPLE_MS);
  } while (deps.now() - start < durationMs);
  const { peak, samples } = tracker.snapshot();
  const suggested = suggestGpuLimits(peak);
  safeSet(GPU_BUDGET_CALIBRATION_KEY, JSON.stringify(suggested));
  return { peak, suggested, samples };
}

/**
 * 安装 dev 标定钩子（`window.ysmCalibrateGpuBudget` / `ysmResetGpuBudget`）。
 *
 * 由**装配层**（`app-modules.ts`，ADR-214 同款 `_devMode` + `isDebugEnabled` 守卫）
 * 在 DEV 时机调用一次；不调用即不暴露。命名不带双下划线前缀——对齐既有
 * `window.debugGetSpec` 先例，且避开红线段 R1（该段禁止把调试状态挂成双下划线全局）。
 * 幂等：重复调用只装一次。
 *
 * @param sample 组合采样器（生产：`makeGpuSampler(() => sceneInfraHost.renderer, ...)`）
 */
export function installGpuCalibrationHook(sample: () => GpuLoadSample): void {
  const w = window as unknown as {
    ysmCalibrateGpuBudget?: (ms?: number) => Promise<CalibrationResult>;
    ysmResetGpuBudget?: () => void;
  };
  if (w.ysmCalibrateGpuBudget) return;
  w.ysmCalibrateGpuBudget = (ms?: number) => runGpuBudgetCalibration(sample, ms);
  w.ysmResetGpuBudget = () => clearGpuBudgetCalibration();
}

/** 组合采样器：从 renderer 读 info + 注入纹理字节（生产 hook 用）。
 *  放在本模块是为了让调用方（mount）只传 renderer，不必自己拼两个模块的依赖。 */
export function makeGpuSampler(
  getRenderer: () => THREE.WebGLRenderer | null,
  getTextureBytes: () => number,
): () => GpuLoadSample {
  return () => {
    const r = getRenderer();
    // renderer 未就绪（self 模式 / 会话间隙）→ 全 0 快照：不污染峰值统计
    if (!r) return { drawCalls: 0, triangles: 0, textures: 0, programs: 0 };
    return sampleGpuLoad(r, getTextureBytes());
  };
}
