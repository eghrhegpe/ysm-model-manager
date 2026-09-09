// @vitest-environment node
// ===== spec-builder 契约测试（镜像 internal/app/app_model_test.go）=====
// 纯 TS 移植（ADR-049 P2-2 闭环）：buildSpecFromGeometryJSON ↔ Go
// Build3DSpecFromGeometryJSON。任一侧口径漂移都会使其中一套测试失败，双边锁定。
import { describe, it, expect } from "vitest";
import { buildSpecFromGeometryJSON } from "./spec-builder.ts";

/** Go app_model_test.go 同款 geometry fixture */
const GEO = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`;

/** 无 texture 字段的 cube：Go `Texture int` 缺省 0，spec 恒含 texIdx:0 */
const GEO_NO_TEX = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 64 },
    "bones": [{ "name": "b", "pivot": [0, 0, 0], "cubes": [{ "origin": [0, 0, 0], "size": [4, 4, 4] }] }]
  }]
}`;

/** 便捷构造 bedrock geometry JSON（镜像 Go fixture 形状：identifier + bones 数组体） */
function geo(identifier: string, bones: string): string {
  return `{
    "format_version": "1.12.0",
    "minecraft:geometry": [{
      "description": { "identifier": "${identifier}", "texture_width": 64, "texture_height": 64 },
      "bones": [${bones}]
    }]
  }`;
}

