// @vitest-environment node
// ===== stats-core 纯计算单测（无 IO / 无 WASM；Worker 路径的可测核心）=====
// 覆盖：纹理嗅探（PNG/JPEG）、WASM 解码产物统计（合并求和/跳过 ysm.json/animations/
// avatar）、.json 主文件统计（ysm.json spec 关联文件 / 标准 geometry / 畸形输入）、
// parseAnyGeometry 三条兼容形态专项边界（不经 statsFromJsonBytes 间接触达）。
import { describe, it, expect } from "vitest";
import { parseAnyGeometry, statsFromDecodedFiles, statsFromJsonBytes } from "./stats-core.ts";
import { pngBytes } from "@/test-utils/tex-bytes.ts";
import type { YsmDecodedFile } from "@/wasm/parser-shared.ts";

const enc = new TextEncoder();

/** 2 骨 4 方 64x32 / 3 骨 2 方 16x16 的标准 bedrock geometry JSON */
const geoA = JSON.stringify({
  "minecraft:geometry": [
    {
      description: { texture_width: 64, texture_height: 32 },
      bones: [{ name: "a", cubes: [{}, {}, {}] }, { name: "b", cubes: [{}] }],
    },
  ],
});
const geoB = JSON.stringify({
  "minecraft:geometry": [
    {
      description: { texture_width: 16, texture_height: 16 },
      bones: [{ name: "x", cubes: [{}, {}] }, { name: "y", cubes: [] }, { name: "z", cubes: [] }],
    },
  ],
});

describe("stats-core.statsFromDecodedFiles（.ysm WASM 产物统计）", () => {
  it("合并多 geometry 骨骼/立方体求和，纹理尺寸取 geometry 描述与嗅探的最大值", () => {
    const files: YsmDecodedFile[] = [
      { path: "models/a.json", data: enc.encode(geoA) },
      { path: "models/b.json", data: enc.encode(geoB) },
      { path: "ysm.json", data: enc.encode("{}") }, // 元信息，跳过
      { path: "animations/anim.json", data: enc.encode("{}") }, // 动画，跳过
      { path: "textures/main.png", data: pngBytes(128, 64) }, // 嗅探 128x64 > geo 64x32
      { path: "avatar/face.png", data: pngBytes(512, 512) }, // 头像不参与
    ];
    const s = statsFromDecodedFiles(files);
    expect(s.boneCount).toBe(2 + 3);
    expect(s.cubeCount).toBe(4 + 2);
    expect(s.texWidth).toBe(128);
    expect(s.texHeight).toBe(64);
    expect(s.hasError).toBe(false);
  });

  it("无几何（全部跳过/空输入）→ hasError true（对齐 Go BoneCount==0 语义）", () => {
    expect(statsFromDecodedFiles([]).hasError).toBe(true);
    expect(
      statsFromDecodedFiles([{ path: "ysm.json", data: enc.encode("{}") }]).hasError,
    ).toBe(true);
  });

  it("畸形 geometry JSON 不拖垮整批（跳过该文件）", () => {
    const s = statsFromDecodedFiles([
      { path: "models/good.json", data: enc.encode(geoA) },
      { path: "models/bad.json", data: enc.encode("{{{{ not json") },
    ]);
    expect(s.boneCount).toBe(2);
    expect(s.cubeCount).toBe(4);
  });
});

