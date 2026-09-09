// ===== 体素共享管线（对齐 voxel.go groupVoxelStream / filterSurfaceOnly / finalizeVoxelData）=====
// 纯函数：格式视图的 next 生成器 → 按颜色分组 → 表面过滤 → VoxelData 输出。
// 消费方：litematic-voxel.ts / nbt-voxel.ts / schematic-voxel.ts

import { isObj } from "@/utils/resource/nbt-guards.ts";
import { mapColor } from "./voxel-colors.ts";
import type { VoxelData, VoxelGroup } from "./voxel-types.ts";

export type { VoxelData, VoxelGroup } from "./voxel-types.ts";

// --- 内部类型 ---

/** 对齐 voxel.go:30 voxelBlock（各格式统一中间表示；坐标已过 int16 守卫） */
export interface VoxelBlock {
  color: string;
  x: number;
  y: number;
  z: number;
}

/** 对齐 voxel.go:13-19 regionInfo 标准化 region 遍历信息（仅 litematic 使用） */
export interface RegionInfo {
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

// --- 守卫常量（对齐 voxel.go:249-263 region Size/坐标 int16 表示范围）---
export const MAX_REGION_AXIS = 1 << 21;
export const MAX_COORD = 32767;
export const MIN_COORD = -32768;
export const INT16_MAX = 32767;
export const INT16_MIN = -32768;

// --- 共享管线 ---

/**
 * 对齐 voxel.go:54-71 groupVoxelStream：从 next 生成器消费方块流，按颜色分组，
 * 超过 maxBlocks 截断。next 返回 null 表示流结束。
 */
export function groupVoxelStream(
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
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 坐标 → bigint 键（int16 三轴打包为 48 位：x/y/z 各 16 位，偏移 +32768 消符号）。
 * 替代 `${x},${y},${z}` 字符串键，减少热循环中的临时字符串分配。
 */
function packCoord(x: number, y: number, z: number): bigint {
  return ((BigInt(x) + 32768n) << 32n) | ((BigInt(y) + 32768n) << 16n) | (BigInt(z) + 32768n);
}

/** 对齐 voxel.go:502-529 filterSurfaceOnly：剔除被 6 邻居完全包围的不可见方块 */
function filterSurfaceOnly(colorGroups: Map<string, number[][]>): Map<string, number[][]> {
  const occupied = new Set<bigint>();
  for (const positions of colorGroups.values()) {
    for (const p of positions) occupied.add(packCoord(p[0], p[1], p[2]));
  }
  const result = new Map<string, number[][]>();
  for (const [color, positions] of colorGroups) {
    const exposed: number[][] = [];
    for (const p of positions) {
      const x = p[0],
        y = p[1],
        z = p[2];
      let surface = false;
      for (const off of NEIGHBOR_OFFSETS) {
        if (!occupied.has(packCoord(x + off[0], y + off[1], z + off[2]))) {
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
export function finalizeVoxelData(
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

// --- 共享工具函数 ---

/** palette 列表 → 颜色数组（Name → mapColor；缺失 Name / 非 compound 元素兜底 fallback）。
 *  三处视图（schematic / bedrock / 区块）共用，消除重复（jscpd）。 */
export function paletteToColors(paletteList: unknown[], fallback: string): string[] {
  const out: string[] = new Array(paletteList.length);
  for (let i = 0; i < paletteList.length; i++) {
    const elem = paletteList[i];
    if (isObj(elem)) {
      const name = elem.Name;
      out[i] = typeof name === "string" ? mapColor(name) : fallback;
    } else {
      out[i] = fallback;
    }
  }
  return out;
}

/** 索引反推坐标（对齐 voxel.go:437-439 口径）；int16 越界返回 null（调用方跳过）。
 *  坐标写入调用方复用的 out 对象（热循环避免每块一次 {x,y,z} 临时分配——审核 P3）。 */
export function indexToCoord(
  i: number,
  width: number,
  length: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | null {
  out.x = (i - 1) % width;
  out.y = Math.floor((i - 1) / (width * length));
  out.z = Math.floor((i - 1) / width) % length;
  if (
    out.x < INT16_MIN ||
    out.x > INT16_MAX ||
    out.y < INT16_MIN ||
    out.y > INT16_MAX ||
    out.z < INT16_MIN ||
    out.z > INT16_MAX
  ) {
    return null;
  }
  return out;
}

/**
 * getLongArray 口径：LongArray（parseNbtRootExact → bigint[]）。
 * 空数组 ≠ 缺失（对齐 Go `[]bigint{}` 非 nil）——与 asByteArray 同语义。
 */
export function asLongArray(v: unknown): bigint[] | undefined {
  return Array.isArray(v) && (v.length === 0 || typeof v[0] === "bigint")
    ? (v as bigint[])
    : undefined;
}

/** getByteArray 口径：ByteArray 解析后为 number[]。空数组 ≠ 缺失（对齐 Go `[]byte{}` 非 nil） */
export function asByteArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.length > 0 && typeof v[0] !== "number") return undefined;
  return v as number[];
}

/** 整型强校验（对齐 Go `.(int32)` 断言：非整型 number 判无效返回 null） */
export function toIntStrict(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v;
}
