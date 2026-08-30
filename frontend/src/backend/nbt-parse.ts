// ===== 网页版 NBT 二进制解析（ADR-070 M1：.litematic/.nbt/.schematic meta 读取）=====
// 纯 TS 平移 go/litematic/nbt.go 的解码口径（TagType 1B + 名字 u16 长度 + UTF-8 + payload），
// 范式对齐 ADR-049 P2-2 spec-builder.ts（TS 镜像 Go + 测试锁定）。
// M1 只读 meta（不提取 voxel，那是 M2）；三个 binding 的 web 实现经本文件产出 JSON。
//
// NBT 格式（对齐 go/litematic/nbt.go:14-221 + go-mc/nbt）：
//   root  = TagType(1B) + name(u16 len + UTF-8) + payload
//   Compound(10) = 循环 [子类型 + 名字 + payload] 直到 type=0
//   List(9)      = 元素类型(1B) + int32 长度 + N×payload（元素无名字）
//   ByteArray(7)/IntArray(11)/LongArray(12) = int32 长度 + 定长元素
// 值映射（对齐 nbt.go getInt/getString/getByteArray/getList 口径）：
//   Byte/Short/Int/Long/Float/Double → number；String → string；
//   Compound → 嵌套对象；List → 数组；ByteArray/IntArray/LongArray → number[]。
// 输入同时支持 gzip（魔数 1f 8b → gunzipSync）与已解压原始 NBT（按魔数判断）。

import { gunzipSync } from "fflate";

// --- NBT 标签类型常量 ---
const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

/** gzip 魔数（1f 8b）——命中先解压，未命中视为原始 NBT */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** 解压后 NBT 大小上限（对齐 go/litematic/nbt.go maxDecodedBytes 100MB，防 zip-bomb） */
const MAX_NBT_BYTES = 100 << 20;

/**
 * gzip footer ISIZE：末 4 字节（小端）记录原始数据长度 mod 2^32。
 * 合法 NBT 元数据通常 < 10MB；ISIZE ≥ MAX_NBT_BYTES 直接拒收，
 * 避免 gunzipSync 把 100MB 压缩数据膨胀到 TB 级再被事后校验拦住（时序缺陷）。
 * 注意：ISIZE 是模 2^32 的低位，真实值可能更大，但 ≥ MAX_NBT_BYTES 已足够拒收炸弹。
 */
