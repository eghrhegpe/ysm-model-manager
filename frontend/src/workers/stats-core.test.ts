// @vitest-environment node
// ===== stats-core 纯计算单测（无 IO / 无 WASM；Worker 路径的可测核心）=====
// 覆盖：纹理嗅探（PNG/JPEG）、WASM 解码产物统计（合并求和/跳过 ysm.json/animations/
// avatar）、.json 主文件统计（ysm.json spec 关联文件 / 标准 geometry / 畸形输入）。
import { describe, it, expect } from "vitest";
import {
  statsFromDecodedFiles,
  statsFromJsonBytes,
  type StatsFileInput,
} from "./stats-core.ts";
import { pngBytes, jpgBytes } from "../test-utils/tex-bytes.ts";

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
    const files: StatsFileInput[] = [
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
});