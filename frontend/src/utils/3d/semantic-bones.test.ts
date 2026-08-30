// @vitest-environment node
// ===== 语义骨骼层测试（semantic-bones.ts）=====
// 覆盖：候选名匹配（日/英变体、优先级、缺省）、MMD 映射（歧义消解：上半身2 →
// upperChest 不归 chest）、VRM 直产映射、宽容缺省、消费方入口。

import { describe, expect, it } from "vitest";
import { buildBoneTree, type BoneTree } from "./bone-tools.ts";
import {
  getSemanticBone,
  matchSemanticBone,
  mmdSemanticBoneMap,
  resolveSemanticBones,
  vrmSemanticBoneMap,
  type SemanticBoneMap,
} from "./semantic-bones.ts";

/** 构造骨架测试树：MMD 风格（id = 索引字符串，name = 骨骼名） */
function mmdTree(names: string[]): BoneTree {
  return buildBoneTree(
    names.map((n, i) => ({ id: String(i), name: n, parentId: i > 0 ? String(i - 1) : null })),
  );
}

/** 构造 VRM 风格 humanBones（键 = 语义名） */
function vrmHumanBones(keys: string[]): Record<string, { node?: { name: string } }> {
  return Object.fromEntries(keys.map((k) => [k, { node: { name: k } }]));
}

describe("matchSemanticBone", () => {
  it("MMD 日文标准名命中（name 匹配，id 是索引不参与）", () => {
    const tree = mmdTree(["センター", "腰", "上半身", "頭"]);
    expect(matchSemanticBone(tree, ["上半身", "chest"])?.id).toBe("2");
  });

  it("英文变体命中（导出名常见形态）", () => {
    const tree = mmdTree(["root", "Chest", "Head"]);
    expect(matchSemanticBone(tree, ["chest", "Chest"])?.name).toBe("Chest");
    expect(matchSemanticBone(tree, ["頭", "head", "Head"])?.name).toBe("Head");
  });

  it("候选顺序即优先级：首命中胜出", () => {
    const tree = mmdTree(["腰", "上半身"]);
    // 候选 [上半身, 腰] 命中 上半身，而非 腰
    expect(matchSemanticBone(tree, ["上半身", "腰"])?.name).toBe("上半身");
  });

  it("无命中返回 null（宽容缺省）", () => {
    const tree = mmdTree(["腰", "頭"]);
    expect(matchSemanticBone(tree, ["上半身", "chest"])).toBeNull();
    expect(matchSemanticBone(buildBoneTree([]), ["頭"])).toBeNull();
  });

  it("VRM 风格（id === name）两路等效", () => {
    const tree = buildBoneTree([{ id: "chest", name: "chest" }]);
    expect(matchSemanticBone(tree, ["chest"])?.id).toBe("chest");
  });
});

describe("resolveSemanticBones / mmdSemanticBoneMap", () => {
  it("MMD 标准骨骼全命中：语义映射正确", () => {
    const tree = mmdTree([
      "センター", // 0 center
      "腰", // 1 hips
      "上半身", // 2 chest
      "首", // 3 neck
      "頭", // 4 head
      "左肩", // 5 leftShoulder
      "右肩", // 6 rightShoulder
      "左腕", // 7 leftUpperArm
      "右腕", // 8 rightUpperArm
      "左ひじ", // 9 leftLowerArm
      "右ひじ", // 10 rightLowerArm
      "左足", // 11 leftUpperLeg
      "右足", // 12 rightUpperLeg
      "左足首", // 13 leftFoot
      "右足首", // 14 rightFoot
    ]);
    const map = mmdSemanticBoneMap(tree);
    expect(map.center?.id).toBe("0");
    expect(map.hips?.id).toBe("1");
    expect(map.chest?.id).toBe("2");
    expect(map.neck?.id).toBe("3");
    expect(map.head?.id).toBe("4");
    expect(map.leftShoulder?.id).toBe("5");
    expect(map.rightShoulder?.id).toBe("6");
    expect(map.leftUpperArm?.id).toBe("7");
    expect(map.rightUpperArm?.id).toBe("8");
    expect(map.leftLowerArm?.id).toBe("9");
    expect(map.rightLowerArm?.id).toBe("10");
    expect(map.leftUpperLeg?.id).toBe("11");
    expect(map.rightUpperLeg?.id).toBe("12");
    expect(map.leftFoot?.id).toBe("13");
    expect(map.rightFoot?.id).toBe("14");
  });

  it("歧义消解：上半身2 归 upperChest，不污染 chest", () => {
    const tree = mmdTree(["腰", "上半身", "上半身2", "首", "頭"]);
    const map = mmdSemanticBoneMap(tree);
    expect(map.chest?.id).toBe("1"); // chest 独占 上半身（索引 1）
    expect(map.upperChest?.id).toBe("2"); // upperChest 独占 上半身2（索引 2）
    expect(map.spine).toBeUndefined(); // 无 spine 候选命中 → 缺省
  });

  it("部分骨骼缺失 → 宽容缺省（消费方 getSemanticBone 返回 null）", () => {
    const tree = mmdTree(["腰", "頭"]); // 只有 hips + head
    const map = mmdSemanticBoneMap(tree);
    expect(map.hips?.id).toBe("0");
    expect(map.head?.id).toBe("1");
    expect(getSemanticBone(map, "chest")).toBeNull();
    expect(getSemanticBone(map, "leftUpperArm")).toBeNull();
  });

  it("空树 → 空映射（不抛）", () => {
    expect(mmdSemanticBoneMap(buildBoneTree([]))).toEqual({});
  });

  it("resolveSemanticBones 接受自定义候选表（测试扩展性）", () => {
    const tree = buildBoneTree([{ id: "a", name: "Body" }]);
    const map = resolveSemanticBones(tree, {
      chest: ["Body"],
    } as unknown as Record<string, readonly string[]>);
    expect(map.chest?.id).toBe("a");
  });
});

describe("vrmSemanticBoneMap", () => {
  it("humanoid 键天然语义化：直产映射，object 透传", () => {
    const humanBones = vrmHumanBones(["hips", "chest", "head", "leftUpperArm"]) as Record<
      string,
      { node?: { name: string } }
    >;
    const map = vrmSemanticBoneMap(humanBones as unknown as Parameters<typeof vrmSemanticBoneMap>[0]);
    expect(map.hips?.id).toBe("hips");
    expect(map.chest?.id).toBe("chest");
    expect(map.head?.id).toBe("head");
    expect(map.leftUpperArm?.id).toBe("leftUpperArm");
    // 非语义键（如手指 proximal/distal）不进入子集映射
    expect(Object.keys(map).sort()).toEqual(["chest", "head", "hips", "leftUpperArm"]);
  });

  it("空 humanBones → 空映射（不抛）", () => {
    expect(vrmSemanticBoneMap({})).toEqual({});
  });

  it("node 缺失的骨骼不进映射（与 buildVrmBoneNodes 同口径）", () => {
    const map = vrmSemanticBoneMap({ hips: {}, head: { node: { name: "head" } } } as unknown as Parameters<typeof vrmSemanticBoneMap>[0]);
    expect(map.hips).toBeUndefined();
    expect(map.head?.id).toBe("head");
  });
});

describe("getSemanticBone（消费方入口）", () => {
  it("存在返回 entry，缺失返回 null（不崩）", () => {
    const map: SemanticBoneMap = { chest: { id: "2" } };
    expect(getSemanticBone(map, "chest")?.id).toBe("2");
    expect(getSemanticBone(map, "head")).toBeNull();
    expect(getSemanticBone({}, "chest")).toBeNull();
  });
});
