// ===== 网页版体素数据构建（ADR-070 M2：.litematic/.nbt/.schematic voxel 3D 数据）=====
// 纯 TS 平移 go/litematic/voxel.go（BuildVoxelData/BuildNbtVoxelData/BuildSchematicVoxelData）
// + nbt.go 的 extractBits/bitsPerEntry，与 M1（nbt-parse.ts）共用 parseNbtRootExact
// （LongArray 精确 64 位，打包位解码必需——number 归一在 >2^53 时有精度损失）。
// 输出 JSON 对齐 go/types/resource.go:325 LitematicVoxelData：
//   { size:[x,y,z], groups:[{color,positions:[[x,y,z]...]}], truncated, maxBlocks }
// 消费方 litematic-adapter.ts:11-17 的字段名正是 color/positions（positions 非 blocks）。
// 位解码口径（对齐 nbt.go:299-327 extractBits）：Litematica 小端位序——方块索引从
// 每个 long 的 LSB 开始连续排列，可跨 64 位容器边界。
import { mapColor, resolveBlockName } from "./voxel-colors.ts";
import { base64ToBytes } from "./web-common.ts";
import { parseNbtRootExact } from "./nbt-parse.ts";
import { asArray, asNumber, getCompound, isObj } from "../utils/core/nbt-guards.ts";

/** 对齐 voxel.go:30 voxelBlock（各格式统一中间表示；坐标已过 int16 守卫） */
interface VoxelBlock {
  color: string;
  x: number;
  y: number;
  z: number;
}

/** 对齐 voxel.go:13-19 regionInfo 标准化 region 遍历信息 */
interface RegionInfo {
  originX: number;
  originY: number;
  originZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  palette: string[];
  longs: bigint[];
  bpe: number;
}

/** 输出形状（对齐 types.VoxelGroup / LitematicVoxelData json tag） */
export interface VoxelGroup {
  color: string;
  positions: number[][];
}

export interface VoxelData {
  size: number[];
  groups: VoxelGroup[] | null; // null 仅出现在「无 Regions」降级（对齐 Go 空 Groups → JSON null）
  truncated: boolean;
  maxBlocks: number;
}

// 对齐 voxel.go:249-263 的守卫常量（region Size/坐标 int16 表示范围）
const MAX_REGION_AXIS = 1 << 21;
const MAX_COORD = 32767;
const MIN_COORD = -32768;
const INT16_MAX = 32767;
const INT16_MIN = -32768;
/** 对齐 Go maxSchematicBlocks 512M（schematic w*h*l 总量上限，防溢出/挂起） */
const MAX_SCHEMATIC_BLOCKS = 512_000_000;

// ===== 位解码（对齐 nbt.go extractBits / bitsPerEntry + voxel.go readVarInt）=====

/** 对齐 voxel.go:531-549 readVarInt：返回 {value, offset}（shift≥64 截断防溢出 wrap） */
export function readVarInt(data: ArrayLike<number>, offset: number): { value: number; offset: number } {
  let result = 0;
  let shift = 0;
  while (offset < data.length) {
    if (shift >= 64) break; // 畸形 varint（连续 continuation bit 无终止）→ 截断返回
    const b = data[offset];
    offset++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, offset };
}

/**
 * 对齐 nbt.go:299-327 extractBits：从 LongArray（精确 bigint[]，小端位序）按
 * bitOffset 取 bitCount 位，支持跨 64 位容器边界。longIdx 越界返回 0
 * （与 Go 一致——越界位视为 air）。
 */
export function extractBits(longs: bigint[], bitOffset: number, bitCount: number): number {
  if (bitCount <= 0 || bitOffset < 0) return 0;
  const longIdx = Math.floor(bitOffset / 64);
  const bitPos = bitOffset % 64;
  if (longIdx >= longs.length) return 0;
  const mask = (1n << BigInt(bitCount)) - 1n;
  if (bitPos + bitCount <= 64) {
    return Number((BigInt(longs[longIdx]) >> BigInt(bitPos)) & mask);
  }
  const bitsFromFirst = 64 - bitPos;
  const bitsFromSecond = bitCount - bitsFromFirst;
  const low = BigInt(longs[longIdx]) >> BigInt(bitPos);
  let high = 0n;
  if (longIdx + 1 < longs.length) {
    high = BigInt(longs[longIdx + 1]) & ((1n << BigInt(bitsFromSecond)) - 1n);
  }
  return Number(low | (high << BigInt(bitsFromFirst)));
}

