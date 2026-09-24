// @vitest-environment node
// ===== 足 IK 质量探针（ADR-243 §2.8 待实机校准项 → 数字化）=====
// 目的：把「足部动作看起来奇葩」变成数字。纯 three 数学，无 DOM / 无 GPU。
//
//   A/B 矩阵：solveIK × (iterations × damping × pole) × 3 场景
//     → 残差（足到目标距离）/ 膝朝向 kneeZ / 大腿角
//   控制器级：当前钉死参数（4 轮 × 0.6 × ±π/3，无 pole）同场景实测
//   非轴对齐 rest：骨盆转 30° vs 轴对齐 → 探「世界轴 premultiply 捷径」
//   确定性：同配置两次全新 fixture 必须同数（scratch 缓冲纪律哨兵）
//
// 几何约定：
//   骨盆原点 → 大腿 (0.1,0.8,0) → 膝 -0.5 → 踝 -0.5 ⇒ 足静止世界 (0.1,0,0)，腿总长 1.0
//   模型前向 = -z（MMD 转 three 手性翻转后的惯例）
//     ⇒ 正常屈膝 = 膝朝 +z（足的后方）；kneeZ < 0 = 膝翻反侧（奇葩形态之一）
//
// 运行：cd frontend && npx vitest --run src/preview-3d/bone/vrm-foot-ik-quality.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { solveIK, type IKConfig } from "./ik-solver.ts";
import { createVrmFootIKController, type FootIKSampler } from "./vrm-foot-ik.ts";
import type { BoneNode, BoneTree } from "./bone-tools.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

const IDENTITY = new THREE.Quaternion();

interface LegRig {
  pelvis: THREE.Object3D;
  thigh: THREE.Object3D;
  knee: THREE.Object3D;
  foot: THREE.Object3D;
  chain: THREE.Object3D[];
  tree: BoneTree;
  semantic: SemanticBoneMap;
}

/** 单腿 fixture；`pelvisYaw` 让整副骨盆绕 Y 预转（非轴对齐 rest 探针用） */
function buildLeg(pelvisYaw = 0): LegRig {
  const pelvis = new THREE.Object3D();
  pelvis.rotation.y = pelvisYaw;
  const thigh = new THREE.Object3D();
  thigh.position.set(0.1, 0.8, 0);
  const knee = new THREE.Object3D();
  knee.position.set(0, -0.5, 0);
  const foot = new THREE.Object3D();
  foot.position.set(0, -0.5, 0);
  pelvis.add(thigh);
  thigh.add(knee);
  knee.add(foot);

  const tree = makeTree([
    { id: "hips", parentId: null, object: pelvis },
    { id: "leftUpperLeg", parentId: "hips", object: thigh },
    { id: "leftLowerLeg", parentId: "leftUpperLeg", object: knee },
    { id: "leftFoot", parentId: "leftLowerLeg", object: foot },
  ]);
  const semantic: SemanticBoneMap = {
    leftUpperLeg: { id: "leftUpperLeg", object: thigh },
    leftFoot: { id: "leftFoot", object: foot },
  };
  return { pelvis, thigh, knee, foot, chain: [pelvis, thigh, knee, foot], tree, semantic };
}

function makeTree(
  bones: Array<{ id: string; parentId: string | null; object?: THREE.Object3D }>,
): BoneTree {
  const byId = new Map<string, BoneNode>();
  for (const b of bones) byId.set(b.id, { id: b.id, name: b.id, parentId: b.parentId, object: b.object });
  return { byId, childrenMap: new Map(), roots: [], objectToId: new Map() };
}

// ---------------------------------------------------------------------------
// 场景（世界坐标；模型前向 -z）
// ---------------------------------------------------------------------------

const S1_LIFT = new THREE.Vector3(0.1, 0.35, 0); // 抬脚：髋→目标 0.45，够得着
const S2_STEP = new THREE.Vector3(0.1, 0.1, -0.55); // 前跨步：髋→目标 0.89，够得着
const S3_OVER = new THREE.Vector3(0.1, 0.05, -0.85); // 跨太大：髋→目标 1.134 > 腿长 1.0
const SCENARIOS: Record<string, THREE.Vector3> = {
  "S1抬脚": S1_LIFT,
  "S2前跨": S2_STEP,
  "S3跨太大": S3_OVER,
};

/**
 * 膝极向量目标：MMD 惯例 `左膝曲` 指向**模型前方**（前向 -z 世界里即 -z 侧）。
 * 权重取 0.3（0.5 实测会与前跨步对抗，见首版矩阵 S2/S3 劣化）。
 */
