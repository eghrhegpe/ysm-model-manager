// ===== .nbt structure 体素视图（对齐 voxel.go BuildNbtVoxelData + buildBedrockVoxelData）=====
// 纯 TS 平移 go/litematic/voxel.go:286-382（Java 版）+ 基岩版 1.21+ sub_levels 聚合。
// 消费方：web-fs.ts

import { asArray, asNumber, getCompound, isObj } from "@/utils/resource/nbt-guards.ts";
import type { VoxelBlock, VoxelData } from "./voxel-pipeline.ts";
import {
  finalizeVoxelData,
  groupVoxelStream,
  INT16_MAX,
  INT16_MIN,
  MAX_REGION_AXIS,
  paletteToColors,
  toIntStrict,
} from "./voxel-pipeline.ts";

/**
 * 对齐 voxel.go:286-382 BuildNbtVoxelData：structure NBT 体素视图。
 * 缺 size/blocks/palette、size 长度非 3、size 元素非整型 → null（→ "{}"）。
 * 空气判定按 palette 条目实际颜色（MapColor 对 air 系返回 ""），非 `state == 0`。
 */
export function nbtVoxelView(root: Record<string, unknown>, maxBlocks: number): VoxelData | null {
  // 基岩版 1.21+ structure 新格式：根含 sub_levels 时走聚合分支
  // （对齐 nbt-parse.ts:325 的判定 + Go voxel.go buildBedrockVoxelData 口径）
  const subLevels = asArray(root.sub_levels);
  if (subLevels) return bedrockVoxelView(subLevels, maxBlocks);

  const sizeList = asArray(root.size);
  const blocksList = asArray(root.blocks);
  const paletteList = asArray(root.palette);
  if (!sizeList || !blocksList || !paletteList) return null;
  if (sizeList.length !== 3) return null;
  const sx = toIntStrict(sizeList[0]);
  const sy = toIntStrict(sizeList[1]);
  const sz = toIntStrict(sizeList[2]);
  if (sx === null || sy === null || sz === null) return null;

  const paletteColors = paletteToColors(paletteList, "#7F7F7F");

  let bi = 0;
  const next = (): VoxelBlock | null => {
    for (; bi < blocksList.length; ) {
      const elem: unknown = blocksList[bi];
      bi++;
      if (!isObj(elem)) continue;
      const posList = asArray(elem.pos);
      const stateTag = elem.state;
      if (!posList || stateTag === undefined || posList.length !== 3) continue;
      // 对齐 voxel.go:346-354：state 须为整型且落在 palette 内、颜色非空（air → 跳过）
      if (typeof stateTag !== "number" || !Number.isInteger(stateTag)) continue;
      if (stateTag < 0 || stateTag >= paletteColors.length || paletteColors[stateTag] === "")
        continue;
      const px = asNumber(posList[0]);
      const py = asNumber(posList[1]);
      const pz = asNumber(posList[2]);
      // 对齐 voxel.go:356-370：pos 元素须为整型（int32 口径），越界 int16 丢弃
      if (px === undefined || py === undefined || pz === undefined) continue;
      if (!Number.isInteger(px) || !Number.isInteger(py) || !Number.isInteger(pz)) continue;
      if (
        px < INT16_MIN ||
        px > INT16_MAX ||
        py < INT16_MIN ||
        py > INT16_MAX ||
        pz < INT16_MIN ||
        pz > INT16_MAX
      ) {
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
  let gMinX = 0,
    gMinY = 0,
    gMinZ = 0,
    gMaxX = 0,
    gMaxY = 0,
    gMaxZ = 0;
  let hasBounds = false;
  const infos: SubInfo[] = [];

  for (const sl of subLevels) {
    if (!isObj(sl)) continue;
    const lb = getCompound(sl, "local_bounds");
    const blocks = asArray(sl.blocks);
    if (!lb || !blocks) continue;
    const minX = asNumber(lb.min_x) ?? 0;
    const minY = asNumber(lb.min_y) ?? 0;
    const minZ = asNumber(lb.min_z) ?? 0;
    const maxX = asNumber(lb.max_x) ?? 0;
    const maxY = asNumber(lb.max_y) ?? 0;
    const maxZ = asNumber(lb.max_z) ?? 0;
    if (!hasBounds) {
      gMinX = minX;
      gMinY = minY;
      gMinZ = minZ;
      gMaxX = maxX;
      gMaxY = maxY;
      gMaxZ = maxZ;
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
    const paletteList = asArray(sl.block_palette) ?? [];
    const palette = paletteToColors(paletteList, "#7F7F7F");
    infos.push({ originX: minX, originY: minY, originZ: minZ, palette, blocks });
  }
  if (!hasBounds) return null;

  const size = [gMaxX - gMinX + 1, gMaxY - gMinY + 1, gMaxZ - gMinZ + 1];
  // 对齐 MAX_REGION_AXIS 守卫：基岩版包围盒维度也须合理
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return null;
  if (size[0] > MAX_REGION_AXIS || size[1] > MAX_REGION_AXIS || size[2] > MAX_REGION_AXIS)
    return null;

  let si = 0;
  let bi = 0;
  const next = (): VoxelBlock | null => {
    for (; si < infos.length; ) {
      const info = infos[si];
      for (; bi < info.blocks.length; ) {
        const elem: unknown = info.blocks[bi];
        bi++;
        if (!isObj(elem)) continue;
        const pid = asNumber(elem.palette_id);
        // 空气判定按 palette 条目实际颜色（mapColor 对 air 系返回 ""），非 `pid == 0`
        if (pid === undefined || pid < 0 || pid >= info.palette.length || info.palette[pid] === "")
          continue;
        const lp = getCompound(elem, "local_pos");
        if (!lp) continue;
        const lx = asNumber(lp.x);
        const ly = asNumber(lp.y);
        const lz = asNumber(lp.z);
        if (lx === undefined || ly === undefined || lz === undefined) continue;
        // 全局坐标 = local_bounds.min + local_pos − 聚合 min（平移归零）；int16 守卫与 Java 分支一致
        const gx = info.originX + lx - gMinX;
        const gy = info.originY + ly - gMinY;
        const gz = info.originZ + lz - gMinZ;
        if (
          gx < INT16_MIN ||
          gx > INT16_MAX ||
          gy < INT16_MIN ||
          gy > INT16_MAX ||
          gz < INT16_MIN ||
          gz > INT16_MAX
        ) {
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
