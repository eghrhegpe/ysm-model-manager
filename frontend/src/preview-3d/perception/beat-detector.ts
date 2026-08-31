// ===== 感知层：节拍检测（BeatDetector）=====
// 能量峰值法检测节拍：低频能量 > 滑动均值 × threshold 且距上次 beat > minInterval → 触发。
// 设计原则：
//   - 纯算法，不依赖 Web Audio API（振幅由消费方注入）；
//   - 支持 BPM 量化（吸附到常见值 80/90/.../180）；
//   - onBeat 回调 + getPhase() 节拍相位（0..1）。
//
// 消费方接入示例（Web Audio API）：
//   const detector = createBeatDetector();
//   const analyser = ctx.createAnalyser();
//   // 每帧：
//   const dataArray = new Uint8Array(analyser.frequencyBinCount);
//   analyser.getByteFrequencyData(dataArray);
//   const bassEnergy = dataArray.slice(0, 10).reduce((s, v) => s + v, 0) / 10 / 255;
//   detector.update(bassEnergy, dt);
//   if (detector.isBeat()) { /* 踩点 */ }
//   const phase = detector.getPhase(); // 0..1  Within beat
//
// 消费方接入示例（无音频，手动驱动）：
//   const detector = createBeatDetector({ bpm: 120 });
//   // 每帧按固定 BPM 产生虚拟节拍
//   detector.update(0.5, dt); // 固定振幅 0.5

import { clamp01 } from "../../utils/core/clamp.ts";

/** 节拍检测配置 */
export interface BeatDetectorOptions {
  /** 节拍能量阈值倍数（能量 > 均值 × threshold 触发），默认 1.3 */
  threshold?: number;
  /** 最小节拍间隔（毫秒），默认 250 */
  minIntervalMs?: number;
  /** 能量历史窗口大小（帧数），默认 43（≈1s @ 43fps） */
  historySize?: number;
  /** BPM 量化容差（±N BPM 内吸附到常见值），默认 5 */
  quantizeTolerance?: number;
  /** 是否启用 BPM 量化，默认 true */
  quantizeEnabled?: boolean;
  /** 初始 BPM（无检测数据时的 fallback），默认 120 */
  initialBpm?: number;
}

/** 常见 BPM 值（用于量化吸附） */
const COMMON_BPMS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];

interface BeatState {
  /** 能量历史窗口 */
  energyHistory: number[];
  /** 能量窗口总和（滑动均值计算用） */
  energySum: number;
  /** 上次节拍时间（performance.now ms） */
  lastBeatTime: number;
  /** 节拍时间戳数组（最近若干次，用于 BPM 计算） */
  beatTimes: number[];
  /** 当前检测 BPM */
  bpm: number;
  /** 当前节拍相位（0..1，从上次节拍开始计时） */
  phase: number;
  /** 当前帧是否踩点 */
  isBeat: boolean;
  /** 当前帧能量（归一化 0..1） */
  currentEnergy: number;
}

/**
 * 构建节拍 detector。
 * 每次 build 调用一次。
 */
export function createBeatDetector(opts: BeatDetectorOptions = {}) {
  const threshold = opts.threshold ?? 1.3;
  const minIntervalMs = opts.minIntervalMs ?? 250;
  const historySize = opts.historySize ?? 43;
  const quantizeTolerance = opts.quantizeTolerance ?? 5;
  const quantizeEnabled = opts.quantizeEnabled ?? true;
  const initialBpm = opts.initialBpm ?? 120;

  const state: BeatState = {
    energyHistory: [],
    energySum: 0,
    lastBeatTime: performance.now(),
    beatTimes: [],
    bpm: initialBpm,
    phase: 0,
    isBeat: false,
    currentEnergy: 0,
  };

  /** 踩踏点回调列表 */
  const onBeatCallbacks: Array<() => void> = [];

  /**
   * 注册节拍回调（踩点时触发）。
   */
  function onBeat(cb: () => void): void {
    onBeatCallbacks.push(cb);
  }

  /**
   * 注销节拍回调。
   */
  function offBeat(cb: () => void): void {
    const idx = onBeatCallbacks.indexOf(cb);
    if (idx >= 0) onBeatCallbacks.splice(idx, 1);
  }

  /**
   * 每帧调用，注入归一化能量值（0..1）。
   * @param energy 当前帧低频能量（已归一化 0..1）
   * @param dt     帧间隔（秒）
   */
  function update(energy: number, dt: number): void {
    const normalized = clamp01(energy);
    state.currentEnergy = normalized;

    // 滑动窗口更新
    state.energyHistory.push(normalized);
    state.energySum += normalized;
    if (state.energyHistory.length > historySize) {
      state.energySum -= state.energyHistory.shift()!;
    }

    // 滑动均值
    const avg = state.energySum / state.energyHistory.length;

    // 节拍检测：能量 > 均值 × threshold 且距上次节拍 > minInterval
    const now = performance.now();
    const timeSinceLastBeat = now - state.lastBeatTime;
    const isEnergyPeak = avg > 0 && normalized > avg * threshold;

    if (isEnergyPeak && timeSinceLastBeat >= minIntervalMs) {
      // 触发节拍
      state.isBeat = true;
      state.lastBeatTime = now;
      state.beatTimes.push(now);
      // 保留最近 16 次节拍用于 BPM 计算
      if (state.beatTimes.length > 16) state.beatTimes.shift();
      // 计算 BPM
      if (state.beatTimes.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < state.beatTimes.length; i++) {
          intervals.push(state.beatTimes[i] - state.beatTimes[i - 1]);
        }
        const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const rawBpm = avgIntervalMs > 0 ? 60000 / avgIntervalMs : initialBpm;
        // BPM 量化
        if (quantizeEnabled) {
          state.bpm = quantizeBpm(rawBpm, quantizeTolerance);
        } else {
          state.bpm = rawBpm;
        }
      }
      // 触发回调
      for (const cb of onBeatCallbacks) {
        try {
          cb();
        } catch {
          /* 回调抛错不阻断检测 */
        }
      }
    } else {
      state.isBeat = false;
    }

    // 更新相位（0..1，从上次节拍开始）
    state.phase = Math.min(1, (now - state.lastBeatTime) / (60000 / state.bpm));
  }

  /**
   * 重置状态（切换音频源或模型时调用）。
   */
  function reset(): void {
    state.energyHistory = [];
    state.energySum = 0;
    state.lastBeatTime = performance.now();
    state.beatTimes = [];
    state.bpm = initialBpm;
    state.phase = 0;
    state.isBeat = false;
    state.currentEnergy = 0;
  }

  /**
   * 销毁（不再使用时调用）。
   */
  function dispose(): void {
    onBeatCallbacks.length = 0;
    reset();
  }

  return { update, onBeat, offBeat, reset, dispose, getPhase: () => state.phase, isBeat: () => state.isBeat };
}

/** BPM 量化：偏差 ±tolerance 内吸附到常见值 */
function quantizeBpm(raw: number, tolerance: number): number {
  if (raw <= 0) return 120;
  for (const bpm of COMMON_BPMS) {
    if (Math.abs(raw - bpm) <= tolerance) return bpm;
  }
  return raw;
}
