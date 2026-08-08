// ===== parseBedrockGeometryFromJSON 测试 =====
// 覆盖：基础解析、无 bones 返回 null、UV 三种形态（数组/字符串/对象）、pivot 对象、texSlot、缺省字段
import { describe, it, expect } from "vitest";
import { parseBedrockGeometryFromJSON } from "./geometry.ts";

describe("parseBedrockGeometryFromJSON", () => {
  it("解析基础结构：骨骼/方块计数、纹理尺寸", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [
          {
            description: { texture_width: 64, texture_height: 32 },
            bones: [
              {
                name: "body",
                parent: "root",
                pivot: [0, 0, 0],
                cubes: [{ origin: [0, 0, 0], size: [16, 16, 16], uv: [0, 0] }],
              },
            ],
          },
        ],
      }),
    );
    expect(g).not.toBeNull();
    expect(g!.boneCount).toBe(1);
    expect(g!.cubeCount).toBe(1);
    expect(g!.texWidth).toBe(64);
    expect(g!.texHeight).toBe(32);
    expect(g!.bones[0].name).toBe("body");
    expect(g!.bones[0].parent).toBe("root");
    expect(g!.bones[0].cubes[0].uv).toEqual([0, 0]);
  });

  it("无 minecraft:geometry 或空 bones → null", () => {
    expect(parseBedrockGeometryFromJSON('{"foo": 1}')).toBeNull();
    expect(
      parseBedrockGeometryFromJSON('{"minecraft:geometry": [{"bones": []}]}'),
    ).toBeNull();
    expect(
      parseBedrockGeometryFromJSON('{"minecraft:geometry": [{}]}'),
    ).toBeNull();
  });

  it("UV 字符串形态（{...}）→ 存 faceUV，uv 默认 [0,0]", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [{
          bones: [{
            name: "b", cubes: [{ uv: "{\"north\":{\"uv\":[0,0]}}" }],
          }],
        }],
      }),
    )!;
    const c = g.bones[0].cubes[0];
    expect(c.uv).toEqual([0, 0]);
    expect(c.faceUV).toContain("north");
  });

  it("UV 对象形态 → 取内层 uv 数组 + 序列化 faceUV", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [{
          bones: [{
            name: "b", cubes: [{ uv: { uv: [4, 4], uv_size: [8, 8] } }],
          }],
        }],
      }),
    )!;
    const c = g.bones[0].cubes[0];
    expect(c.uv).toEqual([4, 4]);
    expect(c.faceUV).toContain("uv_size");
  });

  it("texture 数字 → texSlot；非数字 → 0", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [{
          bones: [{
            name: "b",
            cubes: [{ texture: 3 }, { texture: "main" }],
          }],
        }],
      }),
    )!;
    expect(g.bones[0].cubes[0].texSlot).toBe(3);
    expect(g.bones[0].cubes[1].texSlot).toBe(0);
  });

  it("origin/size/pivot 对象形态 → 转数组（缺字段补 0）", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [{
          bones: [{
            name: "b",
            pivot: { x: 1, y: 2, z: 3 },
            cubes: [{ origin: { x: 4, z: 6 }, size: [1, 1, 1] }],
          }],
        }],
      }),
    )!;
    expect(g.bones[0].pivot).toEqual([1, 2, 3]);
    expect(g.bones[0].cubes[0].origin).toEqual([4, 0, 6]);
  });

  it("缺省字段兜底：pivot/rotation 默认 [0,0,0]", () => {
    const g = parseBedrockGeometryFromJSON(
      JSON.stringify({
        "minecraft:geometry": [{ bones: [{ name: "b", cubes: [] }] }],
      }),
    )!;
    expect(g.bones[0].pivot).toEqual([0, 0, 0]);
    expect(g.bones[0].rotation).toEqual([0, 0, 0]);
  });
});
