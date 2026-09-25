// @vitest-environment node
// ===== vrm-foot-ik.ts 契约测试（ADR-243 §2.8 方案 A）=====
// 覆盖：降级路径（null 入参 / 语义缺腿 / 链不可提取）、targets=null 全程静默、
// 双侧与单侧驱动、采样失败跳过、时间透传、**静止位置创建期快照**这条防自反馈不变量、
// dispose 清空腿表。
//
// solveIK 以 vi.fn 包真实实现做间谍（对齐 mmd-foot-ik.test.ts 手法）：
// 既有调用记录可断言，又有真实数学行为可验证。
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { BoneNode, BoneTree } from "./bone-tools.ts";
import { solveIK } from "./ik-solver.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";
import { createVrmFootIKController, type FootIKSampler, type FootIKSamplers } from "./vrm-foot-ik.ts";

vi.mock("./ik-solver.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ik-solver.ts")>();
  return { ...actual, solveIK: vi.fn(actual.solveIK) };
});

const solveIKMock = vi.mocked(solveIK);

/** 单腿三骨：root(±0.1,0.8,0) → knee(-0.4) → foot(-0.4)，足静止世界 y=0 */
function makeLeg(offsetX: number) {
  const root = new THREE.Object3D();
  root.position.set(offsetX, 0.8, 0);
  const knee = new THREE.Object3D();
  knee.position.set(0, -0.4, 0);
  const foot = new THREE.Object3D();
  foot.position.set(0, -0.4, 0);
  root.add(knee);
  knee.add(foot);
  return { root, knee, foot };
}

function makeTree(
  bones: Array<{ id: string; parentId: string | null; object?: THREE.Object3D }>,
): BoneTree {
  const byId = new Map<string, BoneNode>();
  for (const b of bones) {
    byId.set(b.id, { id: b.id, name: b.id, parentId: b.parentId, object: b.object });
  }
  return { byId, childrenMap: new Map(), roots: [], objectToId: new Map() };
}

/** VRM 形态双腿：骨盆 hips → 大腿 → 膝盖 → 踝（链根应取骨盆） */
function makeVrmLegRig() {
  const pelvis = new THREE.Object3D();
  // 骨盆置于原点：使足静止世界 y = 0.8 − 0.4 − 0.4 = 0，restWorld 断言更直观
  pelvis.position.set(0, 0, 0);
  const left = makeLeg(0.1);
  const right = makeLeg(-0.1);
  pelvis.add(left.root);
  pelvis.add(right.root);

  const tree = makeTree([
    { id: "hips", parentId: null, object: pelvis },
    { id: "leftUpperLeg", parentId: "hips", object: left.root },
    { id: "leftLowerLeg", parentId: "leftUpperLeg", object: left.knee },
    { id: "leftFoot", parentId: "leftLowerLeg", object: left.foot },
    { id: "rightUpperLeg", parentId: "hips", object: right.root },
    { id: "rightLowerLeg", parentId: "rightUpperLeg", object: right.knee },
    { id: "rightFoot", parentId: "rightLowerLeg", object: right.foot },
  ]);
  const semanticBones: SemanticBoneMap = {
    leftUpperLeg: { id: "leftUpperLeg", object: left.root },
    leftFoot: { id: "leftFoot", object: left.foot },
    rightUpperLeg: { id: "rightUpperLeg", object: right.root },
    rightFoot: { id: "rightFoot", object: right.foot },
  };
  return { tree, semanticBones, left, right, pelvis };
}

/** 恒定偏移采样器（记录收到的时间，便于断言透传） */
function fixedSampler(offset: [number, number, number], seen?: number[]): FootIKSampler {
  return {
    sample: (t, out) => {
      seen?.push(t);
      out.set(...offset);
      return true;
    },
  };
}

beforeEach(() => {
  solveIKMock.mockClear();
});

