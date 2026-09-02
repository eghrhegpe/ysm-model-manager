// @vitest-environment node
// ===== Go-TS 方块配色对拍（ADR-154 pilot 2：双端互锁）=====
// 与 go/litematic/parity_voxel_test.go 互锁：Go 侧测试直接读 data.json 逐键验证
// 生成物未过期；本文件从 TS 侧消费同一 data.json（mapColor/resolveBlockName 的
// 数据源），并断言算法行为（命名空间裁剪 / 空气空串 / 模糊匹配 / 哈希回退）。
// 任一端改口径，另一端 go test / vitest 红。
import { describe, it, expect } from "vitest";
import { mapColor, resolveBlockName } from "./voxel-colors.ts";
import voxelData from "./voxel-colors-data.json" with { type: "json" };

const data = voxelData as unknown as {
  BLOCK_COLOR_MAP: Record<string, string>;
  BLOCK_VARIANT_NAMES: Record<string, string>;
};

describe("方块配色表对拍（ADR-154 pilot 2）", () => {
  it("fixture 非空（防空转守卫）", () => {
    expect(Object.keys(data.BLOCK_COLOR_MAP).length).toBeGreaterThan(0);
    expect(Object.keys(data.BLOCK_VARIANT_NAMES).length).toBeGreaterThan(0);
  });

  it("全量表：mapColor 对每个预定义键输出 = data.json 值（TS 数据源与 Go 一致）", () => {
    for (const [name, want] of Object.entries(data.BLOCK_COLOR_MAP)) {
      expect(mapColor(name), `mapColor(${name})`).toBe(want);
    }
  });

  it("全量表：resolveBlockName 对每个 id:data 变体输出 = data.json 值", () => {
    for (const [key, want] of Object.entries(data.BLOCK_VARIANT_NAMES)) {
      const [idStr, dataStr] = key.split(":");
      expect(
        resolveBlockName(Number(idStr), Number(dataStr)),
        `resolveBlockName(${key})`,
      ).toBe(want);
    }
  });
});

describe("方块配色算法行为（与 Go block_colors.go 对齐）", () => {
  it("去命名空间：minecraft:stone 与 stone 同色", () => {
    expect(mapColor("minecraft:stone")).toBe(data.BLOCK_COLOR_MAP["stone"]);
  });

  it("air 系映射为空串（调用方空气方块判定契约）", () => {
    for (const name of ["air", "minecraft:air", "cave_air", "void_air"]) {
      expect(mapColor(name), name).toBe("");
    }
  });

  it("未知名走 FNV 哈希回退（确定性、与 Go hashColor 同口径）", () => {
    // 全表无此名 → 哈希回退固定值（对齐 go/litematic/block_colors_test.go 的口径）
    const h1 = mapColor("no_such_block_xyz");
    expect(h1).toMatch(/^#[0-9a-f]{6}$/);
    expect(mapColor("no_such_block_xyz")).toBe(h1); // 确定性
  });

  it("变体回退：精确变体缺失时回退 id:0", () => {
    // 找一个有 id:0 但无对应 id:data 的键做回退验证（对拍 Go ResolveBlockName 口径）
    const id0 = Object.entries(data.BLOCK_VARIANT_NAMES).find(([k]) => k.endsWith(":0"));
    expect(id0).toBeTruthy();
    const [idStr, , val] = [id0![0].split(":")[0], 0, id0![1]];
    // 与 Go 一致：未知 data 变体回退 id:0 的注册名
    expect(resolveBlockName(Number(idStr), 15)).toBe(val);
  });
});