describe("stats-core.statsFromJsonBytes（.json 主文件：解压目录入口 ADR-038）", () => {
  it("ysm.json spec：按 files.player.model/texFiles 读取关联文件合并统计", async () => {
    const spec = JSON.stringify({
      spec: 1,
      files: {
        player: {
          model: ["a.json", "models/b.json"],
          texture: ["t.png"],
        },
      },
    });
    const store = new Map<string, Uint8Array>([
      ["models/a.json", enc.encode(geoA)],
      ["models/b.json", enc.encode(geoB)], // 声明已带 models/ 前缀 → 不重复补前缀
      ["textures/t.png", pngBytes(256, 128)],
    ]);
    const s = await statsFromJsonBytes(enc.encode(spec), async (rel) => store.get(rel) ?? null);
    expect(s.boneCount).toBe(2 + 3);
    expect(s.cubeCount).toBe(4 + 2);
    expect(s.texWidth).toBe(256);
    expect(s.texHeight).toBe(128);
    expect(s.hasError).toBe(false);
  });

  it("ysm.json spec 声明 Windows 反斜杠路径：归一化后命中正斜杠关联文件", async () => {
    // spec 内 model/texture 用反斜杠声明 models\\a.json / textures\\t.png，store 以正斜杠 key
    // 提供；normPath 归一化应使其正确命中，不重复补前缀也不丢失（P1 路径健壮性）。
    const spec = JSON.stringify({
      spec: 1,
      files: { player: { model: ["models\\a.json"], texture: ["textures\\t.png"] } },
    });
    const store = new Map<string, Uint8Array>([
      ["models/a.json", enc.encode(geoA)],
      ["textures/t.png", pngBytes(256, 128)],
    ]);
    const s = await statsFromJsonBytes(enc.encode(spec), async (rel) => store.get(rel) ?? null);
    expect(s.boneCount).toBe(2);
    expect(s.cubeCount).toBe(4);
    expect(s.texWidth).toBe(256);
    expect(s.texHeight).toBe(128);
    expect(s.hasError).toBe(false);
  });

  it("ysk.json spec 带 models/ 前缀的文件：不重复补前缀", async () => {
    // b.json 声明为已带 models/ 前缀 → 直接命中；a.json 缺前缀 → 补 models/
    const spec = JSON.stringify({
      spec: 1,
      files: { player: { model: ["a.json", "models/b.json"], texture: [] } },
    });
    const store = new Map<string, Uint8Array>([
      ["models/a.json", enc.encode(geoA)],
      ["models/b.json", enc.encode(geoB)],
    ]);
    const s = await statsFromJsonBytes(enc.encode(spec), async (rel) => store.get(rel) ?? null);
    expect(s.boneCount).toBe(5);
    expect(s.cubeCount).toBe(6);
  });

  it("标准 bedrock geometry JSON 直接解析", async () => {
    const s = await statsFromJsonBytes(enc.encode(geoA), async () => null);
    expect(s.boneCount).toBe(2);
    expect(s.cubeCount).toBe(4);
    expect(s.texWidth).toBe(64);
    expect(s.texHeight).toBe(32);
    expect(s.hasError).toBe(false);
  });

  it("畸形 JSON / spec 无骨骼 → hasError true（不抛错）", async () => {
    const bad = await statsFromJsonBytes(enc.encode("{{{"), async () => null);
    expect(bad.hasError).toBe(true);
    const noBones = await statsFromJsonBytes(
      enc.encode(JSON.stringify({ spec: 1, files: { player: { model: [], texture: [] } } })),
      async () => null,
    );
    expect(noBones.hasError).toBe(true);
  });

  it("标准 bedrock geometry 空 bones / 无骨骼 → hasError true（对齐 Go BoneCount==0 语义）", async () => {
    // 空 bones 数组的标准 geometry：parseAnyGeometry 返回 null（geometry.ts 挡空 bones）
    // → EMPTY_ERROR hasError:true——与 spec 分支 hasError:boneCount===0 同口径。
    const emptyGeo = await statsFromJsonBytes(
      enc.encode(
        JSON.stringify({ "minecraft:geometry": [{ description: { texture_width: 16, texture_height: 16 }, bones: [] }] }),
      ),
      async () => null,
    );
    expect(emptyGeo.hasError).toBe(true);
    expect(emptyGeo.boneCount).toBe(0);
    // 畸形结构（无 bones 字段）→ 同样 hasError true
    const noGeoField = await statsFromJsonBytes(
      enc.encode(JSON.stringify({ some: "other" })),
      async () => null,
    );
    expect(noGeoField.hasError).toBe(true);
  });
});

describe("stats-core.parseAnyGeometry（geometry 兼容形态专项边界）", () => {
  it("标准 minecraft:geometry 数组（走 parseBedrockGeometryFromJSON 分支）", () => {
    expect(parseAnyGeometry(geoA)).toEqual({ boneCount: 2, cubeCount: 4, texWidth: 64, texHeight: 32 });
  });

  it("兼容形态：minecraft.geometry[0] 对象", () => {
    const json = JSON.stringify({
      minecraft: {
        geometry: [
          { description: { texture_width: 8, texture_height: 8 }, bones: [{ name: "a", cubes: [{}, {}] }] },
        ],
      },
    });
    expect(parseAnyGeometry(json)).toEqual({ boneCount: 1, cubeCount: 2, texWidth: 8, texHeight: 8 });
  });

  it("兼容形态：geometry.model 对象", () => {
    const json = JSON.stringify({
      geometry: {
        model: { description: { texture_width: 4, texture_height: 4 }, bones: [{ name: "b", cubes: [{}] }] },
      },
    });
    expect(parseAnyGeometry(json)).toEqual({ boneCount: 1, cubeCount: 1, texWidth: 4, texHeight: 4 });
  });

  it("兼容形态：直接 {bones} 根对象（无 description → 纹理 0）", () => {
    const json = JSON.stringify({ bones: [{ name: "c", cubes: [{}, {}] }] });
    expect(parseAnyGeometry(json)).toEqual({ boneCount: 1, cubeCount: 2, texWidth: 0, texHeight: 0 });
  });

  it("cube 缺省（cubes 字段不存在）计 0 立方体", () => {
    const json = JSON.stringify({ minecraft: { geometry: [{ bones: [{ name: "d" }, { name: "e", cubes: [{}] }] }] } });
    expect(parseAnyGeometry(json)).toEqual({ boneCount: 2, cubeCount: 1, texWidth: 0, texHeight: 0 });
  });

  it("空 bones 数组 / 无 geometry 结构 / 畸形 JSON → null", () => {
    expect(parseAnyGeometry(JSON.stringify({ "minecraft:geometry": [{ bones: [] }] }))).toBeNull();
    expect(parseAnyGeometry(JSON.stringify({ some: "other" }))).toBeNull();
    expect(parseAnyGeometry("{{{")).toBeNull();
  });
});