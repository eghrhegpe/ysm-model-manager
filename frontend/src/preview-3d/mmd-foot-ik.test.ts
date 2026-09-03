// @vitest-environment node
// ===== mmd-foot-ik.ts 契约测试 =====
// 覆盖：createFootIKController 的四条降级路径（null 入参 / 语义缺腿 / id 不在树 /
// 链长<2）、apply 的 isIdle 早退 / 已贴地 continue / 漂移驱动 solveIK（锚地语义：
// 仅改 y 保留水平位置）、dispose 清空腿表。
//
// solveIK 以 vi.fn 包真实实现做间谍：既有调用记录可断言，又有真实数学行为可验证。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { createFootIKController } from "./mmd-foot-ik.ts";
import { solveIK } from "./ik-solver.ts";
import type { BoneNode, BoneTree } from "./bone-tools.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";

vi.mock("./ik-solver.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ik-solver.ts")>();
  return { ...actual, solveIK: vi.fn(actual.solveIK) };
});

const solveIKMock = vi.mocked(solveIK);

/** 单腿三骨：root(0,0.8,0) → knee(0,0.4,0) → foot(0,0,0)，初始足底世界 y=0 */
function makeLeg() {
  const root = new THREE.Object3D();
  root.position.set(0, 0.8, 0);
  const knee = new THREE.Object3D();
  knee.position.set(0, -0.4, 0);
  const foot = new THREE.Object3D();
  foot.position.set(0, -0.4, 0);
  root.add(knee);
  knee.add(foot);
  return { root, knee, foot };
}

function makeTree(bones: Array<{ id: string; parentId: string | null; object?: THREE.Object3D }>): BoneTree {
  const byId = new Map<string, BoneNode>();
  for (const b of bones) {
    byId.set(b.id, { id: b.id, name: b.id, parentId: b.parentId, object: b.object });
  }
  return { byId, childrenMap: new Map(), roots: [], objectToId: new Map() };
}

/** 双腿完整环境：树 + 语义映射 + 骨架引用 */
function makeRig() {
  const left = makeLeg();
  const right = makeLeg();
  const tree = makeTree([
    { id: "legL_root", parentId: null, object: left.root },
    { id: "legL_knee", parentId: "legL_root", object: left.knee },
    { id: "legL_foot", parentId: "legL_knee", object: left.foot },
    { id: "legR_root", parentId: null, object: right.root },
    { id: "legR_knee", parentId: "legR_root", object: right.knee },
    { id: "legR_foot", parentId: "legR_knee", object: right.foot },
  ]);
  const semanticBones: SemanticBoneMap = {
    leftUpperLeg: { id: "legL_root", object: left.root },
    leftFoot: { id: "legL_foot", object: left.foot },
    rightUpperLeg: { id: "legR_root", object: right.root },
    rightFoot: { id: "legR_foot", object: right.foot },
  };
  return { tree, semanticBones, left, right };
}

function footWorldY(foot: THREE.Object3D): number {
  const wp = new THREE.Vector3();
  foot.getWorldPosition(wp);
  return wp.y;
}

beforeEach(() => {
  solveIKMock.mockClear();
});

