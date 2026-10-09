// ===== sky-asset.ts 守卫（ADR-235-d1 子提交 B + ADR-311-d1 判别样本）=====
// 病根锁：`createSky` / `applyUniform` / `applyScaledUniform` 原先混在 SkyCapability 编排壳里，
// 双写 sky+envSky 材质的机制无法叶层直测。下沉后本文件钉死**双侧判别样本**：
//   · createSky scale 设置 + cloudCoverage 初值（判真侧）
//   · applyUniformToPair 双写两材质 value（判真侧）
//   · applyScaledUniformToPair undefined 守卫（判非真侧：缺 uniform 不抛错、无副作用）
//   · 与 cap 门控的关系：本模块不判 `changed.has(field)`（门控归 cap，勿在此重复）
// 零 mock（纯 three 对象直测）——按 ADR-311-d1「禁 mock 被断言谓词」。
import { describe, it, expect } from "vitest";
import { Sky } from "three/addons/objects/Sky.js";
import {
  applyScaledUniformToPair,
  applyUniformToPair,
  createSky,
} from "./sky-asset.ts";

function makePair(): { sky: Sky; envSky: Sky } {
  return { sky: new Sky(), envSky: new Sky() };
}

describe("createSky（判真侧）", () => {
  it("scale 按传入设置（天空盒半边长须 > 相机 maxDistance）", () => {
    const sky = createSky(0.5, 12000);
    expect(sky.scale.x).toBe(12000);
    expect(sky.scale.y).toBe(12000);
    expect(sky.scale.z).toBe(12000);
  });

  it("cloudCoverage 写入 uniforms（??= 兜底：未注入先补初值）", () => {
    const sky = createSky(0.35, 8000);
    const u = sky.material.uniforms as Record<string, { value: number }>;
    expect(u.cloudCoverage.value).toBe(0.35);
  });

  it("每次 createSky 产出独立实例（非共享材质/几何）", () => {
    const a = createSky(0.5, 12000);
    const b = createSky(0.5, 12000);
    expect(a).not.toBe(b);
    expect(a.material).not.toBe(b.material);
  });
});

describe("applyUniformToPair（双写机制）", () => {
  it("把 value 同时写入 sky 与 envSky 的同名 uniform", () => {
    const { sky, envSky } = makePair();
    applyUniformToPair(sky, envSky, "turbidity", 2.5);
    const su = sky.material.uniforms as Record<string, { value: number }>;
    const eu = envSky.material.uniforms as Record<string, { value: number }>;
    expect(su.turbidity.value).toBe(2.5);
    expect(eu.turbidity.value).toBe(2.5);
  });

  it("多次调用覆盖（后写胜，non-accumulating）", () => {
    const { sky, envSky } = makePair();
    applyUniformToPair(sky, envSky, "rayleigh", 2.0);
    applyUniformToPair(sky, envSky, "rayleigh", 2.6);
    const su = sky.material.uniforms as Record<string, { value: number }>;
    expect(su.rayleigh.value).toBe(2.6);
  });
});

describe("applyScaledUniformToPair（undefined 守卫 · 判非真侧）", () => {
  it("uniform 不存在：静默跳过、不抛错、无副作用（判别样本：与 applyUniformToPair 抛错区分）", () => {
    const { sky, envSky } = makePair();
    expect(() => applyScaledUniformToPair(sky, envSky, "ghostUniform", 5)).not.toThrow();
    const u = sky.material.uniforms as Record<string, unknown>;
    expect("ghostUniform" in u, "不注入幽灵 uniform").toBe(false);
  });

  it("uniform 存在（仅主天空 patch 注入）：主天空写、envSky 跳过（非对称 patch）", () => {
    const { sky, envSky } = makePair();
    // 模拟 sky-patch.ts 只给主天空注入 sunIntensityScale（envSky 保持原生 Preetham）
    const su = sky.material.uniforms as Record<string, { value: number } | undefined>;
    su.sunIntensityScale = { value: 0 };
    const eu = envSky.material.uniforms as Record<string, { value: number } | undefined>;

    applyScaledUniformToPair(sky, envSky, "sunIntensityScale", 0.75);

    expect(su.sunIntensityScale.value).toBe(0.75);
    expect("sunIntensityScale" in eu, "envSky 无该 uniform，不注入").toBe(false);
  });

  it("双方都有该 uniform：两写（与 applyUniformToPair 同效）", () => {
    const { sky, envSky } = makePair();
    applyScaledUniformToPair(sky, envSky, "turbidity", 4.0);
    const su = sky.material.uniforms as Record<string, { value: number }>;
    const eu = envSky.material.uniforms as Record<string, { value: number }>;
    expect(su.turbidity.value).toBe(4.0);
    expect(eu.turbidity.value).toBe(4.0);
  });
});