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
import { WATER_WAVE_SEGMENTS } from "./water-state.ts";
import { WaterCapability, WATER_UNIFORM_NAMES, WATER_FRAME_READ_KEYS } from "./water-capability.ts";
import { WATER_PARAM_APPLIER_KEYS } from "./water-capability.ts";
import { persistState, restoreState } from "./scene-capability.ts";
import { isEnvCallbacksSuspended } from "@/preview-3d/state/env-dispatcher.ts";
import { getParamRange, getPresetKeys } from "@/preview-3d/state/env-state-schema.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";

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
      "#include <common>\nvoid main() {\n#include <normal_fragment_maps>\nvec3 normal = vec3(0.0, 0.0, 1.0);\nvViewPosition;\n#include <dithering_fragment>\n}",
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

  it("setWaterEnabled 控制 visible（单门：能力启停即 waterEnabled，fog 同法）", () => {
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

  // [探针回归 2026-09-21] waterEnabled 与参数键**同批派发**（预设快照/程序化批量写入）时，
  // 回调原在开关分支 `return` 早退，吞掉同行其余 water 键的分派：envState 已更新、
  // 材质/transform 却停在旧值（用户可见的画面与状态脱节），直到下一次无关派发才惰性补上。
  // 现开关只管可见性、参数照常逐键派发——两种落地在同一次派发内都发生。
  it("waterEnabled + 参数同批派发：参数不被可见性分支吞掉", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const top = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = top.material as THREE.MeshPhysicalMaterial;
    // 开关 + 颜色同批
    setEnvState({ waterEnabled: false, waterColor: 0x11aa22 }, { source: "manual" });
    expect(mat.color.getHex(), "颜色应随同批写入落地材质").toBe(0x11aa22);
    // 开关 + 尺寸同批
    setEnvState({ waterEnabled: true, waterSize: 200 }, { source: "manual" });
    expect(top.scale.x, "size 应随同批写入落到 scale").toBe(200);
    expect(top.visible, "同批的开关也要生效").toBe(true);
  });

  it("getMenuNodes：enabled 平铺 toggle + 5 组 folder", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(6);
    expect(nodes[0].id).toBe("water-enabled");
    expect(nodes.slice(1).map((n) => n.kind)).toEqual([
      "folder",
      "folder",
      "folder",
      "folder",
      "folder",
    ]);
    expect(nodes.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
      "preview.waterGroupReflect",
    ]);
  });

  it("getMasterNodeId 返回 water-enabled 使 env 面板能在行首渲染开关", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    expect(cap.getMasterNodeId()).toBe("water-enabled");
  });

  it("菜单控件条件显隐：wetness 仅 film；pool 系列仅 pool", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const pool = nodes[3]!;
    const wetness = look.children!.find((c) => c.id === "water-wetness")!;
    const poolHeight = pool.children!.find((c) => c.id === "water-pool-height")!;
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

  it("poolHeight 只决定容器壁高（ADR-257 / 272：不动水面，且零重建）", () => {
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
    // 容器壁高由 poolHeight 驱动：几何单位化（参数高度恒 1），h 经 scale.y 表达——
    // 这正是不再重建的根据（ADR-272 扩展）。
    const inner = walls.find((m) => m.name.endsWith("-inner"))!;
    expect((inner.geometry as THREE.PlaneGeometry).parameters.height).toBeCloseTo(1, 5);
    expect(inner.scale.y, "壁高 = 池深").toBeCloseTo(1.2, 5);
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

  // ── 波幅采样抗锯齿（2026-09-22）──
  // 病灶：64×64 分段固定，顶点间距 = size/64；水膜拉到 300 m 时最短波长只剩 ~2.2 个
  // 顶点/波长（奈奎斯特极限 2），高频波混叠成游走摩尔纹。处方：按「每波长顶点数」
  // 逐波衰减振幅——≥6 全留，2–6 淡出；位移/法线/泡沫同源于 amp，一处衰减三处一致。
  it("分段数唯一事实源 = water-state WATER_WAVE_SEGMENTS，film/pool 顶水面几何实际用它分段", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    // cap["water"].top 走 role 契约取件（同 L1041 先例）：film 顶=root、pool 顶=group 内
    // 顶板，不靠 mesh name 字符串（pool 的 "ysm-ground-water" 挂在 group 上，无几何）
    const filmGeo = (cap["water"].top as unknown as THREE.Mesh)
      .geometry as THREE.PlaneGeometry;
    expect(filmGeo.parameters.widthSegments).toBe(WATER_WAVE_SEGMENTS);
    expect(filmGeo.parameters.heightSegments).toBe(WATER_WAVE_SEGMENTS);
    cap.setWaterMode("pool");
    const poolGeo = (cap["water"].top as unknown as THREE.Mesh)
      .geometry as THREE.PlaneGeometry;
    expect(poolGeo.parameters.widthSegments).toBe(WATER_WAVE_SEGMENTS);
    expect(poolGeo.parameters.heightSegments).toBe(WATER_WAVE_SEGMENTS);
  });

  it("gerstner 按每波长顶点数淡出波幅，间距由 WATER_WAVE_SEGMENTS 推导（改分段两处必同步）", () => {
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
    // 间距派生与 shader/几何同一常数（模板内插，字面 64 不许回流两处各写各的）
    expect(shader.vertexShader).toContain(`sizeSafe / float(${WATER_WAVE_SEGMENTS})`);
    // 衰减必须先于 wa/steep 派生（wa = freq*amp 用淡出后的 amp，泡沫与法线自动同幅）
    const ampScale = shader.vertexShader.indexOf("amp *= aa;");
    const waDerive = shader.vertexShader.indexOf("float wa = freq * amp;");
    expect(ampScale).toBeGreaterThan(-1);
    expect(waDerive).toBeGreaterThan(ampScale);
    expect(shader.vertexShader).toContain(
      "float aa = max(smoothstep(2.0, 6.0, waveLen / spacing), 0.001);",
    );
  });

  it("aa 带 1‰ 下界：wa 恒 > 0，steep 除零 Inf×0=NaN 的通路被焊死", () => {
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
    // 裸 smoothstep（无 max 下界）意味着 λ/s ≤ 2 时 amp=0 → wa=0 → steep clamp 除零，红
    expect(shader.vertexShader).toContain("max(smoothstep(2.0, 6.0,");
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

  it("film：waterPoolRoundness 变更不得泄漏进 uRoundness（构造期门控 = 运行期门控）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply(); // 默认 film
    const root = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = root.material as THREE.MeshPhysicalMaterial;
    mat.onBeforeCompile(
      fakeShader() as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    const live = (
      mat as unknown as {
        userData: { shader: { uniforms: { uRoundness: { value: number } } } };
      }
    ).userData.shader;
    // 构造期：film 无容器，圆角恒 0（buildWaveWaterMaterial 的 forPool 门控）
    expect(live.uniforms.uRoundness.value).toBe(0);
    // 直写 envState（模拟存档恢复 / 预设套用 / 其他 cap 写入）——
    // film 下不得被 pool 专属参数污染，否则水膜被圆角裁剪
    setEnvState({ waterPoolRoundness: 0.5 }, { source: "manual" });
    expect(live.uniforms.uRoundness.value).toBe(0);
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

  it("update 门控：visible 为假不累加（setEnabled 别名与 setWaterEnabled 同一 gate，两条路径都验）", () => {
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

  it("setPoolWallThickness（pool）→ 外壁偏移 / 壁高 / 光学光程就地更新，零重建", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.setWaterMode("pool");
    cap.apply();
    const outer = scene.getObjectByName("ysm-water-wall-n-outer") as THREE.Mesh;
    const geoBefore = outer.geometry;
    expect(() => cap.setPoolWallThickness(0.3)).not.toThrow();
    expect(cap.getPoolWallThickness()).toBeCloseTo(0.3, 5);
    const outerAfter = scene.getObjectByName("ysm-water-wall-n-outer") as THREE.Mesh;
    expect(outerAfter, "壁件同一实例（ADR-272 扩展：零重建）").toBe(outer);
    expect(outerAfter.geometry, "壁几何不被重建").toBe(geoBefore);
    // 外壁位置 = size/2 + 壁厚（绝对量，不随 size 缩放）
    expect(outerAfter.position.z).toBeCloseTo(-(cap.getWaterSize() / 2 + 0.3), 5);
    // 壁厚同时是池内壁的体积光学光程（材质属性，随壁厚跟随）
    const innerMat = (scene.getObjectByName("ysm-water-wall-n-inner") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    expect(innerMat.thickness).toBeCloseTo(0.3, 5);
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

  it("setWaterOpacity（film，shader 已编译）→ 同步 uBaseOpacity uniform", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh).material as THREE.MeshPhysicalMaterial & {
      userData: { shader?: { uniforms: { uBaseOpacity: { value: number } } } };
    };
    mat.userData.shader = { uniforms: { uBaseOpacity: { value: 0 } } };
    cap.setWaterOpacity(0.8);
    // film: opacity = waterOpacity * wetness(默认0.5)
    expect(mat.opacity).toBeCloseTo(0.8 * 0.5, 5);
    expect(mat.userData.shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.8 * 0.5, 5);
  });

  it("setWaterOpacity（pool，shader 已编译）→ 同步 uBaseOpacity uniform", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    const mat = top.material as THREE.MeshPhysicalMaterial & {
      userData: { shader?: { uniforms: { uBaseOpacity: { value: number } } } };
    };
    mat.userData.shader = { uniforms: { uBaseOpacity: { value: 0 } } };
    cap.setWaterOpacity(0.9);
    // pool: opacity = waterOpacity（无 wetness 因子）
    expect(mat.opacity).toBeCloseTo(0.9, 5);
    expect(mat.userData.shader.uniforms.uBaseOpacity.value).toBeCloseTo(0.9, 5);
  });
});

describe("WaterCapability — 能力级开关单门收口（fog 先例同法，2026-09-22）", () => {
  beforeEach(() => {
    resetEnvState();
  });

  it("私有 enabled 字段已退役——实例不持有同名 own 属性（防僵尸门回归守卫）", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    expect("enabled" in cap, "能力级开关唯一真值源 = envState.waterEnabled，私有门不得复活").toBe(
      false,
    );
  });

  it("setEnabled/isEnabled 是 envState.waterEnabled 的别名（写即派发即同步可见性）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setEnabled(false);
    expect(envState.waterEnabled).toBe(false);
    expect(cap.isEnabled()).toBe(false);
    expect(scene.getObjectByName("ysm-ground-water")!.visible).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    expect(scene.getObjectByName("ysm-ground-water")!.visible).toBe(true);
  });

  it("saveState 不再持久化能力级 enabled 幽灵键（waterEnabled 随 schema 键集照常落盘）", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    cap.saveState();
    const saved = restoreState("water") as Record<string, unknown>;
    expect("enabled" in saved, "恒 true 的幽灵键不得再进存档").toBe(false);
    expect("waterEnabled" in saved).toBe(true);
  });

  it("legacy 中毒回归：ground 嵌套 water.enabled=false 恢复后，单一开关仍能救回水面", () => {
    // 病灶（2026-09-22 收口）：旧 loadState 首段把嵌套 dialect 的 water.enabled 同时写进
    // 私有 this.enabled——该键无任何 UI 写口（registry ctx 无 enabled，env 行 headerToggle
    // 绑的是 waterEnabled），false 一进即永久锁死：菜单开关显示 ON 而水面不再出现，
    // saveState 还把中毒值落盘，重启自续。现单门收口后同一存档可正常翻回。
    persistState("ground", { water: { enabled: false, wetness: 0.4 } });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.loadState();
    expect(cap.getWaterEnabled()).toBe(false);
    expect(scene.getObjectByName("ysm-ground-water")!.visible).toBe(false);
    cap.setWaterEnabled(true);
    expect(scene.getObjectByName("ysm-ground-water")!.visible, "单门可逆：翻开关即复现").toBe(true);
  });

  it("loadState 恢复段挂起派发、末尾一次性落地（同侪 fog/ground 口径）", () => {
    // 断言两点：① 恢复结束后 visible/geometry 与整批 envState 一致（end-of-line 统一应用，
    // 不依赖逐键派发）；② 挂起计数无逃逸。
    persistState("water", {
      waterEnabled: true,
      waterMode: "pool",
      waterSize: 150,
      waterPoolHeight: 2,
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(isEnvCallbacksSuspended(), "resume 必须在 finally 闭合").toBe(false);
    cap.apply();
    const root = scene.getObjectByName("ysm-ground-water") as THREE.Group;
    expect(root.visible).toBe(true);
    const top = root.getObjectByName("ysm-water-top") as THREE.Mesh;
    expect(top.scale.x, "结构参数在末尾统一落地").toBe(150);
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

  it("film 存档残留 pool 圆角 → 恢复后不得污染 film 的 uRoundness（pool 专属参数不跨界）", () => {
    // 现实来源：用户先在 pool 调过圆角、切回 film 后保存——saveState 写全量 water 键（不分形态），
    // 存档里因此残留 poolRoundness。恢复时若 applier 无形态门控，水膜会被凭空裁掉四角
    // （构造期靠 forPool 恒 0 明令禁止的行为，只在运行期漏门控 → 2026-09 修复）。
    persistState("water", {
      enabled: true,
      mode: "film",
      poolRoundness: 0.5,
      waterPoolRoundness: 0.5,
    });
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply(); // 默认 film
    // 真实时序：先编译 shader（存下 uniform 句柄），再恢复存档——否则 setUniform 因无 shader 而自然跳过
    const root = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = root.material as THREE.MeshPhysicalMaterial;
    mat.onBeforeCompile(
      fakeShader() as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    cap.loadState();
    // 参数本身照常恢复（pool 用户的持久化不受影响）
    expect(cap.getPoolRoundness()).toBeCloseTo(0.5, 5);
    const live = (
      mat as unknown as {
        userData: { shader: { uniforms: { uRoundness: { value: number } } } };
      }
    ).userData.shader;
    expect(live.uniforms.uRoundness.value, "film 圆角恒 0").toBe(0);
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

  // 锐评病灶②：值钳制曾「三张皮」——loadState 自备 Math.max(1, v) 自钳，
  // 与 setEnvState 的 clampFieldValue 重复且只覆盖下界（无上界）。
  // 经 storage 边界后只可能有**有限**数值，故两者行为恰好一致——
  // 即：那段自钳是公认的死重量，与「唯一写入口」原则相悖。
  // 现删除自钳，投诚唯一写入口；本组测试钉死「去自钳不得改变可观察行为」。
  it("脏 waterSize 下界钳制仍生效（0/负数 → range.min）", () => {
    const scene = new THREE.Scene();
    persistState("water", { size: 0, enabled: true });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    // 写入口口径：clamp(0, 1, 300) = 1
    expect(envState.waterSize).toBe(1);
  });

  it("脏 waterSize 上界钳制同口径（旧自钳只盖下界，现投诚 schema range）", () => {
    const scene = new THREE.Scene();
    persistState("water", { size: 9999, enabled: true });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    // 写入口口径：clamp(9999, 1, 300) = 300（旧自钳 Math.max(1,v) 不盖上界）
    expect(envState.waterSize).toBe(300);
  });

  it("负数 waterSize 钳到 range.min", () => {
    const scene = new THREE.Scene();
    persistState("water", { size: -12, enabled: true });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(envState.waterSize).toBe(1);
  });

  it("legacy size 键迁移仍生效（去自钳 ≠ 去兼容）", () => {
    const scene = new THREE.Scene();
    persistState("water", { size: 64, enabled: true });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterSize()).toBe(64);
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
    const topBefore = (cap["water"].top as unknown as THREE.Mesh);
    // 走 registerEnvCallback 的 film size 分支（applyChangedParams，非重建路径）
    setEnvState({ waterSize: 60 }, { source: "manual" });
    const topAfter = (cap["water"].top as unknown as THREE.Mesh);
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

  /** 树内控件总数（含各层 children）——与下方逐项断言互为兜底：
   *  树里新增控件却漏加断言时，这里的数字先红（旧标题「13 项」正因漏了 waterLevel 而长期失真）。 */
  const countControls = (arr: readonly PreviewMenuNode[]): number =>
    arr.reduce((n, c) => n + (c.children ? countControls(c.children) : 1), 0);

  it("20 项控件 setValue/getValue 双向读写联动（数量与树一致）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(countControls(nodes)).toBe(20);
    const form = nodes[1]!;
    const look = nodes[2]!;
    const pool = nodes[3]!;
    const wave = nodes[4]!;
    const reflect = nodes[5]!;
    const by = (id: string) => {
      for (const arr of [
        nodes,
        form.children!,
        look.children!,
        pool.children!,
        wave.children!,
        reflect.children!,
      ]) {
        const found = arr.find((c) => c.id === id);
        if (found) return found;
      }
      throw new Error(`node ${id} not found`);
    };
    nodes[0]!.control!.set!(false);
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    by("water-mode").control!.set!("pool");
    expect(by("water-mode").control!.get!(undefined)).toBe("pool");
    by("water-size").control!.set!(140);
    expect(by("water-size").control!.get!(undefined)).toBeCloseTo(140, 5);
    by("water-level").control!.set!(1.2);
    expect(by("water-level").control!.get!(undefined)).toBeCloseTo(1.2, 5);
    by("water-wetness").control!.set!(0.45);
    expect(by("water-wetness").control!.get!(undefined)).toBeCloseTo(0.45, 5);
    by("water-color").control!.set!(0x0a0b0c);
    expect(by("water-color").control!.get!(undefined)).toBe(0x0a0b0c);
    by("water-opacity").control!.set!(0.55);
    expect(by("water-opacity").control!.get!(undefined)).toBeCloseTo(0.55, 5);
    by("water-normal-strength").control!.set!(0.6);
    expect(by("water-normal-strength").control!.get!(undefined)).toBeCloseTo(0.6, 5);
    by("water-clarity").control!.set!(0.35);
    expect(by("water-clarity").control!.get!(undefined)).toBeCloseTo(0.35, 5);
    by("water-pool-height").control!.set!(1.5);
    expect(by("water-pool-height").control!.get!(undefined)).toBeCloseTo(1.5, 5);
    by("water-pool-wall-thickness").control!.set!(0.4);
    expect(by("water-pool-wall-thickness").control!.get!(undefined)).toBeCloseTo(0.4, 5);
    by("water-pool-wall-color").control!.set!(0x334455);
    expect(by("water-pool-wall-color").control!.get!(undefined)).toBe(0x334455);
    by("water-pool-roundness").control!.set!(0.2);
    expect(by("water-pool-roundness").control!.get!(undefined)).toBeCloseTo(0.2, 5);
    by("water-wave-speed").control!.set!(1.8);
    expect(by("water-wave-speed").control!.get!(undefined)).toBeCloseTo(1.8, 5);
    by("water-choppiness").control!.set!(0.42);
    expect(by("water-choppiness").control!.get!(undefined)).toBeCloseTo(0.42, 5);
    // ADR-297 reflect 组五控件（主开 + 四从控）双向读写
    by("water-reflection").control!.set!(true);
    expect(by("water-reflection").control!.get!(undefined)).toBe(true);
    by("water-reflection-strength").control!.set!(0.8);
    expect(by("water-reflection-strength").control!.get!(undefined)).toBeCloseTo(0.8, 5);
    by("water-reflection-resolution").control!.set!(1024);
    expect(by("water-reflection-resolution").control!.get!(undefined)).toBe(1024);
    by("water-reflection-clip-bias").control!.set!(5.5);
    expect(by("water-reflection-clip-bias").control!.get!(undefined)).toBeCloseTo(5.5, 5);
    by("water-reflect-ssr-suppress").control!.set!(false);
    expect(by("water-reflect-ssr-suppress").control!.get!(undefined)).toBe(false);
  });
});

describe("WaterCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  function newCap() {
    return new WaterCapability({ scene: new THREE.Scene() });
  }

  it("完整树 = enabled 平铺 toggle + 5 组 folder（form/look/pool/wave/reflect）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(6);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("water-enabled");
    nodes[0]!.control!.set!(false);
    expect(cap.getWaterEnabled()).toBe(false);
    expect(nodes.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
      "preview.waterGroupReflect",
    ]);
    const look = nodes[2]!;
    expect(look.children!.map((c) => c.id)).toEqual([
      "water-wetness",
      "water-color",
      "water-opacity",
      "water-normal-strength",
      "water-clarity",
      "water-choppiness",
    ]);
  });

  it("film/pool visibleWhen 谓词挂节点", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const wetness = look.children!.find((c) => c.id === "water-wetness")!;
    expect(wetness.visibleWhen?.({ "env.waterMode": "film" })).toBe(true);
    expect(wetness.visibleWhen?.({ "env.waterMode": "pool" })).toBe(false);
    const pool = nodes[3]!;
    const height = pool.children!.find((c) => c.id === "water-pool-height")!;
    expect(height.visibleWhen?.({ "env.waterMode": "pool" })).toBe(true);
    expect(height.visibleWhen?.({ "env.waterMode": "film" })).toBe(false);
  });

  it("clarity 滑块仅 pool 模式可见（film 下 inert，ADR-257 审核 Item 7 消歧义）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const clarity = look.children!.find((c) => c.id === "water-clarity")!;
    expect(clarity.visibleWhen).toBeDefined();
    expect(clarity.visibleWhen?.({ "env.waterMode": "pool" })).toBe(true);
    expect(clarity.visibleWhen?.({ "env.waterMode": "film" })).toBe(false);
  });

  it("color/slider 节点读写闭包直连 cap", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const look = nodes[2]!;
    const color = look.children!.find((c) => c.id === "water-color")!;
    expect(color.kind).toBe("color");
    color.control!.set!(0x3355aa);
    expect(cap.getWaterColor()).toBe(0x3355aa);
    const opacity = look.children!.find((c) => c.id === "water-opacity")!;
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

  // 锐评病灶③：顶面 thickness 是「从池深派生的光学光程」，在 buildMaterial 里
  // 算一次（Math.max(0.01, waterPoolHeight * 0.5)）。但 ADR-272 后 pool 的
  // needsRebuild 恒 false，于是运行期拖池深：几何（transformLinks）跟上了，
  // 这个派生光学量却停在装配那一刻——池子变深、水体光程不变。
  it("pool：改 poolHeight 重派生顶面 thickness（派生光学量不烘死在装配期）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(1.0);
    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    const mat = top.material as THREE.MeshPhysicalMaterial;
    expect(mat.thickness, "建时期派生：h × 0.5").toBeCloseTo(0.5, 5);

    cap.setPoolHeight(2.0);
    const matAfter = (scene.getObjectByName("ysm-water-top") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    expect(matAfter, "零重建：材质实例不变").toBe(mat);
    expect(matAfter.thickness, "改池深后光程应重派生为 1.0").toBeCloseTo(1.0, 5);
  });

  it("film 无容器：改 wetness 不引入体积光学（thickness 恒 0）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const mat = (scene.getObjectByName("ysm-ground-water") as THREE.Mesh)
      .material as THREE.MeshPhysicalMaterial;
    expect(mat.thickness, "film 水膜无厚度可言").toBe(0);
    cap.setWetness(0.9);
    expect(mat.thickness, "wetness 不得把水膜变透光体").toBe(0);
  });

  it("菜单 ground-water-level 在 film 与 pool 下均可见（无 visibleWhen 门控）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    const form = nodes[1]!;
    const level = form.children!.find((c) => c.id === "water-level");
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

  it("形态能力旗标：film 受 wetness 门控、无体积光学 / 无圆角；pool 反之", () => {
    expect(filmStrategy.wetnessGated).toBe(true);
    expect(filmStrategy.supportsVolumeOptics).toBe(false);
    expect(filmStrategy.supportsRoundness).toBe(false);
    expect(poolStrategy.wetnessGated).toBe(false);
    expect(poolStrategy.supportsVolumeOptics).toBe(true);
    expect(poolStrategy.supportsRoundness).toBe(true);
  });

  it("clampPoolRoundness 边界：负值归零、超上限取 0.5（构造期与运行期共用同一域）", () => {
    expect(clampPoolRoundness(-1)).toBe(0);
    expect(clampPoolRoundness(0)).toBe(0);
    expect(clampPoolRoundness(0.25)).toBeCloseTo(0.25, 5);
    expect(clampPoolRoundness(0.5)).toBeCloseTo(0.5, 5);
    expect(clampPoolRoundness(9)).toBeCloseTo(0.5, 5);
  });

  it("needsRebuild 由形态自行声明：film / pool 恒不重建（结构参数全走 transformLinks，ADR-272 扩展）", () => {
    expect(filmStrategy.needsRebuild(new Set(["waterLevel", "waterSize"]))).toBe(false);
    expect(poolStrategy.needsRebuild(new Set(["waterLevel"]))).toBe(false);
    // ADR-272：pool 的 size 改走 transformLinks（逐件 scale + 定位），不再全量重建容器——
    // 这是 waterSize 得以放开 UI 入口的前提：拖动是高频事件，ADR-255 §2.2 的「低频接受」前提已失效
    expect(poolStrategy.needsRebuild(new Set(["waterSize"])), "pool size 零重建").toBe(false);
    // ADR-272 扩展：池深与壁厚同样收进 links（壁高走 scale.y、外偏 = size/2 + t、外壁按 t 加高），
    // 几何一句不动——「拖池深滑块每帧重建 10 个 mesh」的旧账至此结清
    expect(poolStrategy.needsRebuild(new Set(["waterPoolHeight"])), "pool 池深零重建").toBe(false);
    expect(poolStrategy.needsRebuild(new Set(["waterPoolWallThickness"])), "pool 壁厚零重建").toBe(false);
  });

  it("[锐评 W-3] schema water 组键集 = 分派表键集（字面同步契约）", () => {
    // 双保险：类型派生（WaterParamKey = Extract<EnvStateKey, `water${string}`>）负责编译期，
    // 本字面量对比负责**运行时**——schema 加新水键而漏加分派表条目时，
    // 编译期 Record 完备性会拦下（新增 key 必在分派表声明）；但分派表**删条目**
    // 或字面量登记与分派表漂移（如手抄漏字），只有本测试能兜住。
    const schemaKeys = getPresetKeys("water").filter((k) => k.startsWith("water"));
    expect(
      new Set(schemaKeys),
      `schema water 组键集与分派表字面量漂移（schema=${JSON.stringify(schemaKeys)}）`,
    ).toEqual(new Set(WATER_PARAM_APPLIER_KEYS));
  });

  it("[锐评 3.1 守卫] WATER_UNIFORM_NAMES 字面量登记与 onBeforeCompile 注入的 uniform 集一致", () => {
    // setUniform 走 `mat.userData.shader.uniforms[name]` string key 后门——
    // 拼错 uniform 名即静默失败（guard 只防 uniform 不存在，不防 typo）。
    // 本测试锁：onBeforeCompile 里 `shader.uniforms.uXxx = {...}` 的 10 个名
    // 必须全部登记在 WATER_UNIFORM_NAMES（单一登记点），未来加 uniform 忘登记即红。
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const shader = fakeShader() as unknown as THREE.WebGLProgramParametersWithUniforms;
    cap["water"].top.material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    const injected = Object.keys((shader.uniforms as Record<string, unknown>));
    expect(injected.length, "注入的 uniform 集非空").toBeGreaterThan(0);
    // 注入的每个 uniform 名都须在 WATER_UNIFORM_NAMES（漏登记 → 未受守卫 → 静默失效面）
    for (const name of injected) {
      expect(
        (WATER_UNIFORM_NAMES as readonly string[]).includes(name),
        `uniform ${name} 已在 shader 注入但因未登 WATER_UNIFORM_NAMES 而失去编译期守卫`,
      ).toBe(true);
    }
    // 反向：登记的每个名都须真实注入（防登记了但 shader 没写 → 死登记）
    for (const name of WATER_UNIFORM_NAMES) {
      expect(shader.uniforms, `WATER_UNIFORM_NAMES 登记了 ${name} 但未注入`).toHaveProperty(name);
    }
  });

  it("[锐评 3.3] WATER_FRAME_READ_KEYS 登记 = 无材质应用的键，且消费点在 update 现读 envState", () => {
    // 结构证据链：
    //  ① 登记的每个键都必须存在于分派表键集（否则登记悬空、空条目无处安放）
    for (const key of WATER_FRAME_READ_KEYS) {
      expect(
        (WATER_PARAM_APPLIER_KEYS as readonly string[]).includes(key),
        `WATER_FRAME_READ_KEYS 登记 ${key} 不在分派表键集（登记悬空）`,
      ).toBe(true);
    }
    //  ② 行为实证：登记的键确实由 update 逐帧现读 envState——waveSpeed 驱动 waterTime 累加。
    //     （未来登记集扩充时，此处须为每个新键补一条「update 现读该键」的行为断言，
    //     否则登记只是声明、没有可观测出口。）
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const before = (cap as unknown as { waterTime: { value: number } }).waterTime.value;
    cap.setWaveSpeed(2.0);
    cap.update(1.0);
    const after = (cap as unknown as { waterTime: { value: number } }).waterTime.value;
    expect(after - before, "waveSpeed 变更 → update 累加速度随之变化（现读 envState 生效）").toBeCloseTo(
      2.0,
      5,
    );
  });

  // [锐评 D3 契约锁 2026-09-22] saveState 派生化（getPresetKeys 遍历）只覆盖**写侧**，
  // loadState 还原表仍是手写双轨清单——旧注释「读写两侧自动跟上」超额承诺了读侧
  //（e7c9e52fb 复审发现）。本行为锁补上读侧：schema 每键写偏离值 → save → reset →
  // load → 全部存活；未来 schema 加水键而漏登记还原表，本测试即红，且偏离值表缺键
  // 会被点名（把加键动作逼回本文件登记，防「自动持久化、静默不还原」）。
  it("[D3] schema water 键集全部可 save/load round-trip（还原表不得漏登记）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    // 每键一个「≠ schema 默认」的偏离值（合法域内）——新键未列入即 fail 提示登记
    const DEVIATION: Record<string, unknown> = {
      waterEnabled: false,
      waterMode: "pool",
      waterLevel: 2.5,
      waterWetness: 0.9,
      waterColor: 0x010203,
      waterOpacity: 0.6,
      waterNormalStrength: 0.3,
      waterClarity: 0.2,
      waterWaveSpeed: 2.5,
      waterChoppiness: 0.9,
      waterPoolHeight: 1.5,
      waterPoolWallThickness: 0.5,
      waterPoolWallColor: 0x040506,
      waterPoolRoundness: 0.2,
      waterSize: 123,
      // ADR-297 倒影键（偏离值均 ≠ schema 默认：false/0.6/512/true）
      waterReflectionEnabled: true,
      waterReflectionStrength: 0.9,
      waterReflectionResolution: 1024,
      waterReflectDisableWhenSSR: false,
      // [锐评 F-2] clipBias 下沉键（默认 3，偏离取 5.5 ∈ [0,10]）
      waterReflectionClipBias: 5.5,
    };
    const schemaKeys = getPresetKeys("water").filter((k) => k.startsWith("water"));
    const missing = schemaKeys.filter((k) => !(k in DEVIATION));
    expect(
      missing,
      `schema 新增了 water 键但本测试未登记偏离值: ${JSON.stringify(missing)}`,
    ).toEqual([]);
    const patch: Record<string, unknown> = {};
    for (const k of schemaKeys) {
      // 偏离值必须确实偏离当前值，否则「存活」断言恒真、锁形同虚设
      expect(
        envState[k as keyof typeof envState],
        `water 键 ${k} 的偏离值与当前值同值（测试自失能）`,
      ).not.toBe(DEVIATION[k]);
      patch[k] = DEVIATION[k];
    }
    setEnvState(patch as never, { source: "manual", force: true });
    cap.saveState();
    resetEnvState();
    const cap2 = new WaterCapability({ scene });
    cap2.loadState();
    for (const k of schemaKeys) {
      expect(envState[k as keyof typeof envState], `water 键 ${k} 未被 loadState 还原`).toBe(
        DEVIATION[k],
      );
    }
  });
});

describe("WaterCapability — waterSize UI 入口与零重建（ADR-272）", () => {
  beforeEach(() => { resetEnvState(); });

  /** 收集 root 子树全部 mesh（池体恒 10 件：顶 + 底 + 4 组内外壁） */
  const collectMeshes = (scene: THREE.Scene): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    scene.getObjectByName("ysm-ground-water")!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };

  it("setWaterSize 写 envState；入口钳到 ≥1（与 loadState 恢复同一下界，shader /sizeSafe 再兜一层）", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    cap.apply();
    expect(cap.getWaterSize()).toBe(80);
    cap.setWaterSize(140);
    expect(cap.getWaterSize()).toBe(140);
    cap.setWaterSize(0);
    expect(cap.getWaterSize(), "脏数据 0 会让水面退化成一个点").toBe(1);
  });

  it("菜单滑杆值域 = schema 值域（ADR-283：菜单不再是第二事实源）", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    const sliders = cap.getMenuNodes().flatMap((n) => n.children ?? []);
    const pairs = [
      ["water-level", "waterLevel"],
      ["water-size", "waterSize"],
      ["water-wetness", "waterWetness"],
      ["water-opacity", "waterOpacity"],
      ["water-normal-strength", "waterNormalStrength"],
      ["water-clarity", "waterClarity"],
      ["water-choppiness", "waterChoppiness"],
      ["water-pool-height", "waterPoolHeight"],
      ["water-pool-wall-thickness", "waterPoolWallThickness"],
      ["water-pool-roundness", "waterPoolRoundness"],
      ["water-wave-speed", "waterWaveSpeed"],
    ] as const;
    for (const [id, key] of pairs) {
      const node = sliders.find((c) => c.id === id);
      expect(node, `缺菜单节点 ${id}`).toBeDefined();
      const c = node!.control!;
      const range = getParamRange(key);
      expect({ min: c.min, max: c.max, step: c.step, unit: c.unit }, `${id} 值域应来自 schema`).toEqual(range);
    }
  });

  it("菜单 ground-water-size：form 组、跨形态无 visibleWhen、双向直连 cap", () => {
    const cap = new WaterCapability({ scene: new THREE.Scene() });
    const form = cap.getMenuNodes()[1]!;
    const size = form.children!.find((c) => c.id === "water-size");
    expect(size).toBeDefined();
    expect(size!.kind).toBe("slider");
    expect(size!.labelKey).toBe("preview.waterSize");
    expect(size!.visibleWhen, "与 ground-water-level 同款：film/pool 通用").toBeUndefined();
    size!.control!.set!(140);
    expect(cap.getWaterSize()).toBe(140);
    expect(size!.control!.get!(undefined)).toBe(140);
  });

  it("pool：size 变更零重建——10 个 mesh 与各自 geometry 全部同一实例，仅 transform 更新", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    const meshesBefore = collectMeshes(scene);
    const geosBefore = meshesBefore.map((m) => m.geometry);
    expect(meshesBefore).toHaveLength(10);

    cap.setWaterSize(40);
    const meshesAfter = collectMeshes(scene);
    expect(meshesAfter).toHaveLength(10);
    meshesAfter.forEach((m, i) => {
      expect(m, `第 ${i} 件 mesh 不应被重建`).toBe(meshesBefore[i]);
      expect(m.geometry, `第 ${i} 件 geometry 不应被重建`).toBe(geosBefore[i]);
    });

    // 连续改尺寸仍不重建（拖滑块 = 高频，这是入口得以放开的前提）
    cap.setWaterSize(300);
    collectMeshes(scene).forEach((m, i) => expect(m).toBe(meshesBefore[i]));
  });

  it("pool：尺寸几何按新边长落地——顶/底等比铺满，四壁缩放 + 外壁含壁厚偏移", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setWaterSize(120);
    const half = 60;
    const thickness = cap.getPoolWallThickness();

    const top = scene.getObjectByName("ysm-water-top") as THREE.Mesh;
    expect(top.scale.x).toBeCloseTo(120, 5);
    expect(top.scale.y).toBeCloseTo(120, 5);

    const bottom = scene.getObjectByName("ysm-water-bottom") as THREE.Mesh;
    expect(bottom.scale.x).toBeCloseTo(120, 5);
    expect(bottom.scale.y).toBeCloseTo(120, 5);

    // n 壁：法向轴 z、符号 -1；内壁 |位置| = size/2，外壁再加一个壁厚（壁厚是绝对量，不随 size 缩放）
    const innerN = scene.getObjectByName("ysm-water-wall-n-inner") as THREE.Mesh;
    expect(innerN.scale.x).toBeCloseTo(120, 5);
    expect(innerN.scale.y, "壁高 = 池深（不随 size 缩放）").toBeCloseTo(cap.getPoolHeight(), 5);
    expect(innerN.position.z).toBeCloseTo(-half, 5);
    const outerN = scene.getObjectByName("ysm-water-wall-n-outer") as THREE.Mesh;
    expect(outerN.position.z).toBeCloseTo(-(half + thickness), 5);

    // e 壁：法向轴 x（与 n/s 正交，符号 +1）
    const innerE = scene.getObjectByName("ysm-water-wall-e-inner") as THREE.Mesh;
    expect(innerE.position.x).toBeCloseTo(half, 5);
    expect(innerE.position.z).toBeCloseTo(0, 5);
  });

  it("film：size 变更走 scale，mesh 与 geometry 同一性保持（ADR-255 改造 A 回归）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const before = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const geoBefore = before.geometry;
    cap.setWaterSize(140);
    const after = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    expect(after).toBe(before);
    expect(after.geometry).toBe(geoBefore);
    expect(after.scale.x).toBeCloseTo(140, 5);
    expect(after.scale.y).toBeCloseTo(140, 5);
  });

  it("size 经菜单入口落地后，波浪 uniform 的 uSize/uHalfSize 同步（波频随世界尺寸）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const top = scene.getObjectByName("ysm-ground-water") as THREE.Mesh;
    const mat = top.material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    const live = (
      mat as unknown as {
        userData: { shader: { uniforms: { uSize: { value: number }; uHalfSize: { value: number } } } };
      }
    ).userData.shader;
    expect(live.uniforms.uSize.value).toBe(80);
    cap.setWaterSize(140);
    expect(live.uniforms.uSize.value).toBe(140);
    expect(live.uniforms.uHalfSize.value).toBe(70);
  });
});

