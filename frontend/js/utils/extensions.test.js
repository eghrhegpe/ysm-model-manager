import { describe, it, expect } from "vitest";
import { RESOURCE_EXTS, ALL_EXTS, getExts, isSupportedExt, extBelongsTo } from "./extensions.js";

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
