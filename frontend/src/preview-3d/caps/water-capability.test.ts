// @vitest-environment node
// ===== WaterCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { WaterCapability } from "./water-capability.ts";
import { persistState } from "./scene-capability.ts";
import { resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";

afterEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
});

describe("WaterCapability", () => {
  beforeEach(() => { resetEnvState(); });

  it("apply 挂入场景（ysm-ground-water），默认 film + 水膜浓度>0 可见", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    expect(cap.getWaterMode()).toBe("film");
    cap.apply();
    const water = scene.getObjectByName("ysm-ground-water");
    expect(water).toBeDefined();
    expect(water).toBeInstanceOf(THREE.Mesh);
    expect(water!.visible).toBe(true);
  });

  it("setWaterEnabled 独立控制 visible（与能力 enabled 解耦）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(scene.getObjectByName("ysm-ground-water")?.visible).toBe(true);
    cap.setWaterEnabled(false);
    expect(cap.getWaterEnabled()).toBe(false);
    expect(scene.getObjectByName("ysm-ground-water")?.visible).toBe(false);
    cap.setWaterEnabled(true);
    expect(scene.getObjectByName("ysm-ground-water")?.visible).toBe(true);
  });

  it("getMenuNodes：enabled 平铺 toggle + 4 组 folder", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(5);
    expect(nodes[0].id).toBe("ground-water-enabled");
    expect(nodes.slice(1).map((n) => n.kind)).toEqual(["folder", "folder", "folder", "folder"]);
    expect(nodes.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
    ]);
  });

  it("getMasterNodeId 返回 ground-water-enabled 使 env 面板能在行首渲染开关", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    expect(cap.getMasterNodeId()).toBe("ground-water-enabled");
  });

  it("菜单控件条件显隐：wetness 仅 film；pool 系列仅 pool", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const pool = nodes[3]!;
    const wetness = look.children!.find((c) => c.id === "ground-wetness")!;
    const poolHeight = pool.children!.find((c) => c.id === "ground-pool-height")!;
    const snap = (mode: string) => ({ "env.waterMode": mode } as Partial<PreviewSnapshot>);
    expect(wetness.visibleWhen?.(snap("film"))).toBe(true);
    expect(poolHeight.visibleWhen?.(snap("film"))).toBe(false);
    expect(wetness.visibleWhen?.(snap("pool"))).toBe(false);
    expect(poolHeight.visibleWhen?.(snap("pool"))).toBe(true);
  });

  it("setNormalStrength 影响顶水面 normalScale", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(cap.getNormalStrength()).toBe(0.08);
    cap.setNormalStrength(0.8);
    expect(cap.getNormalStrength()).toBe(0.8);
    const topMesh = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = topMesh.material as THREE.MeshStandardMaterial;
    expect(mat.normalScale.x).toBeCloseTo(0.8);
    expect(mat.normalScale.y).toBeCloseTo(0.8);
  });

  it("generateNormalMap 返回 DataTexture，尺寸 256x256", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const tex = cap["generateNormalMap"](256) as THREE.DataTexture;
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
  });

  it("saveState/loadState 持久化 normalStrength（water 键）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setNormalStrength(0.7);
    cap.saveState();
    resetEnvState();
    const cap2 = new WaterCapability({ scene });
    cap2.loadState();
    expect(cap2.getNormalStrength()).toBe(0.7);
  });
});

