// @vitest-environment node
// ===== WaterCapability 测试（preview-3d/caps/water-capability.ts）=====
// 覆盖：apply 挂入场景（ysm-ground-water）、独立开关、getMenuControls 分组、
// 法线贴图生成、参数 setter/getter、水池几何、持久化（water 键 + legacy ground 键迁移）。
// 2026-08-28 从 GroundCapability 解耦为独立能力（详见 docs/superpowers/plans/2026-08-28-split-water-capability.md）。
import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { WaterCapability } from "./water-capability.ts";
import { persistState } from "./scene-capability.ts";
import type { PreviewSnapshot } from "../state/preview-paths.ts";

// node 环境内存版 localStorage 跨用例共享，清理防污染（与 ground 拆分的持久化键互不串扰）
afterEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
});

describe("WaterCapability", () => {
  it("apply 挂入场景（ysm-ground-water），默认 film + 水膜浓度>0 可见", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    expect(cap.getWaterMode()).toBe("film");
    cap.apply();
    const water = scene.getObjectByName("ysm-ground-water");
    expect(water).toBeDefined();
    expect(water).toBeInstanceOf(THREE.Mesh);
    expect(water!.visible).toBe(true); // 水膜浓度 0.15 > 0 → 可见
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

  it("getMenuControls：12 项按功能区（形态/外观/水池/波纹）分组，启用开关无 group 作根行主控件", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const controls = cap.getMenuControls();
    expect(controls.length).toBe(12);
    // 首个控件 = 启用水面，无 group（作为 cap 根行主控件，下钻子视图不再重复）
    expect(controls[0].id).toBe("ground-water-enabled");
    expect(controls[0].group).toBeUndefined();
    // 其余 11 项归属 4 个功能组，且全部带 group
    const rest = controls.slice(1);
    expect(rest.every((c) => c.group !== undefined)).toBe(true);
    const groups = new Set(rest.map((c) => c.group));
    expect([...groups].sort()).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
    ].sort());
    const byGroup = (g: string) => rest.filter((c) => c.group === g).map((c) => c.id).sort();
    expect(byGroup("preview.waterGroupForm")).toEqual(["ground-water-mode"]);
    expect(byGroup("preview.waterGroupLook")).toEqual(["ground-normal-strength", "ground-water-clarity", "ground-water-color", "ground-water-opacity", "ground-wetness"].sort());
    expect(byGroup("preview.waterGroupPool")).toEqual(["ground-pool-height", "ground-pool-wall-color", "ground-pool-wall-thickness", "ground-pool-roundness"].sort());
    expect(byGroup("preview.waterGroupWave")).toEqual(["ground-wave-speed"]);
  });

  it("菜单控件条件显隐：wetness 仅 film；pool 系列仅 pool（visibleWhen B 轨）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const controls = cap.getMenuControls();
    const wetness = controls.find((c) => c.id === "ground-wetness")!;
    const poolHeight = controls.find((c) => c.id === "ground-pool-height")!;
    // [铁律收口] 谓词吃状态层快照 env.waterMode（纯函数，不摸 cap 实例）
    const snap = (mode: string) => ({ "env.waterMode": mode } as Partial<PreviewSnapshot>);
    // 默认 film：wetness 可见，pool 系列隐藏
    expect(wetness.visibleWhen?.(snap("film"))).toBe(true);
    expect(poolHeight.visibleWhen?.(snap("film"))).toBe(false);
    // 切 pool：wetness 隐藏，pool 系列可见
    expect(wetness.visibleWhen?.(snap("pool"))).toBe(false);
    expect(poolHeight.visibleWhen?.(snap("pool"))).toBe(true);
  });

  it("getMenuControls 含 ground-normal-strength slider（group=preview.waterGroup）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const controls = cap.getMenuControls();
    const normalCtrl = controls.find((c) => c.id === "ground-normal-strength");
    expect(normalCtrl).toBeDefined();
    expect(normalCtrl!.kind).toBe("slider");
    expect(normalCtrl!.group).toBe("preview.waterGroupLook");
    expect(normalCtrl!.slider).toEqual({ min: 0, max: 1, step: 0.05 });
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

  it("generateNormalMap 像素值合法：R/G 有变化，B 接近 255", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const tex = cap["generateNormalMap"](256) as THREE.DataTexture;
    expect(tex.image.data).toBeDefined();
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(256 * 256 * 4);

    let rMin = 255, rMax = 0, gMin = 255, gMax = 0;
    let bCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b >= 240) bCount++;
    }
    // R/G 通道应有变化（不为单一值）
    expect(rMax - rMin).toBeGreaterThan(5);
    expect(gMax - gMin).toBeGreaterThan(5);
    // B 通道大部分接近 255（朝上法线）
    expect(bCount).toBeGreaterThan(data.length / 4 * 0.9);
  });

  it("saveState/loadState 持久化 normalStrength（water 键）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setNormalStrength(0.7);
    cap.saveState();
    const cap2 = new WaterCapability({ scene });
    cap2.loadState();
    expect(cap2.getNormalStrength()).toBe(0.7);
  });
});

