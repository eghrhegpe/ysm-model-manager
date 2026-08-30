// @vitest-environment node
// ===== parse-java-model.test.ts — MC Java 版模型解析器（ADR-080）=====
// 覆盖：parent 链合并、纹理变量链式解析、缺省 UV、UV v 翻转/角序、
// element rotation、face UV rotation、isRenderableModel 模板判定。

import { describe, it, expect } from "vitest";
import { parseJavaModel, isRenderableModel, modelEntryFor, type PackEntryReader } from "./parse-java-model.ts";

/** 内存资源包 fake reader：Map<entry, JSON 对象> → base64 */
function makeReader(models: Record<string, unknown>): { read: PackEntryReader; entries: Set<string> } {
  const entries = new Set<string>();
  const map = new Map<string, string>();
  for (const [entry, obj] of Object.entries(models)) {
    map.set(entry, btoa(unescape(encodeURIComponent(JSON.stringify(obj)))));
    entries.add(entry);
  }
  return {
    entries,
    read: async (e: string): Promise<string | null> => map.get(e) ?? null,
  };
}

// vanilla 家族：block → cube → cube_all → stone（3 级 parent 链）
const FAMILY = {
  "assets/minecraft/models/block/block.json": {
    gui_light: "side",
    display: { thirdperson_righthand: { rotation: [75, 45, 0], scale: [0.375, 0.375, 0.375] } },
  },
  "assets/minecraft/models/block/cube.json": {
    parent: "block/block",
    elements: [
      {
        from: [0, 0, 0], to: [16, 16, 16],
        faces: {
          down: { texture: "#down" },
          up: { texture: "#up" },
          north: { texture: "#north" },
          south: { texture: "#south" },
          west: { texture: "#west" },
          east: { texture: "#east" },
        },
      },
    ],
  },
  "assets/minecraft/models/block/cube_all.json": {
    parent: "block/cube",
    textures: { down: "#all", up: "#all", north: "#all", south: "#all", west: "#all", east: "#all" },
  },
  "assets/minecraft/models/block/stone.json": {
    parent: "minecraft:block/cube_all",
    textures: { all: "minecraft:block/stone" },
  },
  "assets/minecraft/textures/block/stone.png": "TEX-STONE", // 仅占位，尺寸解析走默认 16
};

describe("modelEntryFor", () => {
  it("无命名空间默认 minecraft，models 路径 + .json", () => {
    expect(modelEntryFor("block/stone")).toBe("assets/minecraft/models/block/stone.json");
    expect(modelEntryFor("minecraft:block/stone")).toBe("assets/minecraft/models/block/stone.json");
  });
});

describe("parent 链解析", () => {
  it("3 级链（stone→cube_all→cube→block）：elements 继承 + display 继承", async () => {
    const r = makeReader(FAMILY);
    const m = await parseJavaModel("assets/minecraft/models/block/stone.json", r.read);
    expect(m).not.toBeNull();
    expect(m!.elementCount).toBe(1); // elements 来自 cube.json
    expect(m!.faces).toHaveLength(6);
    // display 继承自 block.json
    expect((m!.display.thirdperson_righthand as { rotation: number[] }).rotation).toEqual([75, 45, 0]);
    expect(m!.gui_light).toBe("side");
  });

  it("纹理变量链式：#all → block/stone → 纹理条目", async () => {
    const r = makeReader(FAMILY);
    const m = await parseJavaModel("assets/minecraft/models/block/stone.json", r.read);
    expect(m!.faces.every((f) => f.texEntry === "assets/minecraft/textures/block/stone.png")).toBe(true);
  });

  it("缺省 uv 回退全纹理，north 面角序：方块顶(y=max)对纹理顶(v=1)", async () => {
    const r = makeReader(FAMILY);
    const m = await parseJavaModel("assets/minecraft/models/block/stone.json", r.read);
    const north = m!.faces.find((f) => f.face === "north")!;
    // corners v 角 [1,1,0,0] → Three 域 v 翻转 [0,0,1,1]
    expect(north.uv).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    // 顶点 2 = y=max → v=1（纹理顶部）
    expect(north.verts[7]).toBe(16);
    expect(north.uv[5]).toBe(1);
  });

  it("缺失纹理变量 → texEntry null（模板判定依据）", async () => {
    const r = makeReader({
      "assets/minecraft/models/block/template.json": {
        parent: "block/cube",
        textures: {},
      },
    });
    const m = await parseJavaModel("assets/minecraft/models/block/template.json", r.read);
    expect(m!.faces.every((f) => f.texEntry === null && f.texColor === null)).toBe(true);
  });
});

describe("element rotation", () => {
  it("cross 45° 绕 y 轴：顶点位移（不再落在原始 0.8/15.2 坐标）", async () => {
    const r = makeReader({
      "assets/minecraft/models/block/cross.json": {
        ambientocclusion: false,
        elements: [
          {
            from: [0.8, 0, 8], to: [15.2, 16, 8],
            rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
            faces: { north: { uv: [0, 0, 16, 16], texture: "#cross" } },
          },
        ],
      },
    });
    const m = await parseJavaModel("assets/minecraft/models/block/cross.json", r.read);
    expect(m!.ambientocclusion).toBe(false);
    const xs = m!.faces[0].verts.filter((_, i) => i % 3 === 0);
    expect(xs.some((x) => x !== 0.8 && x !== 15.2)).toBe(true); // 旋转已应用
  });
});

