// pack-3d.ts 单元测试：pack 场景「resourcepack」类型 tab 候选源覆盖（修复 3D 内切换面板数据不统一）
import { describe, it, expect } from "vitest";
import { packModelsByType } from "./pack-3d.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

describe("packModelsByType", () => {
  const entries = ["assets/m/models/item/a.json", "assets/m/models/item/b.json"];

  it("resourcepack tab 返回 zip 内全部模型 entry（siblings）", async () => {
    const fn = packModelsByType(entries);
    expect(await fn(RESOURCE_TYPES.PACK)).toEqual(entries);
  });

  it("resourcepack tab 不依赖 base（无 base 也返回 entry）", async () => {
    const fn = packModelsByType(entries);
    expect(await fn("resourcepack")).toEqual(entries);
  });

  it("其他类型委托 base（保留跨类型仓库扫描）", async () => {
    const base = async (): Promise<string[]> => ["other.zip"];
    const fn = packModelsByType(entries, base);
    expect(await fn("ysm")).toEqual(["other.zip"]);
    expect(await fn("vrm")).toEqual(["other.zip"]);
  });

  it("其他类型且无 base 时返回空数组（不抛）", async () => {
    const fn = packModelsByType(entries);
    expect(await fn("vrm")).toEqual([]);
  });
});
