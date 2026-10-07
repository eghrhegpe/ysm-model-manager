// @vitest-environment node
// ===== parseBedrockGeometryFromJSON 分支特征基线（认知复杂度战役 第 1 批）=====
// 背景：该函数被 preview-3d/decoder/geometry.test.ts 引用（happy path：数组/字符串/对象 UV、
// texSlot、对象形态坐标、负 size 透传），但「执行到了却从没断言过」的分支仍在：
//   - 缺 description → texWidth/texHeight 归零
//   - bone 缺 parent → null；缺 pivot/rotation/cubes → 兜底
//   - uv 字符串非 "{" 前缀 → 三形态全不命中（uv 保持 [0,0]、faceUV 保持 ""）
//   - uv 对象无内层 uv 数组 → 仅序列化 faceUV
//   - toArr 收到标量（number/boolean）→ [0,0,0]
//   - bone.pivot 为非对象标量 → 原样透传（falsy 才兜底）
//   - minecraft:geometry 为空数组 → null
// 本文件在削平重构前先落基线，锁死这些数据不变量。
import { describe, it, expect } from "vitest";
import { parseBedrockGeometryFromJSON } from "./bedrock-geometry.ts";

/** 构造单几何体、单骨骼的 JSON 字符串（bones 为原始对象数组） */
function geoJson(bones: unknown[], description?: unknown): string {
  const g: Record<string, unknown> = { bones };
  if (description !== undefined) g.description = description;
  return JSON.stringify({ "minecraft:geometry": [g] });
}

describe("parseBedrockGeometryFromJSON — 缺省与兜底分支", () => {
  it("缺 description → texWidth/texHeight 归零；bone 缺 parent/pivot/rotation/cubes 全兜底", () => {
    const g = parseBedrockGeometryFromJSON(geoJson([{ name: "b" }]));
    expect(g).not.toBeNull();
    expect(g!.texWidth).toBe(0);
    expect(g!.texHeight).toBe(0);
    expect(g!.boneCount).toBe(1);
    expect(g!.cubeCount).toBe(0);
    expect(g!.bones[0].parent).toBeNull();
    expect(g!.bones[0].pivot).toEqual([0, 0, 0]);
    expect(g!.bones[0].rotation).toEqual([0, 0, 0]);
    expect(g!.bones[0].cubes).toEqual([]);
  });

  it("minecraft:geometry 为空数组 → null（无第一项）", () => {
    expect(parseBedrockGeometryFromJSON('{"minecraft:geometry": []}')).toBeNull();
  });

  it("description 只有 width → height 归零（|| 0 逐字段兜底）", () => {
    const g = parseBedrockGeometryFromJSON(
      geoJson([{ name: "b" }], { texture_width: 64, texture_height: 0 }),
    );
    expect(g!.texWidth).toBe(64);
    expect(g!.texHeight).toBe(0);
  });
});

describe("parseBedrockGeometryFromJSON — UV 形态兜底", () => {
  it("uv 字符串非 { 前缀 → 三形态全不命中：uv 保持 [0,0]、faceUV 保持空串", () => {
    const g = parseBedrockGeometryFromJSON(geoJson([{ name: "b", cubes: [{ uv: "north" }] }]));
    const c = g!.bones[0].cubes[0];
    expect(c.uv).toEqual([0, 0]);
    expect(c.faceUV).toBe("");
  });

  it("uv 对象但无内层 uv 数组 → uv 保持 [0,0]，faceUV 仍序列化整个对象", () => {
    const g = parseBedrockGeometryFromJSON(
      geoJson([{ name: "b", cubes: [{ uv: { uv_size: [8, 8] } }] }]),
    );
    const c = g!.bones[0].cubes[0];
    expect(c.uv).toEqual([0, 0]);
    expect(JSON.parse(c.faceUV)).toEqual({ uv_size: [8, 8] });
  });

  it("uv 缺省 → uv [0,0]、faceUV 空串", () => {
    const g = parseBedrockGeometryFromJSON(geoJson([{ name: "b", cubes: [{}] }]));
    const c = g!.bones[0].cubes[0];
    expect(c.uv).toEqual([0, 0]);
    expect(c.faceUV).toBe("");
    expect(c.texSlot).toBe(0);
  });
});

describe("parseBedrockGeometryFromJSON — toArr 标量分支", () => {
  it("origin/size/pivot/rotation 为标量（number/boolean）→ 一律 [0,0,0]", () => {
    const g = parseBedrockGeometryFromJSON(
      geoJson([
        {
          name: "b",
          cubes: [{ origin: 5, size: "16", pivot: true, rotation: false }],
        },
      ]),
    );
    const c = g!.bones[0].cubes[0];
    expect(c.origin).toEqual([0, 0, 0]);
    expect(c.size).toEqual([0, 0, 0]);
    expect(c.pivot).toEqual([0, 0, 0]);
    expect(c.rotation).toEqual([0, 0, 0]);
  });

  it("bone.pivot 为非对象标量 → 原样透传；falsy（0/空串）→ 兜底 [0,0,0]", () => {
    const keep = parseBedrockGeometryFromJSON(geoJson([{ name: "b", pivot: 5, cubes: [] }]));
    expect(keep!.bones[0].pivot).toBe(5);
    const fallback = parseBedrockGeometryFromJSON(
      geoJson([
        { name: "b", pivot: 0, cubes: [] },
        { name: "c", pivot: "", cubes: [] },
      ]),
    );
    expect(fallback!.bones[0].pivot).toEqual([0, 0, 0]);
    expect(fallback!.bones[1].pivot).toEqual([0, 0, 0]);
  });
});