function gzipIsizedUpperBound(bytes: Uint8Array): number | null {
  if (bytes.length < 8) return null; // gzip footer 至少 8 字节（4 ISIZE + 4 CRC32）
  const off = bytes.length - 4;
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

/** 标签类型的最小 payload 字节数（定长类型返回固定值，变长类型返回 0 表示无法预估） */
function minPayloadBytes(tagType: number): number {
  switch (tagType) {
    case TAG_BYTE: return 1;
    case TAG_SHORT: return 2;
    case TAG_INT: return 4;
    case TAG_LONG: return 8;
    case TAG_FLOAT: return 4;
    case TAG_DOUBLE: return 8;
    case TAG_BYTE_ARRAY: return 4; // int32 长度头
    case TAG_STRING: return 2; // uint16 长度头
    case TAG_INT_ARRAY: return 4;
    case TAG_LONG_ARRAY: return 4;
    default: return 0; // compound/list 变长，无法预估
  }
}

/** 嵌套深度上限（对齐 go/litematic/nbt.go maxNbtDepth 256，防深嵌套栈溢出） */
const MAX_NBT_DEPTH = 256;

/** 顺序读取器：越界一律抛错（调用方 catch → "{}"，对齐 Go 畸形文件返回空结果） */
class NbtReader {
  private readonly data: Uint8Array;
  private off = 0;
  // ADR-070 M2：LongArray 精确解码开关——M1 的 number 归一（hi*2^32+lo）对
  // 值 > 2^53 的 long 有精度损失（低 10 位被舍入归零），而 .litematic 的
  // BlockStates 正是 LongArray 打包位（如 0x5555555555555555），位解码必须
  // 拿到精确 64 位。true 时 LongArray 输出 bigint[]（voxel 路径专用）。
  private readonly longsExact: boolean;

  constructor(data: Uint8Array, longsExact = false) {
    this.data = data;
    this.longsExact = longsExact;
  }

  private take(n: number): Uint8Array {
    if (n < 0 || this.off + n > this.data.length) {
      throw new Error(`nbt 截断（需要 ${n} 字节，剩余 ${this.data.length - this.off}）`);
    }
    const out = this.data.subarray(this.off, this.off + n);
    this.off += n;
    return out;
  }

  u8(): number {
    return this.take(1)[0];
  }

  /** u16 大端无符号 */
  u16(): number {
    const b = this.take(2);
    return (b[0] << 8) | b[1];
  }

  /** i32 大端有符号 */
  i32(): number {
    const b = this.take(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) | 0;
  }

  /** i64 大端有符号 → JS number（双精度可无损表示 < 2^53；meta 场景的时间戳/坐标足够） */
  i64(): number {
    const b = this.take(8);
    const hi = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) | 0;
    const lo = ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) >>> 0;
    return hi * 0x100000000 + lo;
  }

  f32(): number {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, false);
  }

  f64(): number {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, false);
  }

  /** u16 长度 + UTF-8 内容（名字与 TAG_String 共用） */
  utf8(n: number): string {
    return new TextDecoder("utf-8").decode(this.take(n));
  }

  /** 读带名字的标签（root / compound 子项）：type + name */
  namedTag(): { type: number; name: string } {
    const type = this.u8();
    const name = this.utf8(this.u16());
    return { type, name };
  }

  private readByteArray(): number[] {
    const n = this.i32();
    if (n < 0 || n > this.data.length - this.off) throw new Error("nbt byteArray 长度异常");
    return Array.from(this.take(n));
  }

  private readList(elemType: number, depth: number): unknown[] {
    const n = this.i32();
    if (n < 0) throw new Error("nbt list 长度异常");
    const remaining = this.data.length - this.off;
    const elemMin = minPayloadBytes(elemType);
    if (elemMin > 0 && n > remaining / elemMin) {
      throw new Error(`nbt list 长度异常: 声明 ${n} 元素（最小 ${elemMin}B/个），剩余 ${remaining} 字节`);
    }
    if (elemMin === 0 && n > remaining) {
      throw new Error(`nbt list 长度异常: 声明 ${n} 元素，剩余 ${remaining} 字节`);
    }
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(this.payload(elemType, depth + 1));
    return out;
  }

  private readCompound(depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (;;) {
      const childType = this.u8();
      if (childType === TAG_END) break;
      const key = this.utf8(this.u16());
      out[key] = this.payload(childType, depth + 1);
    }
    return out;
  }

  private readIntArray(): number[] {
    const n = this.i32();
    if (n < 0 || n > Math.floor((this.data.length - this.off) / 4)) throw new Error("nbt intArray 长度异常");
    const b = this.take(n * 4);
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = ((b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3]) | 0;
    }
    return out;
  }

  private readLongArray(): unknown[] {
    const n = this.i32();
    if (n < 0 || n > Math.floor((this.data.length - this.off) / 8)) throw new Error("nbt longArray 长度异常");
    const b = this.take(n * 8);
    if (this.longsExact) {
      const out: bigint[] = new Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0n;
        for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(b[i * 8 + j]);
        out[i] = v;
      }
      return out;
    }
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const hi = ((b[i * 8] << 24) | (b[i * 8 + 1] << 16) | (b[i * 8 + 2] << 8) | b[i * 8 + 3]) | 0;
      const lo = ((b[i * 8 + 4] << 24) | (b[i * 8 + 5] << 16) | (b[i * 8 + 6] << 8) | b[i * 8 + 7]) >>> 0;
      out[i] = hi * 0x100000000 + lo;
    }
    return out;
  }

  /** 解析一个 payload（无名字；list 元素与 compound 子 payload 共用） */
  payload(type: number, depth: number): unknown {
    if (depth > MAX_NBT_DEPTH) throw new Error("nbt 嵌套过深");
    switch (type) {
      case TAG_BYTE: {
        const b = this.u8();
        return (b << 24) >> 24;
      }
      case TAG_SHORT: {
        const b = this.take(2);
        return (((b[0] << 8) | b[1]) << 16) >> 16;
      }
      case TAG_INT:
        return this.i32();
      case TAG_LONG:
        return this.i64();
      case TAG_FLOAT:
        return this.f32();
      case TAG_DOUBLE:
        return this.f64();
      case TAG_BYTE_ARRAY:
        return this.readByteArray();
      case TAG_STRING:
        return this.utf8(this.u16());
      case TAG_LIST: {
        const elemType = this.u8();
        return this.readList(elemType, depth);
      }
      case TAG_COMPOUND:
        return this.readCompound(depth);
      case TAG_INT_ARRAY:
        return this.readIntArray();
      case TAG_LONG_ARRAY:
        return this.readLongArray();
      default:
        throw new Error(`未知 NBT 标签类型 ${type}`);
    }
  }
}

