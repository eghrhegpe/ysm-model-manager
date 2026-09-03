// @vitest-environment node
// ===== voxel 数据构建测试（ADR-070 M2）=====
// 覆盖：readVarInt / extractBits / unpackBlockStates 位解码（期望值对照
// go/litematic/malformed_test.go TestExtractBits_* / TestReadVarInt_ContinuationOverflow）、
// 三个 voxelView（构造 gzip NBT，结构对齐 go/litematic/voxel_test.go 的 makeVoxelGz /
// makeNbtStructureGz / makeSchematicV2Gz / makeSchematicV1Gz）、
// 端到端 browserAdapter.Get*VoxelData（导入 IDB → 调用 → JSON 字段名
// color/positions/size/truncated/maxBlocks 对齐 litematic-adapter.ts 消费）、失败路径 "{}"。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { gzipSync } from "fflate";
import { browserAdapter, importWebFiles } from "./browser-adapter.ts";
import {
  readVarInt,
  extractBits,
  unpackBlockStates,
  bitsPerEntry,
  litematicVoxelView,
  nbtVoxelView,
  schematicVoxelView,
  decodeVoxelNbt,
} from "./voxel-parse.ts";
import { mapColor } from "./voxel-colors.ts";
// 测试直接构造 NBT 字节 → parseNbtRootExact（与 binding 层同一精确 LongArray 解码）
import { parseNbtRootExact } from "./nbt-parse.ts";

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
function nbtInt(name: string, v: number): number[] {
  return nbtTag(0x03, name, [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
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
function nbtLongArray(name: string, vals: bigint[]): number[] {
  const body: number[] = [];
  for (const v of vals) {
    for (let i = 7; i >= 0; i--) body.push(Number((v >> BigInt(8 * i)) & 0xffn));
  }
  return nbtTag(0x0c, name, [
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
  return [...children.flat(), 0x00];
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
/** list 内 int32 元素字节体（无 type/name） */
function intBody(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** 最小 litematic 构造：region 列表（默认 1 个 region：palette [air, stone] + BlockStates） */
function makeLitematicRoot(
  blockStates: bigint[],
  opts: {
    size?: [number, number, number];
    origin?: [number, number, number];
    encSize?: [number, number, number];
    extraRegions?: Array<{ name: string; size: [number, number, number]; origin: [number, number, number]; blockStates: bigint[] }>;
  } = {},
): number[] {
  const size = opts.size ?? [1, 1, 1];
  const origin = opts.origin ?? [0, 0, 0];
  const encSize = opts.encSize ?? size;
  const palette = nbtList("BlockStatePalette", 0x0a,
    nbtCompoundBody(nbtString("Name", "minecraft:air")),
    nbtCompoundBody(nbtString("Name", "minecraft:stone")),
  );
  const specs = [
    { name: "0,0", size, origin, blockStates },
    ...(opts.extraRegions ?? []),
  ];
  const regionTags: number[][] = [];
  for (const r of specs) {
    regionTags.push(nbtCompound(r.name,
      palette,
      nbtCompound("Size", nbtInt("x", r.size[0]), nbtInt("y", r.size[1]), nbtInt("z", r.size[2])),
      nbtCompound("Position", nbtInt("x", r.origin[0]), nbtInt("y", r.origin[1]), nbtInt("z", r.origin[2])),
      nbtLongArray("BlockStates", r.blockStates),
    ));
  }
  return nbtRoot(
    nbtInt("Version", 5),
    nbtCompound("Metadata", nbtCompound("EnclosingSize", nbtInt("x", encSize[0]), nbtInt("y", encSize[1]), nbtInt("z", encSize[2]))),
    nbtCompound("Regions", ...regionTags),
  );
}

const STONE_COLOR = mapColor("minecraft:stone"); // "#7F7F7F"
const STONE = 0x5555555555555555n; // bpe=2 全 stone 位域（每 2 位 = 01）

// ===== 位解码单测（对照 go malformed_test.go TestExtractBits_* / TestReadVarInt_*）=====

describe("readVarInt — 对齐 voxel.go:531-549", () => {
  it("单字节（无 continuation bit）", () => {
    expect(readVarInt([0x05], 0)).toEqual({ value: 5, offset: 1 });
  });
  it("多字节 varint（0xE5 0x0F → 2021）", () => {
    // 0xE5 = 0x65 | 0x80（续位），0x0F << 7 = 0x780 → 0x65 | 0x780 = 0x7E5
    expect(readVarInt([0xe5, 0x0f], 0)).toEqual({ value: 0x7e5, offset: 2 });
  });
  it("畸形无终止 varint：shift≥64 截断（对齐 TestReadVarInt_ContinuationOverflow：offset=10 且值非 0）", () => {
    const { value, offset } = readVarInt(new Array(15).fill(0xff), 0);
    expect(offset).toBe(10);
    expect(value).not.toBe(0);
  });
});

describe("extractBits — 对齐 nbt.go:299-327 / malformed_test.go TestExtractBits_*", () => {
  it("longIdx 越界返回 0（BeyondLongsCapacity）", () => {
    const longs = [0xaaaaaaaaaaaaaaaan, 0x5555555555555555n];
    expect(extractBits(longs, 200, 4)).toBe(0);
  });
  it("跨 long 边界取值（AtLongBoundary：long[0] bit63=1 + long[1] bit0=1 → 3）", () => {
    const longs = [0xffffffffffffffffn, 0x1n];
    expect(extractBits(longs, 63, 2)).toBe(3);
  });
  it("正好贴 64 边界（ExactlyAtEnd：bit60-63 = 0xF）", () => {
    const longs = [0xffffffffffffffffn, 0x0n];
    expect(extractBits(longs, 60, 4)).toBe(15);
  });
  it("单 long 跨边界缺第二容器（OneLongEmpty：high=0）", () => {
    const longs = [0xaaaaaaaaaaaaaaaan];
    expect(extractBits(longs, 60, 8)).toBe(10);
  });
});

describe("unpackBlockStates / bitsPerEntry — 对齐 voxel.go 打包位读取", () => {
  it("0x5555555555555555，bpe=2 → 每 2 位 = 01 → 全 palette 索引 1", () => {
    expect(unpackBlockStates([STONE], 2, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
  it("跨 64 位容器：2 个 long 拼出 33 个 2-bit 组（第 33 个取 long[1] 低 2 位）", () => {
    // long[0] 全 1（32 组 11=3），long[1] = 0b01 → 第 33 组 = 1
    const longs = [0xffffffffffffffffn, 0x1n];
    const out = unpackBlockStates(longs, 2, 33);
    expect(out.slice(0, 32)).toEqual(new Array(32).fill(3));
    expect(out[32]).toBe(1);
  });
  it("越界位 → 0（air，对齐 extractBits longIdx 越界）", () => {
    const out = unpackBlockStates([0x1n], 2, 40);
    expect(out[0]).toBe(1);
    expect(out[31]).toBe(0); // 第 32 个越界（只有 1 个 long）
  });
  it("bitsPerEntry：单条目 0；2/3 项 → 2；5 项 → 3", () => {
    expect(bitsPerEntry(1)).toBe(0);
    expect(bitsPerEntry(2)).toBe(2);
    expect(bitsPerEntry(3)).toBe(2);
    expect(bitsPerEntry(5)).toBe(3);
  });
});

// ===== litematicVoxelView（对齐 BuildVoxelData）=====

describe("litematicVoxelView — .litematic（BuildVoxelData 平移）", () => {
  it("1 个 region、1 个 stone 方块 → size [1,1,1]、1 组 1 位置", () => {
    const root = parse(makeLitematicRoot([1n]));
    const data = litematicVoxelView(root, 100);
    expect(data).not.toBeNull();
    expect(data!.size).toEqual([1, 1, 1]);
    expect(data!.truncated).toBe(false);
    expect(data!.maxBlocks).toBe(100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].color).toBe(STONE_COLOR);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]);
  });

  it("BlockStates=0（palette[0]=air）→ 无方块（对齐 TestBuildVoxelData_PaletteIndex0IsAir）", () => {
    const data = litematicVoxelView(parse(makeLitematicRoot([0n])), 100);
    expect(data!.groups).toHaveLength(0);
  });

  it("maxBlocks=0 → 截断且无方块（对齐 TestBuildVoxelData_MaxBlocksTruncate）", () => {
    const data = litematicVoxelView(parse(makeLitematicRoot([1n])), 0);
    expect(data!.truncated).toBe(true);
    expect(data!.groups).toHaveLength(0);
  });

  it("多 region 同色合并为一组（对齐 TestBuildVoxelData_MultiRegion）", () => {
    const root = parse(makeLitematicRoot([1n], {
      encSize: [2, 1, 1],
      extraRegions: [{ name: "1,0", size: [1, 1, 1], origin: [1, 0, 0], blockStates: [1n] }],
    }));
    const data = litematicVoxelView(root, 100);
    expect(data!.size).toEqual([2, 1, 1]);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0], [1, 0, 0]]);
  });

  it("无 Regions → 仅 Size（对齐 TestBuildVoxelData_NoRegions：groups=null、maxBlocks=0）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 5),
      nbtCompound("Metadata", nbtCompound("EnclosingSize", nbtInt("x", 2), nbtInt("y", 3), nbtInt("z", 4))),
    ));
    const data = litematicVoxelView(root, 100);
    expect(data).toEqual({ size: [2, 3, 4], groups: null, truncated: false, maxBlocks: 0 });
  });

  it("表面过滤：3×3×3 实心方块剔除中心 1 个（对齐 filterSurfaceOnly）", () => {
    // 27 个 2-bit 组全为 1（stone）：低 54 位 = 01 重复 27 次（= 0x15555555555555）
    const bits = 0x15555555555555n; // 54 位 01 模式（27 组）
    const root = parse(makeLitematicRoot([bits], { size: [3, 3, 3] }));
    const data = litematicVoxelView(root, 100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].positions).toHaveLength(26); // 中心 (1,1,1) 被 6 邻居包围 → 剔除
    expect(data!.groups![0].positions).not.toContainEqual([1, 1, 1]);
  });

  it("负 size 标准化 + 负 origin 偏移", () => {
    // size x=-2 → origin x 从 1 起（ox += -2+1 = -1 → 0-1 = ... 实际：origin=1, size=-2 → ox=0, sx=2）
    const palette = nbtList("BlockStatePalette", 0x0a,
      nbtCompoundBody(nbtString("Name", "minecraft:air")),
      nbtCompoundBody(nbtString("Name", "minecraft:stone")),
    );
    const region = nbtCompound("r0",
      palette,
      nbtCompound("Size", nbtInt("x", -2), nbtInt("y", 1), nbtInt("z", 1)),
      nbtCompound("Position", nbtInt("x", 1), nbtInt("y", 0), nbtInt("z", 0)),
      nbtLongArray("BlockStates", [0b0101n]), // block0=1(stone) block1=1(stone)
    );
    const root = parse(nbtRoot(nbtInt("Version", 5),
      nbtCompound("Metadata", nbtCompound("EnclosingSize", nbtInt("x", 2), nbtInt("y", 1), nbtInt("z", 1))),
      nbtCompound("Regions", region),
    ));
    const data = litematicVoxelView(root, 100);
    // 标准化后 origin=(0,0,0) size=(2,1,1)：两个 stone 方块在 x=0、x=1
    expect(data!.groups![0].positions).toEqual([[0, 0, 0], [1, 0, 0]]);
  });

  it("BlockStates 容量不足（size 4×4×4 只有 1 个 long）→ 全部 region 损坏 → null（对齐 TestBuildVoxelData_BlockStatesShort）", () => {
    const palette = nbtList("BlockStatePalette", 0x0a,
      nbtCompoundBody(nbtString("Name", "minecraft:air")),
      nbtCompoundBody(nbtString("Name", "minecraft:stone")),
    );
    const region = nbtCompound("r0",
      palette,
      nbtCompound("Size", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4)),
      nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
      nbtLongArray("BlockStates", [0x5555555555555555n]),
    );
    const root = parse(nbtRoot(nbtInt("Version", 5),
      nbtCompound("Metadata", nbtCompound("EnclosingSize", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4))),
      nbtCompound("Regions", region),
    ));
    expect(litematicVoxelView(root, 100)).toBeNull();
  });

  it("palette 越界索引跳过（0b11 → 3 ≥ len 2）→ 无方块（对齐 TestBuildVoxelData_PaletteIndexOutOfBounds）", () => {
    const data = litematicVoxelView(parse(makeLitematicRoot([0b11n])), 100);
    expect(data!.groups).toHaveLength(0);
  });
});