const POLE_TARGET = new THREE.Vector3(0.1, 0.3, -0.6);
const POLE_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

interface Metrics {
  /** 足末端到目标的残差（越小越贴目标） */
  residual: number;
  /** (膝世界 − 足世界) 归一化的 z 分量：>0 膝朝后（正常屈膝），<0 膝翻反侧 */
  kneeZ: number;
  /** 大腿局部旋转偏离 rest 的角幅度（rad） */
  thighAng: number;
}

function measure(leg: LegRig, target: THREE.Vector3): Metrics {
  const footW = new THREE.Vector3();
  leg.foot.getWorldPosition(footW);
  const kneeW = new THREE.Vector3();
  leg.knee.getWorldPosition(kneeW);
  const kneeVec = new THREE.Vector3().subVectors(kneeW, footW);
  const kneeZ = kneeVec.lengthSq() > 1e-12 ? kneeVec.normalize().z : 0;
  return { residual: footW.distanceTo(target), kneeZ, thighAng: leg.thigh.quaternion.angleTo(IDENTITY) };
}

function fmtRow(scenario: string, tag: string, m: Metrics): string {
  return `${scenario.padEnd(8, "　")} ${tag.padEnd(10, "　")} residual=${m.residual.toFixed(4)}  kneeZ=${m.kneeZ.toFixed(3)}  thighAng=${m.thighAng.toFixed(3)}`;
}

/** 恒定偏移采样器（结构同 vrm-foot-ik.test.ts 的 fixedSampler） */
function fixedSampler(offset: THREE.Vector3): FootIKSampler {
  return { sample: (_t, out) => (out.copy(offset), true) };
}

// ---------------------------------------------------------------------------
// A/B 矩阵（solveIK 级）
// ---------------------------------------------------------------------------

