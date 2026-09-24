// @vitest-environment node
// ===== vmd-expression-map.ts 契约测试（ADR-306 §2.1）=====
// 覆盖：五母音/眨眼/情感 preset 的候选命中、全不可映射 preset 的显式声明、
// 候选名唯一性（防跨 preset 重复导致的静默错绑）。
import { describe, expect, it } from "vitest";
import { VMD_EXPRESSION_CANDIDATES, VMD_EXPRESSION_UNMAPPED } from "./vmd-expression-map.ts";

describe("VMD_EXPRESSION_CANDIDATES", () => {
  it("五母音候选命中（あいうえお）", () => {
    expect(VMD_EXPRESSION_CANDIDATES.aa).toContain("あ");
    expect(VMD_EXPRESSION_CANDIDATES.ih).toContain("い");
    expect(VMD_EXPRESSION_CANDIDATES.ou).toContain("う");
    expect(VMD_EXPRESSION_CANDIDATES.ee).toContain("え");
    expect(VMD_EXPRESSION_CANDIDATES.oh).toContain("お");
  });

  it("眨眼候选：まばたき 为主，双眼 wink 兜底", () => {
    expect(VMD_EXPRESSION_CANDIDATES.blink?.[0]).toBe("まばたき");
    expect(VMD_EXPRESSION_CANDIDATES.blink).toContain("ウィンク");
  });

  it("情感 preset 候选非空", () => {
    for (const preset of ["happy", "angry", "sad", "relaxed", "surprised"] as const) {
      expect(VMD_EXPRESSION_CANDIDATES[preset]?.length).toBeGreaterThan(0);
    }
  });

  it("候选名跨 preset 唯一（防一个 morph 名静默命中多个 preset）", () => {
    const seen = new Map<string, string>();
    for (const [preset, candidates] of Object.entries(VMD_EXPRESSION_CANDIDATES)) {
      for (const c of candidates ?? []) {
        const prev = seen.get(c);
        expect(prev, `候选名「${c}」同时属于 ${prev} 与 ${preset}`).toBeUndefined();
        seen.set(c, preset);
      }
    }
  });

  it("blink 不含单眼 wink（blinkLeft/Right 不映射的决策不被候选名破坏）", () => {
    for (const c of VMD_EXPRESSION_CANDIDATES.blink ?? []) {
      expect(c === "ウィンク右" || c === "ウィンク左").toBe(false);
    }
  });
});

describe("VMD_EXPRESSION_UNMAPPED", () => {
  it("neutral / 单眼 wink / 视线族显式声明不映射 + 原因", () => {
    expect(VMD_EXPRESSION_UNMAPPED.neutral).toBeTruthy();
    expect(VMD_EXPRESSION_UNMAPPED.blinkLeft).toBeTruthy();
    expect(VMD_EXPRESSION_UNMAPPED.blinkRight).toBeTruthy();
    for (const p of ["lookUp", "lookDown", "lookLeft", "lookRight"]) {
      expect(VMD_EXPRESSION_UNMAPPED[p]).toBeTruthy();
    }
  });

  it("显式不映射的 preset 不出现在候选表（两表互斥）", () => {
    for (const preset of Object.keys(VMD_EXPRESSION_UNMAPPED)) {
      expect(VMD_EXPRESSION_CANDIDATES[preset as keyof typeof VMD_EXPRESSION_CANDIDATES]).toBeUndefined();
    }
  });
});