describe("createVrmFootIKController 降级路径", () => {
  it("boneTree=null / semanticBones=undefined / 语义表为空 → no-op，不调 solveIK", () => {
    const { tree } = makeVrmLegRig();
    const controllers = [
      createVrmFootIKController(null, undefined),
      createVrmFootIKController(null, {}),
      createVrmFootIKController(tree, undefined),
      createVrmFootIKController(tree, {}),
    ];
    const targets = { left: fixedSampler([0, 0, 0]), right: null };
    for (const controller of controllers) {
      expect(() => controller.apply(0, targets)).not.toThrow();
      expect(() => controller.dispose()).not.toThrow();
    }
    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("语义 id 不在树中（链提取失败）→ no-op", () => {
    const { tree } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, {
      leftUpperLeg: { id: "leftUpperLeg", object: {} as never },
      leftFoot: { id: "notInTree", object: {} as never },
    });

    controller.apply(0, { left: fixedSampler([0, 0, 0]), right: null });

    expect(solveIKMock).not.toHaveBeenCalled();
  });
});

describe("apply 驱动", () => {
  it("targets=null → 全程静默：不调 solveIK、骨架不动", () => {
    const { tree, semanticBones, left } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);
    left.knee.rotation.x = 0.5;
    const before = new THREE.Vector3();
    left.foot.getWorldPosition(before);

    controller.apply(0.3, null);

    expect(solveIKMock).not.toHaveBeenCalled();
    const after = new THREE.Vector3();
    left.foot.getWorldPosition(after);
    expect(after.toArray()).toEqual(before.toArray());
  });

  it("双侧目标 → 每腿一次 solveIK，target = 足静止世界 + 采样偏移", () => {
    const { tree, semanticBones, pelvis } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, {
      left: fixedSampler([0.2, 0.5, -0.1]),
      right: fixedSampler([-0.3, 0.1, 0.05]),
    });

    expect(solveIKMock).toHaveBeenCalledTimes(2);
    const [leftChain, leftTarget, leftCfg] = solveIKMock.mock.calls[0];
    const [rightChain, rightTarget] = solveIKMock.mock.calls[1];

    // 链根取骨盆（ADR-243 §2.8）：[hips, 大腿, 膝盖, 踝]
    expect(leftChain).toHaveLength(4);
    expect(leftChain[0]).toBe(pelvis);
    expect(rightChain).toHaveLength(4);
    expect(rightChain[0]).toBe(pelvis);

    // target 向量跨腿复用（每帧零分配纪律）⇒ 两次调用拿到的是**同一引用**，
    // 只能断言最终态；左腿基准（restWorld.x = 0.1）由「单侧目标」用例单独覆盖。
    expect(leftTarget).toBe(rightTarget);
    // 右腿：restWorld(-0.1, 0, 0) + offset(-0.3, 0.1, 0.05)
    expect(rightTarget.x).toBeCloseTo(-0.4, 6);
    expect(rightTarget.y).toBeCloseTo(0.1, 6);
    expect(rightTarget.z).toBeCloseTo(0.05, 6);

    // 与待机锚地同一组保守参数（v1 刻意不分叉）
    expect(leftCfg).toMatchObject({ iterations: 4, tolerance: 0.005, damping: 0.6 });
    expect(leftCfg?.minAngle).toBeCloseTo(-Math.PI / 3, 10);
    expect(leftCfg?.maxAngle).toBeCloseTo(Math.PI / 3, 10);
  });

  it("单侧目标（另侧 null）→ 只驱动该侧", () => {
    const { tree, semanticBones, pelvis } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, { left: fixedSampler([0, 0.2, 0]), right: null });

    expect(solveIKMock).toHaveBeenCalledTimes(1);
    const [chain, target] = solveIKMock.mock.calls[0];
    expect(chain[0]).toBe(pelvis);
    expect(target.x).toBeCloseTo(0.1, 6); // 左足静止 x = 0.1（restWorld 快照）
    expect(target.y).toBeCloseTo(0.2, 6);
  });

  it("采样器返回 false（该时刻无数据）→ 跳过该腿，不调 solveIK", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, {
      left: { sample: () => false },
      right: { sample: () => false },
    });

    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("动作时间原样透传给采样器", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);
    const seen: number[] = [];

    controller.apply(1.375, { left: fixedSampler([0, 0, 0], seen), right: null });

    expect(seen).toEqual([1.375]);
  });

  it("IK 确实改变骨架（真实数学，而非仅调用）", () => {
    const { tree, semanticBones, left } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);
    const before = new THREE.Vector3();
    left.foot.getWorldPosition(before);

    // 目标抬到 rest 上方 0.3m：解算后足部应朝目标移动
    controller.apply(0, { left: fixedSampler([0.1, 0.3, 0]), right: null });

    const after = new THREE.Vector3();
    left.foot.getWorldPosition(after);
    expect(after.y).toBeGreaterThan(before.y);
  });
});

