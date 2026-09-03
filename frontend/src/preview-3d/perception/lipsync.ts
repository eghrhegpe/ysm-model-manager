// ===== 感知层：LipSync（程序化生命力 L2）=====
// 音频振幅 → 口型 morph 权重。
// 设计原则：
//   - 振幅来源解耦：通过回调注入，消费方决定用 Web Audio API / 麦克风 / 虚拟源
//   - 宽容缺省：无回调时静默跳过
//   - 线性映射：amplitude ∈ [0,1] → weight ∈ [0, intensity]
//   - 多 morph 支持：open/close/pucker/smile 四音素独立驱动
//
// 消费方接入示例（单 morph）：
//   const lipSync = createLipSyncController();
//   // in update():
//   lipSync.apply(dt, amplitude, (weight) => { mesh.morphTargetInfluences[lipIndex] = weight; });
//
// 消费方接入示例（多 morph）：
//   const lipSync = createLipSyncController({ multiMorph: true });
//   // in update():
//   lipSync.applyMulti(dt, { lipOpen: ampOpen, lipClose: ampClose }, (morphId, weight) => {
//     const idx = morphTargetDictionary[morphId];
//     if (idx !== undefined) mesh.morphTargetInfluences[idx] = weight;
//   });

import { clamp01 } from "../../utils/core/clamp.ts";
import { getSemanticMorph, type SemanticMorphMap, type SemanticMorphId } from "../semantic-morphs.ts";

/** 单 morph 回调：消费方写入具体格式的 morph weight */
export type LipSyncCallback = (weight: number) => void;

/** 多 morph 回调：(morphId, weight) → 消费方写入 */
export type MultiLipSyncCallback = (morphId: SemanticMorphId, weight: number) => void;

/** 每 morph 独立状态 */
interface MorphState {
  prevWeight: number;
}

export interface LipSyncOptions {
  /** 灵敏度阈值：振幅低于此值时输出 0（过滤静音） */
  sensitivity?: number;
  /** 最大张嘴幅度 */
  intensity?: number;
  /** 平滑因子：0=不 smoothing，1=完全滞后（推荐 0.3-0.7） */
  smoothing?: number;
  /** 是否启用多 morph 模式（默认 false） */
  multiMorph?: boolean;
}

/**
 * 构建 LipSync controller。
 * 每次 build 调用一次；dispose 后停止。
 */
export function createLipSyncController(opts: LipSyncOptions = {}) {
  const sensitivity = opts.sensitivity ?? 0.15;
  const intensity = opts.intensity ?? 0.8;
  const smoothing = opts.smoothing ?? 0.5;
  const multiMorph = opts.multiMorph ?? false;

  let disposed = false;

  // 单 morph 状态
  let state: MorphState | null = null;
  // 多 morph 状态（按语义 id 索引）
  const multiStates = new Map<SemanticMorphId, MorphState>();

  /**
   * 单 morph 模式：每帧调用。
   * @param dt        帧间隔（秒，保留接口一致性）
   * @param amplitude 归一化音频振幅（0..1+）
   * @param onLipSync 写入 morph weight 的 callback
   */
  function apply(_dt: number, amplitude: number, onLipSync: LipSyncCallback): void {
    if (disposed || !onLipSync || multiMorph) return;

    const raw = clamp01(amplitude);
    // 灵敏度阈值：低于 threshold 视为静音
    const target = raw > sensitivity ? (raw - sensitivity) / (1 - sensitivity) * intensity : 0;
    // 平滑：指数移动平均
    if (!state) state = { prevWeight: target };
    const weight = state.prevWeight * smoothing + target * (1 - smoothing);
    state.prevWeight = weight;
    onLipSync(weight);
  }

  /**
   * 多 morph 模式：每帧调用，分别驱动 open/close/pucker/smile。
   * @param dt           帧间隔
   * @param amplitudes   各音素振幅（部分提供即可，未提供则保持上一帧）
   * @param onMultiLipSync 写入 morph weight 的回调
   */
  function applyMulti(
    _dt: number,
    amplitudes: Partial<Record<SemanticMorphId, number>>,
    onMultiLipSync: MultiLipSyncCallback,
  ): void {
    if (disposed || !onMultiLipSync || !multiMorph) return;

    for (const id of ["lipOpen", "lipClose", "lipPucker", "lipSmile"] as SemanticMorphId[]) {
      const amp = amplitudes[id];
      if (amp === undefined) continue;

      let s = multiStates.get(id);
      if (!s) {
        s = { prevWeight: 0 };
        multiStates.set(id, s);
      }

      const raw = clamp01(amp);
      const target = raw > sensitivity ? (raw - sensitivity) / (1 - sensitivity) * intensity : 0;
      const weight = s.prevWeight * smoothing + target * (1 - smoothing);
      s.prevWeight = weight;
      onMultiLipSync(id, weight);
    }
  }

  function reset(): void {
    state = null;
    multiStates.clear();
  }

  function dispose(): void {
    disposed = true;
    state = null;
    multiStates.clear();
  }

  return { apply, applyMulti, reset, dispose };
}

/**
 * 从 SemanticMorphMap 提取口型 morph index 映射（供消费方使用）。
 * 返回 { open, close, pucker, smile } 各 morph 在 morphTargetDictionary 中的 index。
 */
export function buildLipMorphIndices(
  semanticMorphs: SemanticMorphMap,
  morphTargetDictionary: Record<string, number | undefined>,
): { open?: number | undefined; close?: number | undefined; pucker?: number | undefined; smile?: number | undefined } {
  const result: { open?: number | undefined; close?: number | undefined; pucker?: number | undefined; smile?: number | undefined } = {};
  const openEntry = getSemanticMorph(semanticMorphs, "lipOpen");
  if (openEntry?.name && morphTargetDictionary[openEntry.name] !== undefined) {
    result.open = morphTargetDictionary[openEntry.name];
  }
  const closeEntry = getSemanticMorph(semanticMorphs, "lipClose");
  if (closeEntry?.name && morphTargetDictionary[closeEntry.name] !== undefined) {
    result.close = morphTargetDictionary[closeEntry.name];
  }
  const puckerEntry = getSemanticMorph(semanticMorphs, "lipPucker");
  if (puckerEntry?.name && morphTargetDictionary[puckerEntry.name] !== undefined) {
    result.pucker = morphTargetDictionary[puckerEntry.name];
  }
  const smileEntry = getSemanticMorph(semanticMorphs, "lipSmile");
  if (smileEntry?.name && morphTargetDictionary[smileEntry.name] !== undefined) {
    result.smile = morphTargetDictionary[smileEntry.name];
  }
  return result;
}
