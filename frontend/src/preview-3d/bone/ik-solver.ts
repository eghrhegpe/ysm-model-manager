// ===== CCD IK 求解器（Cyclic Coordinate Descent）=====
// 纯算法，零 DOM / 零 backend（ADR-072 工具层纯净）。
// 用途：MMD/YSM 等骨骼模型的足部锚地（foot anchoring）、手部定位等——
//   给定骨骼链 + 目标位置，逐关节调整旋转使末端逼近目标。
//
// 算法：CCD（Cyclic Coordinate Descent）
//   - 从末端向根骨骼逐关节旋转，使末端沿该关节的旋转轴朝目标靠拢
//   - 每轮遍历后检查收敛（末端→目标距离 < tolerance）
//   - 支持关节角度约束（minAngle/maxAngle）与极向量（poleTarget 肘/膝朝向）
//   - 极向量独立于 CCD 角度项：末端已对齐（角度≈0）时仍生效——用于末端到位后的肘/膝姿态矫正
//   - 遍历跳过链根（j≥1）：根是链锚点，旋转会带动整链乃至父链漂移（foot-ik 依赖此约定，
//     故腿链只能"向锚地靠拢"而非精确到达，属设计预期）。链根选谁决定几节参与解算：
//     [大腿,膝盖,踝] → 仅膝盖；[骨盆,大腿,膝盖,踝] → 大腿+膝盖（ADR-243 §2.8 采用后者，
//     链根取大腿的直接父骨，见 mmd-foot-ik.ts）
//
// 参考：babylon-mmd 的 ik-solver（ADR-066 提及的 532 行实现）
//   本实现为自写精简版，仅保留 CCD 核心 + 极向量，不依赖 babylon-mmd 运行时。

import * as THREE from "three";

// ---------------------------------------------------------------------------
// 热路径预分配（零分配纪律）
// ---------------------------------------------------------------------------
// solveIK 及其逐关节/极向量 helper（rotateJointTowardTarget / applyCcdRotation /
// solveChainJoint / applyPoleConstraint）在 MMD 足部 IK 空闲态每帧被调用（每腿一次）。
// 为避免每帧重复分配临时对象，复用模块级 scratch。主线程单线程、函数同步且无重入
// （solveIK → solveChainJoint → rotateJointTowardTarget/applyPoleConstraint，
// 后者不回调用前者），故共享缓冲安全。
// 语义与局部 `new` 完全等价：每个缓冲在每次使用前均被覆盖写入，不存在跨调用残留。
const _ikWorldPos = new THREE.Vector3();
const _ikWorldJoint = new THREE.Vector3();
const _ikToEnd = new THREE.Vector3();
const _ikToTarget = new THREE.Vector3();
const _ikAxis = new THREE.Vector3();
const _ikQuat = new THREE.Quaternion();
const _poleJointWorld = new THREE.Vector3();
const _poleNextWorld = new THREE.Vector3();
const _poleChainDir = new THREE.Vector3();
const _poleToPole = new THREE.Vector3();
const _poleAxis = new THREE.Vector3();
const _poleQuat = new THREE.Quaternion();
/** 共线退化回退轴（世界参考）：主选 Y（腿链竖直主导时叉积必退化才走到 X） */
const _ikWorldUp = new THREE.Vector3(0, 1, 0);
const _ikWorldX = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** IK 链：从 root 到 endEffector 的 THREE.Object3D 有序数组（含两端） */
export type IKChain = THREE.Object3D[];

/** IK 求解配置 */
export interface IKConfig {
  /** 最大迭代轮数（默认 8） */
  iterations?: number;
  /** 收敛容差：末端到目标距离 < 此值视为达成（默认 0.001） */
  tolerance?: number;
  /** 单关节旋转最小角（弧度，默认 -π） */
  minAngle?: number;
  /** 单关节旋转最大角（弧度，默认 +π） */
  maxAngle?: number;
  /** 极向量目标：肘/膝朝向约束（world space），null=不启用（默认 null） */
  poleTarget?: THREE.Vector3 | null;
  /** 极向量权重（0=禁用，1=完全约束，默认 0） */
  poleWeight?: number;
  /** 阻尼系数（0-1，靠近 0 收敛慢但平滑，靠近 1 收敛快，默认 1） */
  damping?: number;
}

/** IK 求解结果 */
export interface IKResult {
  /** 末端是否达到目标（distance < tolerance） */
  achieved: boolean;
  /** 末端到目标剩余距离 */
  distance: number;
  /** 实际迭代轮数 */
  iterations: number;
}

// ---------------------------------------------------------------------------
// 核心算法
// ---------------------------------------------------------------------------