describe("WaterCapability — 水池几何 / 嵌套参数", () => {
  beforeEach(() => { resetEnvState(); });

  it("setWaterMode 后 variant.mode 与 envState.waterMode 恒等", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const body = () => (cap as unknown as { water: { mode: string } }).water;
    expect(body().mode).toBe("film");
    cap.setWaterMode("pool");
    expect(body().mode).toBe("pool");
    expect(cap.getWaterMode()).toBe("pool");
    cap.setWaterMode("film");
    expect(body().mode).toBe("film");
    expect(cap.getWaterMode()).toBe("film");
  });

  it("初始 film 模式 water 是单 Mesh；setWaterMode('pool') 后 ysm-ground-water 下 mesh≥5", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(scene.getObjectByName("ysm-ground-water")).toBeInstanceOf(THREE.Mesh);
    cap.setWaterMode("pool");
    cap.setPoolHeight(0.8);
    const root = scene.getObjectByName("ysm-ground-water");
    expect(root).toBeDefined();
    const meshes: THREE.Mesh[] = [];
    root!.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(5);
  });

  it("池体顶 mesh y 位置等于 poolHeight", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(1.2);
    const root = scene.getObjectByName("ysm-ground-water")!;
    let topY = -Infinity;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) topY = Math.max(topY, m.getWorldPosition(new THREE.Vector3()).y);
    });
    expect(topY).toBeCloseTo(1.2, 1);
  });

  it("setPoolHeight / setPoolWallColor getter/setter 一致", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setPoolHeight(1.2);
    expect(cap.getPoolHeight()).toBe(1.2);
    cap.setPoolWallColor(0x2244aa);
    expect(cap.getPoolWallColor()).toBe(0x2244aa);
    cap.setPoolRoundness(0.3);
    expect(cap.getPoolRoundness()).toBeCloseTo(0.3);
  });
});

describe("WaterCapability — 旧存档迁移（legacy ground 键）", () => {
  beforeEach(() => { resetEnvState(); });

  it("顶层 wetness/waterColor/waterOpacity/normalStrength → 迁移进 water 参数", () => {
    persistState("ground", {
      enabled: true,
      visible: true,
      wetness: 0.6,
      waterColor: 0x4488aa,
      waterOpacity: 0.5,
      normalStrength: 0.4,
      matSource: "checker",
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWetness()).toBeCloseTo(0.6);
    expect(cap.getWaterColor()).toBe(0x4488aa);
    expect(cap.getWaterOpacity()).toBeCloseTo(0.5);
    expect(cap.getNormalStrength()).toBeCloseTo(0.4);
    expect(cap.getWaterEnabled()).toBe(true);
    expect(cap.getWaterMode()).toBe("film");
  });

  it("水池切换到 film 模式：dispose 所有子 mesh，不泄漏（再切 pool 仍可工作）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(0.8);
    const before = scene.getObjectByName("ysm-ground-water");
    expect(before).toBeDefined();
    cap.setWaterMode("film");
    const after = scene.getObjectByName("ysm-ground-water");
    expect(after).toBeInstanceOf(THREE.Mesh);
    expect(after!.name).toBe("ysm-ground-water");
    cap.setWaterMode("pool");
    const root = scene.getObjectByName("ysm-ground-water")!;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(5);
  });

  describe("subscribe（局部刷新通知）", () => {
    it("setWaterMode 触发订阅者，同值早退不 notify，unsub 后停止", () => {
      const scene = new THREE.Scene();
      const cap = new WaterCapability({ scene });
      let calls = 0;
      const unsub = cap.subscribe!(() => { calls++; });
      expect(typeof unsub).toBe("function");
      cap.setWaterMode("pool");
      expect(calls).toBe(1);
      cap.setWaterMode("pool");
      expect(calls).toBe(1);
      cap.setWaterMode("film");
      expect(calls).toBe(2);
      unsub();
      cap.setWaterMode("pool");
      expect(calls).toBe(2);
    });

    it("setWetness / setWaterColor 等仅改值不触发订阅者", () => {
      const scene = new THREE.Scene();
      const cap = new WaterCapability({ scene });
      let calls = 0;
      cap.subscribe!(() => { calls++; });
      cap.setWetness(0.5);
      cap.setWaterColor(0x112233);
      cap.setWaterOpacity(0.7);
      expect(calls).toBe(0);
    });
  });
});

