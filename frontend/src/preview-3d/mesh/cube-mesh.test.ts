// ===== cube-mesh.test.ts — 立方体几何构建测试 =====
// 覆盖 buildCubeMeshData（核心渲染路径）、mergeCubes、computeBoneLocalPos。
// 对齐 Go threejs/spec.go buildCubeMeshData 口径，双边测试锁定（ADR-049 P2-2 范式）。
import { describe, it, expect } from "vitest";
import { buildCubeMeshData, mergeCubes, computeBoneLocalPos } from "./cube-mesh.ts";
import type { Cube2D, Vec3 } from "@/preview-3d/model/spec-builder.ts";

/** 构造一份最小合法 Cube2D（1×1×1 立方体，无 inflate/mirror/rotation） */
function buildCube(overrides: Partial<Cube2D> = {}): Cube2D {
  return {
    origin: [0, 0, 0],
    size: [1, 1, 1],
    pivot: [0, 0, 0],
    pivotSet: false,
    uv: [0, 0],
    faceUV: "",
    rotation: [0, 0, 0],
    texSlot: 0,
    inflate: 0,
    mirror: false,
    cubeTexW: 0,
    cubeTexH: 0,
    ...overrides,
  };
}

const bonePivot: Vec3 = { x: 0, y: 0, z: 0 };

