// @vitest-environment node
// ===== 反射链不变式（2026-09 读 three r185 源码核实后固化）=====
// 本文件的价值：审计时「双反射默认可达」「groundReflector 可直接接本仓 Reflector」
// 两个论断都曾以「读代码」的方式被误判（真实默认值与构造入参默认值不同名不同义）。
// 故把**跨文件耦合的关键事实**钉成断言，防后续按印象改动：
//   ① 双反射（单平面镜 + SSR 同叠）默认不可达 —— 依赖 ppReflectorDisableWhenSSR 默认 true
//   ② 单平面镜默认关 —— 依赖 envState.reflectorEnabled 默认 false
//      （[锐评 F-1] 原此处记「cap 构造 `enabled ?? true` 与 schema 键是 AND 关系」——
//       私有门已随单门收口退役，`isEnabled()` 现直读 schema 键，两门不再背离。）
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

  it("② reflectorEnabled 默认 false —— 单平面镜默认关（单门收口后即 cap 总开关）", () => {
    resetEnvState();
    expect(envState.reflectorEnabled).toBe(false);
    const scene = new THREE.Scene();
    const cap = new ReflectorCapability({ scene, renderer: makeFakeRenderer() });
    // [锐评 F-1] 单门收口：isEnabled() 直读 schema 键，默认关——不再有「私有门恒 true
    // 而 schema 键 false」的背离（旧实现此处断言 isEnabled()===true 且 getParams().enabled===false，
    // 即菜单显示 ON 却无镜面的脱节，与 fog 收口前同病）。
    expect(cap.isEnabled()).toBe(false);
    cap.apply();
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    expect(cap.getParams().enabled).toBe(false);
    cap.dispose();
  });

  it("②a 菜单读数与 schema 键同源：首启显示关（防「显示 ON 却无镜」回归）", () => {
    resetEnvState();
    const scene = new THREE.Scene();
    const cap = new ReflectorCapability({ scene, renderer: makeFakeRenderer() });
    // headerToggle/菜单 master 节点读的就是 isEnabled()——首启必须与 schema 键一致为 false
    const master = cap.getMenuNodes().find((n) => n.id === cap.getMasterNodeId())!;
    expect(master.control!.get!(undefined)).toBe(false);
    expect(cap.isEnabled()).toBe(false);
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
