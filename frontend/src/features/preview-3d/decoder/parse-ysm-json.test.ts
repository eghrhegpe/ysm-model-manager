// @vitest-environment node
// ===== ysm.json 直解析纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { parseYsmJsonDirect } from "./parse-ysm-json.ts";

/** _ysmMeta 是 BedrockGeometry 的索引签名 unknown，测试里收窄 */
type YsmMeta = {
  modelFiles: unknown[];
  texFiles: unknown[];
  defaultTexture: string | null;
};

describe("parseYsmJsonDirect — ysm.json 格式（spec/files/metadata）", () => {
  it("解析 model/texture 数组与作者信息，产出占位 geometry + _ysmMeta", () => {
    const r = parseYsmJsonDirect({
      spec: { x: 1 },
      files: {
        player: {
          model: ["models/a.json", "models/b.json"],
          texture: ["textures/tex.png"],
        },
      },
      metadata: {
        authors: [
          { name: "作者A", role: "模型", avatar: "avatar/a.png" },
          { name: "", role: "跳过" },
        ],
      },
      properties: { texture_width: 128, texture_height: 64 },
    });
    expect(r).not.toBeNull();
    const g = r!.geometry!;
    expect(g).toMatchObject({ bones: [], boneCount: 0, texWidth: 128, texHeight: 64 });
    expect(g._ysmMeta as YsmMeta).toEqual({
      modelFiles: ["models/a.json", "models/b.json"],
      texFiles: ["textures/tex.png"],
      defaultTexture: null,
    });
    expect(r!.authors).toEqual([
      { name: "作者A", role: "模型", avatarUrl: null, avatarPath: "avatar/a.png" },
    ]);
  });

  it("单个（非数组）model/texture 会包成数组", () => {
    const r = parseYsmJsonDirect({
      spec: {},
      files: { player: { model: "models/a.json", texture: "textures/t.png" } },
    });
    const meta = r!.geometry!._ysmMeta as YsmMeta;
    expect(meta.modelFiles).toEqual(["models/a.json"]);
    expect(meta.texFiles).toEqual(["textures/t.png"]);
  });

  it("缺 player 文件信息返回 null", () => {
    expect(parseYsmJsonDirect({ spec: {}, files: {} })).toBeNull();
  });

  it("default_texture 置首（R1 契约：与 Go orderTexByYSM 一致）", () => {
    const r = parseYsmJsonDirect({
      spec: {},
      files: {
        player: {
          model: "models/a.json",
          texture: ["textures/arrow.png", "textures/main.png"],
        },
      },
      properties: { default_texture: "textures/main.png" },
    });
    const meta = r!.geometry!._ysmMeta as YsmMeta;
    expect(meta.texFiles).toEqual(["textures/main.png", "textures/arrow.png"]);
    expect(meta.defaultTexture).toBe("textures/main.png");
  });

  it("default_texture 已首位时不重复移动", () => {
    const r = parseYsmJsonDirect({
      spec: {},
      files: { player: { model: "a.json", texture: ["main.png", "arrow.png"] } },
      properties: { default_texture: "main.png" },
    });
    const meta = r!.geometry!._ysmMeta as YsmMeta;
    expect(meta.texFiles).toEqual(["main.png", "arrow.png"]);
  });

  it("texture 声明为 {uv} 对象时同样参与 default_texture 置首", () => {
    const r = parseYsmJsonDirect({
      spec: {},
      files: {
        player: {
          model: "a.json",
          texture: [{ uv: "textures/arrow.png" }, { uv: "textures/main.png" }],
        },
      },
      properties: { default_texture: "textures/main.png" },
    });
    const meta = r!.geometry!._ysmMeta as YsmMeta;
    expect(meta.texFiles).toEqual([
      { uv: "textures/main.png" },
      { uv: "textures/arrow.png" },
    ]);
  });

  it("texture_width 为字符串/0 → 回退默认 64", () => {
    const r = parseYsmJsonDirect({
      spec: {},
      files: { player: { model: "a.json", texture: ["t.png"] } },
      properties: { texture_width: "128", texture_height: 0 },
    });
    expect(r!.geometry!.texWidth).toBe(64);
    expect(r!.geometry!.texHeight).toBe(64);
  });
});

describe("parseYsmJsonDirect — 标准 Bedrock geometry 格式", () => {
  it("minecraft.geometry[0] 路径映射骨骼与立方体默认值", () => {
    const r = parseYsmJsonDirect({
      minecraft: {
        geometry: [
          {
            description: { texture_width: 64, texture_height: 32 },
            bones: [
              {
                name: "head",
                pivot: [0, 0, 0],
                cubes: [{ origin: [0, 0, 0], size: [8, 8, 8] }],
              },
            ],
          },
        ],
      },
    });
    expect(r).not.toBeNull();
    const g = r!.geometry!;
    expect(g.boneCount).toBe(1);
    expect(g.bones[0]).toMatchObject({
      name: "head",
      parent: "",
      rotation: [0, 0, 0],
    });
    expect(g.bones[0].cubes[0]).toMatchObject({
      size: [8, 8, 8],
      faceUV: "",
      texSlot: 0,
    });
    expect(g.texWidth).toBe(64);
  });

  it("无骨骼返回 null", () => {
    expect(parseYsmJsonDirect({ minecraft: { geometry: [{ bones: [] }] } })).toBeNull();
    expect(parseYsmJsonDirect({})).toBeNull();
  });

  it("畸形 pivot/rotation/size（字符串、长度不足）→ 回退默认向量", () => {
    const r = parseYsmJsonDirect({
      minecraft: {
        geometry: [
          {
            description: { texture_width: 64, texture_height: 64 },
            bones: [
              {
                name: "bad",
                pivot: ["x", "y", "z"],
                rotation: [1, 2],
                cubes: [{ origin: [0, 0, 0], size: [8, "8", 8], uv: [0, 0, 1] }],
              },
            ],
          },
        ],
      },
    });
    const b = r!.geometry!.bones[0];
    expect(b.pivot).toEqual([0, 0, 0]);
    expect(b.rotation).toEqual([0, 0, 0]);
    expect(b.cubes[0].size).toEqual([0, 0, 0]);
    expect(b.cubes[0].uv).toEqual([0, 0]);
  });

  it("inflate/mirror 字段透传（mirror 布尔归一）", () => {
    const r = parseYsmJsonDirect({
      minecraft: {
        geometry: [
          {
            bones: [
              {
                name: "h",
                cubes: [
                  { origin: [0, 0, 0], size: [1, 1, 1], inflate: 0.5, mirror: true },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(r!.geometry!.bones[0].cubes[0]).toMatchObject({
      inflate: 0.5,
      mirror: true,
    });
  });

  it("geometry.model 路径同样可解析", () => {
    const r = parseYsmJsonDirect({
      geometry: {
        model: {
          description: { texture_width: 32 },
          bones: [{ name: "root" }],
        },
      },
    });
    expect(r!.geometry!.boneCount).toBe(1);
    expect(r!.geometry!.texWidth).toBe(32);
  });

  it("根级裸 bones 兜底解析（无 minecraft/geometry 包装）", () => {
    const r = parseYsmJsonDirect({ bones: [{ name: "root" }] });
    expect(r!.geometry!.boneCount).toBe(1);
    expect(r!.geometry!.bones[0].name).toBe("root");
  });
});