describe("WaterCapability — onBeforeCompile 波浪 shader 注入", () => {
  beforeEach(() => { resetEnvState(); });

  function fakeShader() {
    return {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <dithering_fragment>\n}",
    };
  }

  it("film 材质注入 uTime/uHalfSize/uBaseOpacity 与 wave 函数/varying", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uTime).toBeDefined();
    expect(shader.uniforms.uHalfSize.value).toBeCloseTo(40, 5);
    expect(shader.uniforms.uSize.value).toBeCloseTo(80, 5);
    expect(shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.25 * 0.15, 5);
    expect(shader.uniforms.uRoundness.value).toBe(0);
    expect(shader.uniforms.uChoppiness.value).toBeCloseTo(0.5, 5);
    expect(shader.vertexShader).toContain("vec3 gerstner(");
    expect(shader.vertexShader).toContain("vWorldPos_wave");
    expect(shader.vertexShader).toContain("transformed.z += gdisp.z;");
    expect(shader.vertexShader).toContain("vFoam");
    expect(shader.fragmentShader).toContain("vWorldPos_wave");
    expect(shader.fragmentShader).toContain("vFoam");
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= fade;");
  });

  it("film 模式 waterSize 变更不重建 mesh（scale 驱动，ADR-152 改造 A）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const before = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const geoBefore = before.geometry;
    setEnvState({ waterSize: 40 }, { source: "manual" });
    const after = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    expect(after).toBe(before);
    expect(after.geometry).toBe(geoBefore);
    expect(after.scale.x).toBeCloseTo(40, 5);
    expect(after.scale.y).toBeCloseTo(40, 5);
    setEnvState({ waterSize: 120 }, { source: "manual" });
    expect(scene.getObjectByName("ysm-ground-water")).toBe(after);
    expect(after.scale.x).toBeCloseTo(120, 5);
  });

  it("pool 材质 + roundness>0 → uRoundness 取 round，fragment 注入 edge-fade", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    cap.setPoolRoundness(0.3);
    const mat = ((scene.getObjectByName("ysm-ground-water") as THREE.Mesh).getObjectByName("ysm-water-top") as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uRoundness.value).toBeCloseTo(0.3, 5);
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= fade;");
  });
});

describe("WaterCapability — update 波纹动画推进", () => {
  beforeEach(() => { resetEnvState(); });

  it("update(dt) 按 waveSpeed 累加 waterTime（film 默认可见）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaveSpeed(2.0);
    cap.update(0.5);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
  });

  it("update 早退：enabled / water.enabled / visible 任一为假则不累加", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.update(1.0);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
    cap.setEnabled(false);
    cap.update(1.0);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
    cap.setEnabled(true);
    cap.setWaterEnabled(false);
    cap.update(1.0);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
    cap.setWaterEnabled(true);
    cap.setWetness(0);
    cap.update(1.0);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
  });
});