describe("buildSpecFromGeometryJSON 契约（对齐 Go TestBuild3DSpecFromGeometryJSON）", () => {
  it("空输入 → {}", () => {
    expect(buildSpecFromGeometryJSON("")).toBe("{}");
  });

  it("非法 JSON → {}", () => {
    expect(buildSpecFromGeometryJSON("not json")).toBe("{}");
  });

  it("无 minecraft:geometry → {}", () => {
    expect(buildSpecFromGeometryJSON('{"geometry":"x"}')).toBe("{}");
  });

  it("合法 geometry → 非 {}，models 与 meshGroups 非空（cube 已生成顶点）", () => {
    const got = buildSpecFromGeometryJSON(GEO);
    expect(got).not.toBe("{}");
    const spec = JSON.parse(got) as { models: { meshGroups: unknown[] }[] };
    expect(spec.models.length).toBe(1);
    expect(spec.models[0].meshGroups.length).toBeGreaterThan(0);
  });

  it("8×8×8 cube → 72 positions / 36 indices（6 面 × 4 顶点）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(GEO)) as {
      models: { meshGroups: { positions: number[]; indices: number[]; texIdx: number }[] }[];
    };
    const mesh = spec.models[0].meshGroups[0];
    expect(mesh.positions).toHaveLength(72);
    expect(mesh.indices).toHaveLength(36);
  });

  it("cube 未声明 texture → texIdx 0（对齐 Go `Texture int` 缺省，不丢键）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(GEO_NO_TEX)) as {
      models: { meshGroups: { texIdx: number }[] }[];
    };
    expect(spec.models[0].meshGroups[0].texIdx).toBe(0);
  });

  // ===== 镜像 go/threejs/spec_test.go =====

  // 镜像 Go TestBuildDuplicateBoneMerge（spec_test.go:107）
  // 同名骨骼 overwrite：第一条 b1 无 parent，第二条 b1 有 parent "p1" →
  // overwrite 语义保留带 parent 版本的 cube（cubeB 替换 cubeA），meshGroups 仅 1 条。
  it("同名骨骼 merge → meshGroups=1（overwrite 整体替换旧 cube）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.dup",
      '{ "name": "b1", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "b1", "parent": "p1", "pivot": [10,0,0], "cubes": [{ "origin": [10,0,0], "size": [2,2,2], "pivot": [11,0,0], "uv": [0,0] }] }, ' +
      '{ "name": "p1", "pivot": [0,0,0], "cubes": [] }'))) as {
      models: { bones: { name: string; parentId: string | null }[]; meshGroups: unknown[] }[];
    };
    // b1 在 bones 列表只出现一次（同名 merge）
    const b1Count = spec.models[0].bones.filter((b) => b.name === "b1").length;
    expect(b1Count).toBe(1);
    // overwrite 后只保留 cubeB → meshGroups=1
    expect(spec.models[0].meshGroups.length).toBe(1);
  });

  // 镜像 Go TestEulerToQuaternionIdentity（spec_test.go:187）
  // 骨骼 rotation=[0,0,0] → hasBoneRotation=false → localRotation=[0,0,0,1]（单位四元数）
  it("骨骼无旋转 → localRotation=[0,0,0,1]（单位四元数）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localRotation).toEqual([0, 0, 0, 1]);
  });

  // 镜像 Go TestEulerToQuaternion90X（spec_test.go:199）
  // 骨骼 rotation=[90,0,0] → localRot=eulerToQuaternion(-90,0,0) → qx≈-0.7071, qw≈0.7071, qy=qz=0
  it("骨骼 X 轴 90° 旋转 → 四元数 qx≈-0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [90,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation; // [x,y,z,w]
    expect(Math.abs(q[0] - (-0.70710678))).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
    expect(Math.abs(q[1])).toBeLessThan(1e-9);
    expect(Math.abs(q[2])).toBeLessThan(1e-9);
  });

  // 镜像 Go TestEulerToQuaternion_90Y（spec_extra_test.go:205）
  // 骨骼 rotation=[0,90,0] → localRot=eulerToQuaternion(0,-90,0) → qy≈-0.7071, qw≈0.7071
  it("骨骼 Y 轴 90° 旋转 → 四元数 qy≈-0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,90,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[1] - (-0.70710678))).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
  });

  // 镜像 Go TestEulerToQuaternion_90Z（spec_extra_test.go:216）
  // 骨骼 rotation=[0,0,90] → localRot=eulerToQuaternion(0,0,90) → qz≈0.7071, qw≈0.7071
  // （Z 轴不取反：eulerToQuaternion(-0,-0,90)）
  it("骨骼 Z 轴 90° 旋转 → 四元数 qz≈0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,0,90], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[2] - 0.70710678)).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
  });

  // 镜像 Go TestEulerToQuaternion_180X（spec_extra_test.go:227）
  // 骨骼 rotation=[180,0,0] → localRot=eulerToQuaternion(-180,0,0) → qx≈1, qw≈0
  it("骨骼 X 轴 180° 旋转 → 四元数 qx≈1 qw≈0", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [180,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[0] - 1)).toBeLessThan(1e-4);
    expect(Math.abs(q[3])).toBeLessThan(1e-4);
  });

  // 镜像 Go TestHasBoneRotation 360° 整圈用例（spec_extra_test.go:135）
  // 骨骼 rotation=[360,0,0] → hasBoneRotation=false（整圈四元数=单位四元数）
  // → localRotation=[0,0,0,1]（与无旋转一致）
  it("骨骼 360° 整圈旋转 → 视为无旋转 localRotation=[0,0,0,1]", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [360,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localRotation).toEqual([0, 0, 0, 1]);
  });

  // 镜像 Go TestMeshIDMultiCube（spec_test.go:213）
  // 单骨骼 12 cube → meshGroups=12，cubeIdx 10 的 meshID="b1_10"（十进制，无 ':' 等异常字符）
  it("12 cube 单骨骼 → meshGroups=12，meshID b1_10 存在", () => {
    const cubes: string[] = [];
    for (let i = 0; i < 12; i++) {
      cubes.push(`{ "origin": [${i * 3},0,0], "size": [1,1,1], "pivot": [${i * 3 + 1},0,0], "uv": [0,0] }`);
    }
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.multi",
      `{ "name": "b1", "pivot": [0,0,0], "cubes": [${cubes.join(",")}] }`))) as {
      models: { meshGroups: { id: string }[] }[];
    };
    expect(spec.models[0].meshGroups.length).toBe(12);
    expect(spec.models[0].meshGroups.some((m) => m.id === "b1_10")).toBe(true);
    for (const m of spec.models[0].meshGroups) {
      expect(m.id).not.toContain(":");
    }
  });

  // 镜像 Go TestParseFaceUV_AllFaces（spec_extra_test.go:161）
  // cube uv 为 faceUV JSON 字符串，east={uv:[0,0],uv_size:[8,8]}，texW=texH=64
  // → east face u0=0/64=0, u1=8/64=0.125（uvs[0]=0, uvs[2]=0.125）
  it("cube faceUV 字符串（east uv_size 8×8）→ uvs[0]=0 uvs[2]=0.125", () => {
    const faceUV = `{"east":{"uv":[0,0],"uv_size":[8,8]},"west":{"uv":[8,0],"uv_size":[8,8]},"up":{"uv":[16,0],"uv_size":[8,8]},"down":{"uv":[24,0],"uv_size":[8,8]},"south":{"uv":[32,0],"uv_size":[8,8]},"north":{"uv":[40,0],"uv_size":[8,8]}}`;
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.faceuv",
      `{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [8,8,8], "uv": ${JSON.stringify(faceUV)} }] }`))) as {
      models: { meshGroups: { uvs: number[] }[] }[];
    };
    const uvs = spec.models[0].meshGroups[0].uvs;
    // East face = uvs[0..7]，u0=uvs[0]=0，u1=uvs[2]=0.125
    expect(uvs[0]).toBe(0);
    expect(uvs[2]).toBeCloseTo(0.125, 6);
  });

  // 镜像 Go TestParseFaceUV_PartialFaces（spec_extra_test.go:184）
  // 只提供 east face → east 有 UV 值，west face 保持零值
  it("cube faceUV 仅 east 面 → east 有 UV，west 保持零", () => {
    const faceUV = `{"east":{"uv":[0,0],"uv_size":[8,8]}}`;
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.partial",
      `{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [8,8,8], "uv": ${JSON.stringify(faceUV)} }] }`))) as {
      models: { meshGroups: { uvs: number[] }[] }[];
    };
    const uvs = spec.models[0].meshGroups[0].uvs;
    // East face uvs[0..7] 有值
    expect(uvs[2]).toBeCloseTo(0.125, 6);
    // West face uvs[8..15] 保持零（未提供）
    expect(uvs[8]).toBe(0);
    expect(uvs[10]).toBe(0);
  });

  // 镜像 Go TestBuildCubeMeshData_ZeroSize（spec_extra_test.go:240）
  // cube size=[0,0,0] → 三轴被 thicknessEpsilon 修正，保留非空 mesh
  // → meshGroups=1，positions=72，indices=36（6 面 × 4 顶点）
  it("零尺寸 cube → 保留 mesh（72 positions / 36 indices）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.zero",
      '{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [0,0,0], "uv": [0,0] }] }'))) as {
      models: { meshGroups: { positions: number[]; indices: number[] }[] }[];
    };
    expect(spec.models[0].meshGroups.length).toBe(1);
    const mesh = spec.models[0].meshGroups[0];
    expect(mesh.positions.length).toBe(72);
    expect(mesh.indices.length).toBe(36);
  });

  // 镜像 Go TestBuildBoneLocalPosition_XFlip（spec_test.go:262）
  // 骨骼 pivot=[5,2,-3] 无 parent → localPosition=[-5,2,-3]（X 翻转对齐 C# ConvertBones）
  it("骨骼无 parent → localPosition X 翻转 [-5,2,-3]", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.xflip",
      '{ "name": "b1", "pivot": [5,2,-3], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localPosition: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localPosition).toEqual([-5, 2, -3]);
  });

  // ===== 契约对齐边界用例（cubes 字段缺席/null/非数组）=====

  // 契约对齐 Go parse.go：骨骼缺 cubes 字段 → 视为空数组，骨骼保留、meshGroups 空
  it("骨骼缺 cubes 字段 → 骨骼保留、meshGroups=[]", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.nocube",
      '{ "name": "b", "pivot": [0,0,0] }'))) as {
      models: { bones: unknown[]; meshGroups: unknown[] }[];
    };
    expect(spec.models[0].bones.length).toBe(1);
    expect(spec.models[0].meshGroups).toEqual([]);
  });

  // 契约对齐 Go parse.go：cubes=null → 视为空数组（与缺字段同语义）
  it("骨骼 cubes=null → 视为空数组，骨骼保留", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.nullcubes",
      '{ "name": "b", "pivot": [0,0,0], "cubes": null }'))) as {
      models: { bones: unknown[]; meshGroups: unknown[] }[];
    };
    expect(spec.models[0].bones.length).toBe(1);
    expect(spec.models[0].meshGroups).toEqual([]);
  });

  // 契约对齐 Go parse.go：cubes 为非数组（字符串）→ 畸形输入，返回 {}
  it("骨骼 cubes 非数组（字符串）→ {} 拒绝", () => {
    const spec = buildSpecFromGeometryJSON(geo("geometry.badcubes",
      '{ "name": "b", "pivot": [0,0,0], "cubes": "not-an-array" }'));
    expect(spec).toBe("{}");
  });

  // 契约对齐：混合骨骼（有 cube 的 b1 + 无 cube 的 b2）→ 两者保留，仅 b1 产生 mesh
  it("混合骨骼（有 cube + 无 cube）→ bones=2，meshGroups=1", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.mix",
      '{ "name": "b1", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "b2", "pivot": [4,0,0] }'))) as {
      models: { bones: { name: string }[]; meshGroups: unknown[] }[];
    };
    expect(spec.models[0].bones.length).toBe(2);
    expect(spec.models[0].meshGroups.length).toBe(1);
  });

  // ===== 镜像 go/threejs/spec_build_extra_test.go =====

  // 镜像 Go TestBuildCubeMeshData_EntryNaNGuard（spec_build_extra_test.go:194）
  // NaN 在 JSON 中非法，buildSpecFromGeometryJSON 入口 JSON.parse 会静默返回 null，
  // 整条路径守卫在 parseBedrockGeometry 层即触发 → {} 是正确行为
  it("cube origin 含 NaN（JSON 非法）→ 整条几何被拒绝返回 {}", () => {
    const result = buildSpecFromGeometryJSON('{"minecraft:geometry":[{"description":{"identifier":"g","texture_width":64,"texture_height":64},"bones":[{"name":"b","pivot":[0,0,0],"cubes":[{"origin":[NaN,0,0],"size":[2,2,2],"uv":[0,0]}]}]}]}');
    // JSON.parse 遇到 NaN 字面量直接抛错，入口 guard 返回 null
    expect(result).toBe("{}");
  });

  // 镜像 Go TestBuildCubeMeshData_VertexRelPivotOverflow（spec_build_extra_test.go:202）
  // Go 端 buildCubeMeshData 有 lx/hx 等顶点的 -Inf 守卫；
  // TS 端 assertFinite 仅覆盖入口和 [tx,ty,tz]，顶点派生 lx/hx 阶段未加守卫。
  // 本用例验证 TS 行为：极值输入不崩溃（产生 Infinity 顶点是预期 JS 行为），
  // 正常 cube 不受影响，2 个 mesh 均产出。
  it("origin/pivot 极值溢出 → 不崩溃，正常 cube 仍产出 mesh（共 2 个）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.overflow",
      '{ "name": "b1", "pivot": [0,0,0], "cubes": [' +
        '{ "origin": [-1e308,0,0], "size": [8,8,8], "pivot": [1e308,0,0], "pivotSet": true, "uv": [0,0] },' +
        '{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }' +
      '] }'))) as {
      models: { meshGroups: { id: string; positions: number[] }[] }[];
    };
    // 两个 cube 均产出 mesh（极值 cube 的顶点为 Infinity，但不崩溃）
    expect(spec.models[0].meshGroups.length).toBe(2);
    // 正常 cube 的 mesh 顶点全有限
    const normalMesh = spec.models[0].meshGroups.find((m) => m.id === "b1_1");
    expect(normalMesh).toBeDefined();
    expect(normalMesh!.positions.every((v) => Number.isFinite(v))).toBe(true);
  });

  // 镜像 Go TestBuildCubeMeshData_LocalPosOverflow（spec_build_extra_test.go:251）
  // Go 端 buildCubeMeshData 检查 mesh localPos 有限性；TS 端 lx/hx 无守卫。
  // 本用例验证 TS 不崩溃，mesh 仍可产出（顶点含 Infinity 属 JS 浮点边界行为）。
  it("骨骼 pivot 与 cube pivot 距离溢出 → 不崩溃，mesh 仍可产出", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.locpos-overflow",
      '{ "name": "b1", "pivot": [1e308,0,0], "cubes": [' +
        '{ "origin": [0,0,0], "size": [8,8,8], "pivot": [-1e308,0,0], "pivotSet": true, "uv": [0,0] }' +
      '] }'))) as {
      models: { meshGroups: unknown[] }[];
    };
    // mesh 产出但顶点含 Infinity（JS 浮点边界，非 null 拒绝路径）
    expect(spec.models[0].meshGroups.length).toBe(1);
  });

  // 镜像 Go TestBuildCubeMeshData_NoUVZeroFill（spec_build_extra_test.go:237）
  it("texW=0 → UV 全零填充（非 NaN）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(`{
      "format_version": "1.12.0",
      "minecraft:geometry": [{
        "description": { "identifier": "geometry.noutex" },
        "bones": [{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [8,8,8], "uv": [0,0] }] }]
      }]
    }`));
    // texWidth=0 → buildModelGroup 默认 64，mesh 正常产出，UV 不会 NaN
    expect(spec.models[0].meshGroups.length).toBeGreaterThan(0);
    for (const m of spec.models[0].meshGroups) {
      for (const u of (m as { uvs: number[] }).uvs) {
        expect(Number.isFinite(u)).toBe(true);
      }
    }
  });

  // 镜像 Go TestBuildModelGroup_PureParentReference（spec_build_extra_test.go:93）
  it("纯 parent 引用（ghost parent）→ 补 ghost 骨骼挂 root，子骨骼也挂 root", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.ghost",
      '{ "name": "b1", "parent": "ghost", "pivot": [5,2,-3], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { name: string; parentId: string | null; localPosition: number[] }[] }[];
    };
    const names = spec.models[0].bones.map((b) => b.name);
    expect(names).toContain("ghost");
    const b1 = spec.models[0].bones.find((b) => b.name === "b1")!;
    expect(b1.parentId).toBeNull();
    expect(b1.localPosition).toEqual([-5, 2, -3]);
    const ghost = spec.models[0].bones.find((b) => b.name === "ghost")!;
    expect(ghost.parentId).toBeNull();
  });

  // 镜像 Go TestBuildModelGroup_ArmAttach（spec_build_extra_test.go:165）
  it("RightArm/LeftArm 无 parent → 挂到 Arm 下", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.arm",
      '{ "name": "root", "pivot": [0,0,0] }, ' +
      '{ "name": "Arm", "parent": "root", "pivot": [0,10,0] }, ' +
      '{ "name": "RightArm", "pivot": [4,10,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "LeftArm", "pivot": [-4,10,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { name: string; parentId: string | null }[] }[];
    };
    const parents = Object.fromEntries(
      spec.models[0].bones.map((b) => [b.name, b.parentId]),
    );
    expect(parents["RightArm"]).toBe("Arm");
    expect(parents["LeftArm"]).toBe("Arm");
  });

  // 镜像 Go TestBuildModelGroup_DuplicateNameMergeNoOverwrite（spec_build_extra_test.go:133）
  it("同名骨骼均无 parent → mergeCubes 追加，meshGroups=2（非重叠）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.dup-no-overwrite",
      '{ "name": "dup", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "dup", "pivot": [0,0,0], "cubes": [{ "origin": [10,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { name: string }[]; meshGroups: { id: string }[] }[];
    };
    expect(spec.models[0].bones.filter((b) => b.name === "dup").length).toBe(1);
    expect(spec.models[0].meshGroups.length).toBe(2);
  });

  // 镜像 Go TestBuildMulti_SkipEmptyComponent（spec_build_extra_test.go:266）
  it("无骨骼的 geometry → {}", () => {
    expect(buildSpecFromGeometryJSON(geo("geometry.allempty", ""))).toBe("{}");
  });

  // 镜像 Go TestBuildMulti_AllEmpty（spec_build_extra_test.go:296）
  it("空 bones 数组 → {}", () => {
    const spec = buildSpecFromGeometryJSON(`{
      "format_version": "1.12.0",
      "minecraft:geometry": [{
        "description": { "identifier": "nobody", "texture_width": 64, "texture_height": 64 },
        "bones": []
      }]
    }`);
    expect(spec).toBe("{}");
  });

  // 镜像 Go eulerToQuaternion ZYX 口径（spec.go:351-399）：
  // eulerToQuaternion(-90,-90,0) 实测输出 [-0.5,-0.5,-0.5,0.5]
  // （浮点下 trace≈0, m11≈m22 时走 m11>m22 分支，与 Go 同口径）
  it("组合旋转 [90,90,0] → qx=-0.5 qy=-0.5 qz=-0.5 qw=0.5（ZYX 欧拉序）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.combo",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [90,90,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(q[0]).toBeCloseTo(-0.5, 4);
    expect(q[1]).toBeCloseTo(-0.5, 4);
    expect(q[2]).toBeCloseTo(-0.5, 4);
    expect(q[3]).toBeCloseTo(0.5, 4);
  });

  // 间接验证：360°=单位四元数，shouldOverwrite 判定不应把第二条（无旋）覆盖第一条（360°）
  // 若误判为非单位 → 第二条无旋会覆盖第一条 → _cubeCount 会从 1 变成 1（相同，但 localRotation 变 [0,0,0,1] 不变）
  // 本用例核心是验证 hasBoneRotation(360,0,0) 返回 false
  it("hasBoneRotation(360,0,0)=false → 360° 与 0° 不触发 overwrite", () => {
    // 两条同名骨骼：第一条 360° 有 cube，第二条 0° 有不同位置 cube
    // shouldOverwrite 判定：first.hasRot=false(360°), newHasRot=false(0°)
    // → (!false&&false)||(false&&false&&!false&&false) = false → 不覆盖，走 mergeCubes
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.identity-eq",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [360,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,0,0], "cubes": [{ "origin": [5,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[]; _cubeCount: number }[]; meshGroups: { id: string }[] }[];
    };
    const bEntry = spec.models[0].bones[0];
    // 未被覆盖：保留 360° 旋转（=单位四元数）和第一条 cube（mergeCubes 追加第二条）
    expect(bEntry.localRotation).toEqual([0, 0, 0, 1]);
    expect(bEntry._cubeCount).toBe(2); // mergeCubes 追加了两个 cube
    expect(spec.models[0].meshGroups.length).toBe(2);
  });
});