describe("createFootIKController 降级路径（dummy controller）", () => {
  it("boneTree=null / semanticBones=undefined → no-op 不抛、不触发 solveIK", () => {
    for (const controller of [
      createFootIKController(null, undefined),
      createFootIKController(null, {}),
      createFootIKController(makeTree([]), undefined),
    ]) {
      expect(() => controller.apply(0.016, true)).not.toThrow();
      expect(() => controller.dispose()).not.toThrow();
    }
    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("语义表为空（双腿缺省）→ dummy", () => {
    const { tree } = makeRig();
    const controller = createFootIKController(tree, {});
    controller.apply(0.016, true);
    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("语义 id 不在树中 → extract 失败（chain=null）→ dummy", () => {
    const { tree } = makeRig();
    const controller = createFootIKController(tree, {
      leftUpperLeg: { id: "legL_root" },
      leftFoot: { id: "notInTree" },
    });
    controller.apply(0.016, true);
    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("rootId === footId（链长 1）→ dummy", () => {
    const { tree } = makeRig();
    const controller = createFootIKController(tree, {
      leftUpperLeg: { id: "legL_foot" },
      leftFoot: { id: "legL_foot" },
    });
    controller.apply(0.016, true);
    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("语义条目缺 id（entry.id = undefined）→ getSemanticBoneId 返回 null → dummy", () => {
    const { tree } = makeRig();
    const controller = createFootIKController(tree, {
      leftUpperLeg: {} as NonNullable<SemanticBoneMap["leftUpperLeg"]>,
      leftFoot: { id: "legL_foot" },
    });
    controller.apply(0.016, true);
    expect(solveIKMock).not.toHaveBeenCalled();
  });
});

describe("createFootIKController 正常双腿", () => {
  it("待机态足部漂移 → 每腿调一次 solveIK，配置为锚地参数", () => {
    const { tree, semanticBones, left, right } = makeRig();
    const controller = createFootIKController(tree, semanticBones);

    // 模拟动画漂移：膝盖绕 X 轴弯曲，足部上抬离开锚地
    left.knee.rotation.x = 0.5;
    right.knee.rotation.x = 0.3;

    const leftFootPos = new THREE.Vector3();
    left.foot.getWorldPosition(leftFootPos);
    const rightFootPos = new THREE.Vector3();
    right.foot.getWorldPosition(rightFootPos);
    expect(leftFootPos.y).toBeCloseTo(0.4 * (1 - Math.cos(0.5)), 6); // 漂移确实发生

    controller.apply(0.016, true);

    expect(solveIKMock).toHaveBeenCalledTimes(2);
    const [leftChain, , leftCfg] = solveIKMock.mock.calls[0];
    const [rightChain, rightTarget, rightCfg] = solveIKMock.mock.calls[1];
    // 链：root → knee → foot（含两端 3 节点）
    expect(leftChain).toHaveLength(3);
    expect(leftChain[2]).toBe(left.foot);
    expect(rightChain[2]).toBe(right.foot);
    // 配置：4 迭代 / 0.005 容差 / 0.6 阻尼 / ±60° 角度钳制
    expect(leftCfg).toMatchObject({ iterations: 4, tolerance: 0.005, damping: 0.6 });
    expect(leftCfg!.minAngle).toBeCloseTo(-Math.PI / 3, 10);
    expect(leftCfg!.maxAngle).toBeCloseTo(Math.PI / 3, 10);
    expect(rightCfg).toMatchObject({ iterations: 4, tolerance: 0.005, damping: 0.6 });
    // 锚地语义：目标仅拉回锚地高度（y=0），保留漂移后的水平位置
    // （target 为跨腿复用向量，断言最后一次调用即右腿快照）
    expect(rightTarget.y).toBeCloseTo(0, 6);
    expect(rightTarget.x).toBeCloseTo(rightFootPos.x, 6);
    expect(rightTarget.z).toBeCloseTo(rightFootPos.z, 6);
  });

  it("apply 后足部向锚地高度靠拢", () => {
    const { tree, semanticBones, left } = makeRig();
    const controller = createFootIKController(tree, semanticBones);
    left.knee.rotation.x = 0.5;
    const before = footWorldY(left.foot);

    controller.apply(0.016, true);

    const after = footWorldY(left.foot);
    expect(after).toBeLessThan(before); // 下拉向锚地
    expect(before - after).toBeGreaterThan(0.004); // 4 轮迭代至少收拢一截
  });

  it("isIdle=false → 早退：不调 solveIK、骨骼不动", () => {
    const { tree, semanticBones, left } = makeRig();
    const controller = createFootIKController(tree, semanticBones);
    left.knee.rotation.x = 0.5;
    const before = footWorldY(left.foot);

    controller.apply(0.016, false);

    expect(solveIKMock).not.toHaveBeenCalled();
    expect(footWorldY(left.foot)).toBeCloseTo(before, 10);
  });

  it("足部已贴地（|Δy| < 0.001）→ continue 跳过：不调 solveIK", () => {
    const { tree, semanticBones } = makeRig();
    const controller = createFootIKController(tree, semanticBones);

    controller.apply(0.016, true); // 初始足底 y=0 即锚地

    expect(solveIKMock).not.toHaveBeenCalled();
  });

  it("dispose → 清空腿表：此后 apply 不再驱动 solveIK", () => {
    const { tree, semanticBones, left } = makeRig();
    const controller = createFootIKController(tree, semanticBones);
    left.knee.rotation.x = 0.5;

    controller.dispose();
    controller.apply(0.016, true);

    expect(solveIKMock).not.toHaveBeenCalled();
  });
});
