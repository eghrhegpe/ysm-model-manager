// ===== 感知层：AutoDance 简化版（程序化生命力 L3）=====
// 按 BPM 节拍驱动骨骼律动，不生成 VMD，直接改 Three.js 骨骼变换。
// 简化设计（相比 MikuMikuAR 完整版）：
//   - 单正弦源驱动（无 beatBounce 脉冲、无 downbeatWeight 层次）
//   - 躯干左右摇摆 + 肩膀上下 + 手臂挥舞
//   - 4 拍呼吸幅度调制（避免机械重复感）
//
// 消费方接入：
//   const autoDance = createAutoDanceController({ bpm: 120, intensity: 0.5 });
//   // in update(dt, semanticBones):
//   autoDance.apply(dt, semanticBones);

import * as THREE from "three";
import { getSemanticBone, type SemanticBoneMap, type SemanticBoneId } from "../semantic-bones.ts";
import { createBeatDetector } from "./beat-detector.ts";

/** 节拍 detector 接口（抽象，解耦具体实现） */
export interface BeatDetectorLike {
  /** 当前节拍相位（0..1） */
  getPhase(): number;
  /** 当前帧是否踩点 */
  isBeat(): boolean;
}

/** AutoDance 配置 */
export interface AutoDanceOptions {
  /** 节拍 BPM（默认 120，有 beatDetector 时忽略） */
  bpm?: number;
  /** 整体强度（0..1，默认 0.5） */
  intensity?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 外部节拍 detector（可选，提供后使用其相位代替内部计时） */
  beatDetector?: BeatDetectorLike;
}

/** 默认参数 */
const DEFAULT_BPM = 120;
const DEFAULT_INTENSITY = 0.5;

/** 每帧 AutoDance 状态 */
interface DanceState {
  /** 累计时间（秒） */
  t: number;
  /** resting rotations（骨骼初始四元数快照） */
  rests: Map<string, { rot: THREE.Quaternion; pos: THREE.Vector3 }>;
}

/** 驱动的语义骨骼及振幅系数 */
const DANCE_BONES: Array<{ id: SemanticBoneId; xAmp: number; yAmp: number; zAmp: number; rxAmp: number; ryAmp: number; rzAmp: number }> = [
  // 臀部/重心：左右摇摆（X 平移）+ 轻微扭转（Y 旋转）
  { id: "hips", xAmp: 0.03, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0.08, rzAmp: 0 },
  // 脊柱：跟随 hips 微动
  { id: "spine", xAmp: 0.015, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0.04, rzAmp: 0 },
  // 胸部：前后微动 + 侧倾
  { id: "chest", xAmp: 0, yAmp: 0, zAmp: 0.01, rxAmp: 0.03, ryAmp: 0, rzAmp: 0.02 },
  { id: "upperChest", xAmp: 0, yAmp: 0, zAmp: 0.008, rxAmp: 0.02, ryAmp: 0, rzAmp: 0.015 },
  // 肩膀：上下摆动
  { id: "leftShoulder", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0, rzAmp: 0.06 },
  { id: "rightShoulder", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0, rzAmp: -0.06 },
  // 上臂：左右挥舞（交替）
  { id: "leftUpperArm", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0, rzAmp: 0.25 },
  { id: "rightUpperArm", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0, ryAmp: 0, rzAmp: -0.25 },
  // 下臂：随上臂联动（较小幅度）
  { id: "leftLowerArm", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0.1, ryAmp: 0, rzAmp: 0.05 },
  { id: "rightLowerArm", xAmp: 0, yAmp: 0, zAmp: 0, rxAmp: 0.1, ryAmp: 0, rzAmp: -0.05 },
];

/** 左右臂骨骼集合（帧循环半拍错位判定用，避免每帧重复字符串比较） */
const LEFT_ARM_IDS = new Set<SemanticBoneId>(["leftUpperArm", "leftLowerArm", "leftShoulder"]);
const RIGHT_ARM_IDS = new Set<SemanticBoneId>(["rightUpperArm", "rightLowerArm", "rightShoulder"]);

