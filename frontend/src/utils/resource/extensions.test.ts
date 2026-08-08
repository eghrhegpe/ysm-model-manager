import { describe, it, expect } from "vitest";
import { RESOURCE_EXTS, ALL_EXTS, getExts, isSupportedExt, extBelongsTo } from "./extensions.ts";
// P2 修复：直接 import 根目录 resource_types.json 做双向对账（仿 types.test.ts:9）——
// 原测试全部硬编码断言，三端一致性只靠退出码恒 0 陷阱的外部脚本守护
import resourceTypesJson from "../../../../resource_types.json" with { type: "json" };

describe("RESOURCE_EXTS ↔ resource_types.json 双向对账（P2）", () => {
  const jsonTypes = (resourceTypesJson as { resourceTypes: Array<{ id: string; extensions: string[] }> }).resourceTypes;

  it("JSON 每个类型的扩展名都存在于前端表（且大小写一致）", () => {
    for (const rt of jsonTypes) {
      expect(RESOURCE_EXTS[rt.id], `前端表缺类型 ${rt.id}`).toBeDefined();
      for (const ext of rt.extensions) {
        expect(RESOURCE_EXTS[rt.id], `前端表 ${rt.id} 缺扩展名 ${ext}`).toContain(ext);
      }
    }
  });

  it("前端表不包含 JSON 之外的额外类型", () => {
    const jsonIds = new Set(jsonTypes.map((rt) => rt.id));
    for (const id of Object.keys(RESOURCE_EXTS)) {
      expect(jsonIds, `前端表多出类型 ${id}`).toContain(id);
    }
  });

  it(".zip 归属三类（ysm/resourcepack/shaderpack）", () => {
    const types = extBelongsTo(".zip");
    expect(types).toContain("ysm");
    expect(types).toContain("resourcepack");
    expect(types).toContain("shaderpack");
  });
});

describe("RESOURCE_EXTS", () => {
  it("has known type ysm", () => expect(RESOURCE_EXTS.ysm).toContain(".ysm"));
  it("has litematic type", () => expect(RESOURCE_EXTS.litematic).toEqual([".litematic"]));
  it("mmd has pmx", () => expect(RESOURCE_EXTS["mmd-skin"]).toContain(".pmx"));
  it("blueprint has schematic", () => expect(RESOURCE_EXTS["create-blueprint"]).toContain(".schematic"));
});

describe("ALL_EXTS", () => {
  it("contains .ysm", () => expect(ALL_EXTS).toContain(".ysm"));
  it("contains .litematic", () => expect(ALL_EXTS).toContain(".litematic"));
  it("deduplicates .zip (appears in ysm and resourcepack)", () => {
    const zips = ALL_EXTS.filter(e => e === ".zip");
    expect(zips).toHaveLength(1);
  });
});

describe("getExts", () => {
  it("returns exts for known type", () => expect(getExts("ysm")).toContain(".ysm"));
  it("returns empty for unknown type", () => expect(getExts("nonexistent")).toEqual([]));
});

describe("isSupportedExt", () => {
  it("recognizes .ysm", () => expect(isSupportedExt(".ysm")).toBe(true));
  it("recognizes .YSM (case)", () => expect(isSupportedExt(".YSM")).toBe(true));
  it("rejects .xyz", () => expect(isSupportedExt(".xyz")).toBe(false));
  it("rejects empty", () => expect(isSupportedExt("")).toBe(false));
});

describe("extBelongsTo", () => {
  it(".ysm belongs to ysm", () => expect(extBelongsTo(".ysm")).toContain("ysm"));
  it(".zip belongs to both", () => {
    const types = extBelongsTo(".zip");
    expect(types).toContain("ysm");
    expect(types).toContain("resourcepack");
  });
  it("returns [] for unknown", () => expect(extBelongsTo(".xyz")).toEqual([]));
});