/** 对齐 nbt.go:329-338 bitsPerEntry：palette 大小 → 每方块位数（≥2，单条目返回 0） */
export function bitsPerEntry(paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  let b = Math.ceil(Math.log2(paletteSize));
  if (b < 2) b = 2;
  return b;
}

/**
 * 打包位解码：expectedCount 个方块索引 → palette 索引数组。
 * 输入为精确 64 位 LongArray（parseNbtRootExact 产物；number 归一有精度损失，
 * 见 nbt-parse.ts NbtReader.longsExact）。越界位 → 0（air），与 Go extractBits 一致。
 */
export function unpackBlockStates(longs: bigint[], bitsPerBlock: number, expectedCount: number): number[] {
  const out: number[] = new Array(expectedCount);
  for (let i = 0; i < expectedCount; i++) {
    out[i] = extractBits(longs, i * bitsPerBlock, bitsPerBlock);
  }
  return out;
}

// ===== 共享管线（对齐 voxel.go groupVoxelStream / filterSurfaceOnly / finalizeVoxelData）=====

/**
 * 对齐 voxel.go:54-71 groupVoxelStream：从 next 生成器消费方块流，按颜色分组，
 * 超过 maxBlocks 截断。next 返回 null 表示流结束。
 */
function groupVoxelStream(
  next: () => VoxelBlock | null,
  maxBlocks: number,
): { colorGroups: Map<string, number[][]>; truncated: boolean } {
  const colorGroups = new Map<string, number[][]>();
  let blockCount = 0;
  let truncated = false;
  for (;;) {
    if (blockCount >= maxBlocks) {
      truncated = true;
      break;
    }
    const block = next();
    if (!block) break;
    let arr = colorGroups.get(block.color);
    if (!arr) {
      arr = [];
      colorGroups.set(block.color, arr);
    }
    arr.push([block.x, block.y, block.z]);
    blockCount++;
  }
  return { colorGroups, truncated };
}

// 对齐 voxel.go:494-498 neighborOffsets：6 个相邻方向偏移（表面检测）
const NEIGHBOR_OFFSETS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** 对齐 voxel.go:502-529 filterSurfaceOnly：剔除被 6 邻居完全包围的不可见方块 */
function filterSurfaceOnly(colorGroups: Map<string, number[][]>): Map<string, number[][]> {
  const occupied = new Set<string>();
  for (const positions of colorGroups.values()) {
    for (const p of positions) occupied.add(`${p[0]},${p[1]},${p[2]}`);
  }
  const result = new Map<string, number[][]>();
  for (const [color, positions] of colorGroups) {
    const exposed: number[][] = [];
    for (const p of positions) {
      let surface = false;
      for (const off of NEIGHBOR_OFFSETS) {
        if (!occupied.has(`${p[0] + off[0]},${p[1] + off[1]},${p[2] + off[2]}`)) {
          surface = true;
          break;
        }
      }
      if (surface) exposed.push(p);
    }
    if (exposed.length > 0) result.set(color, exposed);
  }
  return result;
}

/** 对齐 voxel.go:74-89 finalizeVoxelData：表面过滤 + groups 组装（按 color 排序保证输出稳定） */
function finalizeVoxelData(
  size: number[],
  colorGroups: Map<string, number[][]>,
  truncated: boolean,
  maxBlocks: number,
): VoxelData {
  const filtered = filterSurfaceOnly(colorGroups);
  const groups: VoxelGroup[] = [];
  for (const [color, positions] of filtered) {
    groups.push({ color, positions });
  }
  groups.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));
  return { size, groups, truncated, maxBlocks };
}

// ===== 类型守卫（isObj/asArray/asNumber/getCompound 已收敛至 utils/core/nbt-guards.ts；
//       保留本文件独有：asLongArray/asByteArray——LongArray 精确 64 位 bigint 与 ByteArray 非缺失语义）=====

