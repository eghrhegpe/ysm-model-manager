// @vitest-environment node
// ===== vmd-retarget.ts 契约测试（ADR-243 §2.1/§2.2/§2.4/§2.5）=====
// 关键手法：用**真实** buildAnimation + 鸭子类型假 VMD 跑端到端，而非 mock 上游——
// 这样「骨名白名单过滤 → 静止位置合成 → 轴系翻转 → 贝塞尔插值挂载 → 轨道命名」
// 五段上游私有行为全部进断言范围（也是 ADR §3.2「依赖上游私有行为」风险的回归哨兵）。
import type { VmdObject } from "@moeru/three-mmd";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm-core";
import { describe, expect, it } from "vitest";
import {
  buildVmdRetargetClip,
  collectVmdBoneNames,
  collectVmdExpressionMap,
  estimateVrmHeight,
  resolveVmdBindings,
  rewriteVmdTracks,
  scaleForHeight,
  type VmdBindingPlan,
  type VmdExpressionManagerLike,
  type VmdHumanoidRig,
} from "./vmd-retarget.ts";

/** 表情轨道名解析桩（鸭子 VmdExpressionManagerLike）：まばたき→blink / あ→aa / にこり→happy */
const EXPR_TRACK_NAME_MOCK: VmdExpressionManagerLike = {
  getExpressionTrackName: (name) =>
    (
      {
        まばたき: "VRMExpression_blink.weight",
        あ: "VRMExpression_aa.weight",
        にこり: "VRMExpression_happy.weight",
      } as Record<string, string>
    )[name] ?? null,
};

// ---------------------------------------------------------------------------
// 假 VMD（鸭子类型）
// ---------------------------------------------------------------------------
// `buildAnimation` 只经由 `vmd.boneKeyFrames` / `vmd.morphKeyFrames` 两个读取器取值，
// 不触碰 VmdObject 的任何私有状态 ⇒ 结构等价即可（ADR §3.2 记录的依赖面）。

interface FakeBoneFrame {
  boneName: string;
  frameNumber: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  /** 16 字节 MMD 插值参数（上游按 index+0/+4/+8/+12 取四轴贝塞尔控制点） */
  interpolation: number[];
}

function makeFakeVmd(
  bones: FakeBoneFrame[],
  morphs: Array<{ morphName: string; frameNumber: number; weight: number }> = [],
): VmdObject {
  const reader = <T>(items: T[]) => ({
    length: items.length,
    get: (i: number): T => {
      const item = items[i];
      if (item === undefined) throw new RangeError(`index ${i} out of range`);
      return item;
    },
  });
  return {
    boneKeyFrames: reader(bones),
    morphKeyFrames: reader(morphs),
  } as unknown as VmdObject;
}

function bone(
  boneName: string,
  frameNumber: number,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number, number] = [0, 0, 0, 1],
): FakeBoneFrame {
  return { boneName, frameNumber, position, rotation, interpolation: new Array(16).fill(20) };
}

// ---------------------------------------------------------------------------
// 假归一化骨骼装配
// ---------------------------------------------------------------------------

function makeNode(name: string, position: [number, number, number]): THREE.Object3D {
  const node = new THREE.Object3D();
  node.name = `Normalized_${name}`;
  node.position.set(...position);
  return node;
}

type BoneNodes = Record<string, THREE.Object3D>;

function makeRig(nodes: Record<string, THREE.Object3D | undefined>): VmdHumanoidRig {
  return {
    getNormalizedBoneNode: (name: VRMHumanBoneName) => nodes[name] ?? null,
  };
}

/** 去掉某个键（避开解构 omit 在 noUnusedLocals 下的悬案） */
function without(nodes: BoneNodes, key: string): BoneNodes {
  const copy: BoneNodes = { ...nodes };
  delete copy[key];
  return copy;
}

/** 轨道值存于 Float32Array（上游 KeyframeTrack 缓冲），逐分量按精度比对 */
function expectValues(
  values: ArrayLike<number>,
  expected: readonly number[],
  offset = 0,
  digits = 5,
): void {
  expected.forEach((v, i) => expect(values[offset + i]).toBeCloseTo(v, digits));
}