describe("ADR-286 分派表：顺序无关性守卫", () => {
  /** 逐 mesh 快照：几何类型 / 变换 / 材质可见属性（opacity/color/transmission/thickness） */
  function snapshot(cap: WaterCapability): string {
    const out: unknown[] = [];
    cap["water"].root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      out.push({
        g: m.geometry.type,
        p: [m.position.x, m.position.y, m.position.z],
        s: [m.scale.x, m.scale.y, m.scale.z],
        o: mat.opacity,
        c: "color" in mat ? mat.color.getHex() : null,
        tr: "transmission" in mat ? mat.transmission : null,
        th: "thickness" in mat ? mat.thickness : null,
      });
    });
    return JSON.stringify(out);
  }

  const PATCH = {
    waterOpacity: 0.7,
    waterWetness: 0.6,
    waterColor: 0x112233,
    waterNormalStrength: 0.8,
    waterPoolWallColor: 0x445566,
    waterPoolRoundness: 0.3,
    waterClarity: 0.5,
    waterSize: 120,
    waterPoolHeight: 3,
    waterPoolWallThickness: 0.4,
    waterChoppiness: 1.5,
    waterLevel: 1.2,
  } as const;

  it("乱序全量 patch（单次派发）与单键逐发（正序多次）落到完全一致的渲染体", () => {
    // Run1：单键逐发（正序）——模拟旧瀑布的键序
    resetEnvState();
    const sceneA = new THREE.Scene();
    const capA = new WaterCapability({ scene: sceneA });
    capA.apply();
    capA.setWaterMode("pool");
    for (const [k, v] of Object.entries(PATCH)) {
      setEnvState({ [k]: v } as unknown as Partial<typeof envState>, { source: "manual" });
    }
    const snapA = snapshot(capA);
    capA.dispose();

    // Run2：同一终态、但一次乱序全量 patch（分派表按 changed 集合序逐键派发）
    resetEnvState();
    const sceneB = new THREE.Scene();
    const capB = new WaterCapability({ scene: sceneB });
    capB.apply();
    capB.setWaterMode("pool");
    const reversed = Object.fromEntries(Object.entries(PATCH).reverse());
    setEnvState(reversed as unknown as Partial<typeof envState>, { source: "manual" });
    const snapB = snapshot(capB);

    expect(snapB).toBe(snapA);
  });
});

