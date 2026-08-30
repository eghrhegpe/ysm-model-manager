// @vitest-environment node
// ===== 语义 morph 层测试（semantic-morphs.ts）=====
import { describe, expect, it } from "vitest";
import {
  getSemanticMorph,
  mmdSemanticMorphMap,
  matchSemanticMorph,
  resolveSemanticMorphs,
  type SemanticMorphMap,
} from "./semantic-morphs.ts";

describe("matchSemanticMorph", () => {
  it("MMD 日文标准名命中", () => {
    expect(matchSemanticMorph(["まばたき", "あ"], ["まばたき", "blink"])).toBe("まばたき");
  });

  it("英文变体命中", () => {
    expect(matchSemanticMorph(["blink", "A"], ["blink", "Blink"])).toBe("blink");
    expect(matchSemanticMorph(["A", "mouth"], ["あ", "A", "a"])).toBe("A");
  });

  it("候选顺序即优先级", () => {
    // "あ" 同时命中 lipOpen 和 lipClose 候选 → 取 lipOpen 优先的 "あ"
    expect(matchSemanticMorph(["あ"], ["あ", "A", "mouth"])).toBe("あ");
  });

  it("无命中返回 null", () => {
    expect(matchSemanticMorph(["xyz"], ["あ", "A"])).toBeNull();
    expect(matchSemanticMorph([], ["blink"])).toBeNull();
  });
});

describe("resolveSemanticMorphs / mmdSemanticMorphMap", () => {
  it("MMD 标准 morph 全命中", () => {
    const morphs = [
      { name: "まばたき" },
      { name: "あ" },
      { name: "い" },
      { name: "ウィンク" },
    ];
    const map = mmdSemanticMorphMap(morphs);
    expect(map.blink?.name).toBe("まばたき");
    expect(map.lipOpen?.name).toBe("あ");
    expect(map.lipClose?.name).toBe("い");
    expect(map.blinkLeft?.name).toBe("ウィンク");
    expect(map.lipPucker).toBeUndefined();
    expect(map.lipSmile).toBeUndefined();
  });

  it("部分缺失 → 宽容缺省", () => {
    const map = mmdSemanticMorphMap([{ name: "あ" }]);
    expect(map.lipOpen?.name).toBe("あ");
    expect(map.blink).toBeUndefined();
    expect(map.lipClose).toBeUndefined();
  });

  it("空列表 → 空映射", () => {
    expect(mmdSemanticMorphMap([])).toEqual({});
  });

  it("resolveSemanticMorphs 接受自定义候选表", () => {
    const map = resolveSemanticMorphs(
      ["customBlink"],
      { blink: ["customBlink"] } as unknown as Record<string, readonly string[]>,
    );
    expect(map.blink?.name).toBe("customBlink");
  });
});

describe("getSemanticMorph", () => {
  it("存在返回 entry，缺失返回 null", () => {
    const map: SemanticMorphMap = { blink: { name: "まばたき" } };
    expect(getSemanticMorph(map, "blink")?.name).toBe("まばたき");
    expect(getSemanticMorph(map, "lipOpen")).toBeNull();
    expect(getSemanticMorph({}, "blink")).toBeNull();
  });
});