/** 标准站姿：hips 0.8m / head 1.392m / 踝 0.08m ⇒ 身高恰 1.6m（span 1.312 / 0.82） */
function makeStandingRig(): BoneNodes {
  return {
    hips: makeNode("hips", [0, 0.8, 0]),
    chest: makeNode("chest", [0, 1.15, 0]),
    upperChest: makeNode("upperChest", [0, 1.28, 0]),
    neck: makeNode("neck", [0, 1.38, 0]),
    head: makeNode("head", [0, 1.392, 0]),
    leftShoulder: makeNode("leftShoulder", [0.03, 1.32, 0]),
    leftUpperArm: makeNode("leftUpperArm", [0.12, 1.32, 0]),
    leftLowerArm: makeNode("leftLowerArm", [0.3, 1.2, 0]),
    leftHand: makeNode("leftHand", [0.5, 1.1, 0]),
    leftUpperLeg: makeNode("leftUpperLeg", [0.1, 0.75, 0]),
    leftLowerLeg: makeNode("leftLowerLeg", [0.1, 0.4, 0]),
    leftFoot: makeNode("leftFoot", [0.1, 0.08, 0]),
    leftToes: makeNode("leftToes", [0.1, 0.02, 0.1]),
  };
}

function trackByName(clip: THREE.AnimationClip, name: string): THREE.KeyframeTrack {
  const found = clip.tracks.find((t) => t.name === name);
  if (!found) {
    throw new Error(
      `track not found: ${name}\n实际: ${clip.tracks.map((t) => t.name).join(", ")}`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// collectVmdBoneNames
// ---------------------------------------------------------------------------

describe("collectVmdBoneNames", () => {
  it("收集 VMD 实际驱动的骨名（去重）", () => {
    const vmd = makeFakeVmd([bone("左腕", 0), bone("左腕", 10), bone("センター", 0)]);
    expect([...collectVmdBoneNames(vmd)].sort()).toEqual(["センター", "左腕"]);
  });

  it("空 VMD → 空集合", () => {
    expect(collectVmdBoneNames(makeFakeVmd([])).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveVmdBindings
// ---------------------------------------------------------------------------

describe("resolveVmdBindings", () => {
  it("命中候选名并建立绑定；位移源独立于旋转源（センター → hips）", () => {
    const nodes = makeStandingRig();
    const present = new Set(["腰", "上半身", "左腕", "左ひじ", "センター"]);

    const plan = resolveVmdBindings(present, makeRig(nodes));

    expect(plan.bindings).toEqual(
      expect.arrayContaining([
        { vrm: "hips", mmd: "腰" },
        { vrm: "chest", mmd: "上半身" },
        { vrm: "leftUpperArm", mmd: "左腕" },
        { vrm: "leftLowerArm", mmd: "左ひじ" },
      ]),
    );
    expect(plan.translationSource).toBe("センター");
    expect(plan.translationTarget).toBe(nodes.hips);
    // 位移基准 = hips 归一化骨静止局部位置（幽灵骨静止位置与缩放基准同源的不变量）
    expect(plan.translationBase?.toArray()).toEqual([0, 0.8, 0]);
  });

  it("VRM 侧无该归一化骨 → 跳过（不产生指向不存在节点的轨道）", () => {
    const plan = resolveVmdBindings(
      new Set(["左腕", "左ひじ"]),
      makeRig(without(makeStandingRig(), "leftLowerArm")),
    );

    expect(plan.bindings).toEqual([{ vrm: "leftUpperArm", mmd: "左腕" }]);
  });

  it("VMD 未驱动的骨不进表（宁缺勿绑空轨道）", () => {
    const plan = resolveVmdBindings(new Set(["左腕"]), makeRig(makeStandingRig()));
    expect(plan.bindings.map((b) => b.vrm)).toEqual(["leftUpperArm"]);
    expect(plan.translationSource).toBeNull();
  });

  it("模型无 hips → 位移通道整体关闭（translationSource 归 null，非半开状态）", () => {
    const plan = resolveVmdBindings(
      new Set(["腰", "センター"]),
      makeRig(without(makeStandingRig(), "hips")),
    );

    expect(plan.translationSource).toBeNull();
    expect(plan.translationTarget).toBeNull();
    expect(plan.translationBase).toBeNull();
  });

  it("丢弃策略生效：扭骨/IK 骨/形变骨在 VMD 里存在也不建绑定", () => {
    const plan = resolveVmdBindings(
      new Set(["左腕捩", "左足ＩＫ", "足首D", "左足先EX", "グルーブ"]),
      makeRig(makeStandingRig()),
    );

    expect(plan.bindings).toEqual([]);
    // グルーブ 只作位移兜底源，不进旋转绑定
    expect(plan.translationSource).toBe("グルーブ");
  });

  it("足 IK 骨只解析名字：不进旋转绑定（全角 ＩＫ 与半角变体均命中）", () => {
    const plan = resolveVmdBindings(
      new Set(["左足ＩＫ", "右足IK", "左腕"]),
      makeRig(makeStandingRig()),
    );

    expect(plan.footIK).toEqual({ left: "左足ＩＫ", right: "右足IK" });
    expect(plan.bindings.map((b) => b.mmd)).toEqual(["左腕"]);
  });

  it("VMD 未驱动 IK 骨 → 双侧 null（不猜、不占位）", () => {
    const plan = resolveVmdBindings(new Set(["左腕"]), makeRig(makeStandingRig()));
    expect(plan.footIK).toEqual({ left: null, right: null });
  });

  // ── 脚尖旋转源（ADR-243 锐评对账 P1b：つま先ＩＫ quaternion 通道）──

  it("つま先ＩＫ 命中 toe 旋转源（全角 ＩＫ 为主，半角变体兜底）", () => {
    const plan = resolveVmdBindings(
      new Set(["左つま先ＩＫ", "右つま先IK", "左腕"]),
      makeRig(makeStandingRig()),
    );
    expect(plan.toeRotation).toEqual({ left: "左つま先ＩＫ", right: "右つま先IK" });
    // toe 源不进旋转绑定（它只是「改道到 toes」的路标，绑定仍走 leftToes 候选）
    expect(plan.bindings.map((b) => b.mmd)).toEqual(["左腕"]);
  });

  it("VMD 未驱动 つま先ＩＫ → toe 旋转源双侧 null", () => {
    const plan = resolveVmdBindings(new Set(["左つま先"]), makeRig(makeStandingRig()));
    expect(plan.toeRotation).toEqual({ left: null, right: null });
  });

  // ── 表情映射解析（ADR-306 §2.1/§2.2）──

  it("morph 名解析：VMD 实际驱动 ∩ 候选表 → preset → 改道表（ghost morph 表用）", () => {
    const morphs = collectVmdExpressionMap(
      new Set(["まばたき", "あ", "作者自定义", "にこり"]),
      EXPR_TRACK_NAME_MOCK,
    );
    expect(morphs.get("まばたき")).toBe("blink");
    expect(morphs.get("あ")).toBe("aa");
    expect(morphs.get("にこり")).toBe("happy");
    expect(morphs.has("作者自定义")).toBe(false);
  });

  it("无 expressionManager → 空 map（ADR-243 v1 行为：morph 全丢弃）", () => {
    const morphs = collectVmdExpressionMap(new Set(["まばたき"]), null);
    expect(morphs.size).toBe(0);
  });

  it("幽灵网格 morph 表只填可映射子集（键进表做上游白名单，不可映射的继续被上游跳过）", () => {
    const nodes = makeStandingRig();
    const vmd = makeFakeVmd(
      [bone("左腕", 0)],
      [
        { morphName: "まばたき", frameNumber: 0, weight: 0 },
        { morphName: "作者自定义", frameNumber: 0, weight: 0 },
      ],
    );
    const { clip } = buildVmdRetargetClip(vmd, makeRig(nodes), {
      positionScale: 1,
      expressionManager: EXPR_TRACK_NAME_MOCK,
    });
    const names = clip.tracks.map((t) => t.name);
    expect(names).toContain("VRMExpression_blink.weight");
    expect(names.some((n) => n.includes("morphTargetInfluences"))).toBe(false);
    expect(names.some((n) => n.includes("作者自定义"))).toBe(false);
  });

  it("纯表情 VMD（零可映射骨）→ 早退分支不吞表情轨道，clip 只装表情轨道", () => {
    const nodes = makeStandingRig();
    // 无 bone（collectVmdBoneNames 空 ⇒ 幽灵骨零条），只有可映射 morph ⇒ 走主路径产出纯表情 clip。
    // 两帧让 duration > 0（单帧在 t=0 ⇒ duration 0，无意义）
    const vmd = makeFakeVmd(
      [],
      [
        { morphName: "まばたき", frameNumber: 0, weight: 0.5 },
        { morphName: "まばたき", frameNumber: 30, weight: 0 },
      ],
    );
    const { clip } = buildVmdRetargetClip(vmd, makeRig(nodes), {
      positionScale: 1,
      expressionManager: EXPR_TRACK_NAME_MOCK,
    });
    const names = clip.tracks.map((t) => t.name);
    expect(names).toEqual(["VRMExpression_blink.weight"]); // 只有表情轨道，无骨骼轨道
    expect(clip.duration).toBeGreaterThan(0);
  });

  it("纯表情 VMD 但无 expressionManager → 退化为空 clip（ADR-243 v1：morph 全丢弃）", () => {
    const nodes = makeStandingRig();
    const vmd = makeFakeVmd(
      [],
      [{ morphName: "まばたき", frameNumber: 0, weight: 0.5 }],
    );
    const { clip, report } = buildVmdRetargetClip(vmd, makeRig(nodes), {
      positionScale: 1,
      // 无 expressionManager
    });
    expect(clip.tracks).toHaveLength(0);
    // 无 manager ⇒ expressionMap 空 ⇒ 幽灵 morph 表白名单空 ⇒ 上游 buildMorphAnimation
    // 直接跳过该 morph（从未进源轨道），故 rewrite 阶段无源轨道可丢 → droppedTracks = 0。
    // 「丢弃」发生在 ghost 表层面，不是 rewrite 计数层面——两口径不重叠。
    expect(report.droppedTracks).toBe(0);
  });

  it("toe 旋转源改道：左つま先ＩＫ quaternion 轨道绑到 leftToes 归一化骨", () => {
    const nodes = makeStandingRig();
    const plan = resolveVmdBindings(new Set(["左つま先ＩＫ"]), makeRig(nodes));
    expect(plan.toeRotation.left).toBe("左つま先ＩＫ");
    // 改道路由：MMD 名 → toes 节点（quaternion 通道落点）
    expect(plan.toeNodesByMmd.get("左つま先ＩＫ")).toBe(nodes.leftToes);
  });
});

// ---------------------------------------------------------------------------
// 比例（§2.5）
// ---------------------------------------------------------------------------

describe("比例缩放", () => {
  it("scaleForHeight 线性外推（1.6m 基准 ⇒ 0.08）", () => {
    expect(scaleForHeight(1.6)).toBeCloseTo(0.08, 10);
    expect(scaleForHeight(2.0)).toBeCloseTo(0.1, 10);
    expect(scaleForHeight(1.2)).toBeCloseTo(0.06, 10);
  });

  it("estimateVrmHeight：head 1.392 − 踝 0.08 = 1.312 ⇒ 身高 1.6m", () => {
    expect(estimateVrmHeight(makeRig(makeStandingRig()))).toBeCloseTo(1.6, 6);
  });

  it("缺 head / 非站立退化尺度 → null（不猜）", () => {
    expect(estimateVrmHeight(makeRig(without(makeStandingRig(), "head")))).toBeNull();

    const flat = makeStandingRig();
    flat.head?.position.set(0, 0.1, 0);
    expect(estimateVrmHeight(makeRig(flat))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rewriteVmdTracks（ADR §2.2 的红线）
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<VmdBindingPlan> = {}): VmdBindingPlan {
  return {
    bindings: [{ vrm: "leftUpperArm", mmd: "左腕" }],
    nodesByMmd: new Map([["左腕", makeNode("leftUpperArm", [0.12, 1.32, 0])]]),
    translationSource: "センター",
    translationTarget: makeNode("hips", [0, 0.8, 0]),
    translationBase: new THREE.Vector3(0, 0.8, 0),
    footIK: { left: null, right: null },
    toeRotation: { left: null, right: null },
    toeNodesByMmd: new Map(),
    morphNameByIndex: new Map(),
    morphPresetByMmd: new Map(),
    ...overrides,
  };
}

function quatTrack(name: string): THREE.QuaternionKeyframeTrack {
  return new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
}

// 上游 `_createTrack` 会挂一个**实例级** `createInterpolant` 覆写（MMD 逐轴贝塞尔），
// `@types/three` 未声明该成员 ⇒ 经窄接口读写，测试里显式可见。
interface WithInterpolant {
  createInterpolant: unknown;
}

function interpolantOf(track: THREE.KeyframeTrack): unknown {
  return (track as unknown as WithInterpolant).createInterpolant;
}

function setInterpolant(track: THREE.KeyframeTrack, fn: unknown): void {
  (track as unknown as WithInterpolant).createInterpolant = fn;
}

describe("rewriteVmdTracks", () => {
  it("原地改 name 保贝塞尔插值：createInterpolant 覆写必须存活", () => {
    const sentinel = (): string => "sentinel";
    const track = quatTrack(".bones[左腕].quaternion");
    setInterpolant(track, sentinel);

    const plan = makePlan();
    const arm = plan.nodesByMmd.get("左腕");
    if (!arm) throw new Error("测试装置损坏");
    const { tracks } = rewriteVmdTracks(new THREE.AnimationClip("", -1, [track]), plan, 1);

    const kept = tracks[0];
    expect(kept).toBe(track); // 同一对象，不是重建的副本
    expect(kept?.name).toBe(`${arm.uuid}.quaternion`);
    expect(interpolantOf(kept as THREE.KeyframeTrack)).toBe(sentinel);
  });

  it("通道裁剪：morph / 未映射骨 / 非位移源 position 一律丢弃并计数", () => {
    const tracks = [
      quatTrack(".bones[左腕].quaternion"),
      new THREE.VectorKeyframeTrack(".bones[センター].position", [0, 1], [0, 0.8, 0, 0, 0.8, 0]),
      new THREE.VectorKeyframeTrack(".bones[左ひざ].position", [0, 1], [0.1, 0.4, 0, 0.1, 0.4, 0]),
      quatTrack(".bones[左足ＩＫ].quaternion"),
      new THREE.NumberKeyframeTrack(".morphTargetInfluences[0]", [0, 1], [0, 1]),
    ];
    const plan = makePlan();

    const { tracks: kept, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, tracks),
      plan,
      1,
    );

    expect(kept.map((t) => t.name)).toEqual([
      `${plan.nodesByMmd.get("左腕")?.uuid}.quaternion`,
      `${plan.translationTarget?.uuid}.position`,
    ]);
    expect(droppedTracks).toBe(3);
  });

  it("位移缩放只作用于「相对静止位置的偏移」，静止位置本身不动", () => {
    // VMD センター 偏移 (1, 2, 3)，轴系翻转后 z 取反 ⇒ basePosition + (1, 2, -3)
    const posTrack = new THREE.VectorKeyframeTrack(
      ".bones[センター].position",
      [0],
      [1, 2.8, -3],
    );

    rewriteVmdTracks(new THREE.AnimationClip("", -1, [posTrack]), makePlan(), 0.5);

    // x: 0 + (1-0)*0.5 = 0.5；y: 0.8 + (2.8-0.8)*0.5 = 1.8；z: 0 + (-3-0)*0.5 = -1.5
    expectValues(posTrack.values, [0.5, 1.8, -1.5]);
  });

  it("scale=1 时位移轨道值原样保留", () => {
    const posTrack = new THREE.VectorKeyframeTrack(".bones[センター].position", [0], [1, 2.8, -3]);
    rewriteVmdTracks(new THREE.AnimationClip("", -1, [posTrack]), makePlan(), 1);
    expectValues(posTrack.values, [1, 2.8, -3]);
  });

  it("足 IK 目标轨道被摘出：不进 clip、不计 dropped、按 k 缩放、对象同一", () => {
    // 幽灵 IK 骨静止位置为零 ⇒ 值即纯偏移（含上游 z 翻转）
    const ikTrack = new THREE.VectorKeyframeTrack(
      ".bones[左足ＩＫ].position",
      [0, 1],
      [0, 20, 0, 0, 20, 10],
    );
    const { tracks, droppedTracks, ikTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [ikTrack]),
      makePlan({ footIK: { left: "左足ＩＫ", right: null } }),
      0.5,
    );

    expect(tracks).toEqual([]);
    expect(ikTracks.left).toBe(ikTrack); // 引用同一对象：没有重建（贝塞尔覆写因此存活）
    expect(ikTracks.right).toBeNull();
    expect(droppedTracks).toBe(0); // 摘出 ≠ 丢弃
    expectValues(ikTrack.values, [0, 10, 0, 0, 10, 5]);
  });

  it("plan 未认领的 IK 骨 position 走常规丢弃（防「摘出」变成漏网通道）", () => {
    const track = new THREE.VectorKeyframeTrack(".bones[左足ＩＫ].position", [0], [0, 20, 0]);
    const { ikTracks, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [track]),
      makePlan(),
      1,
    );

    expect(ikTracks).toEqual({ left: null, right: null });
    expect(droppedTracks).toBe(1);
  });

  // ── 表情轨道改道（ADR-306 §2.2）──

  /** 表情轨道改道面（窄接口，鸭子类型 VRMExpressionManager.getExpressionTrackName） */
  function makeExprMgr(tracks: Record<string, string | null>) {
    return { getExpressionTrackName: (name: string) => tracks[name] ?? null };
  }

  it("morph 轨道查改道表：命中 → 原地改名进 clip（VRMExpression_<name>.weight）", () => {
    const track = new THREE.NumberKeyframeTrack(".morphTargetInfluences[0]", [0, 1], [0, 1]);
    const plan = makePlan({
      morphNameByIndex: new Map([[0, "まばたき"]]),
    });
    const expr = makeExprMgr({ まばたき: "VRMExpression_blink.weight" });

    const { tracks, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [track]),
      plan,
      1,
      expr,
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toBe(track); // 原地改名，不重建
    expect(tracks[0]?.name).toBe("VRMExpression_blink.weight");
    expect(droppedTracks).toBe(0);
  });

  it("morph 轨道未命中（不可映射名 / 无 expressionManager）→ 常规丢弃", () => {
    const track = new THREE.NumberKeyframeTrack(".morphTargetInfluences[3]", [0], [0.5]);
    const plan = makePlan({ morphNameByIndex: new Map([[3, "作者自定义モーフ"]]) });

    // 无 expressionManager：行为与 ADR-243 v1 完全一致（全部丢弃）
    const r1 = rewriteVmdTracks(new THREE.AnimationClip("", -1, [track]), plan, 1);
    expect(r1.tracks).toEqual([]);
    expect(r1.droppedTracks).toBe(1);

    // 有 manager 但该 morph 不可映射（getExpressionTrackName → null）
    const expr = makeExprMgr({});
    const r2 = rewriteVmdTracks(new THREE.AnimationClip("", -1, [track]), plan, 1, expr);
    expect(r2.tracks).toEqual([]);
    expect(r2.droppedTracks).toBe(1);
  });

  it("morph 轨道索引不在改道表 → 丢弃（防上游索引漂移时错绑到无关表情）", () => {
    const track = new THREE.NumberKeyframeTrack(".morphTargetInfluences[9]", [0], [1]);
    const plan = makePlan({ morphNameByIndex: new Map([[0, "まばたき"]]) });
    const expr = makeExprMgr({ まばたき: "VRMExpression_blink.weight" });

    const { tracks, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [track]),
      plan,
      1,
      expr,
    );
    expect(tracks).toEqual([]);
    expect(droppedTracks).toBe(1);
  });

  // ── つま先ＩＫ quaternion 改道（ADR-243 锐评对账 P1b）──

  it("つま先ＩＫ quaternion 轨道改道绑到 toes 节点：原地改 name 保贝塞尔", () => {
    const toesNode = makeNode("leftToes", [0.1, 0.02, 0.1]);
    const sentinel = (): string => "sentinel";
    const track = quatTrack(".bones[左つま先ＩＫ].quaternion");
    setInterpolant(track, sentinel);

    const plan = makePlan({
      toeRotation: { left: "左つま先ＩＫ", right: null },
      toeNodesByMmd: new Map([["左つま先ＩＫ", toesNode]]),
    });
    const { tracks, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [track]),
      plan,
      1,
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toBe(track); // 同一对象：贝塞尔覆写存活
    expect(tracks[0]?.name).toBe(`${toesNode.uuid}.quaternion`);
    expect(droppedTracks).toBe(0);
  });

  it("つま先ＩＫ position 轨道仍丢弃（它不是 IK 目标载体）", () => {
    const track = new THREE.VectorKeyframeTrack(".bones[左つま先ＩＫ].position", [0], [0, 0, 0]);
    const plan = makePlan({
      toeRotation: { left: "左つま先ＩＫ", right: null },
      toeNodesByMmd: new Map([["左つま先ＩＫ", makeNode("leftToes", [0, 0, 0])]]),
    });
    const { tracks, droppedTracks } = rewriteVmdTracks(
      new THREE.AnimationClip("", -1, [track]),
      plan,
      1,
    );
    expect(tracks).toEqual([]);
    expect(droppedTracks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildVmdRetargetClip（端到端，真实 buildAnimation）
// ---------------------------------------------------------------------------

const E2E_VMD = makeFakeVmd(
  [
    bone("センター", 0, [0, 0, 0]),
    bone("センター", 30, [1, 2, 3]),
    // MMD 惯例：VMD 四元数为左手系 ⇒ 实测轨迹应为 (-x, -y, z, w)
    bone("左腕", 0, [0, 0, 0], [0, 0, 0, 1]),
    bone("左腕", 30, [0, 0, 0], [0.1, 0.2, 0.3, 0.9]),
    bone("左ひざ", 0, [0, 0, 0], [0.4, 0, 0, 0.9]),
    // 足 IK 骨：关键帧活在 position 通道（VMD 惯例：IK 骨只该有位移），
    // 第 30 帧偏移 (1,2,3) → 轴系翻转 (1,2,-3) → 按 k 缩放
    bone("左足ＩＫ", 0, [0, 0, 0]),
    bone("左足ＩＫ", 30, [1, 2, 3]),
    // つま先ＩＫ（P1b）：quaternion 通道的手调脚尖俯仰，改道 leftToes
    bone("左つま先ＩＫ", 0, [0, 0, 0], [0, 0, 0, 1]),
    bone("左つま先ＩＫ", 30, [0, 0, 0], [0.2, 0, 0, 0.98]),
  ],
  // morph 入表 ⇒ 幽灵网格若漏置 morphTargetDictionary，上游解引用即抛（回归哨兵）
  [{ morphName: "まばたき", frameNumber: 0, weight: 0 }],
);

describe("buildVmdRetargetClip", () => {
  it("轨道名绑归一化骨 uuid，轴系翻转由上游完成（不重写）", () => {
    const nodes = makeStandingRig();
    const { clip, report } = buildVmdRetargetClip(E2E_VMD, makeRig(nodes), { positionScale: 0.5 });

    const quat = trackByName(clip, `${nodes.leftUpperArm?.uuid}.quaternion`);
    // 第 2 帧（index 4..7）：(0.1, 0.2, 0.3, 0.9) → (-0.1, -0.2, 0.3, 0.9)
    expectValues(quat.values, [-0.1, -0.2, 0.3, 0.9], 4);
    // 贝塞尔插值覆写存活（重建 track 会丢掉）
    expect(Object.hasOwn(quat, "createInterpolant")).toBe(true);

    expect(report.bindings).toEqual([
      { vrm: "leftUpperArm", mmd: "左腕" },
      { vrm: "leftLowerLeg", mmd: "左ひざ" },
    ]);
    expect(report.translationSource).toBe("センター");
    expect(report.positionScale).toBe(0.5);
  });

  it("hips 位移轨道：静止位置（0.8）保留，偏移按 k 缩放（轴系 z 取反）", () => {
    const nodes = makeStandingRig();
    const { clip } = buildVmdRetargetClip(E2E_VMD, makeRig(nodes), { positionScale: 0.5 });

    const pos = trackByName(clip, `${nodes.hips?.uuid}.position`);
    // 第 2 帧：base(0,0.8,0) + (1, 2, -3) ⇒ 缩放后 (0.5, 1.8, -1.5)
    expectValues(pos.values, [0.5, 1.8, -1.5], 3);
  });

  it("丢弃通道：IK 骨 / morph / 非位移源 position 不产出轨道", () => {
    const { clip, report } = buildVmdRetargetClip(E2E_VMD, makeRig(makeStandingRig()), {
      positionScale: 1,
    });

    expect(clip.tracks.every((t) => !t.name.includes("morphTargetInfluences"))).toBe(true);
    // 2 条入表骨（仅 quaternion 通道）+ 1 条 hips 位移 + 1 条 つま先ＩＫ 改道 leftToes（P1b）
    expect(report.bindings).toHaveLength(2);
    expect(clip.tracks).toHaveLength(4);
  });

  it("缺省缩放由身高估算（标准站姿 ⇒ 0.08）", () => {
    const { report } = buildVmdRetargetClip(E2E_VMD, makeRig(makeStandingRig()));
    expect(report.positionScale).toBeCloseTo(0.08, 6);
  });

  it("无任何可用映射 → 空 clip，不抛", () => {
    const { clip, report } = buildVmdRetargetClip(E2E_VMD, makeRig({}));
    expect(clip.tracks).toEqual([]);
    expect(report.bindings).toEqual([]);
    expect(report.translationSource).toBeNull();
  });

  it("VMD 未驱动任何候选骨 → 空 clip", () => {
    const { clip } = buildVmdRetargetClip(
      makeFakeVmd([bone("謎ボーン", 0)]),
      makeRig(makeStandingRig()),
    );
    expect(clip.tracks).toEqual([]);
  });

  it("clip 时长按 MMD 帧率 30fps 换算（第 30 帧 ⇒ 1s）", () => {
    const { clip } = buildVmdRetargetClip(E2E_VMD, makeRig(makeStandingRig()), { positionScale: 1 });
    expect(clip.duration).toBeCloseTo(1, 6);
  });

  // ── 足 IK 目标出口（ADR-243 §2.8 方案 A 的重定向侧）──

  it("足 IK 目标：采样含轴系翻转 + 比例缩放，时间 clamp 到首末关键帧", () => {
    const { footIK } = buildVmdRetargetClip(E2E_VMD, makeRig(makeStandingRig()), {
      positionScale: 0.5,
    });

    expect(footIK.right).toBeNull();
    const left = footIK.left;
    if (!left) throw new Error("左足ＩＫ 未被摘出");

    const out = new THREE.Vector3();
    expect(left.sample(1, out)).toBe(true); // 第 30 帧 ÷ 30fps
    expectValues(out.toArray(), [0.5, 1, -1.5]); // (1,2,3) → z 翻转 → ×0.5

    expect(left.sample(99, out)).toBe(true); // 超尾 → 末帧
    expectValues(out.toArray(), [0.5, 1, -1.5]);
    expect(left.sample(-5, out)).toBe(true); // 超首 → 首帧
    expectValues(out.toArray(), [0, 0, 0]);
  });

  it("足 IK 目标走真实 buildAnimation 的插值（中间时刻落在两端之间）", () => {
    const { footIK } = buildVmdRetargetClip(E2E_VMD, makeRig(makeStandingRig()), {
      positionScale: 1,
    });
    const left = footIK.left;
    if (!left) throw new Error("左足ＩＫ 未被摘出");

    const out = new THREE.Vector3();
    expect(left.sample(0.5, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(1);
  });

  it("VMD 未驱动 IK 骨 → footIK 双侧 null（不产空采样器）", () => {
    const { footIK } = buildVmdRetargetClip(
      makeFakeVmd([bone("左腕", 0)]),
      makeRig(makeStandingRig()),
      { positionScale: 1 },
    );

    expect(footIK).toEqual({ left: null, right: null });
  });

  // ── つま先ＩＫ 改道端到端（P1b）──

  it("つま先ＩＫ quaternion 改道到 leftToes：轴系翻转 + 贝塞尔存活", () => {
    const nodes = makeStandingRig();
    const { clip } = buildVmdRetargetClip(E2E_VMD, makeRig(nodes), { positionScale: 0.5 });

    const toe = trackByName(clip, `${nodes.leftToes?.uuid}.quaternion`);
    // 第 2 帧（index 4..7）：(0.2, 0, 0, 0.98) → (-0.2, 0, 0, 0.98)
    expectValues(toe.values, [-0.2, 0, 0, 0.98], 4);
    expect(Object.hasOwn(toe, "createInterpolant")).toBe(true);
  });
});
