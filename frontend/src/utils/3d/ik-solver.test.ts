// ===== IK 求解器测试 =====

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { solveIK, extractIKChainFromTree } from "./ik-solver.ts";
import type { IKChain, IKResult } from "./ik-solver.ts";
import type { BoneTree } from "./bone-tools.ts";

/** 构建测试骨骼链：root → joint1 → joint2 → endEffector，均为独立 Object3D */
function makeChain(): { root: THREE.Object3D; joints: THREE.Object3D[]; end: THREE.Object3D; chain: IKChain } {
  const root = new THREE.Object3D();
  const j1 = new THREE.Object3D();
  const j2 = new THREE.Object3D();
  const end = new THREE.Object3D();

  // 线性排列：root(0,0,0) → j1(1,0,0) → j2(2,0,0) → end(3,0,0)
  root.position.set(0, 0, 0);
  j1.position.set(1, 0, 0);
  j2.position.set(1, 0, 0);
  end.position.set(1, 0, 0);

  root.add(j1);
  j1.add(j2);
  j2.add(end);

  return { root, joints: [j1, j2], end, chain: [root, j1, j2, end] };
}

describe("solveIK", () => {
  it("末端已在目标位置 → 零迭代收敛", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);
    const target = new THREE.Vector3();
    end.getWorldPosition(target);

    const result = solveIK(chain, target, { iterations: 1, tolerance: 0.001 });
    expect(result.achieved).toBe(true);
    expect(result.distance).toBeLessThan(0.001);
    expect(result.iterations).toBe(1);
  });

  it("简单弯曲：目标在末端上方 → 关节旋转使末端逼近", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 目标：末端正上方 0.5 单位
    const target = new THREE.Vector3(3, 0.5, 0);
    const result = solveIK(chain, target, { iterations: 8, tolerance: 0.01 });

    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    expect(finalPos.distanceTo(target)).toBeLessThan(0.15); // 允许一定误差（CCD 非精确）
    expect(result.iterations).toBeGreaterThan(0);
  });

  it("目标超出链可达范围 → achieved=false 但末端已靠拢", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 链总长 3，目标在 10 单位外 → 永远达不到
    const target = new THREE.Vector3(10, 10, 10);
    const result = solveIK(chain, target, { iterations: 8, tolerance: 0.001 });

    expect(result.achieved).toBe(false);
    expect(result.distance).toBeGreaterThan(0);

    // 但末端应该已朝目标方向靠拢
    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    // CCD 仅旋转关节、不拉伸链长 → 末端始终在链长半径的球面上
    // 验证：末端已朝目标方向靠拢（与原方向相比角度减小）
    const originalDir = new THREE.Vector3(3, 0, 0).normalize();
    const targetDir = target.clone().normalize();
    const finalDir = finalPos.clone().normalize();
    const originalAngle = Math.acos(Math.min(1, originalDir.dot(targetDir)));
    const finalAngle = Math.acos(Math.min(1, finalDir.dot(targetDir)));
    expect(finalAngle).toBeLessThan(originalAngle);
  });

  it("单关节链（root → end）→ 无中间关节可旋转", () => {
    const root = new THREE.Object3D();
    const end = new THREE.Object3D();
    end.position.set(1, 0, 0);
    root.add(end);

    const target = new THREE.Vector3(1, 1, 0);
    const result = solveIK([root, end], target, { iterations: 8 });

    // 只有 2 个节点，无中间关节，CCD 不旋转
    expect(result.achieved).toBe(false);
    expect(result.iterations).toBe(8);
  });

  it("空链 / 单节点 → 优雅降级", () => {
    const result = solveIK([], new THREE.Vector3(1, 0, 0));
    expect(result.achieved).toBe(false);
    expect(result.iterations).toBe(0);
  });

  it("关节角度约束生效：minAngle/maxAngle 限制旋转幅度", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 目标需要大角度旋转才能到达，但限制关节只能转 0.1 rad
    const target = new THREE.Vector3(3, 5, 0);
    const result = solveIK(chain, target, {
      iterations: 5,
      minAngle: -0.1,
      maxAngle: 0.1,
      tolerance: 0.001,
    });

    expect(result.achieved).toBe(false);
    // 关节角度受限，末端无法大幅移动
    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    expect(finalPos.y).toBeLessThan(2); // 约束下 y 约 1.3（maxAngle=0.1 × 5 轮 ≈ 0.5 rad/关节）
  });
});