describe("静止位置取创建期快照（防自反馈漂移）", () => {
  it("创建后骨架被动画移动，目标基准仍停在创建期 rest", () => {
    const { tree, semanticBones, left } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    // 模拟第一帧 vrm.update 烘出的动画位姿：整条腿被抬起（足世界 y 由 0 → 0.6）
    left.root.position.set(0.1, 1.4, 0);

    controller.apply(0, { left: fixedSampler([0, 0, 0]), right: null });

    const [, target] = solveIKMock.mock.calls[0];
    // 若实现改成每帧现读足世界位置，这里会得到 0.6（目标被上一帧结果拖走 ⇒ 自反馈漂移）
    expect(target.y).toBeCloseTo(0, 6);
    expect(target.x).toBeCloseTo(0.1, 6);
  });
});

describe("dispose", () => {
  it("dispose → 清空腿表：此后 apply 不再驱动 solveIK", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.dispose();
    controller.apply(0, { left: fixedSampler([0, 0.3, 0]), right: null });

    expect(solveIKMock).not.toHaveBeenCalled();
  });
});

// ── 脚尖链（ADR-243 P1b：つま先ＩＫ 驱动 leftToes/rightToes）──

/** 单脚尖两骨：foot(±0.1,0,0.1) → toe(+0.12,0,0)，脚尖静止世界 z = 0.1 */
function makeToe(offsetX: number) {
  const foot = new THREE.Object3D();
  foot.position.set(offsetX, 0, 0.1);
  const toe = new THREE.Object3D();
  toe.position.set(0, -0.02, 0.12);
  foot.add(toe);
  return { foot, toe };
}

/** VRM 双脚尖形态：hips → 大腿 → 膝 → 踝 → 脚尖（toe 链根取踝） */
function makeVrmToeRig() {
  const { tree, semanticBones, left, right, pelvis } = makeVrmLegRig();
  const leftToe = makeToe(0.1);
  const rightToe = makeToe(-0.1);
  left.foot.add(leftToe.toe);
  right.foot.add(rightToe.toe);

  // 既有树 + 4 个脚尖节点（toe 骨挂在 foot 下）
  for (const [id, parentId, object] of [
    ["leftToes", "leftFoot", leftToe.toe],
    ["rightToes", "rightFoot", rightToe.toe],
  ] as const) {
    tree.byId.set(id, { id, name: id, parentId, object });
  }

  const toeSemantic: SemanticBoneMap = {
    ...semanticBones,
    leftToes: { id: "leftToes", object: leftToe.toe },
    rightToes: { id: "rightToes", object: rightToe.toe },
  };
  return { tree, semanticBones: toeSemantic, left, right, leftToe, rightToe, pelvis };
}

