// @vitest-environment node
// ===== 感知层：LipSync 测试（lipsync.ts）=====
import { describe, expect, it } from "vitest";
import { createLipSyncController, buildLipMorphIndices } from "./lipsync.ts";
import { type SemanticMorphMap } from "../semantic-morphs.ts";

describe("createLipSyncController", () => {
  it("静音（amplitude=0）→ weight=0", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.15, intensity: 0.8 });
    ctrl.apply(0.016, 0, (w) => traces.push(w));
    expect(traces[0]).toBe(0);
    ctrl.dispose();
  });

  it("低振幅（< sensitivity）→ weight=0", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.2, intensity: 0.8 });
    ctrl.apply(0.016, 0.1, (w) => traces.push(w));
    expect(traces[0]).toBe(0);
    ctrl.dispose();
  });

  it("高振幅（> sensitivity）→ 输出正权重", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.2, intensity: 0.8 });
    ctrl.apply(0.016, 0.8, (w) => traces.push(w));
    expect(traces[0]).toBeGreaterThan(0);
    expect(traces[0]).toBeLessThanOrEqual(0.8);
    ctrl.dispose();
  });

  it("无 callback → 静默降级", () => {
    const ctrl = createLipSyncController();
    expect(() => ctrl.apply(0.016, 0.5, null as unknown as () => void)).not.toThrow();
    ctrl.dispose();
  });

  it("dispose 后不再触发", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController();
    ctrl.dispose();
    ctrl.apply(0.016, 0.8, (w) => traces.push(w));
    expect(traces).toHaveLength(0);
  });

  it("平滑：连续高振幅后降低 → weight 渐进回落", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.1, intensity: 1.0, smoothing: 0.8 });
    // 高振幅
    ctrl.apply(0.016, 0.9, (w) => traces.push(w));
    const high = traces[traces.length - 1];
    // 静音
    ctrl.apply(0.016, 0, (w) => traces.push(w));
    const afterSilence = traces[traces.length - 1];
    // 应回落但未归零（平滑效应）
    expect(afterSilence).toBeLessThan(high);
    expect(afterSilence).toBeGreaterThan(0);
    ctrl.dispose();
  });

  it("amplitude > 1 被 clamp 到 1", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.1, intensity: 0.5 });
    ctrl.apply(0.016, 2.0, (w) => traces.push(w));
    expect(traces[0]).toBeLessThanOrEqual(0.5);
    ctrl.dispose();
  });

  describe("multiMorph", () => {
    it("多 morph 模式：各音素独立驱动", () => {
      const outputs = new Map<string, number[]>();
      const ctrl = createLipSyncController({ multiMorph: true, sensitivity: 0.1, intensity: 1.0 });
      ctrl.applyMulti(0.016, { lipOpen: 0.8, lipClose: 0.2 }, (id, w) => {
        if (!outputs.has(id)) outputs.set(id, []);
        outputs.get(id)!.push(w);
      });
      expect(outputs.has("lipOpen")).toBe(true);
      expect(outputs.has("lipClose")).toBe(true);
      expect(outputs.get("lipOpen")![0]).toBeGreaterThan(0);
      expect(outputs.get("lipClose")![0]).toBeGreaterThan(0);
      ctrl.dispose();
    });

    it("多 morph 模式：未提供的音素不触发", () => {
      const outputs = new Map<string, number[]>();
      const ctrl = createLipSyncController({ multiMorph: true });
      ctrl.applyMulti(0.016, { lipOpen: 0.8 }, (id, w) => {
        if (!outputs.has(id)) outputs.set(id, []);
        outputs.get(id)!.push(w);
      });
      expect(outputs.has("lipOpen")).toBe(true);
      expect(outputs.has("lipClose")).toBe(false);
      ctrl.dispose();
    });
  });
});

describe("buildLipMorphIndices", () => {
  it("从 SemanticMorphMap 提取口型 morph index", () => {
    const morphMap: SemanticMorphMap = {
      lipOpen: { name: "あ" },
      lipClose: { name: "い" },
    };
    const dict = { あ: 3, い: 5, う: 7 };
    const indices = buildLipMorphIndices(morphMap, dict);
    expect(indices.open).toBe(3);
    expect(indices.close).toBe(5);
    expect(indices.pucker).toBeUndefined();
    expect(indices.smile).toBeUndefined();
  });

  it("morph 名不在 dictionary 中 → 跳过", () => {
    const morphMap: SemanticMorphMap = { lipOpen: { name: "あ" } };
    const dict = { い: 5 }; // "あ" 不在
    const indices = buildLipMorphIndices(morphMap, dict);
    expect(indices.open).toBeUndefined();
  });

  it("空 map → 空结果", () => {
    const indices = buildLipMorphIndices({}, {});
    expect(indices.open).toBeUndefined();
    expect(indices.close).toBeUndefined();
  });
});