export function createAutoDanceController(opts: AutoDanceOptions = {}) {
  const bpm = opts.bpm ?? DEFAULT_BPM;
  const intensity = opts.intensity ?? DEFAULT_INTENSITY;
  const enabled = opts.enabled ?? true;
  const beatDetector = opts.beatDetector;

  const beatPeriod = 60 / bpm; // 每拍秒数
  const breathPeriod = beatPeriod * 4; // 4 拍呼吸周期

  let state: DanceState | null = null;
  let disposed = false;
  // 内部计时（无外部 detector 时使用）
  let internalTime = 0;

  // 帧内 scratch 对象（闭包级预分配，对齐 R1-P1-1：每帧零分配）。
  // 闭包级而非模块级：多模型同框时各 controller 实例互不污染。
  const _targetRot = new THREE.Quaternion();
  const _offset = new THREE.Quaternion();
  const _euler = new THREE.Euler(0, 0, 0, "XYZ");

  function warmup(map: SemanticBoneMap): void {
    if (state) return;
    const s: DanceState = { t: 0, rests: new Map() };
    for (const { id } of DANCE_BONES) {
      const e = getSemanticBone(map, id);
      if (!e?.object) continue;
      s.rests.set(id, {
        rot: e.object.quaternion.clone(),
        pos: e.object.position.clone(),
      });
    }
    state = s;
  }

  /**
   * 每帧驱动。
   * @param dt 帧间隔（秒）
   * @param map 语义骨骼映射
   */
  function apply(dt: number, map: SemanticBoneMap): void {
    if (disposed || !enabled) return;
    warmup(map);
    if (!state) return;

    // 更新内部计时（无外部 detector 时）
    if (!beatDetector) {
      internalTime += dt;
    }

    // 节拍相位来源：外部 detector 或内部计时
    const beatPhase = beatDetector ? beatDetector.getPhase() : (internalTime / beatPeriod) % 1;
    // 是否踩点（外部 detector 提供）
    const isBeat = beatDetector ? beatDetector.isBeat() : false;

    // 呼吸相位（0..1 循环，4 拍周期）
    const breathPhase = beatDetector
      ? (beatDetector.getPhase() / 4) % 1
      : (internalTime / breathPeriod) % 1;

    // 幅度调制：4 拍呼吸让律动有"起伏感"
    const breathMod = 0.6 + 0.4 * Math.sin(breathPhase * Math.PI * 2);
    // beatBounce 包络：拍头 0 → 拍中峰值 1 → 拍尾 0，制造踩点感
    const bounce = Math.sin(beatPhase * Math.PI);
    const effectiveIntensity = intensity * breathMod * (0.7 + 0.3 * bounce);

    for (const { id, xAmp, yAmp, zAmp, rxAmp, ryAmp, rzAmp } of DANCE_BONES) {
      const entry = getSemanticBone(map, id);
      const snap = state.rests.get(id);
      if (!entry?.object || !snap) continue;

      // 左右臂半拍错位（打破对称）
      const armOffset = LEFT_ARM_IDS.has(id) ? 0 : RIGHT_ARM_IDS.has(id) ? 0.5 : 0;

      // 主律动：正弦摇摆
      const main = Math.sin(beatPhase * Math.PI * 2 + armOffset * Math.PI);
      // 次拍点缀：高频微动
      const micro = Math.sin(beatPhase * Math.PI * 4) * 0.3;
      const combined = (main + micro) * effectiveIntensity;

      // 应用旋转（在 resting 基础上叠加）
      _targetRot.setFromEuler(_euler.set(
        rxAmp ? combined * rxAmp : 0,
        ryAmp ? combined * ryAmp : 0,
        rzAmp ? combined * rzAmp : 0,
        "XYZ",
      ));

      // 平滑 slerp 到目标
      const restQuat = snap.rot;
      // 乘序修正（P2 静默 bug）：quaternion.multiply 右操作数先应用。
      // 原 targetRot.multiply(restQuat) = dance*rest——摇摆作用于父空间轴，
      // 静止姿态非恒等时骨骼局部轴被带偏（实测局部Y混入X分量、夹角差 21°）。
      // 正确 rest*dance：先摇摆（局部轴）再叠静止姿态；restQuat 是 warmup 快照，
      // 不能就地改 → 写入 scratch _offset（slerp 目标参数只读，复用安全）。
      _offset.copy(restQuat).multiply(_targetRot);
      entry.object.quaternion.slerp(_offset, 0.15);

      // 应用平移（仅 hips/spine 有 X 位移）
      if (xAmp || yAmp || zAmp) {
        entry.object.position.set(
          snap.pos.x + combined * xAmp,
          snap.pos.y + combined * yAmp,
          snap.pos.z + combined * zAmp,
        );
      }
    }
  }

  function reset(): void {
    state = null;
    internalTime = 0;
  }

  function dispose(): void {
    disposed = true;
    state = null;
  }

  return { apply, reset, dispose };
}