/**
 * CCD IK 求解器。
 *
 * @param chain  从 root 到 endEffector 的 Object3D 数组（含两端，≥2 元素）
 * @param target 目标位置（世界坐标）
 * @param config 求解配置
 * @returns IK 求解结果
 *
 * 算法步骤：
 * 1. 对每一轮迭代（最多 iterations 轮）：
 *    a. 从链倒数第二个关节向根遍历（跳过 endEffector 本身和 root——锚点约定，见文件头）
 *    b. 对每个关节：
 *       - 获取关节世界位置、末端世界位置
 *       - 计算关节→末端向量与关节→目标向量
 *       - 极向量约束（若启用）：独立于 CCD 角度项执行，末端已对齐时仍生效（肘/膝姿态矫正）
 *       - 计算使两向量对齐所需的旋转（绕关节的局部 Z 轴）
 *       - 应用旋转（经 minAngle/maxAngle 钳制、damping 衰减）
 *       - 叉积退化（≈180° 共线）→ 确定性回退轴（toEnd×世界Y→世界X）+ 步长封顶 π−0.05，
 *         防「垂直抬脚整关节冻结」与「近共线微小叉积甩反侧」（见 solveIK 内联注释）
 * 2. 检查末端是否收敛（distance < tolerance），是则提前退出
 * 3. 返回结果
 *
 * 实现分层（每层各自具名，主循环零分支）：solveChainJoint（单关节 = 旋转 + 极向量）
 * → rotateJointTowardTarget（算夹角、退化早退）→ applyCcdRotation（轴/钳制/回退轴）。
 */
export function solveIK(chain: IKChain, target: THREE.Vector3, config: IKConfig = {}): IKResult {
  const iters = Math.max(1, Math.floor(config.iterations ?? 8));
  const tol = Math.max(1e-8, config.tolerance ?? 0.001);
  const minAng = config.minAngle ?? -Math.PI;
  const maxAng = config.maxAngle ?? Math.PI;
  const damping = Math.max(0, Math.min(1, config.damping ?? 1));
  const poleWeight = Math.max(0, Math.min(1, config.poleWeight ?? 0));
  const poleTarget = config.poleTarget ?? null;

  if (chain.length < 2) {
    return { achieved: false, distance: 0, iterations: 0 };
  }

  const endEffector = chain[chain.length - 1];
  // 本轮求解的不可变参数（链长派生的极向量下标上界在此定型）
  const step: SolveStep = {
    target,
    minAng,
    maxAng,
    damping,
    poleTarget,
    poleWeight,
    poleJointMax: chain.length - 2,
  };

  for (let i = 0; i < iters; i++) {
    // 从末端向根遍历（跳过 endEffector 本身和根骨骼——根是链锚点，防整链/父链联动漂移）
    for (let j = chain.length - 2; j >= 1; j--) {
      solveChainJoint(chain[j], chain[j + 1], endEffector, step, j);
    }

    // 收敛检查：末端到目标距离
    endEffector.getWorldPosition(_ikWorldPos);
    const dist = _ikWorldPos.distanceTo(target);
    if (dist < tol) {
      return { achieved: true, distance: dist, iterations: i + 1 };
    }
  }

  endEffector.getWorldPosition(_ikWorldPos);
  return { achieved: false, distance: _ikWorldPos.distanceTo(target), iterations: iters };
}

/** 一次求解的不可变参数（逐关节传 7 个标量不如收成一个对象）。 */
interface SolveStep {
  target: THREE.Vector3;
  minAng: number;
  maxAng: number;
  damping: number;
  poleTarget: THREE.Vector3 | null;
  poleWeight: number;
  /** 极向量生效的关节下标上界：仅 `j < chain.length - 2`（末端前一节不参与姿态约束） */
  poleJointMax: number;
}

/** 单关节的一步处理：CCD 旋转 + 极向量约束（顺序即语义，见下）。
 *  返回 false = 关节与末端重合（旧 `continue` 语义：旋转与极向量**均**跳过）。 */
function solveChainJoint(
  joint: THREE.Object3D,
  nextJoint: THREE.Object3D,
  endEffector: THREE.Object3D,
  step: SolveStep,
  j: number,
): boolean {
  if (!rotateJointTowardTarget(joint, endEffector, step)) return false;
  // 极向量约束：在 CCD 旋转后执行（chainDir 为旋转后世界方向），独立于角度项——
  // 末端已对齐（angle≈0）时仍生效，用于末端到位后的肘/膝姿态矫正
  // （applyPoleConstraint 内部有轴退化早退）
  if (step.poleTarget && step.poleWeight > 0 && j < step.poleJointMax) {
    applyPoleConstraint(joint, nextJoint, step.poleTarget, step.poleWeight);
  }
  return true;
}

/** 使「关节→末端」朝「关节→目标」旋转。
 *  返回 false = 关节与末端世界位置重合（toEnd 退化：旋转与极向量均不执行）。 */
function rotateJointTowardTarget(
  joint: THREE.Object3D,
  endEffector: THREE.Object3D,
  step: SolveStep,
): boolean {
  joint.getWorldPosition(_ikWorldJoint);
  endEffector.getWorldPosition(_ikWorldPos);
  const toEnd = _ikToEnd.subVectors(_ikWorldPos, _ikWorldJoint);
  const toTarget = _ikToTarget.subVectors(step.target, _ikWorldJoint);

  // 退化保护：关节与末端重合 → 跳过（旋转与极向量均不执行）
  if (toEnd.lengthSq() < 1e-10) return false;
  toEnd.normalize();
  toTarget.normalize();

  // 计算关节→末端与关节→目标之间的夹角
  const dot = Math.max(-1, Math.min(1, toEnd.dot(toTarget)));
  const angle = Math.acos(dot);

  // CCD 旋转项：方向已对齐（angle<1e-6）→ 跳过旋转（极向量不受影响）
  if (angle >= 1e-6) applyCcdRotation(joint, toEnd, toTarget, angle, step);
  return true;
}

