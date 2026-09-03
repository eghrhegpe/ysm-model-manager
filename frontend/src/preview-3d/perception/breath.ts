// ===== 感知层：呼吸（程序化生命力 L1）=====
// 语义骨骼驱动：每帧对 chest / spine / shoulders 施加正弦微位移，模拟呼吸起伏。
// 设计原则：
//   - 无全局 state——每次 build 实例化一个 controller，状态封装在闭包里；
//   - 宽容缺省：语义骨骼缺失时静默跳过（某模型没 chest 骨不崩）；
//   - 绝对变换而非累加（每帧基于 restPos + offset 重置，防漂移）。
//
// 消费方示例：
//   const breath = createBreathController();
//   // in adapter build:
//   return {
//     update(dt, semanticBones) { breath.update(dt, semanticBones); /* 其他更新 */ },
//     dispose() { breath.dispose(); },
//   };

import * as THREE from "three";
import { getSemanticBone, type SemanticBoneMap, type SemanticBoneId } from "../semantic-bones.ts";
import { isPerceptionPaused } from "./core.ts";

/** 呼吸驱动的语义骨骼列表（躯干段）：顺序即优先级，先 chest 再 fallback spine/shoulders */
const BREATH_BONES: SemanticBoneId[] = ["chest", "upperChest", "spine", "leftShoulder", "rightShoulder"];

/** 每根骨在呼吸周期中的分量权重（chest 动最多，shoulders 动最少）；未列骨骼默认 0（不驱动） */
const BREATH_WEIGHTS: Partial<Record<SemanticBoneId, number>> = {
  chest: 1.0,
  upperChest: 0.8,
  spine: 0.5,
  leftShoulder: 0.3,
  rightShoulder: 0.3,
};

/** 呼吸周期参数（秒） */
const BREATH_CYCLE_S = 2.5; // 正常呼吸 ~4-6 次/分钟 → 周期 10-15s？不，成人静息 12-20 次/分，即周期 3-5s。用 2.5s 作为轻快待机感。
const BREATH_AMP_Y = 0.004; // Y 轴微移幅度（单位：模型空间，MMD 约 cm；4mm 轻微）
const BREATH_AMP_Z = 0.002; // Z 轴微移（胸腔前后胀缩）
const BREATH_AMP_ROTX = 0.001; // 胸椎微前倾（弧度）

/** 每帧呼吸 controller 状态（private，不在接口暴露） */
interface BreathState {
  /** 骨骼 id → restPos/restRot 快照（仅已命中的骨骼） */
  resting: Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }>;
  /** 当前 cycle 时间（秒），由 update 驱动累加 */
  t: number;
  /** 上一次 update 的 timestamp（用于 dt 归一化） */
  lastTime: number;
}

/** 构建呼吸 controller：每次 build 调用一次，持有闭包 state */
export function createBreathController() {
  let state: BreathState | null = null;

  /** 初始化 resting 快照（仅对有效语义骨骼） */
  function warmup(map: SemanticBoneMap): void {
    if (state) return; // 已初始化
    const s: BreathState = { resting: new Map(), t: 0, lastTime: performance.now() };
    for (const id of BREATH_BONES) {
      const e = getSemanticBone(map, id);
      if (!e?.object) continue;
      s.resting.set(id, {
        pos: e.object.position.clone(),
        rot: e.object.quaternion.clone(),
      });
    }
    state = s;
  }

  /**
   * 每帧驱动（在 adapter update 内调用）。
   * @param dt    帧间隔秒（用于稳定物理，此处仅用于时间推进）
   * @param map   当前预览会话的语义骨骼映射（previewScene.semanticBones）
   */
  function apply(dt: number, map: SemanticBoneMap): void {
    if (isPerceptionPaused()) return; // 动画激活时感知静默（#9 全局暂停标志）
    warmup(map);
    if (!state) return;
    // 推进 cycle 时间
    state.t += dt / BREATH_CYCLE_S;
    if (state.t >= 1) state.t -= 1; // 防止浮点累积

    const phase = state.t * 2 * Math.PI;
    // 呼吸曲线：正弦包络的绝对值让呼气也有力道（避免全负半周死寂）
    const breath = Math.sin(phase);
    const breathe = Math.abs(breath); // 单正弦半波 → 呼+吸对称

    for (const id of BREATH_BONES) {
      const entry = getSemanticBone(map, id);
      const snap = state.resting.get(id);
      if (!entry?.object || !snap) continue;
      const w = BREATH_WEIGHTS[id] ?? 0;
      if (!w) continue;
      // 绝对变换（基于 resting 快照，非累加）
      entry.object.position.set(
        snap.pos.x,
        snap.pos.y + breathe * BREATH_AMP_Y * w,
        snap.pos.z + breathe * BREATH_AMP_Z * w,
      );
      // 胸椎微前倾（吸气时脊柱略前弯）
      entry.object.rotation.x = snap.rot.x + breathe * BREATH_AMP_ROTX * w;
    }
  }

  /** 重置 resting 快照（切换模型时调用） */
  function reset(): void {
    state = null;
  }

  /** 销毁：释放 Three.js 对象引用（position/quaternion 快照），防止模型移除后内存泄漏 */
  function dispose(): void {
    state?.resting.clear();
    state = null;
  }

  return { apply, reset, dispose };
}
