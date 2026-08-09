// ===== 骨骼名导出文本纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { buildBoneNamesText } from "./bone-names.ts";

describe("buildBoneNamesText", () => {
  it("含方块骨骼标注方块数", () => {
    const lines = buildBoneNamesText("mods/a.ysm", 2, [
      { name: "head", cubes: [{}, {}] },
      { name: "arm", cubes: [{}] },
    ]);
    expect(lines).toEqual([
      "模型: mods/a.ysm",
      "骨骼总数: 2",
      "head (2 方)",
      "arm (1 方)",
    ]);
  });

  it("结构骨骼（无方块）标注", () => {
    const lines = buildBoneNamesText("a.ysm", 1, [{ name: "root" }]);
    expect(lines[2]).toBe("root (结构骨骼,无方)");
  });

  it("空骨骼列表只输出头两行", () => {
    const lines = buildBoneNamesText("a.ysm", 0, []);
    expect(lines).toEqual(["模型: a.ysm", "骨骼总数: 0"]);
  });
});