describe("WaterCapability — pool 模式 setter 分支", () => {
  beforeEach(() => { resetEnvState(); });

  it("setWaterColor（pool）→ 顶 + 内壁 inner 改色", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    cap.setWaterColor(0x123456);
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    const inner = scene.getObjectByName("ysm-water-wall-n-inner") as THREE.Mesh;
    expect((top.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x123456);
    expect((inner.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x123456);
  });

  it("setWaterOpacity（pool）→ 顶 opacity = waterOpacity（不含 wetness）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    cap.setWaterOpacity(0.9);
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    expect((top.material as THREE.MeshPhysicalMaterial).opacity).toBeCloseTo(0.9, 5);
  });

  it("setClarity（pool）→ top.transmission = clarity，inner.transmission = clarity*0.5", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    cap.setClarity(0.8);
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    const inner = scene.getObjectByName("ysm-water-wall-n-inner") as THREE.Mesh;
    expect((top.material as THREE.MeshPhysicalMaterial).transmission).toBeCloseTo(0.8, 5);
    expect((inner.material as THREE.MeshPhysicalMaterial).transmission).toBeCloseTo(0.4, 5);
  });

  it("setPoolWallThickness（pool）→ 触发几何重建不崩", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    expect(() => cap.setPoolWallThickness(0.3)).not.toThrow();
    expect(cap.getPoolWallThickness()).toBeCloseTo(0.3, 5);
  });

  it("setWaveSpeed 存参且影响 update 累加", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaveSpeed(2.0);
    expect(cap.getWaveSpeed()).toBeCloseTo(2.0, 5);
    cap.update(1.0);
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(2.0, 5);
  });

  it("film 模式 wetness=0 → 水面不可见", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWetness(0);
    expect(scene.getObjectByName("ysm-ground-water")!.visible).toBe(false);
  });

  it("setWetness（film，shader 已编译）→ 同步 uBaseOpacity uniform", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh).material as THREE.MeshPhysicalMaterial & {
      userData: { shader?: { uniforms: { uBaseOpacity: { value: number } } } };
    };
    mat.userData.shader = { uniforms: { uBaseOpacity: { value: 0 } } };
    cap.setWetness(0.6);
    expect(mat.opacity).toBeCloseTo(0.25 * 0.6, 5);
    expect(mat.userData.shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.25 * 0.6, 5);
  });
});

describe("WaterCapability — loadState 多分支", () => {
  beforeEach(() => { resetEnvState(); });

  it("V2 嵌套 water 对象还原全部字段（pool + 各参数）", () => {
    persistState("water", {
      enabled: true,
      size: 64,
      water: {
        enabled: false, mode: "pool", wetness: 0.2, waterColor: 0x112233,
        waterOpacity: 0.4, waterNormalStrength: 0.3, waveSpeed: 1.5, clarity: 0.7,
        poolHeight: 0.9, poolWallThickness: 0.2, poolWallColor: 0x445566, poolRoundness: 0.25,
      },
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterEnabled()).toBe(false);
    expect(cap.getWaterMode()).toBe("pool");
    expect(cap.getWetness()).toBeCloseTo(0.2, 5);
    expect(cap.getWaterColor()).toBe(0x112233);
    expect(cap.getWaterOpacity()).toBeCloseTo(0.4, 5);
    expect(cap.getNormalStrength()).toBeCloseTo(0.3, 5);
    expect(cap.getWaveSpeed()).toBeCloseTo(1.5, 5);
    expect(cap.getClarity()).toBeCloseTo(0.7, 5);
    expect(cap.getPoolHeight()).toBeCloseTo(0.9, 5);
    expect(cap.getPoolWallThickness()).toBeCloseTo(0.2, 5);
    expect(cap.getPoolWallColor()).toBe(0x445566);
    expect(cap.getPoolRoundness()).toBeCloseTo(0.25, 5);
  });

  it("legacy ground 键（water 嵌套对象）迁移", () => {
    persistState("ground", { water: { mode: "pool", wetness: 0.4, waterColor: 0xabcdef } });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterMode()).toBe("pool");
    expect(cap.getWetness()).toBeCloseTo(0.4, 5);
    expect(cap.getWaterColor()).toBe(0xabcdef);
  });

  it("类型不匹配字段全部跳过（保持默认）", () => {
    persistState("water", {
      enabled: "yes", size: "big",
      waterMode: 123 as unknown as string, waterWetness: "x", waterColor: true as unknown as number,
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterEnabled()).toBe(true);
    expect(cap.getWaterMode()).toBe("film");
    expect(cap.getWetness()).toBeCloseTo(0.15, 5);
  });

  it("flat 键轨（saveState 拍平）roundtrip：子域开关/全部参数还原", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterEnabled(false);
    cap.setWaterMode("pool");
    cap.setWetness(0.55);
    cap.setWaterColor(0x556677);
    cap.setWaterOpacity(0.8);
    cap.setNormalStrength(0.9);
    cap.setClarity(0.7);
    cap.setWaveSpeed(2.5);
    cap.setPoolHeight(1.1);
    cap.setPoolWallThickness(0.33);
    cap.setPoolWallColor(0x112233);
    cap.setPoolRoundness(0.28);
    cap.saveState();
    resetEnvState();
    const cap2 = new WaterCapability({ scene });
    cap2.loadState();
    expect(cap2.getWaterEnabled()).toBe(false);
    expect(cap2.getWaterMode()).toBe("pool");
    expect(cap2.getWetness()).toBeCloseTo(0.55, 5);
    expect(cap2.getWaterColor()).toBe(0x556677);
    expect(cap2.getWaterOpacity()).toBeCloseTo(0.8, 5);
    expect(cap2.getNormalStrength()).toBeCloseTo(0.9, 5);
    expect(cap2.getClarity()).toBeCloseTo(0.7, 5);
    expect(cap2.getWaveSpeed()).toBeCloseTo(2.5, 5);
    expect(cap2.getPoolHeight()).toBeCloseTo(1.1, 5);
    expect(cap2.getPoolWallThickness()).toBeCloseTo(0.33, 5);
    expect(cap2.getPoolWallColor()).toBe(0x112233);
    expect(cap2.getPoolRoundness()).toBeCloseTo(0.28, 5);
  });
});