// ---------------------------------------------------------------------------
// 补充覆盖：配置归一化 / 退化向量与极限角度分支
// ---------------------------------------------------------------------------

describe("solveIK 退化与钳制分支", () => {
  it("单节点链 → { achieved:false, distance:0, iterations:0 } 快速返回", () => {
    const obj = new THREE.Object3D();
    const result = solveIK([obj], new THREE.Vector3(1, 2, 3));
    expect(result).toEqual({ achieved: false, distance: 0, iterations: 0 });
  });

  it("iterations=0 → 归一化为 1 轮（Math.max(1, floor)）", () => {
    const { chain } = makeChain();
    const result = solveIK(chain, new THREE.Vector3(10, 10, 10), { iterations: 0 });
    expect(result.iterations).toBe(1);
    expect(result.achieved).toBe(false); // 1 轮达不到远处目标
  });

  it("tolerance=0 → 归一化为 1e-8 下限，零距离仍判达成", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);
    const target = new THREE.Vector3(3, 0, 0); // 末端现位
    const result = solveIK(chain, target, { tolerance: 0 });
    expect(result.achieved).toBe(true); // dist 0 < 1e-8（若未归一化则 0 < 0 恒 false）
  });

  it("关节与末端重合（toEnd 退化）→ 跳过该关节不旋转", () => {
    const root = new THREE.Object3D();
    const j1 = new THREE.Object3D();
    j1.position.set(1, 0, 0);
    const end = new THREE.Object3D(); // 局部 (0,0,0) → 与 j1 世界位置重合
    root.add(j1);
    j1.add(end);
    root.updateMatrixWorld(true);

    const result = solveIK([root, j1, end], new THREE.Vector3(1, 5, 0), { iterations: 4 });
    // 唯一可旋转关节 j1 因 toEnd.lengthSq < 1e-10 被 continue
    expect(j1.quaternion.x).toBeCloseTo(0);
    expect(j1.quaternion.y).toBeCloseTo(0);
    expect(j1.quaternion.z).toBeCloseTo(0);
    expect(j1.quaternion.w).toBeCloseTo(1);
    expect(result.achieved).toBe(false);
    expect(result.distance).toBeCloseTo(5); // 末端未动：|(1,5,0)-(1,0,0)|
    expect(result.iterations).toBe(4);
  });

  it("方向已对齐（angle < 1e-6）→ 跳过旋转，关节保持单位四元数", () => {
    const { chain, joints } = makeChain();
    const [j1, j2] = joints;
    const result = solveIK(chain, new THREE.Vector3(10, 0, 0), { iterations: 5 });
    // 关节→末端与关节→目标同向（均 +X），无需旋转
    expect(j1.quaternion.w).toBeCloseTo(1);
    expect(j2.quaternion.w).toBeCloseTo(1);
    expect(result.achieved).toBe(false);
    expect(result.distance).toBeCloseTo(7); // 链长 3，目标 10
  });

  it("方向相反（旋转轴退化）→ 跳过旋转，关节保持单位四元数", () => {
    const { chain, joints } = makeChain();
    const [j1, j2] = joints;
    const result = solveIK(chain, new THREE.Vector3(-4, 0, 0), { iterations: 5 });
    // toEnd 与 toTarget 反向 → angle=π 但 crossVectors 零向量 → continue
    expect(j1.quaternion.w).toBeCloseTo(1);
    expect(j2.quaternion.w).toBeCloseTo(1);
    expect(result.achieved).toBe(false);
    expect(result.distance).toBeCloseTo(7);
  });

  it("damping=0 → 零旋转幅度跳过，骨骼完全不动", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);
    const result = solveIK(chain, new THREE.Vector3(3, 5, 0), { iterations: 4, damping: 0 });
    end.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    expect(wp.x).toBeCloseTo(3);
    expect(wp.y).toBeCloseTo(0);
    expect(result.achieved).toBe(false);
    expect(result.distance).toBeCloseTo(5);
    expect(result.iterations).toBe(4);
  });

  it("可达目标多迭代收敛：末端逼近 (1,2,0) 且 achieved", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);
    // 距 j1(1,0,0) 恰为链长 2 的可达点
    const target = new THREE.Vector3(1, 2, 0);
    const result = solveIK(chain, target, { iterations: 60, tolerance: 0.02 });
    expect(result.achieved).toBe(true);
    expect(result.distance).toBeLessThan(0.02);
    end.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    expect(wp.x).toBeCloseTo(1, 1);
    expect(wp.y).toBeCloseTo(2, 1);
    expect(wp.z).toBeCloseTo(0, 1);
  });
});

