// @vitest-environment node
// ===== 反射链不变式（2026-09 读 three r185 源码核实后固化）=====
// 本文件的价值：审计时「双反射默认可达」「groundReflector 可直接接本仓 Reflector」
// 两个论断都曾以「读代码」的方式被误判（真实默认值与构造入参默认值不同名不同义）。
// 故把**跨文件耦合的关键事实**钉成断言，防后续按印象改动：
//   ① 双反射（单平面镜 + SSR 同叠）默认不可达 —— 依赖 ppReflectorDisableWhenSSR 默认 true
//   ② 单平面镜默认关 —— 依赖 envState.reflectorEnabled 默认 false
//      （⚠️ 注意与 ReflectorCapability 构造的 `enabled ?? true` 区分：那是 cap 自身开关，
//       buildReflector 仍要 `envState.reflectorEnabled` 才真正建 mesh，两者是 AND 关系）
//   ③ SSR 默认不启用 —— ppReflectionMode 默认 "envmap-only"
import { describe, expect, it } from "vitest";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";
import * as THREE from "three";

function makeFakeRenderer() {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: {
      autoReset: true,
      memory: { textures: 0, geometries: 0 },
      render: { calls: 0, triangles: 0, points: 0, frame: 0 },
      reset: () => {},
    },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

describe("反射链默认值不变式", () => {
  it("① ppReflectorDisableWhenSSR 默认 true —— SSR 活动时压制单平面镜，双反射默认不可达", () => {
    resetEnvState();
    expect(envState.ppReflectorDisableWhenSSR).toBe(true);
  });

  it("③ ppReflectionMode 默认 envmap-only —— SSR（最贵的两条整场渲染）默认不启用", () => {
    resetEnvState();
    expect(envState.ppReflectionMode).toBe("envmap-only");
  });

  it("② reflectorEnabled 默认 false —— cap 自身 enabled 默认 true 但不建 mesh（AND 关系）", () => {
    resetEnvState();
    expect(envState.reflectorEnabled).toBe(false);
    const scene = new THREE.Scene();
    const cap = new ReflectorCapability({ scene, renderer: makeFakeRenderer() });
    // cap.enabled 默认 true（构造 `enabled ?? true`）
    expect(cap.isEnabled()).toBe(true);
    // 但 apply() 因 envState.reflectorEnabled=false 而不建 mesh（AND 关系）
    cap.apply();
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    expect(cap.getParams().enabled).toBe(false); // enabled && reflectorEnabled
    cap.dispose();
  });

  it("②b 显式开 reflectorEnabled 后才真正建出镜面（对照组，证明上条不是恒真）", () => {
    resetEnvState();
    setEnvState({ reflectorEnabled: true }, { source: "manual" });
    const scene = new THREE.Scene();
    const cap = new ReflectorCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.getObjectByName("ysm-reflector")).toBeDefined();
    expect(cap.getParams().enabled).toBe(true);
    cap.dispose();
  });

  it("reflector 平面位于 ground 承接面之下（z-fighting 防御口径）", () => {
    resetEnvState();
    expect(GROUND_LAYER_OFFSETS.reflector).toBeLessThan(GROUND_LAYER_OFFSETS.groundSurface);
  });
});
