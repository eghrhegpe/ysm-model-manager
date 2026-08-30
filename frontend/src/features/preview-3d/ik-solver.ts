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
//     故三骨腿链只能"向锚地靠拢"而非精确到达，属设计预期）
//
// 参考：babylon-mmd 的 ik-solver（ADR-066 提及的 532 行实现）
//   本实现为自写精简版，仅保留 CCD 核心 + 极向量，不依赖 babylon-mmd 运行时。

import * as THREE from "three";

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
 * 2. 检查末端是否收敛（distance < tolerance），是则提前退出
 * 3. 返回结果
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
  const worldPos = new THREE.Vector3();
  const worldJoint = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  for (let i = 0; i < iters; i++) {
    // 从末端向根遍历（跳过 endEffector 本身和根骨骼——根是链锚点，防整链/父链联动漂移）
    for (let j = chain.length - 2; j >= 1; j--) {
      const joint = chain[j];
      joint.getWorldPosition(worldJoint);
      endEffector.getWorldPosition(worldPos);

      toEnd.subVectors(worldPos, worldJoint);
      toTarget.subVectors(target, worldJoint);

      // 退化保护：关节与末端重合 → 跳过（旋转与极向量均不执行）
      if (toEnd.lengthSq() < 1e-10) continue;
      toEnd.normalize();
      toTarget.normalize();

      // 计算关节→末端与关节→目标之间的夹角
      const dot = Math.max(-1, Math.min(1, toEnd.dot(toTarget)));
      const angle = Math.acos(dot);

      // CCD 旋转项：方向对齐（angle<1e-6）/ 轴退化 / 钳制零角 → 跳过旋转（极向量不受影响）
      if (angle >= 1e-6) {
        // 旋转轴：关节→末端 × 关节→目标（垂直于两向量构成的平面）
        axis.crossVectors(toEnd, toTarget);
        if (axis.lengthSq() >= 1e-10) {
          axis.normalize();
          // 钳制角度到关节约束范围
          const clampedAngle = Math.max(minAng, Math.min(maxAng, angle)) * damping;
          if (Math.abs(clampedAngle) >= 1e-8) {
            // 将旋转轴转换为关节局部空间并应用旋转
            joint.quaternion.premultiply(
              quat.setFromAxisAngle(axis, clampedAngle),
            );
          }
        }
      }

      // 极向量约束：在 CCD 旋转后执行（chainDir 为旋转后世界方向），独立于角度项——
      // 末端已对齐（angle≈0）时仍生效，用于末端到位后的肘/膝姿态矫正
      // （applyPoleConstraint 内部有轴退化早退）
      if (poleTarget && poleWeight > 0 && j < chain.length - 2) {
        applyPoleConstraint(joint, chain[j + 1], poleTarget, poleWeight);
      }
    }

    // 收敛检查：末端到目标距离
    endEffector.getWorldPosition(worldPos);
    const dist = worldPos.distanceTo(target);
    if (dist < tol) {
      return { achieved: true, distance: dist, iterations: i + 1 };
    }
  }

  endEffector.getWorldPosition(worldPos);
  return { achieved: false, distance: worldPos.distanceTo(target), iterations: iters };
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
  const jointWorld = new THREE.Vector3();
  const nextWorld = new THREE.Vector3();
  joint.getWorldPosition(jointWorld);
  nextJoint.getWorldPosition(nextWorld);

  const chainDir = new THREE.Vector3().subVectors(nextWorld, jointWorld).normalize();
  const toPole = new THREE.Vector3().subVectors(poleTarget, jointWorld).normalize();

  // 计算当前链方向与目标极向量之间的旋转
  const dot = Math.max(-1, Math.min(1, chainDir.dot(toPole)));
  const angle = Math.acos(dot);
  if (angle < 1e-6) return;

  const axis = new THREE.Vector3().crossVectors(chainDir, toPole);
  if (axis.lengthSq() < 1e-10) return;
  axis.normalize();

  const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle * weight);
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