describe("WaterCapability — 水面模型倒影（ADR-297）", () => {
  beforeEach(() => {
    resetEnvState();
  });

  /** 假 renderer：覆盖官方 Reflector.onBeforeRender 的渲染器触点（r185 实证清单：
   *  getRenderTarget / xr.enabled / shadowMap.autoUpdate / setRenderTarget /
   *  state.buffers.depth.setMask / autoClear / render / state.viewport） */
  function makeFakeRenderer(
    onRender: (scene: THREE.Object3D, camera: THREE.Camera) => void = () => {},
  ) {
    return {
      autoClear: true,
      xr: { enabled: false },
      shadowMap: { autoUpdate: false },
      state: { buffers: { depth: { setMask: () => {} } }, viewport: () => {} },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
      render: (scene: unknown, camera: unknown) =>
        onRender(scene as THREE.Object3D, camera as THREE.Camera),
    } as unknown as THREE.WebGLRenderer;
  }

  function makeCamera() {
    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200);
    cam.position.set(0, 8, 24);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
  }

  /** 编译水材质 shader（fake 锚点），返回其 uniforms 袋 */
  function compileTop(cap: WaterCapability) {
    const topMat = cap["water"].top.material as THREE.MeshPhysicalMaterial;
    topMat.onBeforeCompile(
      fakeShader() as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer,
    );
    return (
      topMat.userData as { shader: { uniforms: Record<string, { value: unknown }> } }
    ).shader.uniforms;
  }

  it("schema 四键默认值：总开关默认关（整场重渲不是白拿的），SSR 抑制默认开", () => {
    expect(envState.waterReflectionEnabled).toBe(false);
    expect(envState.waterReflectionStrength).toBe(0.6);
    expect(envState.waterReflectionResolution).toBe(512);
    expect(envState.waterReflectDisableWhenSSR).toBe(true);
    expect(getParamRange("waterReflectionStrength")).toMatchObject({ min: 0, max: 1 });
    expect(getParamRange("waterReflectionResolution")).toMatchObject({ min: 256, max: 2048 });
  });

  it("[锐评 F-2] clipBias 下沉 schema：默认保持 3（现观感零变化），不再是 ensureReflector 裸字面量", () => {
    expect(envState.waterReflectionClipBias).toBe(3);
    expect(getParamRange("waterReflectionClipBias")).toMatchObject({ min: 0, max: 10 });
  });

  it("[锐评 F-2] clipBias 变更 → 弃载体懒建重建（bias 烘进 Reflector 闭包，不可就地改）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.update(0.016);
    const refl1 = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    expect(refl1).toBeTruthy();
    cap.setWaterReflectionClipBias(1.5);
    cap.update(0.016);
    const refl2 = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    expect(refl2, "bias 变 → 旧载体弃、新载体懒建").toBeTruthy();
    expect(refl2).not.toBe(refl1);
    expect(refl2.getRenderTarget().width, "重建即时补挂当前分辨率（不白弃一帧）").toBe(
      envState.waterReflectionResolution,
    );
    cap.update(0.016);
    expect(cap["reflector"], "bias 未再变 → 载体幸存（防每帧重建抖动）").toBe(refl2);
  });

  it("[锐评 3.5] clipBias 死区内微变（|Δ| < 容差）→ 载体幸存不重建", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.update(0.016);
    const refl1 = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    // 默认 3 → 3.04（Δ=0.04 < 0.05 死区）：肉眼不可感的微调不应触发整场 RT 重建
    cap.setWaterReflectionClipBias(3.04);
    cap.update(0.016);
    expect(cap["reflector"]).toBe(refl1);
  });

  it("[锐评 3.5] clipBias 死区外变化（|Δ| ≥ 容差）→ 弃载体重建", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.update(0.016);
    const refl1 = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    cap.setWaterReflectionClipBias(3.1);
    cap.update(0.016);
    const refl2 = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    expect(refl2).not.toBe(refl1);
  });

  it("默认关：update 不建载体（零开销纪律，与 reflectorEnabled 默认关同门）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(), camera: makeCamera() });
    cap.apply();
    cap.update(0.016);
    expect(cap["reflector"]).toBeNull();
  });

  it("无宿主（renderer/camera 缺省）：开了也不建载体，uniform 恒 0", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    const uni = compileTop(cap);
    cap.update(0.016);
    expect(cap["reflector"]).toBeNull();
    expect(uni.uReflStrength!.value).toBe(0);
  });

  it("开启后 update：懒建载体不入场景、RT 整场渲一次、水面渲中隐藏渲后恢复、三 uniform 落地", () => {
    const scene = new THREE.Scene();
    let visibleDuringRender: boolean | null = null;
    let renderCount = 0;
    let renderCam: THREE.Camera | null = null;
    const cap = new WaterCapability({
      scene,
      renderer: makeFakeRenderer((_s, cam) => {
        renderCount += 1;
        visibleDuringRender = cap["water"].root.visible;
        renderCam = cam;
      }),
      camera: makeCamera(),
    });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    const uni = compileTop(cap);
    cap.update(0.016);
    const refl = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    expect(refl).toBeTruthy();
    expect(refl.parent, "载体不入场景：主渲染零开销、零拾取污染").toBeNull();
    expect(scene.children).not.toContain(refl);
    expect(renderCount, "每帧恰一次镜像 RT 渲染").toBe(1);
    expect(visibleDuringRender, "渲染期间水根隐藏（防自身入镜像/transmission 嵌套）").toBe(false);
    expect(cap["water"].root.visible, "渲染结束恢复可见").toBe(true);
    expect(renderCam).not.toBe(cap["camera"]);
    expect(uni.uReflTex!.value).toBe(refl.getRenderTarget().texture);
    expect(uni.uReflStrength!.value).toBeCloseTo(0.6, 5);
    expect(uni.uReflMatrix!.value, "世界→RT uv 矩阵（含官方 bias）").toBeInstanceOf(THREE.Matrix4);
    expect(refl.position.y, "镜面平面 = 水面（clip 平面跟随水位）").toBeCloseTo(envState.waterLevel, 5);
    expect(refl.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("水位 / 分辨率 / 强度逐帧现读：改 envState 下一拍即生效（单真值源，无派发依赖）", () => {
    const scene = new THREE.Scene();
    let renderCount = 0;
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(() => { renderCount += 1; }), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    const uni = compileTop(cap);
    cap.update(0.016);
    cap.setLevel(2.5);
    cap.setWaterReflectionResolution(1024);
    cap.setWaterReflectionStrength(0.9);
    cap.update(0.016);
    const refl = cap["reflector"] as NonNullable<WaterCapability["reflector"]>;
    expect(refl.position.y).toBeCloseTo(2.5, 5);
    expect(refl.getRenderTarget().width, "RT 原位扩缩，不重建载体").toBe(1024);
    expect(uni.uReflStrength!.value).toBeCloseTo(0.9, 5);
    expect(renderCount).toBe(2);
  });

  it("SSR 抑制真值表：pp 开 + 模式含 ssr → 镜像跳渲 + uniform 归零；关抑制或 envmap-only 照常", () => {
    const scene = new THREE.Scene();
    let renderCount = 0;
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(() => { renderCount += 1; }), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    const uni = compileTop(cap);
    // envmap-only：SSR 未活跃 → 倒影照常
    setEnvState({ ppEnabled: true, ppReflectionMode: "envmap-only" }, { source: "manual" });
    cap.update(0.016);
    expect(renderCount).toBe(1);
    // envmap+ssr：抑制生效（默认开）→ 跳渲 + uniform 0
    setEnvState({ ppReflectionMode: "envmap+ssr" }, { source: "manual" });
    cap.update(0.016);
    expect(renderCount, "SSR 活跃时不再整场重渲").toBe(1);
    expect(uni.uReflStrength!.value).toBe(0);
    // ssr-only 同样抑制
    setEnvState({ ppReflectionMode: "ssr-only" }, { source: "manual" });
    cap.update(0.016);
    expect(renderCount).toBe(1);
    // 关掉抑制开关 → 恢复双跑（用户显式选择，两倒影叠不叠归用户）
    cap.setWaterReflectDisableWhenSSR(false);
    cap.update(0.016);
    expect(renderCount).toBe(2);
    expect(uni.uReflStrength!.value).toBeCloseTo(0.6, 5);
    // pp 总开关关 → 无 ssr → 恢复
    cap.setWaterReflectDisableWhenSSR(true);
    setEnvState({ ppEnabled: false }, { source: "manual" });
    cap.update(0.016);
    expect(renderCount).toBe(3);
  });

  it("水面不可见（waterEnabled 关）：update 早退，倒影零渲染", () => {
    const scene = new THREE.Scene();
    let renderCount = 0;
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(() => { renderCount += 1; }), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.setWaterEnabled(false);
    cap.update(0.016);
    expect(renderCount).toBe(0);
    expect(cap["reflector"]).toBeNull();
    cap.setWaterEnabled(true);
    cap.update(0.016);
    expect(renderCount).toBe(1);
  });

  it("shader 未编译不炸：update 在 userData.shader 缺席时照常渲 RT；编译入场同一拍即重绑（零滞后）", () => {
    const scene = new THREE.Scene();
    let renderCount = 0;
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(() => { renderCount += 1; }), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    expect(() => cap.update(0.016)).not.toThrow();
    expect(renderCount).toBe(1);
    const uni = compileTop(cap);
    expect(uni.uReflTex!.value, "onBeforeCompile 补挂：镜像已在场，编译即重绑").toBeTruthy();
    expect(uni.uReflStrength!.value).toBeCloseTo(0.6, 5);
  });

  it("形态切换后载体幸存、新顶面自动重绑（reflector 与容器生命周期解耦）", () => {
    const scene = new THREE.Scene();
    let renderCount = 0;
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(() => { renderCount += 1; }), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.update(0.016);
    const reflBefore = cap["reflector"];
    cap.setWaterMode("pool");
    cap.apply();
    expect(cap["reflector"], "模式重建不动载体（RT 不白弃）").toBe(reflBefore);
    cap.update(0.016);
    const uniB = compileTop(cap);
    expect(uniB.uReflTex!.value, "新顶面材质重绑同一 RT 贴图").toBe(
      (reflBefore as NonNullable<WaterCapability["reflector"]>).getRenderTarget().texture,
    );
    expect(renderCount).toBe(2);
  });

  it("dispose 释放载体（RT/材质）且清空引用；幂等再 dispose 不炸", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene, renderer: makeFakeRenderer(), camera: makeCamera() });
    cap.apply();
    cap.setWaterReflectionEnabled(true);
    cap.update(0.016);
    expect(cap["reflector"]).toBeTruthy();
    cap.dispose();
    expect(cap["reflector"], "不入场景的载体 disposeWater 遍历不到，须具名清空").toBeNull();
    expect(() => cap.dispose()).not.toThrow();
  });

  it("shader 结构：倒影三 uniform + 斜率 varying 注入到位（fake 编译不告警 = 五锚点全命中）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    cap.apply();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const topMat = cap["water"].top.material as THREE.MeshPhysicalMaterial;
    const shader = fakeShader();
    try {
      topMat.onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        undefined as unknown as THREE.WebGLRenderer,
      );
      expect(warn, "refl 第五守卫并入后，fake 全锚点必须零告警").not.toHaveBeenCalled();
      expect(shader.vertexShader).toContain("varying vec2 vWaveSlope_wave;");
      expect(shader.vertexShader).toContain("vWaveSlope_wave = ysmWaveNormal.xy;");
      expect(shader.fragmentShader).toContain("uniform sampler2D uReflTex;");
      expect(shader.fragmentShader).toContain("uniform mat4 uReflMatrix;");
      expect(shader.fragmentShader, "混合块锚点（守卫判据）").toContain("if (uReflStrength > 0.0) {");
      expect(shader.fragmentShader, "RT 线性值过同源编码再混入已 colorspace 的底色").toContain(
        "linearToOutputTexel",
      );
      expect(shader.fragmentShader).toContain("gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);");
      expect(shader.uniforms.uReflStrength.value, "编译初值 0 = 关（开关只翻 uniform 不重编译）").toBe(0);
      expect(shader.uniforms.uReflTex.value).toBeNull();
      expect(shader.uniforms.uReflMatrix.value).toBeInstanceOf(THREE.Matrix4);
    } finally {
      warn.mockRestore();
    }
  });

  it("reflect 组树形：主开 + 四从控（强度/分辨率/裁剪偏置/SSR 抑制），从控按主开 visibleWhen 出场", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const reflect = cap.getMenuNodes()[5]!;
    expect(reflect.id).toBe("cap-group-water-reflect");
    expect(reflect.children!.map((c) => c.id)).toEqual([
      "water-reflection",
      "water-reflection-strength",
      "water-reflection-resolution",
      "water-reflection-clip-bias",
      "water-reflect-ssr-suppress",
    ]);
    const main = reflect.children![0]!;
    expect(main.visibleWhen, "主开无谓词（组头常驻）").toBeUndefined();
    const snap = (on: boolean) => ({ "env.waterReflectionEnabled": on }) as Partial<PreviewSnapshot>;
    for (const sub of reflect.children!.slice(1)) {
      expect(sub.id).not.toBe(main.id);
      expect(sub.visibleWhen?.(snap(true)), `${sub.id} 主开亮时出场`).toBe(true);
      expect(sub.visibleWhen?.(snap(false)), `${sub.id} 主开灭时隐身`).toBe(false);
    }
  });

  it("主开翻转触发 notify（visibleWhen 吃快照，dock 须重渲染）；从控键不触发", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    let hits = 0;
    const off = cap.subscribe(() => { hits += 1; });
    cap.setWaterReflectionEnabled(true);
    expect(hits).toBe(1);
    cap.setWaterReflectionStrength(0.4);
    cap.setWaterReflectionResolution(1024);
    cap.setWaterReflectDisableWhenSSR(false);
    expect(hits, "从控不涉显隐，不发通知（防拖滑块重渲染风暴）").toBe(1);
    off();
  });

  it("loadState 还原倒影五键并触发一次重建落地（suspend 纪律不破）", () => {
    const scene = new THREE.Scene();
    persistState("water", {
      waterMode: "pool",
      waterReflectionEnabled: true,
      waterReflectionStrength: 0.35,
      waterReflectionResolution: 2048,
      waterReflectionClipBias: 7.5,
      waterReflectDisableWhenSSR: false,
    });
    const cap = new WaterCapability({ scene });
    cap.loadState();
    expect(cap.getWaterReflectionEnabled()).toBe(true);
    expect(cap.getWaterReflectionStrength()).toBeCloseTo(0.35, 5);
    expect(cap.getWaterReflectionResolution()).toBe(2048);
    expect(cap.getWaterReflectionClipBias()).toBeCloseTo(7.5, 5);
    expect(cap.getWaterReflectDisableWhenSSR()).toBe(false);
    expect(isEnvCallbacksSuspended(), "suspend 计数已随 finally 归零").toBe(false);
  });
});

