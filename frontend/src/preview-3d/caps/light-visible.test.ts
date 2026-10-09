// ===== light-visible.ts 守卫（横向铺叶层直测 · ADR-311-d1 判别样本）=====
// 病根锁：`helperVisibleFor` 注释自述旧实现三分歧（createHelper / syncHelper 均缺能力总闸，
// mountHelper 三项齐全）——纯逻辑收敛后无叶测，改错任何一支会静默复活旧三分歧。
// 判别样本模板同 ground-visible.test.ts = **三支各断一支**（专杀「漏能力总闸」旧实现）。
import { describe, it, expect } from "vitest";
import { lightHelperVisibleFor } from "./light-visible.ts";

describe("lightHelperVisibleFor（helper 可见性 · 三支合取）", () => {
  it("三支全真 → 可见（判真侧）", () => {
    expect(lightHelperVisibleFor(true, true, true)).toBe(true);
  });

  it("关线框闸 → 灭（判非真侧 1）", () => {
    expect(lightHelperVisibleFor(true, true, false)).toBe(false);
  });

  it("关本灯 enabled → 灭（判非真侧 2）", () => {
    expect(lightHelperVisibleFor(true, false, true)).toBe(false);
  });

  it("关能力总闸 → 灭（判非真侧 3：专杀「漏能力总闸」的旧 createHelper/syncHelper 实现）", () => {
    expect(lightHelperVisibleFor(false, true, true)).toBe(false);
  });
});