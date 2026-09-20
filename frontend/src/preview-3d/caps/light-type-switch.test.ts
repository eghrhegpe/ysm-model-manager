// @vitest-environment node
// ===== LightCapability 灯光类型切换测试（ADR-280）=====
// 契约：三盏灯（key/fill/rim）各自可在 directional/point/spot 间自由切换；
// 切换 = dispose 旧 Three 对象 + 按 type 重建；体积光锥由「第一盏启用的 spot 灯」驱动。
import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { LightCapability } from "./light-capability.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";

afterEach(() => {
  clearEnvCallbacks();
});

function makeFakeRenderer() {
  return {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean } = {}) {
  return new LightCapability({
    scene: new THREE.Scene(),
    renderer: makeFakeRenderer(),
    ...opts,
  });
}

/** 按槽位取实际 Three 灯对象（经公开 getLights，顺序 = key/fill/rim） */
function lightsOf(cap: LightCapability): {
  key: THREE.Light;
  fill: THREE.Light;
  rim: THREE.Light;
} {
  const [key, fill, rim] = cap.getLights();
  return { key: key as THREE.Light, fill: fill as THREE.Light, rim: rim as THREE.Light };
}

describe("LightCapability — 灯光类型切换（ADR-280）", () => {
  it("构造默认：三盏灯均为 DirectionalLight，type 字段为 directional", () => {
    resetEnvState();
    const cap = newCap();
    const p = cap.getParams();
    expect(p.key.type).toBe("directional");
    expect(p.fill.type).toBe("directional");
    expect(p.rim.type).toBe("directional");
    const { key, fill, rim } = lightsOf(cap);
    expect(key).toBeInstanceOf(THREE.DirectionalLight);
    expect(fill).toBeInstanceOf(THREE.DirectionalLight);
    expect(rim).toBeInstanceOf(THREE.DirectionalLight);
    // `spotlight` 分组已整体删除
    expect("spotlight" in p).toBe(false);
  });

  it("key 切到 point：重建为 PointLight，其余两盏不受影响", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "point" });
    const { key, fill, rim } = lightsOf(cap);
    expect(key).toBeInstanceOf(THREE.PointLight);
    expect(fill).toBeInstanceOf(THREE.DirectionalLight);
    expect(rim).toBeInstanceOf(THREE.DirectionalLight);
    expect(cap.getParams().key.type).toBe("point");
  });

  it("key 切到 spot：重建为 SpotLight 且携带 angle/penumbra/distance/decay", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "spot", angle: 33, penumbra: 0.42, distance: 44, decay: 1.8 });
    const { key } = lightsOf(cap);
    expect(key).toBeInstanceOf(THREE.SpotLight);
    const sp = key as THREE.SpotLight;
    expect(sp.angle).toBeCloseTo(THREE.MathUtils.degToRad(33), 5);
    expect(sp.penumbra).toBeCloseTo(0.42, 5);
    expect(sp.distance).toBeCloseTo(44, 5);
    expect(sp.decay).toBeCloseTo(1.8, 5);
  });

  it("三盏灯各自独立切类型（互不干扰）", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "spot" });
    cap.setLightParams("fill", { type: "point" });
    // rim 保持默认
    const { key, fill, rim } = lightsOf(cap);
    expect(key).toBeInstanceOf(THREE.SpotLight);
    expect(fill).toBeInstanceOf(THREE.PointLight);
    expect(rim).toBeInstanceOf(THREE.DirectionalLight);
  });

  it("类型切回 directional：重建为 DirectionalLight（可逆）", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "spot" });
    expect(lightsOf(cap).key).toBeInstanceOf(THREE.SpotLight);
    cap.setLightParams("key", { type: "directional" });
    expect(lightsOf(cap).key).toBeInstanceOf(THREE.DirectionalLight);
  });

  it("同类型下改参数不重建对象（原地更新，保引用）", () => {
    resetEnvState();
    const cap = newCap();
    const before = lightsOf(cap).key;
    cap.setLightParams("key", { intensity: 2.5 });
    const after = lightsOf(cap).key;
    expect(after).toBe(before); // 同一对象引用
    expect(cap.getParams().key.intensity).toBeCloseTo(2.5, 5);
  });

  it("activeLight 缺省 key，可切换且不影响灯本身", () => {
    resetEnvState();
    const cap = newCap();
    expect(cap.getActiveLight()).toBe("key");
    cap.setActiveLight("rim");
    expect(cap.getActiveLight()).toBe("rim");
    // UI 焦点态不写 envState
    expect(envState.lightRimType).toBe("directional");
  });

  it("getSpotLightForCone：无 spot 灯时返回 null", () => {
    resetEnvState();
    const cap = newCap();
    expect(cap.getSpotLightForCone()).toBeNull();
  });

  it("getSpotLightForCone：返回第一盏启用的 spot 灯 + 槽位", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("rim", { type: "spot" });
    const found = cap.getSpotLightForCone();
    expect(found).not.toBeNull();
    expect(found?.which).toBe("rim");
    expect(found?.light).toBeInstanceOf(THREE.SpotLight);
  });

  it("getSpotLightForCone：key 优先于 rim（按 key→fill→rim 顺序）", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("rim", { type: "spot" });
    cap.setLightParams("key", { type: "spot" });
    expect(cap.getSpotLightForCone()?.which).toBe("key");
  });

  it("getSpotLightForCone：spot 灯被关闭（enabled=false）时不返回", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "spot", enabled: false });
    expect(cap.getSpotLightForCone()).toBeNull();
  });

  it("spot 灯 + 体积光双开 → 锥组挂载；关掉 spot → 卸载", () => {
    resetEnvState();
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    const conePresent = () => scene.children.some((o) => o.name === "ysm-light-volumetric-cone");
    cap.setLightParams("key", { type: "spot" });
    expect(cap.getSpotLightForCone()).not.toBeNull();
    expect(conePresent()).toBe(false); // 体积光未开 → 无锥
    cap.setVolumetric({ enabled: true });
    expect(conePresent()).toBe(true); // 双开 → 锥入场景
    cap.setLightParams("key", { enabled: false });
    expect(cap.getSpotLightForCone()).toBeNull();
    expect(conePresent()).toBe(false); // 关灯 → 卸载
  });

  it("体积光开启但无 spot 灯 → 不产锥；把 fill 切成 spot → 锥出现", () => {
    resetEnvState();
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    const conePresent = () => scene.children.some((o) => o.name === "ysm-light-volumetric-cone");
    cap.setVolumetric({ enabled: true });
    expect(conePresent()).toBe(false); // 三盏都是 directional → 无 driving spot
    cap.setLightParams("fill", { type: "spot" });
    expect(conePresent()).toBe(true); // 任意一盏变 spot 即可见光柱
  });

  it("三盏灯全部切 spot：锥体仍只认第一盏（key）", () => {
    resetEnvState();
    const cap = newCap();
    cap.setLightParams("key", { type: "spot" });
    cap.setLightParams("fill", { type: "spot" });
    cap.setLightParams("rim", { type: "spot" });
    expect(cap.getSpotLightForCone()?.which).toBe("key");
  });

  it("能力总开关关闭时类型切换仍有参数语义（不崩、params 可读）", () => {
    resetEnvState();
    const cap = newCap({ enabled: false });
    cap.setLightParams("fill", { type: "spot" });
    expect(cap.getParams().fill.type).toBe("spot");
    expect(cap.isEnabled()).toBe(false);
    // 灯未挂场景
    expect(cap.getLights()[1].parent).toBeNull();
  });

  it("setEnvState 直写 type 字段也能驱动切换（envState 是唯一真值源）", () => {
    resetEnvState();
    const cap = newCap();
    setEnvState({ lightRimType: "point" }, { source: "manual" });
    expect(lightsOf(cap).rim).toBeInstanceOf(THREE.PointLight);
    expect(cap.getParams().rim.type).toBe("point");
  });
});
