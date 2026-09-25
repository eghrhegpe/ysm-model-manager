// ===== VRM 侧 VMD 足 IK 驱动（ADR-243 §2.8 方案 A）=====
// VMD 的腿部动作主要活在 `左足ＩＫ`/`右足ＩＫ` 的 **position** 通道上，由 MMD 运行时的
// CCDIK 解算成 FK；而重定向用的 `buildAnimation` 是纯关键帧搬运、不解 IK（VRM 侧也没有
// 官方解算器）。本模块补上这一段：把 VMD 的足目标喂给仓库既有的 CCD 求解器。
//
// ── 目标世界位置的一步推导（结论比直觉干净）──
// VMD 的骨骼 position 是「相对 bind pose 的偏移」——格式规范原文：
//   "the position coordinates are relative to the bind pose, or the model's default pose"
// 源模型里：
//   足世界   = 足bind   + ikOffset
//   骨盆世界 = 骨盆bind + centerOffset           （センター 的偏移）
//   ⇒ 足 − 骨盆 = (足bind − 骨盆bind) + (ikOffset − centerOffset)
//
// VRM 侧 `hips` 的归一化 position 轨道已承载 `centerOffset × k`（由重定向器写入），即
//   骨盆世界 = 骨盆bind + centerOffset × k
// 展开后 `centerOffset` 项**相消**：
//
//   目标世界 = 足静止世界 + ikOffset × k        ← 本模块唯一公式
//
// 也就是说：**不需要读 センター 轨道**，只需「VRM 足骨的静止世界位置」这一个常量 +
// 采样器给出的偏移（采样值已含轴系翻转与 k）。全身位移由 hips 轨道承载、足被 IK 钉在
// 世界系——这正是 MMD「IK 目标绝对、身体走动」的语义。
//
// ── 写哪根骨：原始骨，且在 `vrm.update()` **之后** ──
// `VRMHumanoidRig.update()` 每帧把归一化骨的位姿**单向烘回**原始骨，故 IK 结果写在原始骨
// 上必须晚于它（写在归一化骨则须早于它，还要额外刷世界矩阵）。本模块因此与既有
// `mmd-foot-ik.ts` 同层同时机，并以 `animActive` 互斥：待机走锚地、动画走 VMD 目标。
//
// 纯逻辑（THREE + bone-tools + leg-chain + ik-solver），零 DOM / 零 backend：可单测。

import * as THREE from "three";
import type { BoneTree } from "./bone-tools.ts";
import { type IKConfig, solveIK } from "./ik-solver.ts";
import { extractLegChains } from "./leg-chain.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";

/**
 * 单侧足目标采样面（结构上等价于 `vmd-retarget.ts` 的 `VmdFootIKTarget`）。
 *
 * 刻意在此**重述**而非 import adapters 侧的类型：`bone/` 是更低层的工具层，
 * 反向依赖 `adapters/` 会把层级倒过来（check-layering 的 R0-R6 虽只管
 * views/features/services/utils/core，但方向本身就是错的）。结构类型让两者天然兼容。
 */
export interface FootIKSampler {
  sample(timeSeconds: number, out: THREE.Vector3): boolean;
  /**
   * ADR-309 D4（锐评 P4）：IK 开关时间轴查询（源自 MMD propertyKeyFrames.ikStates）。
   * 返回 false = 该时刻 MMD 侧该骨 IK 关闭，CCD 求解应跳过该侧（足回到 FK 自然位）。
   * 缺省 undefined = 全程启用（`.vrma` 与无 ikStates 数据的旧 VMD 零影响）。
   */
  isEnabled?: (t: number) => boolean;
}

/** 双侧足目标（null = 该侧无 IK 数据） */
export interface FootIKSamplers {
  readonly left: FootIKSampler | null;
  readonly right: FootIKSampler | null;
}

/** 足 IK 控制器（每帧驱动；`targets` 为 null 时全程静默、不干预骨架） */
export interface VrmFootIKController {
  /**
   * @param timeSeconds 当前动作时间（与重定向 clip 同一时间轴，通常传 `action.time`）
   * @param targets VMD 足 IK 目标（null = 当前动作无 IK 数据 → 不干预）
   */
  apply(timeSeconds: number, targets: FootIKSamplers | null): void;
  /** 释放资源（幂等；此后 apply 静默） */
  dispose(): void;
}

/** 无腿链 / 无绑定时的一次性空实现（避免调用方判空） */
const NOOP_CONTROLLER: VrmFootIKController = { apply: () => {}, dispose: () => {} };

/**
 * 求解参数：沿用 `mmd-foot-ik.ts` 待机锚地那一组保守值（4 轮 × damping 0.6 ⇒ 约 97% 收敛，
 * 膝部钳制 ±π/3）。v1 刻意不分叉——ADR-243 §2.8 已把「膝/肘单向钳制」列为待实机校准项，
 * 先让两条腿走同一组参数，等肉眼校出问题再按需分叉，免得多一份未经实证的魔数。
 */
const IK_CONFIG: IKConfig = {
  iterations: 4,
  tolerance: 0.005,
  damping: 0.6,
  minAngle: -Math.PI / 3,
  maxAngle: Math.PI / 3,
};