describe("WaterCapability — dispose", () => {
  beforeEach(() => { resetEnvState(); });

  it("dispose 移除并释放 water 容器（幂等）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(scene.getObjectByName("ysm-ground-water")).toBeDefined();
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground-water")).toBeUndefined();
    expect(() => cap.dispose()).not.toThrow();
  });

  it("disposeWater 释放 transmissionRenderTarget（真实渲染时 PhysicalMaterial 内部产物）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    let texDisposed = 0, rtDisposed = 0;
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh).material as THREE.MeshPhysicalMaterial & {
      transmissionRenderTarget?: { texture: { dispose: () => void }; dispose: () => void } | null;
    };
    mat.transmissionRenderTarget = {
      texture: { dispose: () => { texDisposed++; } },
      dispose: () => { rtDisposed++; },
    };
    cap.dispose();
    expect(texDisposed).toBe(1);
    expect(rtDisposed).toBe(1);
  });
});

describe("WaterCapability — 法线贴图缓存", () => {
  beforeEach(() => { resetEnvState(); });

  const topNormalMap = (scene: THREE.Scene): THREE.Texture | null => {
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh | null;
    return top ? (top.material as THREE.MeshPhysicalMaterial).normalMap : null;
  };

  it("setPoolHeight/setPoolWallThickness 触发 rebuild 后 normalMap 复用同一 texture 实例", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    const n1 = topNormalMap(scene);
    expect(n1).not.toBeNull();
    cap.setPoolHeight(2.5);
    cap.setPoolWallThickness(0.5);
    expect(topNormalMap(scene)).toBe(n1);
  });

  it("size 变化（loadState 迁移路径）→ 缓存按 size 失效重生成", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const t1 = cap["getNormalMap"]();
    setEnvState({ waterSize: 40 }, { source: 'manual' });
    const t2 = cap["getNormalMap"]();
    expect(t2).not.toBe(t1);
    expect(cap["getNormalMap"]()).toBe(t2);
  });

  it("dispose 释放缓存贴图（释放责任从 disposeWater 挪到 dispose），且幂等", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    const n1 = topNormalMap(scene);
    expect(n1).not.toBeNull();
    let disposed = 0;
    n1!.addEventListener("dispose", () => { disposed++; });
    cap.dispose();
    expect(disposed).toBe(1);
    expect(() => cap.dispose()).not.toThrow();
    expect(disposed).toBe(1);
  });
});

