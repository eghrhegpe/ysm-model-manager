// ===== model2d 命中区域坐标测试（ADR-021 扩展，防坐标回归）=====
// calcBoneHitZones：2D 正交投影热区计算（scale/偏移/骨骼位移/绕 pivot 旋转/前后视图）。
import { describe, it, expect } from "vitest";
import { calcBoneHitZones } from "./model2d.ts";

/** 便捷构造：单骨骼单 cube 模型 */
function cubeModel(bone, cube) {
  return { bones: [{ name: bone, cubes: [cube] }] };
}

const SIMPLE_CUBE = { origin: [0, 0, 0], size: [2, 4, 6] };

describe("calcBoneHitZones 基础投影", () => {
  it("前视图无旋转：x=origin.x, y=-(maxY), w=size.x, h=size.y", () => {
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, null,
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ name: "bone", x: 0, y: -4, w: 2, h: 4 });
  });

  it("scale 放大 + ox/oy 偏移生效", () => {
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      2, 100, 50, true, 1, 0, null,
    );
    expect(zones[0].x).toBe(100); // ox + mnX*scale
    expect(zones[0].y).toBe(42); // oy - mxY*scale = 50 - 4*2
    expect(zones[0].w).toBe(4); // 2*2
    expect(zones[0].h).toBe(8); // 4*2
  });

  it("骨骼 position 位移参与热区计算", () => {
    const transforms = new Map([
      ["bone", { position: [1, 2, 3], rotation: undefined }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    expect(zones[0].x).toBe(1); // x 整体 +1
    expect(zones[0].y).toBe(-6); // maxY = 4+2
    expect(zones[0].w).toBe(2);
    expect(zones[0].h).toBe(4);
  });

  it("无 cubes 的骨骼被跳过", () => {
    const zones = calcBoneHitZones(
      { bones: [{ name: "empty", cubes: [] }] },
      1, 0, 0, true, 1, 0, null,
    );
    expect(zones).toHaveLength(0);
  });

  it("模型为空返回空数组", () => {
    expect(calcBoneHitZones({}, 1, 0, 0, true, 1, 0, null)).toEqual([]);
  });
});

describe("calcBoneHitZones 旋转", () => {
  it("绕 pivot Z 轴旋转 90°：热区随旋转变化", () => {
    // pivot 默认 [1,2,3]；Z 旋转 90° 后 x∈[-1,3], y∈[1,3]
    const transforms = new Map([
      ["bone", { position: undefined, rotation: [0, 0, 90] }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    expect(zones[0].x).toBeCloseTo(-1, 5);
    expect(zones[0].y).toBeCloseTo(-3, 5);
    expect(zones[0].w).toBeCloseTo(4, 5);
    expect(zones[0].h).toBeCloseTo(2, 5);
  });

  it("视图旋转角 cosA/sinA 参与投影（Y 轴旋转）", () => {
    // 旋转 90°：cosA=0, sinA=1 → rxx = -cz, rz2 = cx
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 0, 1, null,
    );
    // 前视图 py2 = cy：x 范围取 -cz ∈ [-6,0]，y 范围 cy ∈ [0,4]
    expect(zones[0].x).toBe(-6);
    expect(zones[0].w).toBe(6);
    expect(zones[0].y).toBe(-4);
    expect(zones[0].h).toBe(4);
  });
});

describe("calcBoneHitZones 后视图", () => {
  it("isFront=false 时 py2 取 rz2（z 投影）", () => {
    // cosA=1, sinA=0 → rz2 = cz ∈ [0,6]
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, false, 1, 0, null,
    );
    expect(zones[0].x).toBe(0);
    expect(zones[0].w).toBe(2);
    expect(zones[0].y).toBe(-6); // maxY = 6（z 轴）
    expect(zones[0].h).toBe(6);
  });
});
