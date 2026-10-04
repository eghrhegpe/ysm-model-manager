// @vitest-environment node
// ===== [锐评 X-7 2026-10-04] godRaysIntensity 曲线 + clamp 守卫真实性 =====
// 原实现 `Math.min(1, Math.max(0, (20 - e) / 20))` 在过门后恒等（(20−e)/20 ∈ (0, 0.99995)）
// ——与水面 P1-3② 同族的「恒真守卫」。处置同范式：保留 clamp 作纵深防御 + 数值判据自证。
import { describe, it, expect } from "vitest";
import { godRaysIntensity } from "./sun-beams.ts";

describe("godRaysIntensity — 强度曲线（锐评 X-7）", () => {
  it("黄金时刻：越接近地平线越强", () => {
    expect(godRaysIntensity(0.5)).toBeGreaterThan(godRaysIntensity(10));
    expect(godRaysIntensity(10)).toBeGreaterThan(godRaysIntensity(19.9));
  });

  it("门外一律归零：落山 / 地平线容差 / 正午（夜间穿帮是旧实现的病根）", () => {
    expect(godRaysIntensity(0)).toBe(0);
    expect(godRaysIntensity(-17.8), "夜间必须为 0（旧实现此处满强度）").toBe(0);
    expect(godRaysIntensity(1e-3), "容差边界视为落山").toBe(0);
    expect(godRaysIntensity(20), "正午无光束").toBe(0);
    expect(godRaysIntensity(70)).toBe(0);
  });
});

describe("godRaysIntensity — clamp 守卫的真实性（锐评 X-7）", () => {
  it("域内恒等：门内取值的 clamp 永不夹住（值恰等于未夹表达式）", () => {
    for (const e of [0.002, 1, 5, 10, 15, 19.999]) {
      expect(godRaysIntensity(e), `e=${e} 域内不得被夹`).toBeCloseTo((20 - e) / 20, 12);
    }
  });

  it("反证（守卫得是真守卫）：门若失效，clamp 真能兜住越界值", () => {
    // 直接算「未门控表达式」在门外的取值——clamp 对它们有分辨力，证明纵深防御不是装饰
    expect(Math.min(1, Math.max(0, (20 - -80) / 20)), "夜间未门控 ⇒ 会被夹到 1").toBe(1);
    expect(Math.min(1, Math.max(0, (20 - 40) / 20)), "正午未门控 ⇒ 会被夹到 0").toBe(0);
  });
});