/** gzip 解压 + 大小上限守卫（parseNbtRoot / parseNbtRootExact 共用前缀）：
 *  gzip 魔数（1f 8b）→ 先 ISIZE 预筛（防 zip-bomb：gunzipSync 无解压期内限，事后校验已太晚），
 *  再 gunzipSync；解压后仍超限抛错。非 gzip 原样返回。 */
function gunzipNbt(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== GZIP_MAGIC_0 || bytes[1] !== GZIP_MAGIC_1) return bytes;
  const isize = gzipIsizedUpperBound(bytes);
  if (isize !== null && isize > MAX_NBT_BYTES) {
    throw new Error(`nbt gzip ISIZE ${isize} 超过 ${MAX_NBT_BYTES} 字节上限`);
  }
  const data = gunzipSync(bytes);
  if (data.length > MAX_NBT_BYTES) throw new Error(`nbt 解压后超过 ${MAX_NBT_BYTES} 字节上限`);
  return data;
}

/**
 * 解析 NBT 根 compound，返回全部顶层标签。
 * - gzip 魔数（1f 8b）→ 先 gunzipSync 解压；否则视为已解压原始 NBT
 * - 根必须是 TAG_Compound；畸形/截断/未知类型 → 抛错（调用方转 "{}"）
 */
export function parseNbtRoot(bytes: Uint8Array): Record<string, unknown> {
  const r = new NbtReader(gunzipNbt(bytes));
  const { type } = r.namedTag();
  if (type !== TAG_COMPOUND) throw new Error(`根标签不是 compound（${type}）`);
  return r.payload(TAG_COMPOUND, 0) as Record<string, unknown>;
}

/**
 * ADR-070 M2：精确 LongArray 变体——LongArray 输出 bigint[]（精确 64 位），
 * 供 voxel 打包位解码（BlockStates）使用。其余标签映射与 parseNbtRoot 完全一致
 * （LongArray 的 number 归一对 > 2^53 的值有精度损失，见 NbtReader.longsExact）。
 * gzip/解压/畸形判定行为不变。
 */
export function parseNbtRootExact(bytes: Uint8Array): Record<string, unknown> {
  const r = new NbtReader(gunzipNbt(bytes), true);
  const { type } = r.namedTag();
  if (type !== TAG_COMPOUND) throw new Error(`根标签不是 compound（${type}）`);
  return r.payload(TAG_COMPOUND, 0) as Record<string, unknown>;
}

// ===== 类型守卫（对齐 go/litematic/nbt.go getInt/getString/getCompound/getList）=====

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** getInt/getLong 统一口径：整型（Byte/Short/Int/Long/Float/Double 均已归一为 number） */
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getCompound(o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  return isObj(v) ? v : undefined;
}

/** getList 口径：List/ByteArray/IntArray 解析后均为 JS 数组，统一取数组值 */
function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

// ===== 三个 binding 的视图提取（对齐 go/litematic/parser.go 输出字段）=====
// 返回 null 表示「无法解析/无有效内容」→ 调用方输出 "{}"（对齐 Go binding 契约）。

/**
 * .litematic 视图：根 Version/MinecraftDataVersion + Metadata compound → LitematicMeta JSON 形状。
 * 字段名对齐 go/types/resource.go:303 LitematicMeta json tag；与 Go 一致**始终全字段输出**
 * （缺省补零值），供 litematic-meta.ts:161 的 name/author/totalBlocks 校验稳定通过。
 * blockStats（需读 region BlockStatePalette + packed bits，属 M2 voxel 范畴）与
 * PreviewImage（需 PNG 编码）M1 省略，输出空值占位。
 */
