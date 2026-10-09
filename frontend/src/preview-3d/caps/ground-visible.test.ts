// ===== ground-visible.ts 守卫（横向铺叶层直测 · ADR-311-d1 判别样本）=====
// 病根锁：显隐判据原手抄在 GroundCapability 三处（updateGridVisible / updateSurfaceVisible /
// isSurfaceVisible），任一处改布尔组合会静默分叉（ADR-249 历史血案同形）。
// 判别样本模板 = **三支各断一支**：专杀「少一支合取」的实现（漏能力总闸 / 漏总开关 / 漏子开关）。
import { describe, it, expect } from "vitest";
import { groundGridVisibleFor, groundSurfaceVisibleFor } from "./ground-visible.ts";

describe("groundGridVisibleFor（参考网格显隐 · 三支合取）", () => {
  it("三支全真 → 可见（判真侧）", () => {
    expect(groundGridVisibleFor(true, true, true)).toBe(true);
  });

  it("断网格开关 → 灭（判非真侧 1）", () => {
    expect(groundGridVisibleFor(true, true, false)).toBe(false);
  });

  it("断地面总开关 → 灭（判非真侧 2）", () => {
    expect(groundGridVisibleFor(true, false, true)).toBe(false);
  });

  it("断能力开关 → 灭（判非真侧 3：专杀「少能力总闸」实现）", () => {
    expect(groundGridVisibleFor(false, true, true)).toBe(false);
  });
});

describe("groundSurfaceVisibleFor（表面层显隐 · 三支合取）", () => {
  it("三支全真（来源非 none）→ 可见（判真侧）", () => {
    expect(groundSurfaceVisibleFor(true, true, "solid")).toBe(true);
    expect(groundSurfaceVisibleFor(true, true, "canvas")).toBe(true);
  });

  it("来源 none → 灭（判非真侧 1：无表面层纯净态）", () => {
    expect(groundSurfaceVisibleFor(true, true, "none")).toBe(false);
  });

  it("断地面总开关 → 灭（判非真侧 2）", () => {
    expect(groundSurfaceVisibleFor(true, false, "solid")).toBe(false);
  });

  it("断能力开关 → 灭（判非真侧 3）", () => {
    expect(groundSurfaceVisibleFor(false, true, "solid")).toBe(false);
  });
});