// ===== nbtVoxelView（对齐 BuildNbtVoxelData）=====

/** 最小 structure NBT：palette [air, stone]，1 个方块 state + pos */
function makeNbtStructureRoot(state: number, pos: [number, number, number] = [0, 0, 0]): number[] {
  return nbtRoot(
    nbtList("size", 0x03, intBody(1), intBody(1), intBody(1)),
    nbtList("palette", 0x0a,
      nbtCompoundBody(nbtString("Name", "minecraft:air")),
      nbtCompoundBody(nbtString("Name", "minecraft:stone")),
    ),
    nbtList("blocks", 0x0a,
      nbtCompoundBody(
        nbtList("pos", 0x03, intBody(pos[0]), intBody(pos[1]), intBody(pos[2])),
        nbtInt("state", state),
      ),
    ),
  );
}

describe("nbtVoxelView — .nbt structure（BuildNbtVoxelData 平移）", () => {
  it("state=1 → palette[1]=stone → 1 组 1 方块（对齐 TestBuildNbtVoxelData_Success）", () => {
    const data = nbtVoxelView(parse(makeNbtStructureRoot(1)), 100);
    expect(data!.size).toEqual([1, 1, 1]);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].color).toBe(STONE_COLOR);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]);
  });

  it("state=0 → palette[0]=air → 跳过（对齐 TestBuildNbtVoxelData_State0）", () => {
    expect(nbtVoxelView(parse(makeNbtStructureRoot(0)), 100)!.groups).toHaveLength(0);
  });

  it("palette[0]=stone 且 state=0 → 保留（对齐 TestBuildNbtVoxelData_State0NonAirPalette）", () => {
    const root = parse(nbtRoot(
      nbtList("size", 0x03, intBody(1), intBody(1), intBody(1)),
      nbtList("palette", 0x0a,
        nbtCompoundBody(nbtString("Name", "minecraft:stone")),
        nbtCompoundBody(nbtString("Name", "minecraft:dirt")),
      ),
      nbtList("blocks", 0x0a,
        nbtCompoundBody(nbtList("pos", 0x03, intBody(0), intBody(0), intBody(0)), nbtInt("state", 0)),
      ),
    ));
    const data = nbtVoxelView(root, 100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]);
  });

  it("air 位于非 0 索引（palette[1]=air, state=1）→ 跳过（对齐 TestBuildNbtVoxelData_AirAtNonZeroIndex）", () => {
    const root = parse(nbtRoot(
      nbtList("size", 0x03, intBody(1), intBody(1), intBody(1)),
      nbtList("palette", 0x0a,
        nbtCompoundBody(nbtString("Name", "minecraft:stone")),
        nbtCompoundBody(nbtString("Name", "minecraft:air")),
      ),
      nbtList("blocks", 0x0a,
        nbtCompoundBody(nbtList("pos", 0x03, intBody(0), intBody(0), intBody(0)), nbtInt("state", 1)),
      ),
    ));
    expect(nbtVoxelView(root, 100)!.groups).toHaveLength(0);
  });

  it("state 越界 / 负值 / pos 越界 int16 → 跳过（对齐 malformed_test.go 九、）", () => {
    // state=5（palette 2 项）→ 跳过
    expect(nbtVoxelView(parse(makeNbtStructureRoot(5)), 100)!.groups).toHaveLength(0);
    // state=-1 → 跳过
    expect(nbtVoxelView(parse(makeNbtStructureRoot(-1)), 100)!.groups).toHaveLength(0);
    // pos x=40000 越界 → 跳过
    expect(nbtVoxelView(parse(makeNbtStructureRoot(1, [40000, 0, 0])), 100)!.groups).toHaveLength(0);
  });

  it("缺 size/blocks/palette → null（对齐 TestBuildNbtVoxelData_NotStructure / InvalidSize）", () => {
    expect(nbtVoxelView(parse(nbtRoot(nbtInt("Version", 5))), 100)).toBeNull();
    expect(nbtVoxelView(parse(nbtRoot(nbtList("size", 0x03, intBody(1), intBody(2)))), 100)).toBeNull();
  });

  it("maxBlocks=0 → truncated（对齐 TestBuildNbtVoxelData_MaxBlocksTruncate）", () => {
    expect(nbtVoxelView(parse(makeNbtStructureRoot(1)), 0)!.truncated).toBe(true);
  });

  it("基岩版 sub_levels 聚合：包围盒 + 坐标平移 + air/越界过滤（对齐 TestBuildNbtVoxelData_BedrockSubLevels）", () => {
    // sub0: bounds (0,0,0)-(1,0,0)；sub1: bounds (2,0,0)-(3,0,0) → 聚合 size [4,1,1]
    const palette = nbtList("block_palette", 0x0a,
      nbtCompoundBody(nbtString("Name", "minecraft:air")),
      nbtCompoundBody(nbtString("Name", "minecraft:stone")),
      nbtCompoundBody(nbtString("Name", "minecraft:red_concrete")),
    );
    const block = (x: number, y: number, z: number, pid: number): number[] =>
      nbtCompoundBody(
        nbtCompound("local_pos", nbtInt("x", x), nbtInt("y", y), nbtInt("z", z)),
        nbtInt("palette_id", pid),
      );
    const sub0 = nbtCompoundBody(
      nbtCompound("local_bounds",
        nbtInt("min_x", 0), nbtInt("min_y", 0), nbtInt("min_z", 0),
        nbtInt("max_x", 1), nbtInt("max_y", 0), nbtInt("max_z", 0)),
      palette,
      nbtList("blocks", 0x0a,
        block(0, 0, 0, 1), // stone → 全局 (0,0,0)
        block(0, 0, 1, 0), // air → 跳过
        block(1, 0, 0, 2), // red_concrete → 全局 (1,0,0)
      ),
    );
    const sub1 = nbtCompoundBody(
      nbtCompound("local_bounds",
        nbtInt("min_x", 2), nbtInt("min_y", 0), nbtInt("min_z", 0),
        nbtInt("max_x", 3), nbtInt("max_y", 0), nbtInt("max_z", 0)),
      palette,
      nbtList("blocks", 0x0a,
        block(0, 0, 0, 1), // origin_x=2 → 全局 (2,0,0)
        block(1, 0, 0, 9), // palette_id 越界 → 跳过
      ),
    );
    const root = parse(nbtRoot(nbtInt("version", 1), nbtList("sub_levels", 0x0a, sub0, sub1)));
    const data = nbtVoxelView(root, 100);
    expect(data!.size).toEqual([4, 1, 1]);
    const byColor: Record<string, number[][]> = {};
    for (const g of data!.groups!) byColor[g.color] = g.positions;
    expect(byColor[STONE_COLOR]).toEqual([[0, 0, 0], [2, 0, 0]]);
    expect(byColor["#932922"]).toEqual([[1, 0, 0]]); // red_concrete
    expect(data!.groups).toHaveLength(2);
  });

  it("基岩版 sub_levels 无有效包围盒 → null（对齐 TestBuildNbtVoxelData_BedrockNoBounds）", () => {
    const root = parse(nbtRoot(nbtList("sub_levels", 0x0a, nbtCompoundBody(nbtInt("id", 0)))));
    expect(nbtVoxelView(root, 100)).toBeNull();
  });
});

