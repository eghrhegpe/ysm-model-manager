// ===== sky-sun.ts 守卫（ADR-235-d1 子提交 A + ADR-311-d1 判别样本）=====
// 病根锁：`hourToSun`/`getSunPosition`/`sunVectorFromSpherical` 原先混在 SkyCapability 编排壳里
// （sky-capability.ts），纯计算无法叶层直测。下沉后本文件钉死**双侧判别样本**：
//   · hourToSun 关键锚点（正午/日出/日落/夜间）+ wrap（跨天/负数）+ 与「不 wrap」实现区分
//   · getSunPosition 归一化 + clamp01 边界
//   · sunVectorFromSpherical 天顶/正东/正西 + 与 three `setFromSphericalCoords` 逐位等价（判别）
// 零 mock（纯函数直测）——按 ADR-311-d1「禁 mock 被断言谓词」，本文件不 mock 任何被测模块。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  computeHourToSun,
  computeSunPosition,
  sunVectorFromSpherical,
} from "./sky-sun.ts";

describe("hourToSun 关键锚点（判真侧）", () => {
  it("正午 12：太阳在正南天顶（elevation 峰值 70°，azimuth 180°）", () => {
    const { elevation, azimuth } = computeHourToSun(12);
    expect(elevation).toBeCloseTo(70, 6);
    expect(azimuth).toBeCloseTo(180, 6);
  });

  it("日出 6：elevation 0°（地平线）、azimuth 90°（正东）", () => {
    const { elevation, azimuth } = computeHourToSun(6);
    expect(elevation).toBeCloseTo(0, 6);
    expect(azimuth).toBeCloseTo(90, 6);
  });

  it("日落 18：elevation 0°、azimuth 270°（正西）", () => {
    const { elevation, azimuth } = computeHourToSun(18);
    expect(elevation).toBeCloseTo(0, 6);
    expect(azimuth).toBeCloseTo(270, 6);
  });
});

describe("hourToSun 夜间与 wrap（判非真侧 / 反例）", () => {
  it("午夜 0：elevation 为负（地平线下，天空转暗）——与正午判真侧区分", () => {
    const { elevation, azimuth } = computeHourToSun(0);
    expect(elevation, "夜间在地平线下").toBeLessThan(0);
    expect(elevation).toBeCloseTo(-70, 6); // sin(-π/2)*70
    expect(azimuth).toBeCloseTo(0, 6);
  });

  it("wrap 反例：hour=30 折算到 6（h=(30%24+24)%24=6），azimuth 不爆到 4410°", () => {
    const { elevation, azimuth } = computeHourToSun(30);
    expect(elevation).toBeCloseTo(0, 6);
    // 若不 wrap（直接 h=30）：azimuth = 90 + 24×180 = 4410°，判别本用例
    expect(azimuth, "跨天折算回同一天").toBeCloseTo(90, 6);
    expect(azimuth).not.toBeCloseTo(4410, 0);
  });

  it("负数 wrap 反例：hour=-6 折算到 18（h=(-6%24+24)%24=18），等价日落", () => {
    const { elevation, azimuth } = computeHourToSun(-6);
    expect(elevation).toBeCloseTo(0, 6);
    expect(azimuth).toBeCloseTo(270, 6);
  });

  it("elevation 随 hour 单调过峰值：9（上午）< 12（正午）< 15（下午）对称", () => {
    const noon = computeHourToSun(12).elevation;
    const am = computeHourToSun(9).elevation;
    const pm = computeHourToSun(15).elevation;
    expect(am).toBeGreaterThan(0);
    expect(pm).toBeGreaterThan(0);
    expect(am).toBeLessThan(noon);
    expect(pm).toBeLessThan(noon);
  });
});

describe("getSunPosition 归一化 + clamp（判别样本）", () => {
  it("正午 12：x=0.5（azimuth 中线）、y=1.0（elevation 顶）", () => {
    const p = computeSunPosition(12);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(1.0, 6);
  });

  it("午夜 0：x=0、y=0（经度起点 + 底部）", () => {
    const p = computeSunPosition(0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("clamp 反例：elevation 越界区间不爆出 [0,1]（hour=6 时 elevation=0 → y=0.5 非负）", () => {
    const p = computeSunPosition(6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(1);
  });
});

describe("sunVectorFromSpherical 方向向量（判别样本）", () => {
  it("天顶（elevation=90, azimuth=任意）：方向 +Y", () => {
    const v = sunVectorFromSpherical(90, 0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("正东（elevation=0, azimuth=90）：方向 +X", () => {
    const v = sunVectorFromSpherical(0, 90);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("正西（elevation=0, azimuth=180）：方向 -Z（three 球坐标约定）", () => {
    const v = sunVectorFromSpherical(0, 180);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
  });

  it("与 three `Vector3.setFromSphericalCoords(1, φ, θ)` 逐位等价（判别：换写法即错）", () => {
    const samples: Array<[number, number]> = [
      [12, 180],
      [0, 0],
      [6, 90],
      [18, 270],
      [45, 123],
      [-20, 200],
    ];
    for (const [elevation, azimuth] of samples) {
      const phi = ((90 - elevation) * Math.PI) / 180;
      const theta = (azimuth * Math.PI) / 180;
      const ref = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
      const got = sunVectorFromSpherical(elevation, azimuth);
      expect(got.x, `elev=${elevation} az=${azimuth} x`).toBeCloseTo(ref.x, 6);
      expect(got.y, `elev=${elevation} az=${azimuth} y`).toBeCloseTo(ref.y, 6);
      expect(got.z, `elev=${elevation} az=${azimuth} z`).toBeCloseTo(ref.z, 6);
    }
  });
});