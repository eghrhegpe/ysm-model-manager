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
import { WATER_PARAM_APPLIER_KEYS } from "./water-capability.ts";
import { persistState } from "./scene-capability.ts";
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

  it("getMenuNodes：enabled 平铺 toggle + 4 组 folder", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(5);
    expect(nodes[0].id).toBe("water-enabled");
    expect(nodes.slice(1).map((n) => n.kind)).toEqual(["folder", "folder", "folder", "folder"]);
    expect(nodes.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.waterGroupForm",
      "preview.waterGroupLook",
      "preview.waterGroupPool",
      "preview.waterGroupWave",
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

  it("15 项控件 setValue/getValue 双向读写联动（数量与树一致）", () => {
    const scene = new THREE.Scene();
    const cap = new WaterCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(countControls(nodes)).toBe(15);
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
    expect(nodes[0]!.id).toBe("water-enabled");
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

