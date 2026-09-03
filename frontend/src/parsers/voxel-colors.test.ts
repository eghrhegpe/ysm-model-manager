// @vitest-environment node
// ===== voxel-colors 纯算法测试（ADR-070 M2，Go block_colors.go / block_ids.go 平移）=====
// 期望色值为按 Go 语义（FNV-1a 32 位 → HSL(h,50%,60%) → Go 式取整 hex）预计算的
// 固定常量，不依赖被测实现本身；数据表一致性用 voxel-colors-data.json 全量交叉验证。
import { describe, it, expect } from "vitest";
import { mapColor, resolveBlockName } from "./voxel-colors.ts";
import data from "./voxel-colors-data.json";

const BLOCK_COLOR_MAP: Record<string, string> = data.BLOCK_COLOR_MAP;
const BLOCK_VARIANT_NAMES: Record<string, string> = data.BLOCK_VARIANT_NAMES;

describe("mapColor：预定义表直查", () => {
  it("直查命中：stone → #7F7F7F", () => {
    expect(BLOCK_COLOR_MAP["stone"]).toBe("#7F7F7F"); // 夹具自检
    expect(mapColor("stone")).toBe("#7F7F7F");
    expect(mapColor("dirt")).toBe("#9B6B3D");
  });

  it("去命名空间：minecraft:stone 与 stone 同色（冒号裁剪取尾段）", () => {
    expect(mapColor("minecraft:stone")).toBe("#7F7F7F");
    expect(mapColor("minecraft:dirt")).toBe("#9B6B3D");
  });

  it("air / cave_air / void_air 映射为空串（调用方空气判定契约）", () => {
    expect(mapColor("air")).toBe("");
    expect(mapColor("minecraft:cave_air")).toBe("");
    expect(mapColor("minecraft:void_air")).toBe("");
  });

  it("全表交叉验证：294 个预定义键逐一返回表内颜色", () => {
    for (const [name, color] of Object.entries(BLOCK_COLOR_MAP)) {
      expect(mapColor(name), `mapColor(${name})`).toBe(color);
    }
  });
});

describe("mapColor：前缀模糊匹配（对齐 fuzzyMatch 逐段前缀）", () => {
  it("smooth_stone_slab 不在表内 → 逐段前缀命中 smooth_stone", () => {
    expect("smooth_stone_slab" in BLOCK_COLOR_MAP).toBe(false); // 夹具自检
    expect(mapColor("smooth_stone_slab")).toBe("#A6A6A6");
  });

  it("更深层前缀：cracked_stone_bricks_stairs → cracked_stone_bricks", () => {
    expect(mapColor("cracked_stone_bricks_stairs")).toBe("#767676");
  });

  it("带命名空间的前缀匹配仍生效（先裁剪再匹配）", () => {
    expect(mapColor("minecraft:smooth_stone_slab")).toBe("#A6A6A6");
  });
});

describe("mapColor：后缀剥离递归与哈希回退", () => {
  it("前缀全失 + 后缀剥离递归仍失 → 回退整名 FNV 哈希色（固定值）", () => {
    // unknown_ore_stairs：前缀 unknown_ore_stairs / unknown_ore / unknown 全未命中，
    // _stairs 剥离后递归 unknown_ore 也未命中 → hashColor("unknown_ore_stairs")，hue=9
    expect(mapColor("unknown_ore_stairs")).toBe("#cc7566");
  });

  it("纯哈希回退：未知名 → FNV-1a → HSL(50%,60%) 固定色", () => {
    expect(mapColor("mystery_cube")).toBe("#cc7e66"); // hue=14
    expect(mapColor("totally_unknown_block")).toBe("#bdcc66"); // hue=69
  });

  it("哈希回退带命名空间：哈希对象为去命名空间后的名称", () => {
    expect(mapColor("somemod:totally_unknown_block")).toBe("#bdcc66");
  });

  it("hue<60 与 hue>240 覆盖 hueToRgb 全部插值分支（固定期望色）", () => {
    expect(mapColor("probe_10")).toBe("#ccca66"); // hue=59，t<1/6 分支
    expect(mapColor("probe_0")).toBe("#cc66bb"); // hue=310，t>1 分支
  });

  it("空串边界：确定性哈希色（hue=61）", () => {
    expect(mapColor("")).toBe("#cacc66");
  });
});

describe("resolveBlockName：schematic v1 数字 ID → 注册名", () => {
  it("优先精确变体 id:data：17:2 → minecraft:birch_wood", () => {
    expect(BLOCK_VARIANT_NAMES["17:2"]).toBe("minecraft:birch_wood"); // 夹具自检
    expect(resolveBlockName(17, 2)).toBe("minecraft:birch_wood");
    expect(resolveBlockName(17, 3)).toBe("minecraft:jungle_wood");
  });

  it("变体缺失回退 id:0：1:7 → minecraft:stone", () => {
    expect("1:1" in BLOCK_VARIANT_NAMES).toBe(false); // 夹具自检：1 无 data 变体
    expect(resolveBlockName(1, 7)).toBe("minecraft:stone");
  });

  it("id:0 即命中：0:0 → minecraft:air，1:0 → minecraft:stone", () => {
    expect(resolveBlockName(0, 0)).toBe("minecraft:air");
    expect(resolveBlockName(1, 0)).toBe("minecraft:stone");
  });

  it("未找到返回空串（不抛错）", () => {
    expect(resolveBlockName(999999, 0)).toBe("");
    expect(resolveBlockName(999999, 15)).toBe("");
  });

  it("全表交叉验证：1328 个 id:data 变体逐一回解析为注册名", () => {
    for (const [key, expected] of Object.entries(BLOCK_VARIANT_NAMES)) {
      const sep = key.indexOf(":");
      const id = Number(key.slice(0, sep));
      const dataVal = Number(key.slice(sep + 1));
      expect(resolveBlockName(id, dataVal), `resolveBlockName(${id}, ${dataVal})`).toBe(expected);
    }
  });
});