describe("A/B 矩阵（solveIK 级）", () => {
  const ITER = [4, 8, 16] as const;
  const DAMP = [0.6, 1] as const;

  it("3 场景 × 8 配置 → 指标表（记录现状，供选参数用）", () => {
    const rows: string[] = [];
    for (const [name, target] of Object.entries(SCENARIOS)) {
      for (const iterations of ITER) {
        for (const damping of DAMP) {
          for (const poleOn of [false, true]) {
            const leg = buildLeg(0);
            const cfg: IKConfig = {
              iterations,
              tolerance: 0.005,
              damping,
              minAngle: -Math.PI / 3,
              maxAngle: Math.PI / 3,
              poleTarget: poleOn ? POLE_TARGET : null,
              poleWeight: poleOn ? POLE_WEIGHT : 0,
            };
            solveIK(leg.chain, target, cfg);
            rows.push(fmtRow(name, `it${iterations}_d${damping}_pole${poleOn ? "on" : "off"}`, measure(leg, target)));
          }
        }
      }
    }
    console.log("\n[IK-A/B]\n" + rows.join("\n"));

    // 护栏（记录性，不断言优劣）：指标必须有限、非负
    for (const target of Object.values(SCENARIOS)) {
      const leg = buildLeg(0);
      solveIK(leg.chain, target, { iterations: 16, tolerance: 0.005, damping: 1 });
      const m = measure(leg, target);
      expect(Number.isFinite(m.residual)).toBe(true);
      expect(m.residual).toBeGreaterThanOrEqual(0);
    }
  });

  it("S3 跨太大：全配置残差都有下界（够不着 ≠ 数值爆炸）", () => {
    for (const iterations of ITER) {
      for (const damping of DAMP) {
        const leg = buildLeg(0);
        solveIK(leg.chain, S3_OVER, {
          iterations,
          tolerance: 0.005,
          damping,
          minAngle: -Math.PI / 3,
          maxAngle: Math.PI / 3,
        });
        const m = measure(leg, S3_OVER);
        // 髋→目标 1.134 − 腿长 1.0 = 0.134 是理论残差下界（留 0.05 浮点余量）
        expect(m.residual).toBeGreaterThan(0.08);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 控制器级（当前钉死参数：4 轮 × 0.6 × ±π/3，无 pole）
// ---------------------------------------------------------------------------

describe("控制器级（vrm-foot-ik 现行参数）", () => {
  it("S1/S2 实测 + 指标输出", () => {
    for (const [name, target] of Object.entries({ S1: S1_LIFT, S2: S2_STEP })) {
      const rig = buildLeg(0);
      const restFoot = new THREE.Vector3();
      rig.foot.getWorldPosition(restFoot);
      const controller = createVrmFootIKController(rig.tree, rig.semantic);
      controller.apply(0, { left: fixedSampler(new THREE.Vector3().subVectors(target, restFoot)), right: null });
      const m = measure(rig, target);
      console.log(fmtRow(name, "现行参数", m));
      expect(Number.isFinite(m.residual)).toBe(true);
      controller.dispose();
    }
  });

  it("非轴对齐 rest（骨盆 yaw −30°）vs 轴对齐：同场景不变量对比", () => {
    // 轴对齐基准
    const baseRig = buildLeg(0);
    const baseRest = new THREE.Vector3();
    baseRig.foot.getWorldPosition(baseRest);
    const baseCtl = createVrmFootIKController(baseRig.tree, baseRig.semantic);
    baseCtl.apply(0, { left: fixedSampler(new THREE.Vector3().subVectors(S2_STEP, baseRest)), right: null });
    const base = measure(baseRig, S2_STEP);
    baseCtl.dispose();

    // 骨盆转 −30°：场景（目标/偏移）整体同转 ⇒ 模型坐标系下是「同一个动作」
    const yaw = -Math.PI / 6;
    const euler = new THREE.Euler(0, yaw, 0);
    const rotatedRig = buildLeg(yaw);
    const rotatedRest = new THREE.Vector3();
    rotatedRig.foot.getWorldPosition(rotatedRest);
    const rotatedTarget = new THREE.Vector3(0.1, 0.1, -0.55).applyEuler(euler);
    const rotatedOffset = new THREE.Vector3().subVectors(rotatedTarget, rotatedRest);
    const rotatedCtl = createVrmFootIKController(rotatedRig.tree, rotatedRig.semantic);
    rotatedCtl.apply(0, { left: fixedSampler(rotatedOffset), right: null });
    const rotated = measure(rotatedRig, rotatedTarget);
    rotatedCtl.dispose();

    // 输出差值（实验读数：差值大 ⇒ 「世界轴 premultiply 捷径」在起作用）
    const line = `restYaw-30 vs 轴对齐  S2: 残差差=${Math.abs(rotated.residual - base.residual).toFixed(4)}  大腿角差=${Math.abs(rotated.thighAng - base.thighAng).toFixed(4)}`;
    console.log(`\n[IK-rest探针] ${line}`);
    expect(Number.isFinite(rotated.residual - base.residual)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 180° 共线退化（CCD 冻结）—— 记录当前病灶，修复 ik-solver 后翻绿
// ---------------------------------------------------------------------------

describe("180° 共线退化（CCD 冻结）", () => {
  const CFG: IKConfig = {
    iterations: 4,
    tolerance: 0.005,
    damping: 0.6,
    minAngle: -Math.PI / 3,
    maxAngle: Math.PI / 3,
  };

  it("S1 垂直抬脚（膝→足 与 膝→目标 恰好反向共线）：腿必须能动", () => {
    const leg = buildLeg(0);
    solveIK(leg.chain, S1_LIFT, CFG);
    const m = measure(leg, S1_LIFT);
    // 修复前：叉积归零 → 关节全冻结（residual 钉死 0.55、thighAng 0.000）
    expect(m.residual).toBeLessThan(0.15);
    expect(m.thighAng).toBeGreaterThan(0.1);
  });

  it("近共线（偏离 180° 约 1.2°）：结果应与共线同向（膝朝 +z 后方弯），不甩反侧", () => {
    // S1 目标向 -z 挪 0.001 ⇒ 膝→目标 与 膝→足 夹角 ≈ 178.8°（叉积小、方向敏感区）
    const target = new THREE.Vector3(0.1, 0.35, -0.001);
    const leg = buildLeg(0);
    solveIK(leg.chain, target, CFG);
    const m = measure(leg, target);
    // 叉积微小被数值噪声主导时 kneeZ 可能随机甩到负侧（膝翻反）；确定性求解应钉死为正
    expect(m.kneeZ).toBeGreaterThan(0);
    expect(m.residual).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// 确定性（scratch 缓冲纪律哨兵）
// ---------------------------------------------------------------------------

describe("确定性", () => {
  it("同场景同配置 × 两次全新 fixture → 指标必须逐位一致", () => {
    const cfg: IKConfig = {
      iterations: 4,
      tolerance: 0.005,
      damping: 0.6,
      minAngle: -Math.PI / 3,
      maxAngle: Math.PI / 3,
    };
    const run = () => {
      const leg = buildLeg(0);
      solveIK(leg.chain, S2_STEP, cfg);
      return measure(leg, S2_STEP);
    };
    const a = run();
    const b = run();
    expect(a.residual).toBeCloseTo(b.residual, 10);
    expect(a.kneeZ).toBeCloseTo(b.kneeZ, 10);
    expect(a.thighAng).toBeCloseTo(b.thighAng, 10);
  });
});
