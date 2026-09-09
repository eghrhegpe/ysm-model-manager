// ===== .schematic 体素视图（对齐 voxel.go BuildSchematicVoxelData）=====
// 纯 TS 平移 go/litematic/voxel.go:384-491：v1 Blocks/Data / v2 BlockData varint + Palette。
// 消费方：web-fs.ts

import { asNumber, getCompound } from "@/utils/resource/nbt-guards.ts";
import { readVarInt } from "./voxel-bits.ts";
import { mapColor, resolveBlockName } from "./voxel-colors.ts";
import type { VoxelBlock, VoxelData } from "./voxel-pipeline.ts";
import {
  asByteArray,
  finalizeVoxelData,
  groupVoxelStream,
  indexToCoord,
} from "./voxel-pipeline.ts";

/** 对齐 Go maxSchematicBlocks 512M（schematic w*h*l 总量上限，防溢出/挂起） */
const MAX_SCHEMATIC_BLOCKS = 512_000_000;

/**
 * 对齐 voxel.go:384-491 BuildSchematicVoxelData：schematic 体素视图。
 * 缺 Width/Height/Length、或 Blocks/BlockData 全缺 → null（→ "{}"）。
 * v2：BlockData varint + Palette 映射；v1：Blocks byte array（有 Palette 查表，
 * 无 Palette 用 Data + ResolveBlockName 数字 ID 解析）。
 */
export function schematicVoxelView(
  root: Record<string, unknown>,
  maxBlocks: number,
): VoxelData | null {
  const width = asNumber(root.Width);
  const height = asNumber(root.Height);
  const length = asNumber(root.Length);
  if (width === undefined || height === undefined || length === undefined) return null;
  // 对齐 Go voxel.go:556-564：维度上限（int32 可达 2^31-1，乘积可溢出——Go 用 int64 钳制）
  // 网页版用 JavaScript Number（双精度浮点，安全整数 2^53-1），512M 远小于安全范围，
  // 只需总块数守卫即可防溢出（不额外加 per-axis 上限，避免与 Go 功能分叉——2048×1×1 等长条 schematic 应放行）
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(length))
    return null;
  if (width <= 0 || height <= 0 || length <= 0) return null;
  const total = width * height * length;
  if (total > MAX_SCHEMATIC_BLOCKS) return null;

  const blocksBA = asByteArray(root.Blocks);
  const blockDataBA = asByteArray(root.BlockData);
  const dataBA = asByteArray(root.Data);

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
    // v1: raw Blocks byte array。到此路径时 blocksBA 有值（上方联合守卫 56 行 + v2 条件
    // 不成立的组合）；「v2 BlockData 在而 Palette 缺」时 blocksBA 可能缺 → 空流，
    // 与旧实现 return null 同结果（生成器耗尽即止），`?? []` 仅为类型收窄
    const blocks = blocksBA ?? [];
    for (; i < total && i < blocks.length; ) {
      const blockID = blocks[i];
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
