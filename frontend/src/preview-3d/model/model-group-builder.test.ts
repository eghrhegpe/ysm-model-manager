// @vitest-environment node
// ===== model-group-builder 纯逻辑测试（零 WebGL）=====
// buildModelGroup 只依赖 mesh/cube-mesh + quaternion 纯函数（buildCubeMeshData / computeBoneLocalPos），
// 不触碰 Three 渲染器，可在 node 环境跑。
// 锁：空模型回退、纹理尺寸默认、X 轴翻转的局部坐标口径、断裂父子链/左右臂挂接。
import { describe, it, expect } from "vitest";
import { buildModelGroup } from "./model-group-builder.ts";
import type { BedrockModel, Cube2D } from "./spec-builder.ts";

const cube = (origin: [number, number, number] = [0, 0, 0]): Cube2D => ({
  origin,
  size: [1, 1, 1],
  pivot: [0, 0, 0],
  pivotSet: false,
  uv: [0, 0],
  faceUV: "{}",
  rotation: [0, 0, 0],
  texSlot: 0,
  inflate: 0,
  mirror: false,
  cubeTexW: 64,
  cubeTexH: 64,
});

const makeModel = (bones: BedrockModel["bones"], overrides: Partial<BedrockModel> = {}): BedrockModel => ({
  boneCount: bones.length,
  cubeCount: bones.reduce((n, b) => n + b.cubes.length, 0),
  texWidth: 0,
  texHeight: 0,
  sourceName: "test-model",
  format: "bedrock",
  bones,
  ...overrides,
});

describe("buildModelGroup — 空模型回退", () => {
  it("无 bones → 空壳组（id/name=compID，纹理 0，bones/meshGroups 空，textureId null）", () => {
    const g = buildModelGroup(makeModel([]), "comp-a", 0);
    expect(g.id).toBe("comp-a");
    expect(g.name).toBe("comp-a");
    expect(g.textureWidth).toBe(0);
    expect(g.textureHeight).toBe(0);
    expect(g.textureId).toBeNull();
    expect(g.bones).toEqual([]);
    expect(g.meshGroups).toEqual([]);
    expect(g.defaultVisible).toBe(true);
  });
});

describe("buildModelGroup — 纹理尺寸与命名", () => {
  it("texWidth/Height 为 0 时回退默认 64×64", () => {
    const g = buildModelGroup(
      makeModel([{ name: "b", parent: "", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [], groupId: "" }]),
      "comp-b",
      0,
    );
    expect(g.textureWidth).toBe(64);
    expect(g.textureHeight).toBe(64);
  });

  it("model.sourceName 存在时作为组名", () => {
    const g = buildModelGroup(
      makeModel([{ name: "b", parent: "", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [], groupId: "" }], {
        sourceName: "角色A",
      }),
      "comp-c",
      0,
    );
    expect(g.name).toBe("角色A");
  });
});

describe("buildModelGroup — 骨骼局部坐标口径（ysmview X 轴翻转）", () => {
  it("根骨骼无父：localPosition = [-pivot.x, pivot.y, pivot.z]", () => {
    const g = buildModelGroup(
      makeModel([
        { name: "body", parent: "", pivot: [1, 2, 3], rotation: [0, 0, 0], cubes: [], groupId: "" },
      ]),
      "comp-root",
      0,
    );
    const body = g.bones.find((b) => b.name === "body");
    expect(body).toBeDefined();
    expect(body!.parentId).toBeNull();
    expect(body!.localPosition).toEqual([-1, 2, 3]);
  });

  it("子骨骼：localPosition = [parent.x - bone.x, bone.y - parent.y, bone.z - parent.z]", () => {
    const g = buildModelGroup(
      makeModel([
        { name: "body", parent: "", pivot: [1, 2, 3], rotation: [0, 0, 0], cubes: [], groupId: "" },
        { name: "head", parent: "body", pivot: [1, 5, 3], rotation: [0, 0, 0], cubes: [], groupId: "" },
      ]),
      "comp-child",
      0,
    );
    const head = g.bones.find((b) => b.name === "head");
    expect(head).toBeDefined();
    expect(head!.parentId).toBe("body");
    expect(head!.localPosition).toEqual([0, 3, 0]);
  });
});

describe("buildModelGroup — 游离左右臂挂接到 Arm（postProcess）", () => {
  it("无父链的 LeftArm/RightArm 挂回已定父的 Arm 并重算局部坐标", () => {
    const g = buildModelGroup(
      makeModel([
        { name: "root", parent: "", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [], groupId: "" },
        { name: "Arm", parent: "root", pivot: [1, 10, 0], rotation: [0, 0, 0], cubes: [], groupId: "" },
        { name: "RightArm", parent: "", pivot: [1, 12, 0], rotation: [0, 0, 0], cubes: [], groupId: "" },
        { name: "LeftArm", parent: "", pivot: [1, 13, 0], rotation: [0, 0, 0], cubes: [], groupId: "" },
      ]),
      "comp-arm",
      0,
    );
    const right = g.bones.find((b) => b.name === "RightArm");
    const left = g.bones.find((b) => b.name === "LeftArm");
    expect(right!.parentId).toBe("Arm");
    expect(right!.localPosition).toEqual([0, 2, 0]);
    expect(left!.parentId).toBe("Arm");
    expect(left!.localPosition).toEqual([0, 3, 0]);
  });
});

describe("buildModelGroup — cube 参与网格构建", () => {
  it("骨骼带 cube 时产出对应 meshGroups，且 _cubeCount 被回填", () => {
    const g = buildModelGroup(
      makeModel([
        {
          name: "body",
          parent: "",
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [cube([0, 0, 0])],
          groupId: "",
        },
      ]),
      "comp-cube",
      0,
    );
    expect(g.meshGroups.length).toBe(1);
    expect(g.bones[0]._cubeCount).toBe(1);
  });
});