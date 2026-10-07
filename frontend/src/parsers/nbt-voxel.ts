// ===== .nbt structure 体素视图（对齐 voxel.go BuildNbtVoxelData + buildBedrockVoxelData）=====
// 纯 TS 平移 go/litematic/voxel.go:286-382（Java 版）+ 基岩版 1.21+ sub_levels 聚合。
// 消费方：web-fs.ts

import { asArray, asNumber, getCompound, isObj } from "@/utils/resource/nbt-guards.ts";
import type { VoxelBlock, VoxelData } from "./voxel-pipeline.ts";
import {
  finalizeVoxelData,
  groupVoxelStream,
  inInt16Range,
  MAX_REGION_AXIS,
  paletteToColors,
  toIntStrict,
} from "./voxel-pipeline.ts";

/**
 * Java 版 blocks 单项 → 体素方块；形态/范围任一不符 → null（对齐 voxel.go:346-370）。
 * state 须为整型且落在 palette 内、颜色非空（air 按 MapColor 返回 "" 判定，非 `state == 0`）；
 * pos 须为三元素整型且落在 int16 内。
 */
function readStructureBlock(elem: unknown, paletteColors: string[]): VoxelBlock | null {
  if (!isObj(elem)) return null;
  const posList = asArray(elem.pos);
  const stateTag = elem.state;
  if (!posList || stateTag === undefined || posList.length !== 3) return null;
  if (typeof stateTag !== "number" || !Number.isInteger(stateTag)) return null;
  if (stateTag < 0 || stateTag >= paletteColors.length || paletteColors[stateTag] === "")
    return null;
  const px = asNumber(posList[0]);
  const py = asNumber(posList[1]);
  const pz = asNumber(posList[2]);
  if (px === undefined || py === undefined || pz === undefined) return null;
  if (!Number.isInteger(px) || !Number.isInteger(py) || !Number.isInteger(pz)) return null;
  if (!inInt16Range(px) || !inInt16Range(py) || !inInt16Range(pz)) return null;
  return { color: paletteColors[stateTag], x: px, y: py, z: pz };
}

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
      const block = readStructureBlock(blocksList[bi], paletteColors);
      bi++;
      if (block) return block;
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData([sx, sy, sz], colorGroups, truncated, maxBlocks);
}

// ===== 基岩版 1.21+ structure：sub_levels 聚合（对齐 Go buildBedrockVoxelData）=====

/** 单个 sub_level 的遍历信息（局部原点 + 调色板 + 方块表） */
interface BedrockSubInfo {
  origin: [number, number, number];
  palette: string[];
  blocks: unknown[];
}

/** local_bounds → 六分量（缺分量按 0 兜底，对齐 Go 零值口径） */
function readLocalBounds(lb: Record<string, unknown>): {
  min: [number, number, number];
  max: [number, number, number];
} {
  return {
    min: [asNumber(lb.min_x) ?? 0, asNumber(lb.min_y) ?? 0, asNumber(lb.min_z) ?? 0],
    max: [asNumber(lb.max_x) ?? 0, asNumber(lb.max_y) ?? 0, asNumber(lb.max_z) ?? 0],
  };
}

/**
 * sub_levels → 聚合包围盒 + 各子结构遍历信息；无任何有效 sub_level（缺 local_bounds/blocks）
 * → null。首个子结构的分量直接取（可低于初值 0），其后逐分量按 min/max 更值。
 */
function aggregateBedrockSubLevels(subLevels: unknown[]): {
  infos: BedrockSubInfo[];
  min: [number, number, number];
  max: [number, number, number];
} | null {
  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [0, 0, 0];
  let hasBounds = false;
  const infos: BedrockSubInfo[] = [];
  for (const sl of subLevels) {
    if (!isObj(sl)) continue;
    const lb = getCompound(sl, "local_bounds");
    const blocks = asArray(sl.blocks);
    if (!lb || !blocks) continue;
    const sub = readLocalBounds(lb);
    if (!hasBounds) {
      min = sub.min;
      max = sub.max;
      hasBounds = true;
    } else {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], sub.min[axis]);
        max[axis] = Math.max(max[axis], sub.max[axis]);
      }
    }
    // block_palette：Name → mapColor（缺失 Name / 非 compound 元素兜底灰）
    const palette = paletteToColors(asArray(sl.block_palette) ?? [], "#7F7F7F");
    infos.push({ origin: sub.min, palette, blocks });
  }
  if (!hasBounds) return null;
  return { infos, min, max };
}

/**
 * sub_level 内 blocks 单项 → 全局坐标体素方块；越界/空气 → null。
 * 空气判定按 palette 条目实际颜色（mapColor 对 air 系返回 ""），非 `palette_id == 0`。
 */
function readBedrockBlock(
  info: BedrockSubInfo,
  elem: unknown,
  gMin: [number, number, number],
): VoxelBlock | null {
  if (!isObj(elem)) return null;
  const pid = asNumber(elem.palette_id);
  if (pid === undefined || pid < 0 || pid >= info.palette.length || info.palette[pid] === "")
    return null;
  const lp = getCompound(elem, "local_pos");
  if (!lp) return null;
  const lx = asNumber(lp.x);
  const ly = asNumber(lp.y);
  const lz = asNumber(lp.z);
  if (lx === undefined || ly === undefined || lz === undefined) return null;
  // 全局坐标 = local_bounds.min + local_pos − 聚合 min（平移归零）；int16 守卫与 Java 分支一致
  const gx = info.origin[0] + lx - gMin[0];
  const gy = info.origin[1] + ly - gMin[1];
  const gz = info.origin[2] + lz - gMin[2];
  if (!inInt16Range(gx) || !inInt16Range(gy) || !inInt16Range(gz)) return null;
  return { color: info.palette[pid], x: gx, y: gy, z: gz };
}

/**
 * 对齐 voxel.go buildBedrockVoxelData：基岩版 1.21+ structure 体素视图。
 * 每个 sub_level：local_bounds（min/max 聚合全局包围盒）+ blocks（local_pos + palette_id）
 * + block_palette（Name → mapColor）。全局坐标 = local_bounds.min + local_pos − 聚合 min
 * （平移归零，与 Java 版 size/blocks.pos 相对原点语义一致）。
 * 无任何有效 sub_level（缺 local_bounds/blocks）→ null（→ "{}"）。
 */
function bedrockVoxelView(subLevels: unknown[], maxBlocks: number): VoxelData | null {
  const agg = aggregateBedrockSubLevels(subLevels);
  if (!agg) return null;

  const size = [
    agg.max[0] - agg.min[0] + 1,
    agg.max[1] - agg.min[1] + 1,
    agg.max[2] - agg.min[2] + 1,
  ];
  // 对齐 MAX_REGION_AXIS 守卫：基岩版包围盒维度也须合理
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return null;
  if (size[0] > MAX_REGION_AXIS || size[1] > MAX_REGION_AXIS || size[2] > MAX_REGION_AXIS)
    return null;

  let si = 0;
  let bi = 0;
  const next = (): VoxelBlock | null => {
    for (; si < agg.infos.length; ) {
      const info = agg.infos[si];
      for (; bi < info.blocks.length; ) {
        const block = readBedrockBlock(info, info.blocks[bi], agg.min);
        bi++;
        if (block) return block;
      }
      si++;
      bi = 0;
    }
    return null;
  };

  const { colorGroups, truncated } = groupVoxelStream(next, maxBlocks);
  return finalizeVoxelData(size, colorGroups, truncated, maxBlocks);
}
