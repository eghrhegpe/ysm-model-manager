// @vitest-environment node
// ===== NBT 解析 + 蓝图/投影 meta binding web 实现测试（ADR-070 M1）=====
// 覆盖：parseNbtRoot（gzip/原始输入、各标签类型值映射、畸形报错）+ 三个 binding
// （ReadLitematicMeta/ReadNbtStructure/ReadSchematic）经 browserAdapter 的端到端 JSON 输出。
// NBT 字节构造 helper 结构对齐 go/litematic/parser_test.go 的 makeLitematicGz/
// makeSchematicGz/makeNbtStructureGz（nbtTag/nbtString/nbtInt/nbtCompound/nbtList/...）。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { gzipSync } from "fflate";
import { browserAdapter, importWebFiles } from "./browser-adapter.ts";
import { parseNbtRoot } from "./nbt-parse.ts";

// idb 层内存实现：复用 test-setup 全局共享 store（isolate:false 穿透修复，
// 与 browser-adapter 系一致——per-file vi.mock 在共享模块图下会捕获错位绑定）
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
});

// ===== NBT 字节构造 helper（对齐 go/litematic/voxel_test.go + litematic_test.go）=====
const enc = new TextEncoder();

function nbtTag(type: number, name: string, body: number[]): number[] {
  const nameBytes = enc.encode(name);
  return [type, nameBytes.length >> 8, nameBytes.length & 0xff, ...nameBytes, ...body];
}
function nbtByte(name: string, v: number): number[] {
  return nbtTag(0x01, name, [v & 0xff]);
}
function nbtShort(name: string, v: number): number[] {
  return nbtTag(0x02, name, [(v >> 8) & 0xff, v & 0xff]);
}
function nbtInt(name: string, v: number): number[] {
  return nbtTag(0x03, name, [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}
function nbtLong(name: string, v: number): number[] {
  const hi = Math.floor(v / 0x100000000);
  const lo = v >>> 0;
  const body: number[] = [];
  for (let i = 3; i >= 0; i--) body.push((hi >>> (8 * i)) & 0xff);
  for (let i = 3; i >= 0; i--) body.push((lo >>> (8 * i)) & 0xff);
  return nbtTag(0x04, name, body);
}
function nbtFloat(name: string, v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, false);
  return nbtTag(0x05, name, [...b]);
}
function nbtDouble(name: string, v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, false);
  return nbtTag(0x06, name, [...b]);
}
function nbtString(name: string, value: string): number[] {
  const v = enc.encode(value);
  return nbtTag(0x08, name, [v.length >> 8, v.length & 0xff, ...v]);
}
function nbtByteArray(name: string, data: number[]): number[] {
  return nbtTag(0x07, name, [
    (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff,
    ...data,
  ]);
}
function nbtIntArray(name: string, vals: number[]): number[] {
  const body: number[] = [];
  for (const v of vals) body.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  return nbtTag(0x0b, name, [
    (vals.length >>> 24) & 0xff, (vals.length >>> 16) & 0xff, (vals.length >>> 8) & 0xff, vals.length & 0xff,
    ...body,
  ]);
}
function nbtList(name: string, elemType: number, ...elems: number[][]): number[] {
  return nbtTag(0x09, name, [
    elemType,
    (elems.length >>> 24) & 0xff, (elems.length >>> 16) & 0xff, (elems.length >>> 8) & 0xff, elems.length & 0xff,
    ...elems.flat(),
  ]);
}
function nbtCompoundBody(...children: number[][]): number[] {
  return [...children.flat(), 0x00]; // children + TAG_End
}
function nbtCompound(name: string, ...children: number[][]): number[] {
  return nbtTag(0x0a, name, nbtCompoundBody(...children));
}
function nbtRoot(...children: number[][]): number[] {
  return nbtCompound("", ...children);
}
function gz(bytes: number[]): Uint8Array {
  return gzipSync(Uint8Array.from(bytes));
}

// ===== 解析器：标签值映射 =====

describe("parseNbtRoot — 标签值映射", () => {
  it("Int/String/嵌套 Compound 解析（含 UTF-8 中文）", () => {
    const root = parseNbtRoot(
      Uint8Array.from(
        nbtRoot(
          nbtInt("Version", 5),
          nbtString("Name", "测试投影"),
          nbtCompound("Metadata", nbtString("Author", "作者A")),
        ),
      ),
    );
    expect(root["Version"]).toBe(5);
    expect(root["Name"]).toBe("测试投影");
    expect(root["Metadata"]).toEqual({ Author: "作者A" });
  });

  it("Byte/Short/Long/Float/Double → number（含负数与跨 32 位 long）", () => {
    const root = parseNbtRoot(
      Uint8Array.from(
        nbtRoot(
          nbtByte("B", 0xfe), // -2
          nbtShort("S", 0xfffe), // -2
          nbtLong("L", 0x0102030405), // 4328719365
          nbtFloat("F", 1.5),
          nbtDouble("D", -2.25),
        ),
      ),
    );
    expect(root["B"]).toBe(-2);
    expect(root["S"]).toBe(-2);
    expect(root["L"]).toBe(0x0102030405);
    expect(root["F"]).toBeCloseTo(1.5);
    expect(root["D"]).toBeCloseTo(-2.25);
  });

  it("List → 数组（int 元素）；Compound 元素 → 对象数组", () => {
    const root = parseNbtRoot(
      Uint8Array.from(
        nbtRoot(
          nbtList("sizes", 0x03, [0, 0, 0, 3], [0, 0, 0, 4], [0, 0, 0, 5]),
          nbtList("palette", 0x0a, nbtCompoundBody(nbtString("Name", "minecraft:stone"))),
        ),
      ),
    );
    expect(root["sizes"]).toEqual([3, 4, 5]);
    expect(root["palette"]).toEqual([{ Name: "minecraft:stone" }]);
  });

  it("ByteArray/IntArray → number[]", () => {
    const root = parseNbtRoot(
      Uint8Array.from(
        nbtRoot(
          nbtByteArray("Blocks", [0, 1, 2, 3]),
          nbtIntArray("intArr", [7, -7, 300]),
        ),
      ),
    );
    expect(root["Blocks"]).toEqual([0, 1, 2, 3]);
    expect(root["intArr"]).toEqual([7, -7, 300]);
  });

  it("gzip 输入与原始输入等价（魔数 1f 8b 判断解压）", () => {
    const raw = nbtRoot(nbtInt("Version", 2));
    expect(parseNbtRoot(gz(raw))).toEqual(parseNbtRoot(Uint8Array.from(raw)));
    expect(parseNbtRoot(gz(raw))["Version"]).toBe(2);
  });

  it("畸形输入抛错（根非 compound / 截断）", () => {
    // 根是 TAG_Int（0x03）而非 compound
    expect(() => parseNbtRoot(Uint8Array.from([0x03, 0x00, 0x00, 0, 0, 0, 5]))).toThrow();
    // 截断：声明了 String 但内容不足
    const truncated = Uint8Array.from(nbtRoot(nbtString("Name", "abc"))).slice(0, -2);
    expect(() => parseNbtRoot(truncated)).toThrow();
    // 空输入
    expect(() => parseNbtRoot(new Uint8Array(0))).toThrow();
  });
});

// ===== 三个 binding：端到端（构造 gzip NBT → 导入 IDB → browserAdapter 调用）=====

/** 构造最小 .litematic（对齐 makeLitematicGz：root Version + Metadata） */
function makeLitematicGz(): Uint8Array {
  const root = nbtRoot(
    nbtInt("Version", 5),
    nbtInt("MinecraftDataVersion", 3700),
    nbtCompound(
      "Metadata",
      nbtString("Name", "测试投影"),
      nbtString("Author", "作者A"),
      nbtString("Description", "M1 测试蓝图"),
      nbtLong("TimeCreated", 1767344640000),
      nbtLong("TimeModified", 1767344700000),
      nbtInt("TotalBlocks", 42),
      nbtInt("TotalVolume", 4096),
      nbtCompound("EnclosingSize", nbtInt("x", 16), nbtInt("y", 8), nbtInt("z", 4)),
    ),
    nbtCompound("Regions", nbtCompound("region_0")),
  );
  return gz(root);
}

/** 构造最小 .nbt structure（对齐 TestParseNbtStructure_Valid：size/blocks/palette） */
function makeNbtStructureGz(): Uint8Array {
  const root = nbtRoot(
    nbtInt("DataVersion", 2566),
    nbtList("size", 0x03, [0, 0, 0, 3], [0, 0, 0, 4], [0, 0, 0, 5]),
    nbtList("blocks", 0x0a, nbtCompoundBody(nbtInt("state", 0))),
    nbtList("palette", 0x0a, nbtCompoundBody(nbtString("Name", "minecraft:stone")), nbtCompoundBody(nbtString("Name", "minecraft:dirt"))),
    nbtList("entities", 0x0a, nbtCompoundBody(nbtString("id", "minecraft:pig"))),
  );
  return gz(root);
}

/** 构造最小 .schematic（对齐 TestParseSchematicSummary_Valid + FullFields） */
function makeSchematicGz(): Uint8Array {
  const root = nbtRoot(
    nbtInt("Version", 2),
    nbtInt("DataVersion", 2566),
    nbtInt("Width", 10),
    nbtInt("Height", 5),
    nbtInt("Length", 8),
    nbtCompound("Metadata", nbtString("Author", "作者A"), nbtString("Name", "测试建筑")),
    nbtByteArray("Blocks", Array.from({ length: 400 }, (_, i) => i % 3)),
    nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    nbtInt("PaletteMax", 1),
    nbtList("TileEntities", 0x0a, nbtCompoundBody(nbtString("id", "minecraft:chest"))),
    nbtList("Entities", 0x0a, nbtCompoundBody(nbtString("id", "minecraft:villager"))),
  );
  return gz(root);
}

/** 构造基岩版 1.21+ structure（root version + sub_levels，对齐 makeBedrockStructure） */
function makeBedrockStructureGz(): Uint8Array {
  const sub1 = nbtCompoundBody(
    nbtList("block_palette", 0x0a, nbtCompoundBody(nbtString("Name", "minecraft:stone")), nbtCompoundBody(nbtString("Name", "minecraft:dirt"))),
    nbtList("blocks", 0x0a, nbtCompoundBody(nbtInt("palette_id", 0)), nbtCompoundBody(nbtInt("palette_id", 0)), nbtCompoundBody(nbtInt("palette_id", 1))),
    nbtCompound("local_bounds", nbtInt("min_x", 0), nbtInt("min_y", 0), nbtInt("min_z", 0), nbtInt("max_x", 2), nbtInt("max_y", 3), nbtInt("max_z", 4)),
  );
  const sub2 = nbtCompoundBody(
    nbtList("block_palette", 0x0a, nbtCompoundBody(nbtString("Name", "minecraft:dirt")), nbtCompoundBody(nbtString("Name", "minecraft:oak_log"))),
    nbtList("blocks", 0x0a, nbtCompoundBody(nbtInt("palette_id", 1)), nbtCompoundBody(nbtInt("palette_id", 0)), nbtCompoundBody(nbtInt("palette_id", 1))),
    nbtCompound("local_bounds", nbtInt("min_x", 1), nbtInt("min_y", 1), nbtInt("min_z", 1), nbtInt("max_x", 5), nbtInt("max_y", 6), nbtInt("max_z", 7)),
    nbtList("entities", 0x0a, nbtCompoundBody(nbtString("id", "minecraft:zombie"))),
  );
  return gz(nbtRoot(nbtInt("version", 2), nbtList("sub_levels", 0x0a, sub1, sub2)));
}

async function importAs(type: string, name: string, bytes: Uint8Array): Promise<string> {
  // bytes.slice()：Uint8Array<ArrayBufferLike> → Uint8Array<ArrayBuffer> 过 BlobPart 类型关
  // （同 extract.ts:560 手法）
  await importWebFiles([new File([bytes.slice()], name, { type: "application/octet-stream" })], type);
  return `/web/${type}/${name.replace(/\.\w+$/, "")}/${name}`;
}

describe("ReadLitematicMeta — web 实现（ADR-070 M1）", () => {
  it("返回 LitematicMeta 兼容 JSON（全字段对齐 Go json tag）", async () => {
    const path = await importAs("litematic", "测试.litematic", makeLitematicGz());
    const meta = JSON.parse(await browserAdapter.ReadLitematicMeta(path)) as Record<string, unknown>;
    expect(meta["name"]).toBe("测试投影");
    expect(meta["author"]).toBe("作者A");
    expect(meta["description"]).toBe("M1 测试蓝图");
    expect(meta["version"]).toBe(5);
    expect(meta["minecraftDataVersion"]).toBe(3700);
    expect(meta["totalBlocks"]).toBe(42);
    expect(meta["totalVolume"]).toBe(4096);
    expect(meta["timeCreated"]).toBe(1767344640000);
    expect(meta["timeModified"]).toBe(1767344700000);
    expect(meta["enclosingSize"]).toEqual([16, 8, 4]);
    expect(meta["regionCount"]).toBe(1);
    expect(meta["blockStats"]).toEqual([]);
    expect(meta["previewImage"]).toBe("");
  });

  it("缺 Metadata compound → '{}'（对齐 ParseMeta error → '{}'）", async () => {
    const path = await importAs("litematic", "空.litematic", gz(nbtRoot(nbtInt("Version", 5))));
    expect(await browserAdapter.ReadLitematicMeta(path)).toBe("{}");
  });
});

describe("ReadNbtStructure — web 实现（ADR-070 M1）", () => {
  it("返回兼容 JSON（size/blockCount/entityCount/paletteStats/dataVersion）", async () => {
    const path = await importAs("blueprint", "建筑.nbt", makeNbtStructureGz());
    const meta = JSON.parse(await browserAdapter.ReadNbtStructure(path)) as Record<string, unknown>;
    expect(meta["dataVersion"]).toBe(2566);
    expect(meta["size"]).toEqual([3, 4, 5]);
    expect(meta["blockCount"]).toBe(1);
    expect(meta["entityCount"]).toBe(1);
    // palette 条目按 Name 计 1（对齐 ParseNbtStructure:302-321；同 Count 稳定排序保插入序）
    expect(meta["paletteStats"]).toEqual([
      { name: "minecraft:stone", count: 1 },
      { name: "minecraft:dirt", count: 1 },
    ]);
  });

  it("缺 size/blocks/palette → '{}'（对齐 ParseNbtStructure:282-284 判定）", async () => {
    const path = await importAs("blueprint", "空.nbt", gz(nbtRoot(nbtInt("DataVersion", 2566))));
    expect(await browserAdapter.ReadNbtStructure(path)).toBe("{}");
  });

  it("基岩版 1.21+ sub_levels：聚合 size/blockCount/paletteStats", async () => {
    const path = await importAs("blueprint", "基岩.nbt", makeBedrockStructureGz());
    const meta = JSON.parse(await browserAdapter.ReadNbtStructure(path)) as Record<string, unknown>;
    // 全局包围盒：min 取各子结构最小、max 取最大 → size = (max-min+1)
    expect(meta["size"]).toEqual([5 - 0 + 1, 6 - 0 + 1, 7 - 0 + 1]); // [6, 7, 8]
    expect(meta["blockCount"]).toBe(6);
    expect(meta["entityCount"]).toBe(1);
    // 按 palette_id 引用 block_palette.Name 统计真实方块数：stone×2, dirt×2, oak_log×2
    expect(meta["paletteStats"]).toEqual([
      { name: "minecraft:stone", count: 2 },
      { name: "minecraft:dirt", count: 2 },
      { name: "minecraft:oak_log", count: 2 },
    ]);
  });
});

describe("ReadSchematic — web 实现（ADR-070 M1）", () => {
  it("返回兼容 JSON（version/size/blockCount/palette/实体计数）", async () => {
    const path = await importAs("blueprint", "建筑.schematic", makeSchematicGz());
    const meta = JSON.parse(await browserAdapter.ReadSchematic(path)) as Record<string, unknown>;
    expect(meta["version"]).toBe(2);
    expect(meta["dataVersion"]).toBe(2566);
    expect(meta["size"]).toEqual([10, 5, 8]);
    expect(meta["blockCount"]).toBe(400);
    expect(meta["paletteSize"]).toBe(1);
    expect(meta["paletteMax"]).toBe(1);
    expect(meta["name"]).toBe("测试建筑");
    expect(meta["author"]).toBe("作者A");
    expect(meta["tileEntityCount"]).toBe(1);
    expect(meta["entityCount"]).toBe(1);
  });

  it("仅剩 ≤1 字段（只含 Version）→ '{}'（对齐 ParseSchematicSummary:261-263）", async () => {
    const path = await importAs("blueprint", "空.schematic", gz(nbtRoot(nbtInt("Version", 2))));
    expect(await browserAdapter.ReadSchematic(path)).toBe("{}");
  });
});

describe("三个 binding — 失败路径 → '{}'", () => {
  it("文件不存在 → '{}'", async () => {
    expect(await browserAdapter.ReadLitematicMeta("/web/litematic/无/无.litematic")).toBe("{}");
    expect(await browserAdapter.ReadNbtStructure("/web/blueprint/无/无.nbt")).toBe("{}");
    expect(await browserAdapter.ReadSchematic("/web/blueprint/无/无.schematic")).toBe("{}");
  });

  it("非 gzip / 非 NBT 数据 → '{}'", async () => {
    const bad = await importAs("litematic", "坏.litematic", new TextEncoder().encode("not nbt"));
    expect(await browserAdapter.ReadLitematicMeta(bad)).toBe("{}");
    const badNbt = await importAs("blueprint", "坏.nbt", Uint8Array.from([0x01, 0x02, 0x03]));
    expect(await browserAdapter.ReadNbtStructure(badNbt)).toBe("{}");
    const badSch = await importAs("blueprint", "坏.schematic", new TextEncoder().encode("notgzip"));
    expect(await browserAdapter.ReadSchematic(badSch)).toBe("{}");
  });

  it("gzip ISIZE 超大 → 预筛拒收抛错 → '{}'", async () => {
    // 构造 gzip 数据，footer ISIZE 设为 200MB（超过 MAX_NBT_BYTES=100MB）
    // gzip 格式：header + 压缩数据 + optional fields + CRC32(4B) + ISIZE(4B)
    // 我们直接拼一个假 footer：前面放 gzip 魔数 + 任意压缩数据，末尾 8 字节是 CRC+ISIZE
    const fakeData = new Uint8Array(20);
    fakeData[0] = 0x1f;
    fakeData[1] = 0x8b; // gzip magic
    // 末尾 4 字节 ISIZE = 200MB（小端）
    const isize = 200 << 20;
    fakeData[16] = isize & 0xff;
    fakeData[17] = (isize >>> 8) & 0xff;
    fakeData[18] = (isize >>> 16) & 0xff;
    fakeData[19] = (isize >>> 24) & 0xff;
    // CRC32 占位（任意值）
    fakeData[12] = 0;
    fakeData[13] = 0;
    fakeData[14] = 0;
    fakeData[15] = 0;

    expect(() => parseNbtRoot(fakeData)).toThrow("ISIZE");
  });
});
