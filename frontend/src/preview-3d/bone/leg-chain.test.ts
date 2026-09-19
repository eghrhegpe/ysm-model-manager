// @vitest-environment node
// ===== leg-chain.ts 契约测试（ADR-243 §2.8「链根取大腿的直接父骨」）=====
// extractLegChains 是 mmd-foot-ik（待机锚地）与 vrm-foot-ik（VMD 足ＩＫ）共用的腿链提取，
// 此前仅经 createVrmFootIKController 间接经过，其自身分支无人钉死：
//   - 链根 = 大腿的**直接父骨**（不硬编码 hips 语义名，格式无关）；
//   - 父骨缺失 / 悬空（无 object）→ 回退大腿自身，宁可 3 节链也不整腿失效；
//   - foot 不在大腿祖先链上 → 整腿缺席（不占位）；
//   - 输出恒 left→right；缺骨的一侧缺席。
// 这条约定一旦分叉，症状是「某格式的腿只动膝盖」且**不报错**（见文件头），故须编译/测试期钉死。
//
// 关键：extractIKChainFromTree 沿 BoneTree.byId 的 parentId 走链，**不依赖 Object3D 层级**，
// 故 fixture 只需在 byId 每节挂一个 object，无需 add() 成真实父子。
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBoneTree } from "./bone-tools.ts";
import { extractLegChains } from "./leg-chain.ts";
import type { SemanticBoneEntry, SemanticBoneMap } from "./semantic-bones.ts";

const obj = (): THREE.Object3D => new THREE.Object3D();
const sem = (id: string, object: THREE.Object3D): SemanticBoneEntry => ({ id, object });

/** 一条腿的三节 object：大腿 → 膝盖 → 踝 */
function makeLegObjs(): { upper: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D } {
  return { upper: obj(), knee: obj(), foot: obj() };
}