describe("buildCubeMeshData", () => {
  it("基础立方体 → 24 顶点 / 36 索引 / 6 面", () => {
    const mesh = buildCubeMeshData(buildCube(), bonePivot, 16, 16, "root", 0);
    expect(mesh).not.toBeNull();
    if (!mesh) return;
    // 6 面 × 4 顶点 = 24 positions（每个 3 分量 → 72）
    expect(mesh.positions.length).toBe(72);
    // 6 面 × 6 索引 = 36
    expect(mesh.indices.length).toBe(36);
    // 6 面 × 4 法线 = 24（每个 3 分量 → 72）
    expect(mesh.normals.length).toBe(72);
    // 6 面 × 8 UV = 48
    expect(mesh.uvs.length).toBe(48);
  });

  it("texW=0 → 无 UV 展开，uvs 全零（expandBoxUV 守卫）", () => {
    const mesh = buildCubeMeshData(buildCube(), bonePivot, 0, 16, "root", 0);
    expect(mesh).not.toBeNull();
    if (!mesh) return;
    expect(mesh.uvs.every((u) => u === 0)).toBe(true);
  });

  it("NaN origin → 返回 null（有限性守卫）", () => {
    const cube = buildCube({ origin: [NaN, 0, 0] });
    expect(buildCubeMeshData(cube, bonePivot, 16, 16, "root", 0)).toBeNull();
  });

  it("Infinity size → 返回 null", () => {
    const cube = buildCube({ size: [1, Infinity, 1] });
    expect(buildCubeMeshData(cube, bonePivot, 16, 16, "root", 0)).toBeNull();
  });

  it("inflate=2 → origin 各轴 -2、size 各轴 +4（顶点相对 pivot）", () => {
    const cube = buildCube({
      origin: [10, 10, 10],
      size: [6, 6, 6],
      inflate: 2,
      pivotSet: true,
      pivot: [0, 0, 0],
    });
    const mesh = buildCubeMeshData(cube, bonePivot, 16, 16, "root", 0);
    expect(mesh).not.toBeNull();
    // inflate 后 origin=8、size=10，pivot=[0,0,0]
    // min 顶点=8、max 顶点=18，相对 pivot 仍是 8/18
    expect(mesh!.positions).toContain(8);
    expect(mesh!.positions).toContain(18);
  });

  it("负 size → clamp 到 CUBE_EPSILON（不产生负体积）", () => {
    const cube = buildCube({ size: [-5, -5, -5] });
    const mesh = buildCubeMeshData(cube, bonePivot, 16, 16, "root", 0);
    expect(mesh).not.toBeNull();
    // clamp 后 size ≥ epsilon，positions 不含 -5
    expect(mesh!.positions).not.toContain(-5);
  });

  it("mirror=true → east/west 矩形互换后各自水平翻转（Blockbench mirror 两步）", () => {
    // 黄金参照 blockbench cube.js updateUV mirror_uv（L1298-1316）：
    // ① 每面矩形自身水平翻转；② east 与 west (from,size) 整体互换。
    // 1×1×1 cube @ tex16，box uv[0,0]：非 mirror east u∈[0,.0625]、
    // west fu=1 → u∈[.0625,.125]。旧实现只做 ①（b.uvs[0]==a.uvs[2]），
    // 缺 ② → mirror 对称件左右臂贴图互换（女仆左臂青条事故）。
    const a = buildCubeMeshData(buildCube({ uv: [0, 0] }), bonePivot, 16, 16, "root", 0)!;
    const b = buildCubeMeshData(buildCube({ uv: [0, 0], mirror: true }), bonePivot, 16, 16, "root", 0)!;
    // mirror east = 非 mirror west（索引 8..15）翻转：u0↔u2
    expect(b.uvs[0]).toBe(a.uvs[8 + 2]);
    expect(b.uvs[2]).toBe(a.uvs[8 + 0]);
    // mirror west = 非 mirror east 翻转
    expect(b.uvs[8]).toBe(a.uvs[2]);
    expect(b.uvs[10]).toBe(a.uvs[0]);
    // v 分量不参与翻转/互换
    expect(b.uvs[1]).toBe(a.uvs[9]);
  });

  it('meshID = boneID + "_" + cubeIdx', () => {
    const mesh = buildCubeMeshData(buildCube(), bonePivot, 16, 16, "arm", 3);
    expect(mesh).not.toBeNull();
    expect(mesh!.id).toBe("arm_3");
    expect(mesh!.boneId).toBe("arm");
  });

  /** 取某面 8 个 UV（面序 east/west/up/down/south/north） */
  function faceUVs(mesh: NonNullable<ReturnType<typeof buildCubeMeshData>>, face: number): number[] {
    return mesh.uvs.slice(face * 8, face * 8 + 8);
  }

  it("per-face UV：up/down 角点按 GeoCube 反向环绕序（foxcar 贴图颠倒回归）", () => {
    // 黄金参照 GeoCube.java（up=[P4,P8,P7,P3]/down=[P1,P5,P6,P2]）+ GeoQuad.java。
    // 本包 pack 顶点序 up=[P3,P7,P4,P8]/down=[P2,P6,P1,P5] → up/down 必须铺
    // [(u2,v2),(u1,v2),(u2,v1),(u1,v1)]；侧面保持 [(u1,v1),(u2,v1),(u1,v2),(u2,v2)]。
    // down 用负 uv_size（foxcar 544/544），有符号原始坐标不做 min/max 归一化。
    const cube = buildCube({
      pivot: [4, 4, 4],
      pivotSet: true,
      size: [8, 8, 8],
      faceUV:
        '{"east":{"uv":[0,8],"uv_size":[8,8]},' +
        '"up":{"uv":[0,8],"uv_size":[8,8]},' +
        '"down":{"uv":[8,16],"uv_size":[8,-8]}}',
    });
    const mesh = buildCubeMeshData(cube, bonePivot, 64, 64, "root", 0)!;
    expect(faceUVs(mesh, 0)).toEqual([0, 0.125, 0.125, 0.125, 0, 0.25, 0.125, 0.25]); // east 侧面序不变
    expect(faceUVs(mesh, 2)).toEqual([0.125, 0.25, 0, 0.25, 0.125, 0.125, 0, 0.125]); // up 反向
    expect(faceUVs(mesh, 3)).toEqual([0.25, 0.125, 0.125, 0.125, 0.25, 0.25, 0.125, 0.25]); // down 负尺寸反向
  });

  it("box UV：up/down 打包结果与旧负 fw/fh 技巧逐值一致（box 模型零回归）", () => {
    const cube = buildCube({ pivot: [4, 4, 4], pivotSet: true, size: [8, 8, 8], uv: [0, 0] });
    const mesh = buildCubeMeshData(cube, bonePivot, 64, 64, "root", 0)!;
    expect(faceUVs(mesh, 2)).toEqual([0.25, 0.125, 0.125, 0.125, 0.25, 0, 0.125, 0]);
    expect(faceUVs(mesh, 3)).toEqual([0.375, 0, 0.25, 0, 0.375, 0.125, 0.25, 0.125]);
  });

  it("box UV + mirror：east/west 矩形互换 + 六面逐面翻转（女仆左臂青条回归）", () => {
    // 与 Go TestBuildCubeMeshData_BoxMirrorEastWestSwap 同构双锁。
    // 8³ cube @ box uv[0,0] tex64，mirror 后打包结果（face 序 east/west/up/down/south/north）：
    const cube = buildCube({
      pivot: [4, 4, 4],
      pivotSet: true,
      size: [8, 8, 8],
      uv: [0, 0],
      mirror: true,
    });
    const mesh = buildCubeMeshData(cube, bonePivot, 64, 64, "root", 0)!;
    expect(faceUVs(mesh, 0)).toEqual([0.375, 0.125, 0.25, 0.125, 0.375, 0.25, 0.25, 0.25]);
    expect(faceUVs(mesh, 1)).toEqual([0.125, 0.125, 0, 0.125, 0.125, 0.25, 0, 0.25]);
    expect(faceUVs(mesh, 2)).toEqual([0.125, 0.125, 0.25, 0.125, 0.125, 0, 0.25, 0]);
    expect(faceUVs(mesh, 3)).toEqual([0.25, 0, 0.375, 0, 0.25, 0.125, 0.375, 0.125]);
    expect(faceUVs(mesh, 4)).toEqual([0.5, 0.125, 0.375, 0.125, 0.5, 0.25, 0.375, 0.25]);
    expect(faceUVs(mesh, 5)).toEqual([0.25, 0.125, 0.125, 0.125, 0.25, 0.25, 0.125, 0.25]);
  });

  it("per-face UV + mirror：up 水平翻转后角点 = [(u1,v2),(u2,v2),(u1,v1),(u2,v1)]", () => {
    const cube = buildCube({
      pivot: [4, 4, 4],
      pivotSet: true,
      size: [8, 8, 8],
      mirror: true,
      faceUV: '{"up":{"uv":[0,8],"uv_size":[8,8]}}',
    });
    const mesh = buildCubeMeshData(cube, bonePivot, 64, 64, "root", 0)!;
    expect(faceUVs(mesh, 2)).toEqual([0, 0.25, 0.125, 0.25, 0, 0.125, 0.125, 0.125]);
  });

  it("localPosition = bonePivot - cubePivot（X 翻转口径）", () => {
    const cube = buildCube({
      origin: [2, 2, 2],
      size: [2, 2, 2],
      pivot: [3, 3, 3],
      pivotSet: true,
    });
    const bp: Vec3 = { x: 10, y: 10, z: 10 };
    const mesh = buildCubeMeshData(cube, bp, 16, 16, "root", 0);
    expect(mesh).not.toBeNull();
    // localPos = [bonePivot.x - cp.x, cp.y - bonePivot.y, cp.z - bonePivot.z]
    // = [10-3, 3-10, 3-10] = [7, -7, -7]
    expect(mesh!.localPosition).toEqual([7, -7, -7]);
  });

  it("rotation=[90,0,0] → localRotation 为有效四元数", () => {
    const cube = buildCube({ rotation: [90, 0, 0] });
    const mesh = buildCubeMeshData(cube, bonePivot, 16, 16, "root", 0);
    expect(mesh).not.toBeNull();
    const q = mesh!.localRotation;
    expect(q.length).toBe(4);
    // 四元数模长应 ≈ 1（归一化旋转）
    const mag = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2);
    expect(mag).toBeCloseTo(1, 4);
  });
});