/** 施加一次绕关节的 CCD 旋转（轴、钳制、阻尼、共线退化回退轴全在这一处）。 */
function applyCcdRotation(
  joint: THREE.Object3D,
  toEnd: THREE.Vector3,
  toTarget: THREE.Vector3,
  angle: number,
  step: SolveStep,
): void {
  // 旋转轴：关节→末端 × 关节→目标（垂直于两向量构成的平面）
  const axis = _ikAxis.crossVectors(toEnd, toTarget);
  let clampedAngle = Math.max(step.minAng, Math.min(step.maxAng, angle)) * step.damping;
  if (axis.lengthSq() < 1e-8) {
    // ★ 近共线（≈180°）退化：叉积归零（恰共线）或被数值噪声主导（近共线）——
    // 原实现「axis 太小就跳过」⇒ 垂直抬脚时整关节冻结（残差钉死、腿不动），
    // 或近共线时微小叉积的方向随机 ⇒ 膝盖甩反侧。改取确定性回退轴：
    // 优先 toEnd×世界Y（腿链竖直主导时 Y 叉积退化），再 toEnd×世界X；
    // 并把步长封顶 π−0.05——整 180° 翻转病态且一步就冲过目标，
    // 朝向由后续轮次与极向量（poleTarget）继续收敛决定。
    axis.crossVectors(toEnd, _ikWorldUp);
    if (axis.lengthSq() < 1e-8) axis.crossVectors(toEnd, _ikWorldX);
    clampedAngle = Math.min(clampedAngle, Math.PI - 0.05);
  }
  if (axis.lengthSq() < 1e-12) return;
  axis.normalize();
  if (Math.abs(clampedAngle) < 1e-8) return;
  // 将旋转轴转换为关节局部空间并应用旋转
  joint.quaternion.premultiply(_ikQuat.setFromAxisAngle(axis, clampedAngle));
}

/**
 * 极向量约束：调整关节朝向以靠拢 poleTarget（用于肘/膝朝向约束）。
 * @param joint      当前关节
 * @param nextJoint  下一关节（子骨骼）
 * @param poleTarget 极向量目标（世界坐标）
 * @param weight     约束权重
 */
function applyPoleConstraint(
  joint: THREE.Object3D,
  nextJoint: THREE.Object3D,
  poleTarget: THREE.Vector3,
  weight: number,
): void {
  const jointWorld = _poleJointWorld;
  const nextWorld = _poleNextWorld;
  joint.getWorldPosition(jointWorld);
  nextJoint.getWorldPosition(nextWorld);

  const chainDir = _poleChainDir.subVectors(nextWorld, jointWorld).normalize();
  const toPole = _poleToPole.subVectors(poleTarget, jointWorld).normalize();

  // 计算当前链方向与目标极向量之间的旋转
  const dot = Math.max(-1, Math.min(1, chainDir.dot(toPole)));
  const angle = Math.acos(dot);
  if (angle < 1e-6) return;

  const axis = _poleAxis.crossVectors(chainDir, toPole);
  if (axis.lengthSq() < 1e-10) return;
  axis.normalize();

  const quat = _poleQuat.setFromAxisAngle(axis, angle * weight);
  joint.quaternion.premultiply(quat);
}

// ---------------------------------------------------------------------------
// 便捷工具
// ---------------------------------------------------------------------------

/**
 * 从 BoneTree 中提取从 root 到 endEffector 的骨骼链（object 引用）。
 * @param tree          骨骼树
 * @param rootId        根骨骼 id（如 "hips"）
 * @param endEffectorId 末端骨骼 id（如 "leftFoot"）
 * @returns 从 root 到 endEffector 的 Object3D 数组（含两端），无有效链返回 null
 */
export function extractIKChainFromTree(
  tree: import("./bone-tools.ts").BoneTree,
  rootId: string,
  endEffectorId: string,
): THREE.Object3D[] | null {
  if (!tree.byId.has(rootId) || !tree.byId.has(endEffectorId)) return null;

  // 从 endEffector 沿 parentId 向上走到 root
  const path: string[] = [];
  let current = endEffectorId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return null; // 防环
    visited.add(current);
    path.unshift(current);
    const node = tree.byId.get(current);
    if (!node) return null;
    if (current === rootId) break;
    current = node.parentId ?? "";
  }

  // 校验链确实以 root 开头
  if (path[0] !== rootId) return null;

  // 收集 object 引用（任一节缺失则整链无效）
  const chain: THREE.Object3D[] = [];
  for (const id of path) {
    const node = tree.byId.get(id);
    if (!node?.object) return null;
    chain.push(node.object);
  }
  return chain;
}
