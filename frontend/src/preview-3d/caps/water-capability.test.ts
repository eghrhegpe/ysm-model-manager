// @vitest-environment node
// ===== WaterCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import {
  clampPoolRoundness,
  filmStrategy,
  poolStrategy,
  type WaterBody,
  type WaterPartRole,
} from "./water-body-strategies.ts";
import { WaterCapability } from "./water-capability.ts";
import { persistState } from "./scene-capability.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";

afterEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
});

/** 假 shader 对象：锚点与顺序对齐 three 官方 meshphysical
 *  （vertex 的 beginnormal_vertex 先于 begin_vertex；fragment 含 normal_fragment_maps —— 微细节法线注入点）。
 *  `normal` 声明模拟 three 在 normal_fragment_begin 中产出的视图空间法线。 */
function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: number }>,
    vertexShader:
      "#include <common>\nvoid main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}",
    fragmentShader:
      "#include <common>\nvoid main() {\n#include <normal_fragment_maps>\nvec3 normal = vec3(0.0, 0.0, 1.0);\n#include <dithering_fragment>\n}",
  };
}

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

  it("setNormalStrength 写 envState，且 shader 编译后就地同步 uDetailStrength uniform", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(cap.getNormalStrength()).toBe(0.08);
    const topMesh = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = topMesh.material as THREE.MeshPhysicalMaterial;
    // 编译期取值：uniform 初值来源与 setter 同一事实源
    mat.onBeforeCompile(
      fakeShader() as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    const live = (
      mat as unknown as {
        userData: { shader: { uniforms: { uDetailStrength: { value: number } } } };
      }
    ).userData.shader;
    expect(live.uniforms.uDetailStrength.value).toBeCloseTo(0.08, 5);
    // 运行期就地更新：不重建容器，uniform 即时跟随
    cap.setNormalStrength(0.8);
    expect(cap.getNormalStrength()).toBe(0.8);
    expect(live.uniforms.uDetailStrength.value).toBeCloseTo(0.8, 5);
  });

  it("微细节法线不再持有 CPU 贴图：材质 normalMap 恒为 null（已整体迁至 fragment 程序化）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    expect(mat.normalMap).toBeNull();
    // 反向证据：getNormalMap / generateNormalMap 已从 cap 上消失（贴图链路整体移除，非仅停止挂载）
    expect((cap as unknown as Record<string, unknown>)["getNormalMap"]).toBeUndefined();
    expect((cap as unknown as Record<string, unknown>)["generateNormalMap"]).toBeUndefined();
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

  it("poolHeight 只决定容器墙体几何高度（ADR-257：不再决定水面位置）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(1.2);
    const root = scene.getObjectByName("ysm-ground-water")!;
    const walls: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name.includes("wall")) walls.push(m);
    });
    expect(walls.length).toBe(8); // 4 面 × inner/outer
    // 容器几何由 poolHeight 驱动
    const inner = walls.find((m) => m.name.endsWith("-inner"))!;
    const params = (inner.geometry as THREE.PlaneGeometry).parameters;
    expect(params.height).toBeCloseTo(1.2, 5);
    // 而顶层水面的 y 由 waterLevel 决定，与 poolHeight 无关
    expect(scene.getObjectByName("ysm-water-top")!.position.y).toBeCloseTo(cap.getLevel(), 5);
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
    expect(shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.25 * 0.5, 5);
    expect(shader.uniforms.uRoundness.value).toBe(0);
    expect(shader.uniforms.uChoppiness.value).toBeCloseTo(0.5, 5);
    expect(shader.uniforms.uDetailStrength.value).toBeCloseTo(0.08, 5);
    expect(shader.vertexShader).toContain("vec3 gerstner(");
    expect(shader.vertexShader).toContain("vWorldPos_wave");
    expect(shader.vertexShader).toContain("transformed.z += gdisp.z;");
    expect(shader.vertexShader).toContain("vFoam");
    expect(shader.fragmentShader).toContain("vWorldPos_wave");
    expect(shader.fragmentShader).toContain("vFoam");
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= fade;");
  });

  it("解析法线：beginnormal_vertex 后注入 objectNormal 覆盖（ADR-255 §2.1 落地）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    // gerstner 以 out 参数交付解析法线（GPU Gems 1 ch.1）
    expect(shader.vertexShader).toContain("out vec3 nrm");
    // 锚点顺序：覆盖必须发生在 beginnormal_vertex 之后，否则 objectNormal 尚未声明
    const anchor = shader.vertexShader.indexOf("#include <beginnormal_vertex>");
    const assign = shader.vertexShader.indexOf("objectNormal = ysmWaveNormal;");
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(assign).toBeGreaterThan(anchor);
    // 三项偏导累加：nz 以高度项 1.0 起算（GPU Gems 的 1 - ΣQ·WA·S）
    // 水平分量须 ×size —— objectNormal 是物体空间量，各向异性 scale 由 normalMatrix 逆缩放还原
    expect(shader.vertexShader).toContain("nrm.x -= dir.x * wa * c * sizeSafe;");
    expect(shader.vertexShader).toContain("nrm.y -= dir.y * wa * c * sizeSafe;");
    expect(shader.vertexShader).toContain("nrm.z -= steep * wa * s;");
    expect(shader.vertexShader).toContain("nrm.z += 1.0;");
  });

  it("尺度自洽：位移 /size 与法线 ×size 成对出现（水面 mesh 为各向异性缩放，缺一即畸变）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    // 防除零：尺寸经 max(uSize, 0.001) 下界，脏存档不会产出 NaN 几何
    expect(shader.vertexShader).toContain("float sizeSafe = max(uSize, 0.001);");
    // 位移：世界量 → 局部须 /size（原来漏了，几何法线偏离解析值平均 ~94°、最大 179°＝翻面）
    expect(shader.vertexShader).toContain("disp.x += steep * amp * dir.x * c / sizeSafe;");
    expect(shader.vertexShader).toContain("disp.y += steep * amp * dir.y * c / sizeSafe;");
    // 高度分量 scale.z=1，与局部同尺度，不得被换算
    expect(shader.vertexShader).toContain("disp.z += amp * s;");
    // 法线与位移必须同处物体空间——两者同时引用同一尺寸变量是"成对"的结构证据
    const dispU = shader.vertexShader.match(/dir\.[xy] \* c \/ sizeSafe;/g) ?? [];
    const nrmU = shader.vertexShader.match(/dir\.[xy] \* wa \* c \* sizeSafe;/g) ?? [];
    expect(dispU).toHaveLength(2);
    expect(nrmU).toHaveLength(2);
  });

  it("微细节法线：normal_fragment_maps 之后叠加世界空间切向扰动（GPU 程序化，替代 CPU 256² 贴图）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    // 注入锚点：必须落在 normal_fragment_maps 之后（normal 由 three 在此时才产出）
    const anchor = shader.fragmentShader.indexOf("#include <normal_fragment_maps>");
    const assign = shader.fragmentShader.indexOf("normal = normalize(normal +");
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(assign).toBeGreaterThan(anchor);
    // 世界水平坐标直取 vWorldPos_wave.xz（水面 mesh 绕 X 旋转 -90°，世界 xz 即水平面）
    expect(shader.fragmentShader).toContain("vWorldPos_wave.xz");
    // 扰动在世界空间构造、经 viewMatrix 入视图空间——fragment 的 normal 是视图空间量
    expect(shader.fragmentShader).toContain("viewMatrix * vec4(detailWorld, 0.0)");
    // 强度由 uniform 驱动（原 normalScale 槽位已随贴图链路一并移除）
    expect(shader.fragmentShader).toContain("* uDetailStrength;");
    // 三组方向沟槽偏导逐项在场，与原 generateNormalMap 同参（防搬迁中悄悄改谱）
    expect(shader.fragmentShader).toContain("0.08 * cos(dot(dp, dd1) * 0.8)");
    expect(shader.fragmentShader).toContain("0.05 * cos(dot(dp, dd2) * 1.1)");
    expect(shader.fragmentShader).toContain("0.03 * cos(dot(dp, dd3) * 1.6)");
  });

  it("缺 normal_fragment_maps 锚点也告警（微细节法线静默失效的防线）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const broken = fakeShader();
    broken.fragmentShader = broken.fragmentShader.replace("#include <normal_fragment_maps>\n", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mat.onBeforeCompile(
        broken as unknown as THREE.WebGLProgramParametersWithUniforms,
        undefined as unknown as THREE.WebGLRenderer,
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("锚点失配不再静默：缺 beginnormal_vertex 锚点时 reportPatchIssue 告警", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    const broken = fakeShader();
    broken.vertexShader = broken.vertexShader.replace("#include <beginnormal_vertex>\n", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mat.onBeforeCompile(
        broken as unknown as THREE.WebGLProgramParametersWithUniforms,
        undefined as unknown as THREE.WebGLRenderer,
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("uRoundness 运行期越界值被 clamp 到 [0, 0.5]（绕过 setter 的路径不再漏网）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    const top = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh).getObjectByName(
      "ysm-water-top",
    ) as THREE.Mesh;
    const mat = top.material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    // 直写 envState（模拟存档恢复/其他 cap 写入，绕开 setPoolRoundness 的入口 clamp）
    setEnvState({ waterPoolRoundness: 9 }, { source: "manual" });
    const live = (
      mat as unknown as {
        userData: { shader: { uniforms: { uRoundness: { value: number } } } };
      }
    ).userData.shader;
    expect(live.uniforms.uRoundness.value).toBeCloseTo(0.5, 5);
  });

  it("film 模式 waterSize 变更不重建 mesh（scale 驱动，ADR-255 改造 A）", () => {
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

  it("setWaterOpacity（pool）→ 内壁 opacity 同步 = waterOpacity×0.85（修复运行时脱节，ADR-257 审核 Item 6）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    cap.setWaterOpacity(0.9);
    const inner = scene.getObjectByName("ysm-water-wall-n-inner") as THREE.Mesh;
    expect((inner.material as THREE.MeshPhysicalMaterial).opacity).toBeCloseTo(0.9 * 0.85, 5);
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

  it("脏 waterSize 在入口钳到 ≥1（无 UI 入口，只可能来自存档；shader 侧 /sizeSafe 再兜一层）", () => {
    const scene = new THREE.Scene();
    persistState("water", { size: 0, enabled: true });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(envState.waterSize).toBeGreaterThanOrEqual(1);
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
    expect(cap.getWetness()).toBeCloseTo(0.5, 5);
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
    cap.setChoppiness(0.62);
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
    expect(cap2.getChoppiness()).toBeCloseTo(0.62, 5);
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

describe("WaterCapability — 微细节法线（fragment 程序化，无 CPU 贴图）", () => {
  beforeEach(() => { resetEnvState(); });

  const topMatOf = (scene: THREE.Scene): THREE.MeshPhysicalMaterial | null => {
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh | null;
    return top ? (top.material as THREE.MeshPhysicalMaterial) : null;
  };

  it("pool：结构字段重建后顶面材质仍无 CPU 法线贴图（贴图链路整体移除，非仅停止挂载）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    expect(topMatOf(scene)!.normalMap).toBeNull();
    // 三条重建路径逐一走一遍，均不得复活贴图
    cap.setPoolHeight(2.5);
    cap.setPoolWallThickness(0.5);
    setEnvState({ waterSize: 40 }, { source: "manual" });
    expect(topMatOf(scene)!.normalMap).toBeNull();
  });

  it("film size 变更：不重建几何、且不重算任何贴图（CPU 主线程零开销路径）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("film");
    const topBefore = cap["findTopWater"]() as THREE.Mesh;
    // 走 registerEnvCallback 的 film size 分支（applyChangedParams，非重建路径）
    setEnvState({ waterSize: 60 }, { source: "manual" });
    const topAfter = cap["findTopWater"]() as THREE.Mesh;
    expect(topAfter, "film size 变更不得重建 mesh（scale 驱动）").toBe(topBefore);
    expect((topAfter.material as THREE.MeshPhysicalMaterial).normalMap).toBeNull();
    // size 的世界语义改由 uniform 承担（波浪波频与圆角裁剪依赖它们），替代原先的贴图重取
    const shader = fakeShader();
    (topAfter.material as THREE.MeshPhysicalMaterial).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.uSize.value).toBeCloseTo(60, 5);
    expect(shader.uniforms.uHalfSize.value).toBeCloseTo(30, 5);
  });

  it("dispose 幂等，且实例上不再持有任何贴图缓存字段", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground-water")).toBeUndefined();
    expect(() => cap.dispose()).not.toThrow();
    const priv = cap as unknown as Record<string, unknown>;
    expect(priv["normalMapCache"]).toBeUndefined();
    expect(priv["normalMapCacheSize"]).toBeUndefined();
  });
});

describe("WaterCapability — 菜单控件全联动", () => {
  beforeEach(() => { resetEnvState(); });

  it("13 项控件 setValue/getValue 双向读写联动", () => {
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
    by("ground-water-choppiness").control!.set!(0.42);
    expect(by("ground-water-choppiness").control!.get!(undefined)).toBeCloseTo(0.42, 5);
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

  it("clarity 滑块仅 pool 模式可见（film 下 inert，ADR-257 审核 Item 7 消歧义）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const clarity = look.children!.find((c) => c.id === "ground-water-clarity")!;
    expect(clarity.visibleWhen).toBeDefined();
    expect(clarity.visibleWhen?.({ "env.waterMode": "pool" })).toBe(true);
    expect(clarity.visibleWhen?.({ "env.waterMode": "film" })).toBe(false);
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

describe("WaterCapability — 水面/容器解耦：waterLevel（ADR-257 A 档）", () => {
  beforeEach(() => { resetEnvState(); });

  /** schema 默认值 = 0.01（历史 film 水膜微抬量；原 GROUND_LAYER_OFFSETS.waterFilm 已于 ADR-257 后删除） */
  const DEFAULT_LEVEL = 0.01;

  it("film：改 waterLevel 不重建 mesh 且 root.position.y 跟随", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    expect(cap.getLevel()).toBeCloseTo(DEFAULT_LEVEL, 5);
    const before = scene.getObjectByName("ysm-ground-water");
    cap.setLevel(1.25);
    const after = scene.getObjectByName("ysm-ground-water");
    expect(after).toBe(before); // 零重建：实例身份不变
    expect(after!.position.y).toBeCloseTo(1.25, 5);
    expect(cap.getLevel()).toBeCloseTo(1.25, 5);
  });

  it("pool：改 waterLevel 不重建容器，顶层水面 y 跟随 level 且几何未被触碰", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setLevel(0.9);
    const rootBefore = scene.getObjectByName("ysm-ground-water");
    const topBefore = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    expect(topBefore.position.y).toBeCloseTo(0.9, 5);
    const geoBefore = topBefore.geometry;
    cap.setLevel(1.6);
    expect(scene.getObjectByName("ysm-ground-water")).toBe(rootBefore); // 零重建
    const topAfter = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    expect(topAfter.position.y).toBeCloseTo(1.6, 5);
    expect(topAfter.geometry).toBe(geoBefore);
  });

  it("语义分离核心：改 poolHeight 不再移动顶层水面，只改容器几何", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setLevel(0.5);
    cap.setPoolHeight(1.2);
    expect(scene.getObjectByName("ysm-water-top")!.position.y).toBeCloseTo(0.5, 5);
    // 容器随 h 重建（墙几何依赖 h），但水面高度纹丝不动
    cap.setPoolHeight(2.4);
    expect(scene.getObjectByName("ysm-water-top")!.position.y).toBeCloseTo(0.5, 5);
    expect(cap.getPoolHeight()).toBeCloseTo(2.4, 5);
  });

  it("菜单 ground-water-level 在 film 与 pool 下均可见（无 visibleWhen 门控）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    const form = nodes[1]!;
    const level = form.children!.find((c) => c.id === "ground-water-level");
    expect(level).toBeDefined();
    expect(level!.visibleWhen).toBeUndefined(); // 关键：不带模式门控
    level!.control!.set!(0.77);
    expect(cap.getLevel()).toBeCloseTo(0.77, 5);
  });
});

describe("WaterCapability — 形态策略表（ADR-257 B 档）", () => {
  beforeEach(() => { resetEnvState(); });

  /** 收集 root 下全部 mesh（用于与新 role 寻址做对照） */
  const collect = (root: THREE.Object3D): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };

  const bodyOf = (cap: WaterCapability) => (cap as unknown as { water: WaterBody }).water;

  it("pool：getTargets(role) 直出 build 期预捕获引用（零遍历、零字符串匹配）", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    cap.apply();
    cap.setWaterMode("pool");
    const body = bodyOf(cap);
    const roles: WaterPartRole[] = ["surface", "floor", "wallInner", "wallOuter"];
    for (const role of roles) {
      expect(poolStrategy.getTargets(body, role)).toBe(body.parts[role]); // 引用恒等 = 查表直出
    }
    // 四个内壁 + 四个外壁都取得到，确保 role 覆盖完整而非部分匹配
    expect(poolStrategy.getTargets(body, "wallInner")).toHaveLength(4);
    expect(poolStrategy.getTargets(body, "wallOuter")).toHaveLength(4);
    // 反证：全树改名后仍能取出——mesh-name 字符串契约已彻底消除（旧实现此断言必红）
    for (const m of collect(body.root)) m.name = `renamed-${m.name}`;
    expect(poolStrategy.getTargets(body, "wallInner")).toHaveLength(4);
    expect(poolStrategy.getTargets(body, "wallOuter")).toHaveLength(4);
    expect(poolStrategy.getTargets(body, "surface")).toHaveLength(1);
  });

  it("film：容器类 role 一律为空数组——这是「一行表达式同时适配两种形态」的机理", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    cap.apply();
    const body = bodyOf(cap);
    expect(filmStrategy.getTargets(body, "surface")).toBe(body.parts.surface);
    expect(filmStrategy.getTargets(body, "floor")).toEqual([]);
    expect(filmStrategy.getTargets(body, "wallInner")).toEqual([]);
    expect(filmStrategy.getTargets(body, "wallOuter")).toEqual([]);
  });

  it("形态能力旗标：film 受 wetness 门控且无体积光学；pool 反之", () => {
    expect(filmStrategy.wetnessGated).toBe(true);
    expect(filmStrategy.supportsVolumeOptics).toBe(false);
    expect(poolStrategy.wetnessGated).toBe(false);
    expect(poolStrategy.supportsVolumeOptics).toBe(true);
  });

  it("clampPoolRoundness 边界：负值归零、超上限取 0.5（构造期与运行期共用同一域）", () => {
    expect(clampPoolRoundness(-1)).toBe(0);
    expect(clampPoolRoundness(0)).toBe(0);
    expect(clampPoolRoundness(0.25)).toBeCloseTo(0.25, 5);
    expect(clampPoolRoundness(0.5)).toBeCloseTo(0.5, 5);
    expect(clampPoolRoundness(9)).toBeCloseTo(0.5, 5);
  });

  it("needsRebuild 由形态自行声明：film 永不重建；pool 因结构字段重建、但不因 waterLevel 重建", () => {
    expect(filmStrategy.needsRebuild(new Set(["waterLevel", "waterSize"]))).toBe(false);
    expect(poolStrategy.needsRebuild(new Set(["waterLevel"]))).toBe(false);
    expect(poolStrategy.needsRebuild(new Set(["waterSize"]))).toBe(true);
    expect(poolStrategy.needsRebuild(new Set(["waterPoolHeight"]))).toBe(true);
    expect(poolStrategy.needsRebuild(new Set(["waterPoolWallThickness"]))).toBe(true);
  });
});