describe("WaterCapability — 菜单控件全联动", () => {
  beforeEach(() => { resetEnvState(); });

  it("12 项控件 setValue/getValue 双向读写联动", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    const form = nodes[1]!;
    const look = nodes[2]!;
    const pool = nodes[3]!;
    const wave = nodes[4]!;
    const by = (id: string) => {
      for (const arr of [nodes, form.children!, look.children!, pool.children!, wave.children!]) {
        const found = arr.find((c) => c.id === id);
        if (found) return found;
      }
      throw new Error(`node ${id} not found`);
    };
    nodes[0]!.control!.set!(false);
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    by("ground-water-mode").control!.set!("pool");
    expect(by("ground-water-mode").control!.get!(undefined)).toBe("pool");
    by("ground-wetness").control!.set!(0.45);
    expect(by("ground-wetness").control!.get!(undefined)).toBeCloseTo(0.45, 5);
    by("ground-water-color").control!.set!(0x0a0b0c);
    expect(by("ground-water-color").control!.get!(undefined)).toBe(0x0a0b0c);
    by("ground-water-opacity").control!.set!(0.55);
    expect(by("ground-water-opacity").control!.get!(undefined)).toBeCloseTo(0.55, 5);
    by("ground-normal-strength").control!.set!(0.6);
    expect(by("ground-normal-strength").control!.get!(undefined)).toBeCloseTo(0.6, 5);
    by("ground-water-clarity").control!.set!(0.35);
    expect(by("ground-water-clarity").control!.get!(undefined)).toBeCloseTo(0.35, 5);
    by("ground-pool-height").control!.set!(1.5);
    expect(by("ground-pool-height").control!.get!(undefined)).toBeCloseTo(1.5, 5);
    by("ground-pool-wall-thickness").control!.set!(0.4);
    expect(by("ground-pool-wall-thickness").control!.get!(undefined)).toBeCloseTo(0.4, 5);
    by("ground-pool-wall-color").control!.set!(0x334455);
    expect(by("ground-pool-wall-color").control!.get!(undefined)).toBe(0x334455);
    by("ground-pool-roundness").control!.set!(0.2);
    expect(by("ground-pool-roundness").control!.get!(undefined)).toBeCloseTo(0.2, 5);
    by("ground-wave-speed").control!.set!(1.8);
    expect(by("ground-wave-speed").control!.get!(undefined)).toBeCloseTo(1.8, 5);
  });
});

describe("WaterCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  function newCap() {
    return new WaterCapability({ scene: new THREE.Scene() });
  }

  it("完整树 = enabled 平铺 toggle + 4 组 folder（form/look/pool/wave）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(5);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("ground-water-enabled");
    nodes[0]!.control!.set!(false);
    expect(cap.getWaterEnabled()).toBe(false);
    expect(nodes.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
    ]);
    const look = nodes[2]!;
    expect(look.children!.map((c) => c.id)).toEqual([
      "ground-wetness",
      "ground-water-color",
      "ground-water-opacity",
      "ground-normal-strength",
      "ground-water-clarity",
      "ground-water-choppiness",
    ]);
  });

  it("film/pool visibleWhen 谓词挂节点", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const wetness = look.children!.find((c) => c.id === "ground-wetness")!;
    expect(wetness.visibleWhen?.({ "env.waterMode": "film" })).toBe(true);
    expect(wetness.visibleWhen?.({ "env.waterMode": "pool" })).toBe(false);
    const pool = nodes[3]!;
    const height = pool.children!.find((c) => c.id === "ground-pool-height")!;
    expect(height.visibleWhen?.({ "env.waterMode": "pool" })).toBe(true);
    expect(height.visibleWhen?.({ "env.waterMode": "film" })).toBe(false);
  });

  it("color/slider 节点读写闭包直连 cap", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const color = look.children!.find((c) => c.id === "ground-water-color")!;
    expect(color.kind).toBe("color");
    color.control!.set!(0x3355aa);
    expect(cap.getWaterColor()).toBe(0x3355aa);
    const opacity = look.children!.find((c) => c.id === "ground-water-opacity")!;
    opacity.control!.set!(0.6);
    expect(cap.getWaterOpacity()).toBeCloseTo(0.6, 5);
  });
});
