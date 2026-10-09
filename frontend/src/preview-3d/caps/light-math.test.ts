// ===== light-math.ts 守卫（横向铺叶层直测 · ADR-311-d1 判别样本）=====
// 病根锁：`getVolumetricTipRatio` / `setVolumetricTipRatio` 原是 LightCapability 私有方法，
// 互为逆映射且各带独立守卫（base≤0 除零、双向 [0,1] clamp），但无叶测。下沉 `light-math.ts`
// 后此处用**正反双侧**钉死两重边界：除零守卫 + clamp 上下界。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  lightTypeOf,
  volumetricTipFromRatio,
  volumetricTipRatioFor,
} from "./light-math.ts";

describe("volumetricTipRatioFor（tip/base 比值 · 除零 + clamp）", () => {
  it("常规比值原样返回（判真侧）", () => {
    expect(volumetricTipRatioFor(10, 5)).toBe(0.5);
  });

  it("base = 0：除零守卫返 0（判非真侧：比值无意义）", () => {
    expect(volumetricTipRatioFor(0, 5)).toBe(0);
  });

  it("tip > base：clamp 到 1（判非真侧：存量脏数据不越值域）", () => {
    expect(volumetricTipRatioFor(2, 5)).toBe(1);
    expect(volumetricTipRatioFor(5, 5)).toBe(1);
  });

  it("tip < 0：clamp 到 0（判非真侧：下界）", () => {
    expect(volumetricTipRatioFor(10, -2)).toBe(0);
  });
});

describe("volumetricTipFromRatio（base × ratio · clamp 后派生 tip）", () => {
  it("常规比值派生 tip（判真侧）", () => {
    expect(volumetricTipFromRatio(10, 0.5)).toBe(5);
  });

  it("ratio > 1：clamp 到 1，tip = base（判非真侧：越界不写脏数据）", () => {
    expect(volumetricTipFromRatio(10, 1.7)).toBe(10);
  });

  it("ratio < 0：clamp 到 0，tip = 0（判非真侧：下界）", () => {
    expect(volumetricTipFromRatio(10, -0.2)).toBe(0);
  });

  it("base = 0：tip 恒 0", () => {
    expect(volumetricTipFromRatio(0, 0.5)).toBe(0);
  });
});

describe("lightTypeOf（Three 灯对象 → 灯位类型 · instanceof 三分支互斥）", () => {
  it("SpotLight → spot（判真侧）", () => {
    expect(lightTypeOf(new THREE.SpotLight())).toBe("spot");
  });

  it("PointLight → point（判真侧）", () => {
    expect(lightTypeOf(new THREE.PointLight())).toBe("point");
  });

  it("DirectionalLight → directional（判真侧 + 兜底）", () => {
    expect(lightTypeOf(new THREE.DirectionalLight())).toBe("directional");
  });

  it("三灯类型互斥（spot 不落 point/directional）", () => {
    const t = lightTypeOf(new THREE.SpotLight());
    expect(t).not.toBe("point");
    expect(t).not.toBe("directional");
  });
});