export function litematicMetaView(root: Record<string, unknown>): Record<string, unknown> | null {
  // 对齐 ParseMeta:29-32：缺 Metadata compound → error → "{}"
  const metadata = getCompound(root, "Metadata");
  if (!metadata) return null;

  const encSize = getCompound(metadata, "EnclosingSize");
  // 对齐 ParseMeta:64-68：Regions compound 键数 = 区域数
  const regions = getCompound(root, "Regions");
  return {
    name: asString(metadata["Name"]) ?? "",
    author: asString(metadata["Author"]) ?? "",
    description: asString(metadata["Description"]) ?? "",
    timeCreated: asNumber(metadata["TimeCreated"]) ?? 0,
    timeModified: asNumber(metadata["TimeModified"]) ?? 0,
    minecraftDataVersion: asNumber(root["MinecraftDataVersion"]) ?? 0,
    version: asNumber(root["Version"]) ?? 0,
    totalBlocks: asNumber(metadata["TotalBlocks"]) ?? 0,
    totalVolume: asNumber(metadata["TotalVolume"]) ?? 0,
    // 对齐 ParseMeta:46-58：缺 compound / 缺分量 → 0
    enclosingSize: encSize
      ? [asNumber(encSize["x"]) ?? 0, asNumber(encSize["y"]) ?? 0, asNumber(encSize["z"]) ?? 0]
      : [0, 0, 0],
    regionCount: regions ? Object.keys(regions).length : 0,
    blockStats: [],
    previewImage: "",
  };
}

/**
 * .nbt 视图：对齐 ParseNbtStructure（parser.go:267）。
 * size（TAG_List<Int> 或 IntArray → number[]）、blocks/entities 列表长度、
 * palette 条目统计（Go 口径：每个 palette 元素计 1）、DataVersion。
 * 基岩版 1.21+ sub_levels 分支聚合 local_bounds 包围盒与 blocks 计数。
 */
export function nbtStructureView(root: Record<string, unknown>): Record<string, unknown> | null {
  // 基岩版 1.21+ structure 新格式：根含 sub_levels 时走聚合分支（对齐 ParseNbtStructure:274）
  const subLevels = asArray(root["sub_levels"]);
  if (subLevels) return bedrockStructureView(root, subLevels);

  const sizeList = asArray(root["size"]);
  const blocksList = asArray(root["blocks"]);
  const paletteList = asArray(root["palette"]);
  const entitiesList = asArray(root["entities"]);
  // 对齐 ParseNbtStructure:282-284：缺 size/blocks/palette 判定无效
  if (!sizeList && !blocksList && !paletteList) return null;

  const out: Record<string, unknown> = {};
  const dv = asNumber(root["DataVersion"]);
  if (dv !== undefined) out["dataVersion"] = dv;
  if (sizeList && sizeList.length === 3) {
    // 对齐 ParseNbtStructure:290-295：取前三个元素转 int
    out["size"] = [toInt(sizeList[0]), toInt(sizeList[1]), toInt(sizeList[2])];
  }
  if (blocksList) out["blockCount"] = blocksList.length;
  if (entitiesList) out["entityCount"] = entitiesList.length;
  // 对齐 ParseNbtStructure:302-321：palette 条目按 Name 计数（每条计 1）+ 数量降序
  if (paletteList) {
    const paletteStats = paletteEntryStats(paletteList);
    if (paletteStats.length > 0) out["paletteStats"] = paletteStats;
  }
  return out;
}