describe("extractLegChains — 正常双腿（链根取直接父骨）", () => {
  it("VRM 形态：[骨盆,大腿,膝盖,踝] 4 节，链根 = 大腿父骨（非大腿自身）", () => {
    const pelvis = obj();
    const l = makeLegObjs();
    const r = makeLegObjs();
    const tree = buildBoneTree([
      { id: "hips", name: "hips", parentId: null, object: pelvis },
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: "hips", object: l.upper },
      { id: "leftLowerLeg", name: "leftLowerLeg", parentId: "leftUpperLeg", object: l.knee },
      { id: "leftFoot", name: "leftFoot", parentId: "leftLowerLeg", object: l.foot },
      { id: "rightUpperLeg", name: "rightUpperLeg", parentId: "hips", object: r.upper },
      { id: "rightLowerLeg", name: "rightLowerLeg", parentId: "rightUpperLeg", object: r.knee },
      { id: "rightFoot", name: "rightFoot", parentId: "rightLowerLeg", object: r.foot },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("leftFoot", l.foot),
      rightUpperLeg: sem("rightUpperLeg", r.upper),
      rightFoot: sem("rightFoot", r.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    // 顺序恒 left→right
    expect(legs.map((g) => g.side)).toEqual(["left", "right"]);
    // 左腿：链根取骨盆（4 节），末端 = 踝 = chain 末元素同引用
    expect(legs[0].chain).toHaveLength(4);
    expect(legs[0].chain.map((o) => o)).toEqual([pelvis, l.upper, l.knee, l.foot]);
    expect(legs[0].endEffector).toBe(l.foot);
    expect(legs[0].endEffector).toBe(legs[0].chain[legs[0].chain.length - 1]);
    expect(legs[1].endEffector).toBe(r.foot);
  });

  it("MMD 形态：大腿父骨名为「下半身」而非 hips —— 证明按结构取父骨、不硬编码语义名", () => {
    const pelvis = obj(); // id 是「下半身」，不是 hips
    const l = makeLegObjs();
    const tree = buildBoneTree([
      { id: "下半身", name: "下半身", parentId: null, object: pelvis },
      { id: "左足", name: "左足", parentId: "下半身", object: l.upper },
      { id: "左ひざ", name: "左ひざ", parentId: "左足", object: l.knee },
      { id: "左足首", name: "左足首", parentId: "左ひざ", object: l.foot },
    ]);
    // 语义表把 leftUpperLeg/leftFoot 指向 MMD 真实骨 id
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("左足", l.upper),
      leftFoot: sem("左足首", l.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    expect(legs).toHaveLength(1);
    expect(legs[0].side).toBe("left");
    // 链根 = 左足的直接父骨「下半身」（大腿父骨，非大腿自身），4 节
    expect(legs[0].chain).toEqual([pelvis, l.upper, l.knee, l.foot]);
  });
});

describe("extractLegChains — 回退 3 节链（宁可少一节也不整腿失效）", () => {
  it("大腿即树根（无父骨）→ 链根回退大腿自身，3 节", () => {
    const l = makeLegObjs();
    const tree = buildBoneTree([
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: null, object: l.upper },
      { id: "leftLowerLeg", name: "leftLowerLeg", parentId: "leftUpperLeg", object: l.knee },
      { id: "leftFoot", name: "leftFoot", parentId: "leftLowerLeg", object: l.foot },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("leftFoot", l.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    expect(legs[0].chain).toEqual([l.upper, l.knee, l.foot]); // 大腿起，3 节
  });

  it("父骨存在但缺 object（悬空）→ 回退大腿自身，3 节", () => {
    const l = makeLegObjs();
    const tree = buildBoneTree([
      { id: "hips", name: "hips", parentId: null }, // 有节点、无 object
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: "hips", object: l.upper },
      { id: "leftLowerLeg", name: "leftLowerLeg", parentId: "leftUpperLeg", object: l.knee },
      { id: "leftFoot", name: "leftFoot", parentId: "leftLowerLeg", object: l.foot },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("leftFoot", l.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    // chainRootId 回退为大腿自身（父骨无 object 不可作锚点）⇒ 3 节链
    expect(legs[0].chain).toEqual([l.upper, l.knee, l.foot]);
  });
});

describe("extractLegChains — 缺席（不占位）", () => {
  it("foot 不在大腿祖先链上 → 整腿缺席（不产出半截链）", () => {
    const pelvis = obj();
    const l = makeLegObjs();
    const orphan = obj(); // 踝挂在别处，不在大腿子树
    const tree = buildBoneTree([
      { id: "hips", name: "hips", parentId: null, object: pelvis },
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: "hips", object: l.upper },
      { id: "leftLowerLeg", name: "leftLowerLeg", parentId: "leftUpperLeg", object: l.knee },
      { id: "leftFoot", name: "leftFoot", parentId: "orphan", object: l.foot },
      { id: "orphan", name: "orphan", parentId: null, object: orphan },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("leftFoot", l.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    expect(legs).toEqual([]); // 大腿父骨 / 大腿自身两条根都无法抵达 foot → 该腿缺席
  });

  it("语义表只给一侧（另一侧缺 upperLeg/foot）→ 另一侧缺席，不占位", () => {
    const pelvis = obj();
    const r = makeLegObjs();
    const tree = buildBoneTree([
      { id: "hips", name: "hips", parentId: null, object: pelvis },
      { id: "rightUpperLeg", name: "rightUpperLeg", parentId: "hips", object: r.upper },
      { id: "rightLowerLeg", name: "rightLowerLeg", parentId: "rightUpperLeg", object: r.knee },
      { id: "rightFoot", name: "rightFoot", parentId: "rightLowerLeg", object: r.foot },
    ]);
    const semanticBones: SemanticBoneMap = {
      rightUpperLeg: sem("rightUpperLeg", r.upper),
      rightFoot: sem("rightFoot", r.foot),
    };

    const legs = extractLegChains(tree, semanticBones);

    expect(legs.map((g) => g.side)).toEqual(["right"]); // 左腿缺席不占位
  });

  it("语义命中但树中无该骨 id → 该腿缺席", () => {
    const l = makeLegObjs();
    const tree = buildBoneTree([
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: null, object: l.upper },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("missingFootId", obj()), // foot id 不在 byId
    };

    const legs = extractLegChains(tree, semanticBones);

    expect(legs).toEqual([]);
  });
});

describe("extractLegChains — 入参降级", () => {
  it("boneTree=null 或 semanticBones=undefined → 空数组（不抛）", () => {
    const l = makeLegObjs();
    const tree = buildBoneTree([
      { id: "leftUpperLeg", name: "leftUpperLeg", parentId: null, object: l.upper },
      { id: "leftFoot", name: "leftFoot", parentId: "leftUpperLeg", object: l.foot },
    ]);
    const semanticBones: SemanticBoneMap = {
      leftUpperLeg: sem("leftUpperLeg", l.upper),
      leftFoot: sem("leftFoot", l.foot),
    };

    expect(extractLegChains(null, semanticBones)).toEqual([]);
    expect(extractLegChains(tree, undefined)).toEqual([]);
    expect(extractLegChains(null, undefined)).toEqual([]);
    expect(extractLegChains(tree, {})).toEqual([]);
  });
});