// ===== schematicVoxelView（对齐 BuildSchematicVoxelData）=====

describe("schematicVoxelView — .schematic（v1 Blocks / v2 BlockData 双路径）", () => {
  it("v2：BlockData varint [1,0] + Palette → 1 个 stone 方块（对齐 TestBuildSchematicVoxelData_V2BlockData）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 2),
      nbtInt("Width", 2), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("BlockData", [0x01, 0x00]),
      nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data!.size).toEqual([2, 1, 1]);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]); // 索引 0 = blockID 1，索引 1 = air
  });

  it("v1：Blocks [1,0,1] + Palette → 2 个 stone 方块（对齐 TestBuildSchematicVoxelData_V1Blocks）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 1),
      nbtInt("Width", 3), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("Blocks", [0x01, 0x00, 0x01]),
      nbtByteArray("Data", [0, 0, 0]),
      nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0], [2, 0, 0]]);
  });

  it("v1 无 Palette：Blocks + Data 数字 ID 解析（id=1,data=0 → stone）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 1),
      nbtInt("Width", 1), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("Blocks", [0x01]),
      nbtByteArray("Data", [0x00]),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].color).toBe(STONE_COLOR);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]);
  });

  it("v2 多字节 varint 方块 ID（255 + 1 字节扩展 → blockID 511 不在 palette → 默认色）", () => {
    // varint 0xFF 0x03 = 0x7F | 0x03<<7 = 127 + 384 = 511
    const root = parse(nbtRoot(
      nbtInt("Version", 2),
      nbtInt("Width", 1), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("BlockData", [0xff, 0x03]),
      nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].color).toBe("#7F7F7F"); // palette 无 511 → 默认灰
  });

  it("缺 Width/Height/Length → null（对齐 TestBuildSchematicVoxelData_NotSchematic）", () => {
    expect(schematicVoxelView(parse(nbtRoot(nbtInt("Version", 1))), 100)).toBeNull();
  });

  it("有尺寸但无 Blocks/BlockData → null（对齐 TestBuildSchematicVoxelData_NoBlocks）", () => {
    const root = parse(nbtRoot(
      nbtInt("Width", 1), nbtInt("Height", 1), nbtInt("Length", 1),
    ));
    expect(schematicVoxelView(root, 100)).toBeNull();
  });

  it("空 Blocks 数组 ≠ 缺失（对齐 TestBuildSchematicVoxelData_BlocksEmpty：返回空数据而非报错）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 1),
      nbtInt("Width", 2), nbtInt("Height", 2), nbtInt("Length", 2),
      nbtByteArray("Blocks", []),
      nbtByteArray("Data", []),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data).not.toBeNull();
    expect(data!.groups).toHaveLength(0);
  });

  it("截断 varint（0x80 无终止位）→ 静默截断不报错（对齐 TestBuildSchematicVoxelData_TruncatedVarint）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 2),
      nbtInt("Width", 4), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("BlockData", [0x80]),
      nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    ));
    const data = schematicVoxelView(root, 100);
    expect(data).not.toBeNull();
  });

  it("maxBlocks 截断（v2 [1,1] maxBlocks=1 → truncated，对齐 TestBuildSchematicVoxelData_MaxBlocksTruncate）", () => {
    const root = parse(nbtRoot(
      nbtInt("Version", 2),
      nbtInt("Width", 2), nbtInt("Height", 1), nbtInt("Length", 1),
      nbtByteArray("BlockData", [0x01, 0x01]),
      nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
    ));
    const data = schematicVoxelView(root, 1);
    expect(data!.truncated).toBe(true);
  });
});