/** palette 条目统计（Go 口径：每个条目按 Name 计 1，仅名非空；按数量降序） */
function paletteEntryStats(paletteList: unknown[]): Array<{ name: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const elem of paletteList) {
    if (!isObj(elem)) continue;
    const name = asString(elem["Name"]);
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 基岩版 1.21+ structure 聚合（对齐 parseBedrockStructure，parser.go:329）。
 * 每个 sub_level：local_bounds（min/max x/y/z）推导全局包围盒、blocks 求和、
 * blocks.palette_id 引用 block_palette.Name 统计、entities/block_entities 求和。
 */
function bedrockStructureView(root: Record<string, unknown>, subLevels: unknown[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const dv = asNumber(root["DataVersion"]);
  if (dv !== undefined) out["dataVersion"] = dv;

  const bounds: Record<string, number> = { min_x: 0, min_y: 0, min_z: 0, max_x: 0, max_y: 0, max_z: 0 };
  const isMax: Record<string, boolean> = { min_x: false, min_y: false, min_z: false, max_x: true, max_y: true, max_z: true };
  let hasBounds = false;
  let blockCount = 0;
  let entityCount = 0;
  let tileEntityCount = 0;
  const counts: Record<string, number> = {};

  for (const sl of subLevels) {
    if (!isObj(sl)) continue;
    const sub = sl;
    // 对齐 parseBedrockStructure:348-365：local_bounds 聚合（首帧直接取，其后按 min/max 更值）
    const lb = getCompound(sub, "local_bounds");
    if (lb) {
      for (const key of Object.keys(bounds)) {
        const v = asNumber(lb[key]);
        if (v === undefined) continue;
        if (!hasBounds || (isMax[key] && v > bounds[key]) || (!isMax[key] && v < bounds[key])) {
          bounds[key] = v;
        }
      }
      hasBounds = true;
    }
    const blocks = asArray(sub["blocks"]);
    if (blocks) blockCount += blocks.length;
    // block_palette：下标 → Name（对齐 parseBedrockStructure:371-379）
    const paletteNames: string[] = [];
    for (const elem of asArray(sub["block_palette"]) ?? []) {
      paletteNames.push(isObj(elem) ? (asString(elem["Name"]) ?? "") : "");
    }
    // blocks.palette_id 引用计数（对齐 parseBedrockStructure:380-390）
    for (const b of blocks ?? []) {
      if (!isObj(b)) continue;
      const pid = asNumber(b["palette_id"]);
      if (pid !== undefined && pid >= 0 && pid < paletteNames.length) {
        const name = paletteNames[pid];
        if (name) counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    const ents = asArray(sub["entities"]);
    if (ents) entityCount += ents.length;
    const bes = asArray(sub["block_entities"]);
    if (bes) tileEntityCount += bes.length;
  }

  // 对齐 parseBedrockStructure:399-418：仅在非零/存在时写入
  if (hasBounds) {
    out["size"] = [bounds.max_x - bounds.min_x + 1, bounds.max_y - bounds.min_y + 1, bounds.max_z - bounds.min_z + 1];
  }
  if (blockCount > 0) out["blockCount"] = blockCount;
  if (entityCount > 0) out["entityCount"] = entityCount;
  if (tileEntityCount > 0) out["tileEntityCount"] = tileEntityCount;
  const stats = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  if (stats.length > 0) out["paletteStats"] = stats;

  // 有效判定（对齐 parseBedrockStructure:422-424）：size 单独即有效，否则仅 DataVersion → 无效
  if (!("size" in out) && Object.keys(out).length <= 1) return null;
  return out;
}

/**
 * .schematic 视图：对齐 ParseSchematicSummary（parser.go:173）。
 * Width/Height/Length → size、Blocks（ByteArray）长度 → blockCount、Palette/PaletteMax、
 * Metadata Name/Author、TileEntities/Entities 列表长度。
 * v1 的 ID→方块名统计分支（paletteCompound==nil && blocks!=nil）需要 Minecraft 方块 ID 表，
 * 属 M2 范围，M1 跳过（paletteStats 缺省，前端渲染「无方块数据」占位）。
 */
export function schematicSummaryView(root: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const version = asNumber(root["Version"]);
  if (version !== undefined) out["version"] = version;
  const dataVersion = asNumber(root["DataVersion"]);
  if (dataVersion !== undefined) out["dataVersion"] = dataVersion;

  // 对齐 ParseSchematicSummary:188-193：三轴齐全才输出 size
  const w = asNumber(root["Width"]);
  const h = asNumber(root["Height"]);
  const l = asNumber(root["Length"]);
  if (w !== undefined && h !== undefined && l !== undefined) out["size"] = [w, h, l];

  // 对齐 ParseSchematicSummary:195-203：Metadata compound 的 Author/Name
  const metadata = getCompound(root, "Metadata");
  if (metadata) {
    const author = asString(metadata["Author"]);
    if (author !== undefined) out["author"] = author;
    const name = asString(metadata["Name"]);
    if (name !== undefined) out["name"] = name;
  }

  // 对齐 ParseSchematicSummary:205-208：Blocks（ByteArray）长度 = blockCount
  const blocks = asArray(root["Blocks"]);
  if (blocks) out["blockCount"] = blocks.length;

  // 对齐 ParseSchematicSummary:210-216：Palette compound 键数 + PaletteMax
  const paletteMax = asNumber(root["PaletteMax"]);
  if (paletteMax !== undefined) out["paletteMax"] = paletteMax;
  const paletteCompound = getCompound(root, "Palette");
  if (paletteCompound) out["paletteSize"] = Object.keys(paletteCompound).length;

  // 对齐 ParseSchematicSummary:252-259：TileEntities/Entities 列表长度
  const tileEntities = asArray(root["TileEntities"]);
  if (tileEntities) out["tileEntityCount"] = tileEntities.length;
  const entities = asArray(root["Entities"]);
  if (entities) out["entityCount"] = entities.length;

  // 对齐 ParseSchematicSummary:261-263：仅剩 ≤1 个字段视为无效 → "{}"
  if (Object.keys(out).length <= 1) return null;
  return out;
}

/** 值 → int（size 元素可能来自 List<Int> 或 IntArray，解析后均为 number） */
function toInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