// ---------------------------------------------------------------------------
// 补充覆盖：极向量约束（applyPoleConstraint）
// ---------------------------------------------------------------------------

/** 四节点链（root → j1 → j2 → end），含 2 个可旋转关节，供极向量路径（j < length-2）触达 */
function makePoleChain(): { root: THREE.Object3D; j1: THREE.Object3D; j2: THREE.Object3D; end: THREE.Object3D; chain: IKChain } {
  const root = new THREE.Object3D();
  const j1 = new THREE.Object3D();
  const j2 = new THREE.Object3D();
  const end = new THREE.Object3D();
  root.position.set(0, 0, 0);
  j1.position.set(1, 0, 0);
  j2.position.set(1, 0, 0);
  end.position.set(1, 0, 0);
  root.add(j1);
  j1.add(j2);
  j2.add(end);
  return { root, j1, j2, end, chain: [root, j1, j2, end] };
}

describe("solveIK 极向量约束", () => {
  // 几何推导（直链 root(0,0,0)→j1(1,0,0)→j2(2,0,0)→end(3,0,0)，target (3,1,0)，
  // poleTarget (1,2,0)，weight 1，iterations 1）：
  //   j2：toEnd(1,0,0) 与 toTarget(1,1,0)/√2 夹角 π/4，绕 +Z 旋转 → end' = (2+√2/2, √2/2)
  //   j1：IK 角度项 = atan2(1,2) - 22.5° ≈ 0.07095 rad（绕 +Z）
  //   j1 极向量项：chainDir 旋转后指向角 0.07095，toPole (0,1,0) 指向 π/2
  //     → 绕 +Z 旋转 π/2 - 0.07095 → j1 合成旋转恰为 R_z(π/2)
  //   end = j1 + R_z(π/2)·(1+√2/2, √2/2, 0) = (1-√2/2, 1+√2/2, 0)
  it("poleTarget 拉动根侧关节朝向（闭式数值断言）", () => {
    const { end, chain } = makePoleChain();
    chain.forEach((o) => o.updateMatrixWorld(true));
    const result = solveIK(chain, new THREE.Vector3(3, 1, 0), {
      iterations: 1,
      tolerance: 0.001,
      poleTarget: new THREE.Vector3(1, 2, 0),
      poleWeight: 1,
    });
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    expect(wp.x).toBeCloseTo(1 - Math.SQRT1_2, 3);
    expect(wp.y).toBeCloseTo(1 + Math.SQRT1_2, 3);
    expect(wp.z).toBeCloseTo(0, 6);
    // 末端未达目标
    expect(result.achieved).toBe(false);
    expect(result.iterations).toBe(1);
  });

  it("poleWeight=0 → 极向量不生效（仅 IK 旋转：末端在 (1+√(2+√2)·2/√5, √(2+√2)/√5)）", () => {
    const { end, chain } = makePoleChain();
    chain.forEach((o) => o.updateMatrixWorld(true));
    const result = solveIK(chain, new THREE.Vector3(3, 1, 0), {
      iterations: 1,
      tolerance: 0.001,
      poleTarget: new THREE.Vector3(1, 2, 0),
      poleWeight: 0,
    });
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    const len = Math.sqrt(2 + Math.SQRT2);
    expect(wp.x).toBeCloseTo(1 + (len * 2) / Math.sqrt(5), 3);
    expect(wp.y).toBeCloseTo(len / Math.sqrt(5), 3);
    expect(result.achieved).toBe(false);
  });

  it("target=末端现位 → CCD 角度项零夹角跳过，但极向量独立执行（j1 被拉向 poleTarget）", () => {
    const { j1, j2, end, chain } = makePoleChain();
    chain.forEach((o) => o.updateMatrixWorld(true));
    // target=末端现位 (3,0,0)：所有关节 toEnd 与 toTarget 同向 → 角度=0，旋转项全跳过（极向量已解耦）
    // 极向量：j1（j=1 < 链长-2=2）执行 pole——chainDir (1,0,0) 拉向 toPole (1,2,0)/√5
    //   → j1 绕 +Z 旋转 acos(1/√5)：j2 世界位 (1+1/√5, 2/√5, 0)，end = j2 + R·(1,0,0) = (1+2/√5, 4/√5, 0)
    const result = solveIK(chain, new THREE.Vector3(3, 0, 0), {
      iterations: 1,
      poleTarget: new THREE.Vector3(2, 2, 0),
      poleWeight: 1,
    });
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    const s = Math.sqrt(0.2); // 1/√5（cos θ；sin θ = 2/√5）
    expect(wp.x).toBeCloseTo(1 + 2 * s, 3); // 1 + 2/√5 ≈ 1.894
    expect(wp.y).toBeCloseTo(4 * s, 3); // 4/√5 ≈ 1.789
    expect(wp.z).toBeCloseTo(0, 6);
    // 末端离开目标（pole 是姿态约束，牺牲末端精度属预期）；j2 无 pole 条件且角度零 → 保持单位四元数
    expect(result.achieved).toBe(false);
    expect(j2.quaternion.w).toBeCloseTo(1);
    expect(j1.quaternion.w).toBeLessThan(1); // j1 已被极向量绕 Z 旋转
  });

  it("pole 与 chainDir 同向（angle < 1e-6）→ 极向量早退不旋转", () => {
    const { end, chain } = makePoleChain();
    chain.forEach((o) => o.updateMatrixWorld(true));
    // j1 的 IK 旋转后 chainDir（=R_z(θ)·(1,0,0)）指向角 θ = atan2(1,2) - π/8，
    // poleTarget 沿该方向构造 → dot 钳制为 1 → angle 0 → 早退，仅 IK 旋转生效
    const theta = Math.atan2(1, 2) - Math.PI / 8;
    const result = solveIK(chain, new THREE.Vector3(3, 1, 0), {
      iterations: 1,
      poleTarget: new THREE.Vector3(1 + 2 * Math.cos(theta), 2 * Math.sin(theta), 0),
      poleWeight: 1,
    });
    // 仅 IK 旋转生效（同 poleWeight=0 的闭式解）
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    const len = Math.sqrt(2 + Math.SQRT2);
    expect(wp.x).toBeCloseTo(1 + (len * 2) / Math.sqrt(5), 3);
    expect(wp.y).toBeCloseTo(len / Math.sqrt(5), 3);
  });

  it("pole 与 chainDir 相反（轴退化）→ 极向量跳过不旋转", () => {
    const { end, chain } = makePoleChain();
    chain.forEach((o) => o.updateMatrixWorld(true));
    // toPole 取 chainDir 反方向：angle=π 过检但 crossVectors 零向量 → lengthSq < 1e-10 早退
    const theta = Math.atan2(1, 2) - Math.PI / 8;
    const result = solveIK(chain, new THREE.Vector3(3, 1, 0), {
      iterations: 1,
      poleTarget: new THREE.Vector3(1 - 2 * Math.cos(theta), -2 * Math.sin(theta), 0),
      poleWeight: 1,
    });
    // 仅 IK 旋转生效
    const wp = new THREE.Vector3();
    end.getWorldPosition(wp);
    const len = Math.sqrt(2 + Math.SQRT2);
    expect(wp.x).toBeCloseTo(1 + (len * 2) / Math.sqrt(5), 3);
    expect(wp.y).toBeCloseTo(len / Math.sqrt(5), 3);
    expect(result.achieved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 补充覆盖：extractIKChainFromTree
// ---------------------------------------------------------------------------

/** 手工构建 BoneTree（extractIKChainFromTree 只消费 byId / node.parentId / node.object） */
function makeTree(bones: Array<{ id: string; parentId: string | null; object?: THREE.Object3D }>): BoneTree {
  const byId = new Map<string, { id: string; name: string; parentId: string | null; object?: THREE.Object3D }>();
  for (const b of bones) byId.set(b.id, { id: b.id, name: b.id, parentId: b.parentId, object: b.object });
  return { byId, childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree;
}

describe("extractIKChainFromTree", () => {
  it("有效链：沿 parentId 上溯，root→end 顺序返回 object 引用", () => {
    const hips = new THREE.Object3D();
    const legL = new THREE.Object3D();
    const footL = new THREE.Object3D();
    const armL = new THREE.Object3D();
    const tree = makeTree([
      { id: "hips", parentId: null, object: hips },
      { id: "legL", parentId: "hips", object: legL },
      { id: "footL", parentId: "legL", object: footL },
      { id: "armL", parentId: "hips", object: armL },
    ]);
    const chain = extractIKChainFromTree(tree, "hips", "footL");
    expect(chain).not.toBeNull();
    expect(chain).toEqual([hips, legL, footL]); // 顺序：根 → 末端
  });

  it("rootId 不在树 → null", () => {
    const tree = makeTree([{ id: "footL", parentId: null, object: new THREE.Object3D() }]);
    expect(extractIKChainFromTree(tree, "missing", "footL")).toBeNull();
  });

  it("endId 不在树 → null", () => {
    const tree = makeTree([{ id: "hips", parentId: null, object: new THREE.Object3D() }]);
    expect(extractIKChainFromTree(tree, "hips", "missing")).toBeNull();
  });

  it("end 不是 root 的后代（path[0] 校验）→ null", () => {
    const tree = makeTree([
      { id: "hips", parentId: null, object: new THREE.Object3D() },
      { id: "legL", parentId: "hips", object: new THREE.Object3D() },
      { id: "footL", parentId: "legL", object: new THREE.Object3D() },
      { id: "armL", parentId: "hips", object: new THREE.Object3D() },
    ]);
    // 上溯路径 footL→legL→hips，链头是 hips ≠ armL
    expect(extractIKChainFromTree(tree, "armL", "footL")).toBeNull();
  });

  it("父链成环 → 防环返回 null", () => {
    const c1 = new THREE.Object3D();
    const c2 = new THREE.Object3D();
    const tree = makeTree([
      { id: "hips", parentId: null, object: new THREE.Object3D() },
      { id: "c1", parentId: "c2", object: c1 },
      { id: "c2", parentId: "c1", object: c2 },
    ]);
    expect(extractIKChainFromTree(tree, "hips", "c1")).toBeNull();
  });

  it("链上节点缺 object → 整链无效返回 null", () => {
    const tree = makeTree([
      { id: "hips", parentId: null, object: new THREE.Object3D() },
      { id: "footL", parentId: "hips" }, // 无 object
    ]);
    expect(extractIKChainFromTree(tree, "hips", "footL")).toBeNull();
  });

  it("rootId === endId → 单元素链（现状语义，消费方按链长<2 跳过）", () => {
    const hips = new THREE.Object3D();
    const tree = makeTree([{ id: "hips", parentId: null, object: hips }]);
    const chain = extractIKChainFromTree(tree, "hips", "hips");
    expect(chain).not.toBeNull();
    expect(chain).toEqual([hips]);
  });
});