describe("脚尖链驱动（ADR-243 P1b）", () => {
  it("无脚尖语义 → 零影响：只有腿链，行为与 v1 完全一致", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, { left: fixedSampler([0, 0.2, 0]), right: null });

    expect(solveIKMock).toHaveBeenCalledTimes(1); // 只有腿
  });

  it("有脚尖语义：每侧追加一次 toe 链 solveIK（链 = [踝, 脚尖]）", () => {
    const { tree, semanticBones, left, right, leftToe, rightToe, pelvis } = makeVrmToeRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, {
      left: fixedSampler([0, 0.2, 0]),
      right: fixedSampler([0, 0, 0]),
    });

    // 腿链 2 次 + 脚尖链 2 次
    expect(solveIKMock).toHaveBeenCalledTimes(4);
    const calls = solveIKMock.mock.calls;
    // 按腿分组：左腿 → 左脚尖 → 右腿 → 右脚尖（脚尖跟在自身足 IK 之后）
    // 腿链 4 节，链根 = 骨盆（ADR-243 §2.8）
    expect(calls[0][0]).toEqual([pelvis, left.root, left.knee, left.foot]);
    // 左脚尖链：链根 = 踝（endEffector 同链尾）
    const toeCall = calls[1];
    expect(toeCall[0]).toHaveLength(2);
    expect(toeCall[0][0]).toBe(left.foot);
    expect(toeCall[0][1]).toBe(leftToe.toe);
    const toeCallR = calls[3];
    expect(toeCallR[0][0]).toBe(right.foot);
    expect(toeCallR[0][1]).toBe(rightToe.toe);
  });

  it("toe 目标 = 脚尖静止世界 + 同一采样偏移（与腿共用 sampler，钳制参数独立更保守）", () => {
    const { tree, semanticBones } = makeVrmToeRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, { left: fixedSampler([0.05, 0.1, -0.02]), right: null });

    // 单侧驱动：第 1 次 = 左腿，第 2 次 = 左脚尖链
    expect(solveIKMock).toHaveBeenCalledTimes(2);
    const [toeChain, toeTarget, toeCfg] = solveIKMock.mock.calls[1];
    expect(toeChain).toHaveLength(2);
    // 脚尖静止世界 = foot(0.1, 0, 0) + toe(0, -0.02, 0.12) = (0.1, -0.02, 0.12)
    expect(toeTarget.x).toBeCloseTo(0.15, 6);
    expect(toeTarget.y).toBeCloseTo(0.08, 6);
    expect(toeTarget.z).toBeCloseTo(0.1, 6);
    // 脚尖钳制比腿保守（两节链小角度足矣，防 CCD 大步长把脚尖甩上天）
    expect(toeCfg?.maxAngle).toBeLessThan(Math.PI / 3);
    expect(toeCfg?.minAngle).toBeGreaterThan(-Math.PI / 3);
  });

  it("采样失败（false）→ 脚尖链同样跳过", () => {
    const { tree, semanticBones } = makeVrmToeRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, { left: { sample: () => false }, right: null });

    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("dispose 后脚尖链也不再驱动", () => {
    const { tree, semanticBones } = makeVrmToeRig();
    const controller = createVrmFootIKController(tree, semanticBones);
    controller.dispose();

    controller.apply(0, { left: fixedSampler([0, 0.2, 0]), right: null });

    expect(solveIKMock).not.toHaveBeenCalled();
  });
});

// ── ADR-309 D4（锐评 P4）：IK 开关时间轴（propertyKeyFrames.ikStates）──

describe("IK 开关时间轴（ADR-309 D4 / 锐评 P4）", () => {
  it("isEnabled 返回 false → 该侧跳过 solveIK（足回 FK 自然位）", () => {
    const { tree, semanticBones, left } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);
    left.knee.rotation.x = 0.5; // FK 已把膝摆开，CCD 跳过时应保持

    const targets: FootIKSamplers = {
      left: {
        sample: (_t, out) => {
          out.set(0, 0.3, 0);
          return true;
        },
        isEnabled: () => false, // MMD 侧该时刻左足 IK 关闭
      },
      right: null,
    };
    controller.apply(0, targets);

    expect(solveIKMock).not.toHaveBeenCalled();
    // 膝保持 FK 位（未被 CCD 改）
    expect(left.knee.rotation.x).toBeCloseTo(0.5, 6);
  });

  it("缺省 isEnabled（旧 VMD / .vrma）→ 全程求解，行为不变", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    controller.apply(0, { left: fixedSampler([0, 0.3, 0]), right: null });

    expect(solveIKMock).toHaveBeenCalledTimes(1);
  });

  it("isEnabled 按时间轴分段：on 段求解、off 段跳过", () => {
    const { tree, semanticBones } = makeVrmLegRig();
    const controller = createVrmFootIKController(tree, semanticBones);

    const targets: FootIKSamplers = {
      left: {
        sample: (_t, out) => {
          out.set(0, 0.3, 0);
          return true;
        },
        // 0~5s on，5~10s off
        isEnabled: (t) => t < 5 || t >= 10,
      },
      right: null,
    };

    controller.apply(2, targets);
    expect(solveIKMock).toHaveBeenCalledTimes(1); // on 段

    controller.apply(7, targets);
    expect(solveIKMock).toHaveBeenCalledTimes(1); // off 段不增
  });
});