/**
 * 脚尖链求解参数（ADR-243 P1b：つま先ＩＫ）。两节链 `[踝, 脚尖]` 只有一个自由关节，
 * 角度空间小：钳制收紧到 ±π/6 防 CCD 单步把脚尖甩翻（比腿链保守）；`j >= 1` 遍历
 * 约束下链根（踝）锚定，旋转全部落在脚尖关节——正是 MMD つま先ＩＫ 的语义
 * （足跟着地、以踝为轴翘脚尖）。
 */
const TOE_IK_CONFIG: IKConfig = {
  iterations: 4,
  tolerance: 0.005,
  damping: 0.6,
  minAngle: -Math.PI / 6,
  maxAngle: Math.PI / 6,
};

interface Leg {
  side: "left" | "right";
  chain: THREE.Object3D[];
  /** 足骨在**静止位姿**下的世界位置（创建期快照；见文件头公式） */
  restWorld: THREE.Vector3;
  /** 脚尖链 `[踝, 脚尖]`（模型无 toes 语义骨时为 null；链根踝 = 锚点不旋转） */
  toeChain: THREE.Object3D[] | null;
  /** 脚尖骨在**静止位姿**下的世界位置（创建期快照，与 restWorld 同纪律） */
  toeRestWorld: THREE.Vector3 | null;
}

/**
 * 创建足 IK 控制器。
 *
 * ⚠️ 静止世界位置取**创建期快照**，不每帧现读：创建期 = 模型刚加载、动作还没跑过第一帧
 * ⇒ 读到的就是 rest；而每帧现读会拿到「上一帧已被动画覆盖的位姿」，目标被自己的结果
 * 拖走 ⇒ 足部自反馈漂移。前提是模型在场景中不被移动（VRM 预览成立）。
 */
export function createVrmFootIKController(
  boneTree: BoneTree | null,
  semanticBones: SemanticBoneMap | undefined,
): VrmFootIKController {
  const legs: Leg[] = [];
  for (const leg of extractLegChains(boneTree, semanticBones)) {
    const restWorld = new THREE.Vector3();
    leg.endEffector.getWorldPosition(restWorld);
    // 脚尖链：踝 → toes 语义骨（模型缺 toes / 父子关系不符 → null，v1 行为不变）。
    // solveIK 遍历 j>=1 跳过链根 ⇒ 链根取踝，旋转全部落在脚尖关节（踝锚定）。
    const toesEntry = semanticBones?.[leg.side === "left" ? "leftToes" : "rightToes"];
    let toeChain: THREE.Object3D[] | null = null;
    let toeRestWorld: THREE.Vector3 | null = null;
    if (toesEntry?.object) {
      const toesNode = boneTree?.byId.get(toesEntry.id);
      // 防乱挂：toes 的 parent 必须就是踝（MMD/VRM 通例），否则跳过不猜
      const ankleNode = boneTree?.byId.get(leg.endEffectorId ?? "");
      if (toesNode?.object && ankleNode && toesNode.parentId === ankleNode.id) {
        toeChain = [leg.endEffector, toesNode.object];
        toeRestWorld = new THREE.Vector3();
        toesNode.object.getWorldPosition(toeRestWorld);
      }
    }
    legs.push({
      side: leg.side,
      chain: leg.chain,
      restWorld,
      // Leg 契约要求 toeChain/toeRestWorld 必在（可为 null）——缺脚趾链的腿填 null，
      // 不用条件 spread（产物类型变 optional 字段，赋给 Leg 报类型错）
      toeChain,
      toeRestWorld,
    });
  }
  if (legs.length === 0) return NOOP_CONTROLLER;

  // 每帧零分配（与 ik-solver 的 scratch 纪律一致）
  const offset = new THREE.Vector3();
  const target = new THREE.Vector3();

  return {
    apply(timeSeconds: number, targets: FootIKSamplers | null): void {
      if (!targets) return;
      for (const leg of legs) {
        const sampler = targets[leg.side];
        if (!sampler) continue;
        // ADR-309 D4（锐评 P4）：IK 开关时间轴——MMD 侧该骨 IK 关闭的段落，
        // CCD 跳过该侧（足回到 FK 自然位，与 MMD 关 IK 时表现一致）
        if (sampler.isEnabled && !sampler.isEnabled(timeSeconds)) continue;
        if (!sampler.sample(timeSeconds, offset)) continue;
        target.copy(leg.restWorld).add(offset);
        solveIK(leg.chain, target, IK_CONFIG);
        // 脚尖链：目标 = 脚尖静止世界 + 同一偏移（つま先ＩＫ 与 足ＩＫ 共享同一 IK 目标，
        // MMD 源模型里 つま先ＩＫ 也是足ＩＫ 的子关节，位移源一致）
        if (leg.toeChain && leg.toeRestWorld) {
          target.copy(leg.toeRestWorld).add(offset);
          solveIK(leg.toeChain, target, TOE_IK_CONFIG);
        }
      }
    },
    dispose(): void {
      legs.length = 0;
    },
  };
}