// ===== 端到端：三个 binding 经 browserAdapter（对齐 M1 测试模式）=====

/** 构造最小 .litematic（1 region 1 stone 方块） */
function makeLitematicGz(): Uint8Array {
  return gz(makeLitematicRoot([1n]));
}
/** 构造最小 .nbt structure（state=1 → stone） */
function makeNbtStructureGz(): Uint8Array {
  return gz(makeNbtStructureRoot(1));
}
/** 构造最小 .schematic v2（BlockData [1] + Palette） */
function makeSchematicGz(): Uint8Array {
  return gz(nbtRoot(
    nbtInt("Version", 2),
    nbtInt("Width", 1), nbtInt("Height", 1), nbtInt("Length", 1),
    nbtByteArray("BlockData", [0x01]),
    nbtCompound("Palette", nbtInt("minecraft:stone", 1)),
  ));
}

async function importAs(type: string, name: string, bytes: Uint8Array): Promise<string> {
  await importWebFiles([new File([bytes.slice()], name, { type: "application/octet-stream" })], type);
  return `/web/${type}/${name.replace(/\.\w+$/, "")}/${name}`;
}

describe("Get*VoxelData — web 实现端到端（ADR-070 M2）", () => {
  it("GetLitematicVoxelData：JSON 字段名对齐 LitematicVoxelData + litematic-adapter 消费（color/positions/size/truncated/maxBlocks）", async () => {
    const path = await importAs("litematic", "投影.litematic", makeLitematicGz());
    const data = await browserAdapter.GetLitematicVoxelData(path);
    expect(data).not.toBeNull();
    expect(data!.size).toEqual([1, 1, 1]);
    expect(data!.groups).toHaveLength(1);
    expect(data!.groups![0].color).toBe(STONE_COLOR);
    expect(data!.groups![0].positions).toEqual([[0, 0, 0]]);
    expect(data!.truncated).toBe(false);
    expect(data!.maxBlocks).toBe(200000); // 对齐 voxelMaxBlocks 默认值
  });

  it("GetNbtVoxelData / GetSchematicVoxelData 端到端", async () => {
    const nbtPath = await importAs("blueprint", "建筑.nbt", makeNbtStructureGz());
    const nbt = await browserAdapter.GetNbtVoxelData(nbtPath);
    expect(nbt).not.toBeNull();
    expect(nbt!.groups![0].positions).toEqual([[0, 0, 0]]);
    expect(nbt!.maxBlocks).toBe(200000);

    const schPath = await importAs("blueprint", "建筑.schematic", makeSchematicGz());
    const sch = await browserAdapter.GetSchematicVoxelData(schPath);
    expect(sch).not.toBeNull();
    expect(sch!.size).toEqual([1, 1, 1]);
    expect(sch!.groups![0].positions).toEqual([[0, 0, 0]]);
    expect(sch!.truncated).toBe(false);
  });

  it("失败路径：文件不存在 / 非 gzip / 缺 palette 结构 → null（ADR-143 P1 error 通道）", async () => {
    // 文件不存在
    expect(await browserAdapter.GetLitematicVoxelData("/web/litematic/无/无.litematic")).toBeNull();
    expect(await browserAdapter.GetNbtVoxelData("/web/blueprint/无/无.nbt")).toBeNull();
    expect(await browserAdapter.GetSchematicVoxelData("/web/blueprint/无/无.schematic")).toBeNull();
    // 非 gzip / 非 NBT → null
    const bad = await importAs("litematic", "坏.litematic", new TextEncoder().encode("not nbt"));
    expect(await browserAdapter.GetLitematicVoxelData(bad)).toBeNull();
    // .nbt 缺 size/blocks/palette
    const emptyNbt = await importAs("blueprint", "空.nbt", gz(nbtRoot(nbtInt("DataVersion", 2566))));
    expect(await browserAdapter.GetNbtVoxelData(emptyNbt)).toBeNull();
    // .schematic 缺 Width/Height/Length
    const emptySch = await importAs("blueprint", "空.schematic", gz(nbtRoot(nbtInt("Version", 1))));
    expect(await browserAdapter.GetSchematicVoxelData(emptySch)).toBeNull();
  });

  it("全部 region 数据损坏的 .litematic → null（对齐 BuildVoxelData 显式报错）", async () => {
    const palette = nbtList("BlockStatePalette", 0x0a,
      nbtCompoundBody(nbtString("Name", "minecraft:air")),
      nbtCompoundBody(nbtString("Name", "minecraft:stone")),
    );
    const region = nbtCompound("r0",
      palette,
      nbtCompound("Size", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4)),
      nbtCompound("Position", nbtInt("x", 0), nbtInt("y", 0), nbtInt("z", 0)),
      nbtLongArray("BlockStates", [0x5555555555555555n]),
    );
    const root = gz(nbtRoot(nbtInt("Version", 5),
      nbtCompound("Metadata", nbtCompound("EnclosingSize", nbtInt("x", 4), nbtInt("y", 4), nbtInt("z", 4))),
      nbtCompound("Regions", region),
    ));
    const path = await importAs("litematic", "坏.litematic", root);
    const data = await browserAdapter.GetLitematicVoxelData(path);
    // view 返回 null（region 全损坏）→ null（ADR-143 P1：失败走 null 而非 {error} JSON）
    expect(data).toBeNull();
  });
});

// ===== 工具 =====
function parse(bytes: number[]): Record<string, unknown> {
  return parseNbtRootExact(Uint8Array.from(bytes));
}

// ===== decodeVoxelNbt 纯函数（IO 与解码解耦后可直接单测：b64 → NBT root）=====
describe("decodeVoxelNbt — base64 → NBT root（纯函数）", () => {
  it("合法 b64（makeLitematicRoot 构造的 NBT）→ 返回可被 voxelView 消费的 root", () => {
    const bytes = makeLitematicRoot([1n]);
    const b64 = Buffer.from(bytes).toString("base64");
    const root = decodeVoxelNbt(b64);
    expect(root).not.toBeNull();
    // 解码结果再经视图消费，确认与「直接 parse」链路等价（IO 解耦不改变解码语义）
    const data = root ? litematicVoxelView(root, 100) : null;
    expect(data).not.toBeNull();
  });

  it("损坏 b64 → null（不抛错，错误语义由调用方契约化）", () => {
    expect(decodeVoxelNbt("!!! not-a-valid-base64 !!!")).toBeNull();
  });

  it("空串 → null", () => {
    expect(decodeVoxelNbt("")).toBeNull();
  });
});