describe("WaterCapability — 水池几何 / 嵌套参数", () => {
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
    expect(topY).toBeCloseTo(1.2, 1); // ±0.1 容差
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
  it("顶层 wetness/waterColor/waterOpacity/normalStrength → 迁移进 water 参数", () => {
    // 模拟 legacy 存档：拆分前 water 四字段在 ground 顶层（无 water 嵌套对象）
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
    // 迁移后默认 enabled=true / mode=film
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
    cap.setWaterMode("film"); // 回切薄水膜
    const after = scene.getObjectByName("ysm-ground-water");
    expect(after).toBeInstanceOf(THREE.Mesh);
    expect(after!.name).toBe("ysm-ground-water");
    // 再切 pool 不崩
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
      cap.setWaterMode("pool"); // 同值早退
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

// ============ 盲区补全：onBeforeCompile / pool setter / update / loadState 分支 / dispose ============
// 这些路径在 happy-dom 无 WebGL 下原本不可达，但 onBeforeCompile 是纯字符串回调，
// 可手动构造假 shader 触发并断言 GLSL 注入（不依赖 GPU 编译）。
describe("WaterCapability — onBeforeCompile 波浪 shader 注入", () => {
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
    expect(shader.uniforms.uHalfSize.value).toBeCloseTo(40, 5); // size/2 = 80/2
    expect(shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.25 * 0.15, 5); // waterOpacity * wetness
    expect(shader.uniforms.uRoundness.value).toBe(0); // film → forPool:false → 0
    expect(shader.vertexShader).toContain("float wave(");
    expect(shader.vertexShader).toContain("vWorldPos_wave");
    expect(shader.vertexShader).toContain("transformed.z += h;");
    expect(shader.fragmentShader).toContain("vWorldPos_wave");
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= fade;"); // edge-fade 代码段恒插入（运行时按 uRoundness 判断）
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
    cap.update(1.0); // 早退
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
    cap.setEnabled(true);
    cap.setWaterEnabled(false);
    cap.update(1.0); // 早退
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
    cap.setWaterEnabled(true);
    cap.setWetness(0); // film 下 wetness=0 → visible=false
    cap.update(1.0); // 早退
    expect((cap as unknown as { waterTime: { value: number } }).waterTime.value).toBeCloseTo(1.0, 5);
  });
});

describe("WaterCapability — pool 模式 setter 分支", () => {
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
  it("V2 嵌套 water 对象还原全部字段（pool + 各参数）", () => {
    persistState("water", {
      enabled: true,
      size: 64,
      water: {
        enabled: false, mode: "pool", wetness: 0.2, waterColor: 0x112233,
        waterOpacity: 0.4, normalStrength: 0.3, waveSpeed: 1.5, clarity: 0.7,
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
      water: { mode: 123 as unknown as string, wetness: "x", waterColor: true as unknown as number },
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterEnabled()).toBe(true);
    expect(cap.getWaterMode()).toBe("film");
    expect(cap.getWetness()).toBeCloseTo(0.15, 5);
  });
});

describe("WaterCapability — dispose", () => {
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
    // 模拟真渲染后 PhysicalMaterial 内部创建的 transmissionRenderTarget
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

// ============ 菜单控件全联动（覆盖 buildWaterGroup 全部 getValue/setValue 闭包）============
describe("WaterCapability — 菜单控件全联动", () => {
  it("12 项控件 setValue/getValue 双向读写联动", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const by = (id: string) => cap.getMenuControls().find((c) => c.id === id)!;
    by("ground-water-enabled").setValue(false);
    expect(by("ground-water-enabled").getValue()).toBe(false);
    by("ground-water-mode").setValue("pool");
    expect(by("ground-water-mode").getValue()).toBe("pool");
    by("ground-wetness").setValue(0.45);
    expect(by("ground-wetness").getValue()).toBeCloseTo(0.45, 5);
    by("ground-water-color").setValue(0x0a0b0c);
    expect(by("ground-water-color").getValue()).toBe(0x0a0b0c);
    by("ground-water-opacity").setValue(0.55);
    expect(by("ground-water-opacity").getValue()).toBeCloseTo(0.55, 5);
    by("ground-normal-strength").setValue(0.6);
    expect(by("ground-normal-strength").getValue()).toBeCloseTo(0.6, 5);
    by("ground-water-clarity").setValue(0.35);
    expect(by("ground-water-clarity").getValue()).toBeCloseTo(0.35, 5);
    by("ground-pool-height").setValue(1.5);
    expect(by("ground-pool-height").getValue()).toBeCloseTo(1.5, 5);
    by("ground-pool-wall-thickness").setValue(0.4);
    expect(by("ground-pool-wall-thickness").getValue()).toBeCloseTo(0.4, 5);
    by("ground-pool-wall-color").setValue(0x334455);
    expect(by("ground-pool-wall-color").getValue()).toBe(0x334455);
    by("ground-pool-roundness").setValue(0.2);
    expect(by("ground-pool-roundness").getValue()).toBeCloseTo(0.2, 5);
    by("ground-wave-speed").setValue(1.8);
    expect(by("ground-wave-speed").getValue()).toBeCloseTo(1.8, 5);
  });
});