describe("mergeCubes", () => {
  it("空旧集 + 新集 → 新集全追加", () => {
    const nc = buildCube({ origin: [1, 1, 1] });
    const result = mergeCubes([], [nc]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(nc);
  });

  it("相同 origin/size/rotation → 替换旧 cube", () => {
    const old = buildCube({ origin: [0, 0, 0], size: [2, 2, 2] });
    const nc = buildCube({ origin: [0, 0, 0], size: [2, 2, 2] });
    const result = mergeCubes([old], [nc]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(nc);
  });

  it("不同 origin → 不匹配，追加", () => {
    const old = buildCube({ origin: [0, 0, 0], size: [1, 1, 1] });
    const nc = buildCube({ origin: [10, 10, 10], size: [1, 1, 1] });
    const result = mergeCubes([old], [nc]);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(old);
    expect(result[1]).toBe(nc);
  });

  it("一个旧 cube 匹配后不再被后续新 cube 匹配", () => {
    const old = buildCube({ origin: [0, 0, 0], size: [4, 4, 4] });
    const nc1 = buildCube({ origin: [0, 0, 0], size: [4, 4, 4] });
    const nc2 = buildCube({ origin: [2, 2, 2], size: [2, 2, 2] });
    const result = mergeCubes([old], [nc1, nc2]);
    // nc1 匹配 old → 替换；nc2 origin 不同 → 追加
    expect(result.length).toBe(2);
  });
});

describe("computeBoneLocalPos", () => {
  it("根骨骼（无父）→ X 翻转 [-pivot.x, pivot.y, pivot.z]", () => {
    const bone: Vec3 = { x: 5, y: 3, z: 7 };
    const result = computeBoneLocalPos(bone, null);
    expect(result).toEqual([-5, 3, 7]);
  });

  it("有父骨骼 → [parent.x-bone.x, bone.y-parent.y, bone.z-parent.z]", () => {
    const bone: Vec3 = { x: 2, y: 5, z: 3 };
    const parent: Vec3 = { x: 8, y: 1, z: 6 };
    const result = computeBoneLocalPos(bone, parent);
    expect(result).toEqual([6, 4, -3]);
  });

  it("零 pivot 根骨骼 → 全零（-0 === 0 不区分）", () => {
    const bone: Vec3 = { x: 0, y: 0, z: 0 };
    const result = computeBoneLocalPos(bone, null);
    // -0 === 0 在 JS 中为 true（仅 Object.is 区分）
    expect(result[0] === 0).toBe(true);
    expect(result[1] === 0).toBe(true);
    expect(result[2] === 0).toBe(true);
  });
});