describe("face UV rotation", () => {
  it("rotation=90 角置换：(u,v) → (v, 1-u)（MC 域）", async () => {
    const r = makeReader({
      "assets/minecraft/models/block/uvrot.json": {
        textures: { side: "block/stone" },
        elements: [
          {
            from: [0, 0, 0], to: [16, 16, 16],
            faces: { north: { uv: [0, 0, 16, 16], texture: "#side", rotation: 90 } },
          },
        ],
      },
    });
    const m = await parseJavaModel("assets/minecraft/models/block/uvrot.json", r.read);
    const uv = m!.faces[0].uv.map((v) => Math.round(v * 1e6) / 1e6);
    expect(uv).toEqual([1, 0, 1, 1, 0, 0, 0, 1]);
  });
});

describe("UV 归一化（行业口径：分母恒 16，与纹理 PNG 尺寸无关）", () => {
  /** 构造最小 PNG 头（签名 + IHDR，宽高自定）——旧实现读它做 UV 归一化分母 */
  function pngHeadB64(width: number, height: number): string {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    b[16] = (width >> 24) & 0xff; b[17] = (width >> 16) & 0xff; b[18] = (width >> 8) & 0xff; b[19] = width & 0xff;
    b[20] = (height >> 24) & 0xff; b[21] = (height >> 16) & 0xff; b[22] = (height >> 8) & 0xff; b[23] = height & 0xff;
    let s = "";
    for (const byte of b) s += String.fromCharCode(byte);
    return btoa(s);
  }

  it("32x32 高清纹理：uv 仍覆盖全图 0..1（按 PNG 尺寸除会只取左上 1/4）", async () => {
    const map = new Map<string, string>();
    const model = {
      textures: { side: "block/hd" },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { uv: [0, 0, 16, 16], texture: "#side" } } }],
    };
    map.set("assets/minecraft/models/block/hd.json", btoa(unescape(encodeURIComponent(JSON.stringify(model)))));
    map.set("assets/minecraft/textures/block/hd.png", pngHeadB64(32, 32));
    const read: PackEntryReader = async (e) => map.get(e) ?? null;

    const m = await parseJavaModel("assets/minecraft/models/block/hd.json", read);
    expect(m).not.toBeNull();
    const uvs = m!.faces[0].uv;
    expect(Math.max(...uvs)).toBe(1); // 覆盖整张 32x32 纹理（旧实现 /32 → 0.5）
    expect(uvs.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("uv 局部矩形 [4,4,12,12] 归一化到 [0.25, 0.25, 0.75, 0.75]（16 基准，与纹理尺寸无关）", async () => {
    const map = new Map<string, string>();
    const model = {
      textures: { side: "block/hd" },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { uv: [4, 4, 12, 12], texture: "#side" } } }],
    };
    map.set("assets/minecraft/models/block/hdsub.json", btoa(unescape(encodeURIComponent(JSON.stringify(model)))));
    map.set("assets/minecraft/textures/block/hd.png", pngHeadB64(32, 32)); // 旧实现会把它除成 0.125..0.375
    const read: PackEntryReader = async (e) => map.get(e) ?? null;

    const m = await parseJavaModel("assets/minecraft/models/block/hdsub.json", read);
    expect(m).not.toBeNull();
    const uvs = m!.faces[0].uv;
    expect(Math.max(...uvs)).toBe(0.75);
    expect(Math.min(...uvs)).toBe(0.25);
  });
});

describe("isRenderableModel", () => {
  it("纯模板（全 null 纹理）判定不可渲染；有纹理引用可渲染", async () => {
    const tpl = makeReader({ "assets/minecraft/models/block/tpl.json": { parent: "block/cube", textures: {} } });
    const t = await parseJavaModel("assets/minecraft/models/block/tpl.json", tpl.read);
    expect(isRenderableModel(t)).toBe(false);

    const ok = makeReader(FAMILY);
    const s = await parseJavaModel("assets/minecraft/models/block/stone.json", ok.read);
    expect(isRenderableModel(s)).toBe(true);
  });

  it("纯色纹理值（#RRGGBB）视为可渲染", async () => {
    const r = makeReader({
      ...FAMILY,
      "assets/minecraft/models/block/color.json": {
        parent: "block/cube_all", // 面引用 #all，与 cube_all 变量映射一致
        textures: { all: "#ff8800" },
      },
    });
    const m = await parseJavaModel("assets/minecraft/models/block/color.json", r.read);
    expect(isRenderableModel(m)).toBe(true);
    expect(m!.faces[0].texColor).toBe("#ff8800");
  });
});

describe("健壮性", () => {
  it("条目缺失返回 null", async () => {
    const r = makeReader({});
    expect(await parseJavaModel("assets/minecraft/models/block/none.json", r.read)).toBeNull();
  });

  it("parent 循环引用不无限递归（返回 null）", async () => {
    const r = makeReader({
      "assets/minecraft/models/block/a.json": { parent: "block/b" },
      "assets/minecraft/models/block/b.json": { parent: "block/a" },
    });
    expect(await parseJavaModel("assets/minecraft/models/block/a.json", r.read)).toBeNull();
  });
});