/** palette 列表 → 颜色数组（Name → mapColor；缺失 Name / 非 compound 元素兜底 fallback）。
 *  三处视图（schematic / bedrock / 区块）共用，消除重复（jscpd）。 */
function paletteToColors(paletteList: unknown[], fallback: string): string[] {
  const out: string[] = new Array(paletteList.length);
  for (let i = 0; i < paletteList.length; i++) {
    const elem = paletteList[i];
    if (isObj(elem)) {
      const name = elem["Name"];
      out[i] = typeof name === "string" ? mapColor(name) : fallback;
    } else {
      out[i] = fallback;
    }
  }
  return out;
}

/** 索引反推坐标（对齐 voxel.go:437-439 口径）；int16 越界返回 null（调用方跳过）。
 *  坐标写入调用方复用的 out 对象（热循环避免每块一次 {x,y,z} 临时分配——审核 P3）。 */
function indexToCoord(
  i: number,
  width: number,
  length: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | null {
  out.x = (i - 1) % width;
  out.y = Math.floor((i - 1) / (width * length));
  out.z = Math.floor((i - 1) / width) % length;
  if (out.x < INT16_MIN || out.x > INT16_MAX || out.y < INT16_MIN || out.y > INT16_MAX || out.z < INT16_MIN || out.z > INT16_MAX) {
    return null;
  }
  return out;
}

/** getLongArray 口径：LongArray（parseNbtRootExact → bigint[]） */
function asLongArray(v: unknown): bigint[] | undefined {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "bigint" ? (v as bigint[]) : undefined;
}

/** getByteArray 口径：ByteArray 解析后为 number[]。空数组 ≠ 缺失（对齐 Go `[]byte{}` 非 nil） */
function asByteArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.length > 0 && typeof v[0] !== "number") return undefined;
  return v as number[];
}

// ===== .litematic：Regions → BlockStatePalette + packed bits（对齐 BuildVoxelData）=====

/**
 * 对齐 voxel.go:179-284 buildRegionInfo：标准化一个 region。
 * 返回 { info: null, err: null } = 合法空 region（无 palette/零尺寸/单条目 air palette），静默跳过；
 *       { info: null, err } = 数据损坏（调用方记录首错）；
 *       { info }            = 有效 region。
 */
function buildRegionInfo(region: Record<string, unknown>): { info: RegionInfo | null; err: string | null } {
  const paletteList = asArray(region["BlockStatePalette"]);
  if (!paletteList || paletteList.length <= 1) return { info: null, err: null };

  const palette = paletteToColors(paletteList, "#000000");

  const sizeCompound = getCompound(region, "Size");
  if (!sizeCompound) return { info: null, err: "region 缺少 Size compound" };
  let sx = asNumber(sizeCompound["x"]) ?? 0;
  let sy = asNumber(sizeCompound["y"]) ?? 0;
  let sz = asNumber(sizeCompound["z"]) ?? 0;

  const posCompound = getCompound(region, "Position");
  let ox = 0;
  let oy = 0;
  let oz = 0;
  if (posCompound) {
    ox = asNumber(posCompound["x"]) ?? 0;
    oy = asNumber(posCompound["y"]) ?? 0;
    oz = asNumber(posCompound["z"]) ?? 0;
  }

  // 负 size 标准化（对齐 voxel.go:216-227）
  if (sx < 0) {
    ox += sx + 1;
    sx = -sx;
  }
  if (sy < 0) {
    oy += sy + 1;
    sy = -sy;
  }
  if (sz < 0) {
    oz += sz + 1;
    sz = -sz;
  }
  // 零尺寸 = 合法空 region，静默跳过
  if (sx === 0 || sy === 0 || sz === 0) return { info: null, err: null };

  const longs = asLongArray(region["BlockStates"]);
  if (!longs || longs.length === 0) {
    return { info: null, err: `region 缺少 BlockStates（尺寸 ${sx}×${sy}×${sz} 非空）` };
  }

  const bpe = bitsPerEntry(palette.length);
  if (bpe === 0) return { info: null, err: null }; // 单条目 palette（仅空气）无需读 BlockStates

  // 对齐 voxel.go:245-269：维度上限 + int16 坐标范围双守卫
  if (sx > MAX_REGION_AXIS || sy > MAX_REGION_AXIS || sz > MAX_REGION_AXIS) {
    return { info: null, err: `region Size 超出合理范围: ${sx}×${sy}×${sz}` };
  }
  if (
    ox < MIN_COORD || ox + sx - 1 > MAX_COORD ||
    oy < MIN_COORD || oy + sy - 1 > MAX_COORD ||
    oz < MIN_COORD || oz + sz - 1 > MAX_COORD
  ) {
    return { info: null, err: `region 坐标超出 int16 表示范围: origin=(${ox},${oy},${oz}) size=${sx}×${sy}×${sz}` };
  }
  const total = sx * sy * sz;
  const capacity = Math.floor((longs.length * 64) / bpe);
  if (total > capacity) {
    return { info: null, err: `region BlockStates 容量不足: size=${total} 需 ${total} 位，实际 ${longs.length} 位` };
  }

  return {
    info: {
      originX: ox, originY: oy, originZ: oz,
      sizeX: sx, sizeY: sy, sizeZ: sz,
      palette,
      longs,
      bpe,
    },
    err: null,
  };
}

