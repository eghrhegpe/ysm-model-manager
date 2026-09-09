// ===== .litematic 体素视图（对齐 voxel.go BuildVoxelData）=====
// 纯 TS 平移 go/litematic/voxel.go:92-284：Regions → BlockStatePalette + packed bits。
// 消费方：web-fs.ts

import { asArray, asNumber, getCompound, isObj } from "@/utils/resource/nbt-guards.ts";
import { bitsPerEntry, extractBits } from "./voxel-bits.ts";
import type { RegionInfo, VoxelBlock, VoxelData } from "./voxel-pipeline.ts";
import {
  asLongArray,
  finalizeVoxelData,
  groupVoxelStream,
  MAX_COORD,
  MAX_REGION_AXIS,
  MIN_COORD,
  paletteToColors,
} from "./voxel-pipeline.ts";

/**
 * 对齐 voxel.go:179-284 buildRegionInfo：标准化一个 region。
 * 返回 { info: null, err: null } = 合法空 region（无 palette/零尺寸/单条目 air palette），静默跳过；
 *       { info: null, err } = 数据损坏（调用方记录首错）；
 *       { info }            = 有效 region。
 */
function buildRegionInfo(region: Record<string, unknown>): {
  info: RegionInfo | null;
  err: string | null;
} {
  const paletteList = asArray(region.BlockStatePalette);
  if (!paletteList || paletteList.length <= 1) return { info: null, err: null };

  const palette = paletteToColors(paletteList, "#000000");

  const sizeCompound = getCompound(region, "Size");
  if (!sizeCompound) return { info: null, err: "region 缺少 Size compound" };
  let sx = asNumber(sizeCompound.x) ?? 0;
  let sy = asNumber(sizeCompound.y) ?? 0;
  let sz = asNumber(sizeCompound.z) ?? 0;

  const posCompound = getCompound(region, "Position");
  let ox = 0;
  let oy = 0;
  let oz = 0;
  if (posCompound) {
    ox = asNumber(posCompound.x) ?? 0;
    oy = asNumber(posCompound.y) ?? 0;
    oz = asNumber(posCompound.z) ?? 0;
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

  const longs = asLongArray(region.BlockStates);
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
    ox < MIN_COORD ||
    ox + sx - 1 > MAX_COORD ||
    oy < MIN_COORD ||
    oy + sy - 1 > MAX_COORD ||
    oz < MIN_COORD ||
    oz + sz - 1 > MAX_COORD
  ) {
    return {
      info: null,
      err: `region 坐标超出 int16 表示范围: origin=(${ox},${oy},${oz}) size=${sx}×${sy}×${sz}`,
    };
  }
  const total = sx * sy * sz;
  const capacity = Math.floor((longs.length * 64) / bpe);
  if (total > capacity) {
    return {
      info: null,
      err: `region BlockStates 容量不足: size=${total} 需 ${total} 位，实际 ${longs.length} 位`,
    };
  }

  return {
    info: {
      originX: ox,
      originY: oy,
      originZ: oz,
      sizeX: sx,
      sizeY: sy,
      sizeZ: sz,
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
export function litematicVoxelView(
  root: Record<string, unknown>,
  maxBlocks: number,
): VoxelData | null {
  const encSize: number[] = [0, 0, 0];
  const metadata = getCompound(root, "Metadata");
  if (metadata) {
    const es = getCompound(metadata, "EnclosingSize");
    if (es) {
      const x = asNumber(es.x);
      if (x !== undefined) encSize[0] = x;
      const y = asNumber(es.y);
      if (y !== undefined) encSize[1] = y;
      const z = asNumber(es.z);
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