/**
 * 对齐 voxel.go:92-171 BuildVoxelData：.litematic 体素视图。
 * 无 Regions → 仅返回 Size（maxBlocks: 0、groups: null，对齐 Go 快捷返回）；
 * 所有 region 数据损坏 → null（→ "{}"）。
 */
export function litematicVoxelView(root: Record<string, unknown>, maxBlocks: number): VoxelData | null {
  const encSize: number[] = [0, 0, 0];
  const metadata = getCompound(root, "Metadata");
  if (metadata) {
    const es = getCompound(metadata, "EnclosingSize");
    if (es) {
      const x = asNumber(es["x"]);
      if (x !== undefined) encSize[0] = x;
      const y = asNumber(es["y"]);
      if (y !== undefined) encSize[1] = y;
      const z = asNumber(es["z"]);
      if (z !== undefined) encSize[2] = z;
    }
  }
  // encSize 合理性校验（负值/零值 = 无有效包围盒，但仍输出 size 供降级显示）
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(encSize[i])) encSize[i] = 0;
  }

  const regions = getCompound(root, "Regions");
  if (!regions) {
    return { size: encSize, groups: null, truncated: false, maxBlocks: 0 };
  }

  const regionInfos: RegionInfo[] = [];
  let firstErr: string | null = null;
  for (const regionTag of Object.values(regions)) {
    if (!isObj(regionTag)) continue;
    const { info, err } = buildRegionInfo(regionTag);
    if (err) {
      if (!firstErr) firstErr = err;
      continue;
    }
    if (!info) continue;
    regionInfos.push(info);
  }
  // 所有 region 均损坏 → 显式报错（对齐 voxel.go:139-141）
  if (regionInfos.length === 0 && Object.keys(regions).length > 0 && firstErr) return null;

  // 方块生成器：跨 region 顺序推进，跳过 air/invalid（对齐 voxel.go:144-168）
  let ri = 0;
  let i = 0;
  const next = (): VoxelBlock | null => {
    for (; ri < regionInfos.length; ) {
      const info = regionInfos[ri];
      const totalInRegion = info.sizeX * info.sizeY * info.sizeZ;
      for (; i < totalInRegion; ) {
        const paletteIdx = extractBits(info.longs, i * info.bpe, info.bpe);
        if (paletteIdx < 0 || paletteIdx >= info.palette.length || paletteIdx === 0) {
          i++;
          continue; // air or invalid
        }
        // Minecraft 存储顺序 X→Z→Y（Y 最慢）：i = x + z*sizeX + y*sizeX*sizeZ
        const gx = info.originX + (i % info.sizeX);
        const gz = info.originZ + (Math.floor(i / info.sizeX) % info.sizeZ);
        const gy = info.originY + Math.floor(i / (info.sizeX * info.sizeZ));
        const b: VoxelBlock = { color: info.palette[paletteIdx], x: gx, y: gy, z: gz };
        i++;
        return b;
      }
      ri++;
      i = 0;
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData(encSize, colorGroups, truncated, maxBlocks);
}

// ===== .nbt structure：blocks 列表 + palette（对齐 BuildNbtVoxelData）=====

/**
 * 对齐 voxel.go:286-382 BuildNbtVoxelData：structure NBT 体素视图。
 * 缺 size/blocks/palette、size 长度非 3、size 元素非整型 → null（→ "{}"）。
 * 空气判定按 palette 条目实际颜色（MapColor 对 air 系返回 ""），非 `state == 0`。
 */
export function nbtVoxelView(root: Record<string, unknown>, maxBlocks: number): VoxelData | null {
  // 基岩版 1.21+ structure 新格式：根含 sub_levels 时走聚合分支
  // （对齐 nbt-parse.ts:325 的判定 + Go voxel.go buildBedrockVoxelData 口径）
  const subLevels = asArray(root["sub_levels"]);
  if (subLevels) return bedrockVoxelView(subLevels, maxBlocks);

  const sizeList = asArray(root["size"]);
  const blocksList = asArray(root["blocks"]);
  const paletteList = asArray(root["palette"]);
  if (!sizeList || !blocksList || !paletteList) return null;
  if (sizeList.length !== 3) return null;
  const sx = toIntStrict(sizeList[0], "size[0]");
  const sy = toIntStrict(sizeList[1], "size[1]");
  const sz = toIntStrict(sizeList[2], "size[2]");
  if (sx === null || sy === null || sz === null) return null;

  const paletteColors = paletteToColors(paletteList, "#7F7F7F");

  let bi = 0;
  const next = (): VoxelBlock | null => {
    for (; bi < blocksList.length; ) {
      const elem: unknown = blocksList[bi];
      bi++;
      if (!isObj(elem)) continue;
      const posList = asArray(elem["pos"]);
      const stateTag = elem["state"];
      if (!posList || stateTag === undefined || posList.length !== 3) continue;
      // 对齐 voxel.go:346-354：state 须为整型且落在 palette 内、颜色非空（air → 跳过）
      if (typeof stateTag !== "number" || !Number.isInteger(stateTag)) continue;
      if (stateTag < 0 || stateTag >= paletteColors.length || paletteColors[stateTag] === "") continue;
      const px = asNumber(posList[0]);
      const py = asNumber(posList[1]);
      const pz = asNumber(posList[2]);
      // 对齐 voxel.go:356-370：pos 元素须为整型（int32 口径），越界 int16 丢弃
      if (px === undefined || py === undefined || pz === undefined) continue;
      if (!Number.isInteger(px) || !Number.isInteger(py) || !Number.isInteger(pz)) continue;
      if (px < INT16_MIN || px > INT16_MAX || py < INT16_MIN || py > INT16_MAX || pz < INT16_MIN || pz > INT16_MAX) {
        continue;
      }
      return { color: paletteColors[stateTag], x: px, y: py, z: pz };
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData([sx, sy, sz], colorGroups, truncated, maxBlocks);
}

// ===== 基岩版 1.21+ structure：sub_levels 聚合（对齐 Go buildBedrockVoxelData）=====

/**
 * 对齐 voxel.go buildBedrockVoxelData：基岩版 1.21+ structure 体素视图。
 * 每个 sub_level：local_bounds（min/max 聚合全局包围盒）+ blocks（local_pos + palette_id）
 * + block_palette（Name → mapColor）。全局坐标 = local_bounds.min + local_pos − 聚合 min
 * （平移归零，与 Java 版 size/blocks.pos 相对原点语义一致）。
 * 空气判定按 palette 颜色为空（mapColor 对 air 系返回 ""），非 `palette_id == 0`。
 * 无任何有效 sub_level（缺 local_bounds/blocks）→ null（→ "{}"）。
 */
function bedrockVoxelView(subLevels: unknown[], maxBlocks: number): VoxelData | null {
  interface SubInfo {
    originX: number;
    originY: number;
    originZ: number;
    palette: string[];
    blocks: unknown[];
  }
  let gMinX = 0, gMinY = 0, gMinZ = 0, gMaxX = 0, gMaxY = 0, gMaxZ = 0;
  let hasBounds = false;
  const infos: SubInfo[] = [];

  for (const sl of subLevels) {
    if (!isObj(sl)) continue;
    const lb = getCompound(sl, "local_bounds");
    const blocks = asArray(sl["blocks"]);
    if (!lb || !blocks) continue;
    const minX = asNumber(lb["min_x"]) ?? 0;
    const minY = asNumber(lb["min_y"]) ?? 0;
    const minZ = asNumber(lb["min_z"]) ?? 0;
    const maxX = asNumber(lb["max_x"]) ?? 0;
    const maxY = asNumber(lb["max_y"]) ?? 0;
    const maxZ = asNumber(lb["max_z"]) ?? 0;
    if (!hasBounds) {
      gMinX = minX; gMinY = minY; gMinZ = minZ;
      gMaxX = maxX; gMaxY = maxY; gMaxZ = maxZ;
      hasBounds = true;
    } else {
      if (minX < gMinX) gMinX = minX;
      if (minY < gMinY) gMinY = minY;
      if (minZ < gMinZ) gMinZ = minZ;
      if (maxX > gMaxX) gMaxX = maxX;
      if (maxY > gMaxY) gMaxY = maxY;
      if (maxZ > gMaxZ) gMaxZ = maxZ;
    }
    // block_palette：Name → mapColor（缺失 Name / 非 compound 元素兜底灰）
    const paletteList = asArray(sl["block_palette"]) ?? [];
    const palette = paletteToColors(paletteList, "#7F7F7F");
    infos.push({ originX: minX, originY: minY, originZ: minZ, palette, blocks });
  }
  if (!hasBounds) return null;

  const size = [gMaxX - gMinX + 1, gMaxY - gMinY + 1, gMaxZ - gMinZ + 1];
  // 对齐 MAX_REGION_AXIS 守卫：基岩版包围盒维度也须合理
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return null;
  if (size[0] > MAX_REGION_AXIS || size[1] > MAX_REGION_AXIS || size[2] > MAX_REGION_AXIS) return null;

  let si = 0;
  let bi = 0;
  const next = (): VoxelBlock | null => {
    for (; si < infos.length; ) {
      const info = infos[si];
      for (; bi < info.blocks.length; ) {
        const elem: unknown = info.blocks[bi];
        bi++;
        if (!isObj(elem)) continue;
        const pid = asNumber(elem["palette_id"]);
        // 空气判定按 palette 条目实际颜色（mapColor 对 air 系返回 ""），非 `pid == 0`
        if (pid === undefined || pid < 0 || pid >= info.palette.length || info.palette[pid] === "") continue;
        const lp = getCompound(elem, "local_pos");
        if (!lp) continue;
        const lx = asNumber(lp["x"]);
        const ly = asNumber(lp["y"]);
        const lz = asNumber(lp["z"]);
        if (lx === undefined || ly === undefined || lz === undefined) continue;
        // 全局坐标 = local_bounds.min + local_pos − 聚合 min（平移归零）；int16 守卫与 Java 分支一致
        const gx = info.originX + lx - gMinX;
        const gy = info.originY + ly - gMinY;
        const gz = info.originZ + lz - gMinZ;
        if (gx < INT16_MIN || gx > INT16_MAX || gy < INT16_MIN || gy > INT16_MAX || gz < INT16_MIN || gz > INT16_MAX) {
          continue;
        }
        return { color: info.palette[pid], x: gx, y: gy, z: gz };
      }
      si++;
      bi = 0;
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData(size, colorGroups, truncated, maxBlocks);
}

// ===== .schematic：v1 Blocks/Data / v2 BlockData varint + Palette（对齐 BuildSchematicVoxelData）=====

/**
 * 对齐 voxel.go:384-491 BuildSchematicVoxelData：schematic 体素视图。
 * 缺 Width/Height/Length、或 Blocks/BlockData 全缺 → null（→ "{}"）。
 * v2：BlockData varint + Palette 映射；v1：Blocks byte array（有 Palette 查表，
 * 无 Palette 用 Data + ResolveBlockName 数字 ID 解析）。
 */
export function schematicVoxelView(root: Record<string, unknown>, maxBlocks: number): VoxelData | null {
  const width = asNumber(root["Width"]);
  const height = asNumber(root["Height"]);
  const length = asNumber(root["Length"]);
  if (width === undefined || height === undefined || length === undefined) return null;
  // 对齐 Go voxel.go:556-564：维度上限（int32 可达 2^31-1，乘积可溢出——Go 用 int64 钳制）
  // 网页版用 JavaScript Number（双精度浮点，安全整数 2^53-1），512M 远小于安全范围，
  // 只需总块数守卫即可防溢出（不额外加 per-axis 上限，避免与 Go 功能分叉——2048×1×1 等长条 schematic 应放行）
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(length)) return null;
  if (width <= 0 || height <= 0 || length <= 0) return null;
  const total = width * height * length;
  if (total > MAX_SCHEMATIC_BLOCKS) return null;

  const blocksBA = asByteArray(root["Blocks"]);
  const blockDataBA = asByteArray(root["BlockData"]);
  const dataBA = asByteArray(root["Data"]);

  const paletteCompound = getCompound(root, "Palette");
  let paletteMap: Record<number, string> | null = null;
  if (paletteCompound) {
    paletteMap = {};
    for (const [name, v] of Object.entries(paletteCompound)) {
      if (typeof v === "number" && Number.isInteger(v)) paletteMap[v] = mapColor(name);
    }
  }

  // total 已在上方经 MAX_SCHEMATIC_BLOCKS 守卫，此处无需重复校验
  if (blockDataBA === undefined && blocksBA === undefined) return null;

  // 方块生成器：v1 raw Blocks / v2 varint BlockData 双路径，跳过 air（blockID 0）
  let i = 0;
  let offset = 0;
  // 坐标 scratch（indexToCoord 复用写入，避免每块一次临时分配——审核 P3）
  const coord = { x: 0, y: 0, z: 0 };
  const next = (): VoxelBlock | null => {
    if (blockDataBA !== undefined && paletteMap !== null) {
      // v2: varint BlockData
      for (; i < total && offset < blockDataBA.length; ) {
        const r = readVarInt(blockDataBA, offset);
        offset = r.offset;
        i++;
        if (r.value === 0) continue;
        let color = "#7F7F7F";
        const c = paletteMap[r.value];
        if (c !== undefined) color = c;
        // 坐标由索引反推（对齐 voxel.go:437-439），int16 守卫
        if (!indexToCoord(i, width, length, coord)) continue;
        return { color, x: coord.x, y: coord.y, z: coord.z };
      }
      return null;
    }
    // v1: raw Blocks byte array
    for (; i < total && i < (blocksBA?.length ?? 0); ) {
      const blockID = blocksBA![i];
      i++;
      if (blockID === 0) continue;
      let color = "#7F7F7F";
      if (paletteMap !== null) {
        const c = paletteMap[blockID];
        if (c !== undefined) color = c;
      } else {
        let d = 0;
        if (dataBA !== undefined && i - 1 < dataBA.length) d = dataBA[i - 1];
        const name = resolveBlockName(blockID, d);
        if (name !== "") color = mapColor(name);
      }
      if (!indexToCoord(i, width, length, coord)) continue;
      return { color, x: coord.x, y: coord.y, z: coord.z };
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData([width, height, length], colorGroups, truncated, maxBlocks);
}

/** 整型强校验（对齐 Go `.(int32)` 断言：非整型 number 判无效返回 null） */
function toIntStrict(v: unknown, label: string): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v;
}

/**
 * 纯函数：base64 字节 → NBT root（IO 与解码解耦——本函数无任何 IO，输入 b64 字符串
 * 输出解析后的 root 对象；readVoxelJson 等装配层只负责「读文件 → 调本函数 → 视图」）。
 * 任一环节失败（非法 base64 / NBT 解析失败）返回 null，错误语义由调用方契约化。
 */
export function decodeVoxelNbt(b64: string): Record<string, unknown> | null {
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  // 契约：解析失败返回 null（parseNbtRootExact 对畸形 NBT 会抛错，此处兜底）
  try {
    return parseNbtRootExact(bytes);
  } catch {
    return null;
  }
}
