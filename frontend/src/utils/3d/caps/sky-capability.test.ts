// @vitest-environment node
// ===== SkyCapability 测试（utils/3d/caps/sky-capability.ts）=====
// 覆盖：构造默认值、时间/云量/环境 IBL、启用禁用、预设、持久化、getMenuControls。
//
// 设计说明：
// - PMREMGenerator 已从构造函数延迟到 apply() 时创建，构造函数不再依赖 WebGL。
//   node 环境可直接构造，构造函数无需 mock。
// - 但 apply() 仍需要 WebGL（Sky 3D 对象 + PMREMGenerator），保留 spyOn 拦截。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import {
  SkyCapability,
  DEFAULT_SKY_PARAMS,
  MODEL_SKY_PRESETS,
  injectSkySunScalePatch,
} from "./sky-capability.ts";

// 拦截 apply（内部依赖 Sky 3D 对象 + PMREMGenerator，node 不可用）
beforeEach(() => {
  vi.spyOn(SkyCapability.prototype as unknown as { apply: () => void }, "apply").mockImplementation(() => {
    // no-op
  });
});

function makeFakeRenderer() {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean; params?: Partial<import("./sky-capability.ts").SkyParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  return new SkyCapability({ scene, renderer, params: opts.params, enabled: opts.enabled });
}

describe("SkyCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getTimeOfDay()).toBe(9);
    expect(cap.getCloudCoverage()).toBe(0);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("enabled:false 初始禁用", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { timeOfDay: 15, cloudCoverage: 0.5, environment: false } });
    expect(cap.getTimeOfDay()).toBe(15);
    expect(cap.getCloudCoverage()).toBe(0.5);
    expect(cap.isEnvironmentEnabled()).toBe(false);
  });
});

describe("SkyCapability — 时间控制", () => {
  it("setTime 设置时间（0-24 循环）", () => {
    const cap = newCap();
    cap.setTime(12);
    expect(cap.getTimeOfDay()).toBe(12);
    cap.setTime(6);
    expect(cap.getTimeOfDay()).toBe(6);
  });

  it("setTime 超范围取模（25→1, -1→23）", () => {
    const cap = newCap();
    cap.setTime(25);
    expect(cap.getTimeOfDay()).toBe(1);
    cap.setTime(-1);
    expect(cap.getTimeOfDay()).toBe(23);
  });
});

describe("SkyCapability — 云量控制", () => {
  it("setCloudCoverage 设置云量（0~1 clamp）", () => {
    const cap = newCap();
    cap.setCloudCoverage(0.5);
    expect(cap.getCloudCoverage()).toBe(0.5);
    cap.setCloudCoverage(1.5);
    expect(cap.getCloudCoverage()).toBe(1);
    cap.setCloudCoverage(-0.5);
    expect(cap.getCloudCoverage()).toBe(0);
  });
});

describe("SkyCapability — 环境 IBL 开关", () => {
  it("setEnvironmentEnabled 切换", () => {
    const cap = newCap();
    expect(cap.isEnvironmentEnabled()).toBe(true);
    cap.setEnvironmentEnabled(false);
    expect(cap.isEnvironmentEnabled()).toBe(false);
    cap.setEnvironmentEnabled(true);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("setEnvironmentEnabled 经注入的 caps 查询器通知 light 刷新 ambient（双间接光协调）", () => {
    const scene = new THREE.Scene();
    const refreshAmbientFromSky = vi.fn();
    const cap = new SkyCapability({
      scene,
      renderer: makeFakeRenderer(),
      caps: {
        getById: (id: string) =>
          id === "light" ? ({ refreshAmbientFromSky } as never) : undefined,
      },
    });
    cap.setEnvironmentEnabled(false);
    expect(refreshAmbientFromSky).toHaveBeenCalledTimes(1);
    cap.setEnvironmentEnabled(true);
    expect(refreshAmbientFromSky).toHaveBeenCalledTimes(2);
  });
});

describe("SkyCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("SkyCapability — 预设", () => {
  it("setPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    // vrm 预设覆盖 turbidity/exposure 等
    expect(cap.isEnabled()).toBe(true);
    cap.setPreset("mmd");
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("SkyCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ params: { timeOfDay: 15, cloudCoverage: 0.3, environment: false } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getTimeOfDay()).toBe(15);
    expect(cap2.getCloudCoverage()).toBe(0.3);
    expect(cap2.isEnvironmentEnabled()).toBe(false);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { timeOfDay: 18 } });
    cap.loadState();
    expect(cap.getTimeOfDay()).toBe(18);
  });

  it("saveState↔loadState 字段对齐：7 字段单次 round-trip 全还原（防 saveState/loadState 漂移）", () => {
    // 锁「saveState 存了哪些字段，loadState 必须全恢复」——任一方向漏字段在此必现
    const cap = newCap({
      params: { timeOfDay: 16, cloudCoverage: 0.4, environment: false, sunIntensityScale: 0.7, sunDiscScale: 0.55 },
      enabled: false,
    });
    cap.setGodRaysEnabled(true);
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getTimeOfDay()).toBe(16);
    expect(cap2.getCloudCoverage()).toBeCloseTo(0.4, 4);
    expect(cap2.isEnvironmentEnabled()).toBe(false);
    expect(cap2.isEnabled()).toBe(false);
    expect(cap2.isGodRaysEnabled()).toBe(true);
    const p = cap2.getParams();
    expect(p.sunIntensityScale).toBeCloseTo(0.7, 4);
    expect(p.sunDiscScale).toBeCloseTo(0.55, 4);
  });
});

describe("SkyCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(3);
    // 时间滑块
    const timeCtrl = controls.find((c) => c.id === "sky-time");
    expect(timeCtrl).toBeDefined();
    expect(timeCtrl!.kind).toBe("slider");
    expect(timeCtrl!.slider?.unit).toBe("h");
    expect(timeCtrl!.getValue()).toBe(9);
    // 云量滑块
    const cloudCtrl = controls.find((c) => c.id === "sky-cloud");
    expect(cloudCtrl).toBeDefined();
    expect(cloudCtrl!.kind).toBe("slider");
    expect(cloudCtrl!.slider?.unit).toBe("%");
    // 环境贴图开关
    const envCtrl = controls.find((c) => c.id === "sky-env");
    expect(envCtrl).toBeDefined();
    expect(envCtrl!.kind).toBe("toggle");
    expect(envCtrl!.getValue()).toBe(true);
  });

  it("控件操作同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    // 时间滑块
    const timeCtrl = controls.find((c) => c.id === "sky-time")!;
    timeCtrl.setValue(18);
    expect(cap.getTimeOfDay()).toBe(18);
    expect(timeCtrl.getValue()).toBe(18);
    // 环境贴图开关
    const envCtrl = controls.find((c) => c.id === "sky-env")!;
    envCtrl.setValue(false);
    expect(cap.isEnvironmentEnabled()).toBe(false);
    envCtrl.setValue(true);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("非主控件均含 group 字段（云量/环境贴图/昼夜循环）", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    // sky-time/sky-timeline 是顶层主控件，无 group；其余控件必须含 group 且以 preview.sky 开头
    controls.filter((c) => c.id !== "sky-time" && c.id !== "sky-timeline").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.sky")).toBe(true);
    });
  });
});

describe("SkyCapability — 预设数据完整性", () => {
  it("DEFAULT_SKY_PARAMS 默认值完整", () => {
    expect(DEFAULT_SKY_PARAMS.timeOfDay).toBe(9);
    expect(typeof DEFAULT_SKY_PARAMS.elevation).toBe("number");
    expect(typeof DEFAULT_SKY_PARAMS.turbidity).toBe("number");
    expect(typeof DEFAULT_SKY_PARAMS.cloudCoverage).toBe("number");
    expect(DEFAULT_SKY_PARAMS.scale).toBeGreaterThan(0);
  });

  it("MODEL_SKY_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "vrm", "mmd", "mmd-scene", "ysm", "litematic"];
    for (const t of expectedTypes) {
      expect(MODEL_SKY_PRESETS[t]).toBeDefined();
    }
  });
});

describe("SkyCapability — God Rays（体积光束）", () => {
  it("初始 godRaysEnabled=false", () => {
    const cap = newCap();
    expect(cap.isGodRaysEnabled()).toBe(false);
  });

  it("setGodRaysEnabled 切换", () => {
    const cap = newCap();
    cap.setGodRaysEnabled(true);
    expect(cap.isGodRaysEnabled()).toBe(true);
    cap.setGodRaysEnabled(false);
    expect(cap.isGodRaysEnabled()).toBe(false);
  });

  it("getGodRaysIntensity: elevation=-10 → 1", () => {
    const cap = newCap({ params: { elevation: -10 } });
    expect(cap.getGodRaysIntensity()).toBe(1);
  });

  it("getGodRaysIntensity: elevation=10 → ~0.33", () => {
    const cap = newCap({ params: { elevation: 10 } });
    expect(cap.getGodRaysIntensity()).toBeCloseTo(0.33, 1);
  });

  it("getGodRaysIntensity: elevation=20 → 0", () => {
    const cap = newCap({ params: { elevation: 20 } });
    expect(cap.getGodRaysIntensity()).toBe(0);
  });

  it("getGodRaysIntensity: elevation=-20 → 1", () => {
    const cap = newCap({ params: { elevation: -20 } });
    expect(cap.getGodRaysIntensity()).toBe(1);
  });

  it("setTime(sunset=18) 时 intensity>0", () => {
    const cap = newCap();
    cap.setTime(18);
    // 日落时 intensity 应 > 0
    expect(cap.getGodRaysIntensity()).toBeGreaterThan(0);
  });

  it("setTime(noon=12) 时 intensity=0", () => {
    const cap = newCap();
    cap.setTime(12);
    // 正午 elevation 应 > 20°, intensity=0
    expect(cap.getGodRaysIntensity()).toBe(0);
  });

  it("getMenuControls 包含 sky-godrays toggle", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const godraysCtrl = controls.find((c) => c.id === "sky-godrays");
    expect(godraysCtrl).toBeDefined();
    expect(godraysCtrl!.kind).toBe("toggle");
    expect(godraysCtrl!.getValue()).toBe(false);
  });

  it("saveState/loadState 持久化 godRaysEnabled", () => {
    const cap = newCap({ params: { timeOfDay: 18 } });
    cap.setGodRaysEnabled(true);
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isGodRaysEnabled()).toBe(true);
  });
});

describe("SkyCapability — Sunset Tint Overlay", () => {
  it("构造时自动创建 sunsetTintMesh，geometry 是 PlaneGeometry", () => {
    const cap = newCap();
    const mesh = (cap as unknown as { sunsetTintMesh: THREE.Mesh | null }).sunsetTintMesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh!.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    // 初始未挂载
    expect(mesh!.parent).toBeNull();
    expect(mesh!.visible).toBe(false);
  });

  it("getSunsetTintIntensity 与 getGodRaysIntensity 返回相同值（复用同一段逻辑）", () => {
    const cap = newCap({ params: { elevation: -10 } });
    const tintIntensity = (cap as unknown as { getSunsetTintIntensity: () => number }).getSunsetTintIntensity();
    const godRaysIntensity = cap.getGodRaysIntensity();
    expect(tintIntensity).toBe(godRaysIntensity);

    // 通过 setTime 间接设置 elevation
    cap.setTime(10); // 上午，elevation 约 28°
    expect((cap as unknown as { getSunsetTintIntensity: () => number }).getSunsetTintIntensity()).toBe(
      cap.getGodRaysIntensity()
    );
  });

  it("setTime(18) 时 sunsetTint intensity > 0", () => {
    const cap = newCap();
    cap.setTime(18);
    expect((cap as unknown as { getSunsetTintIntensity: () => number }).getSunsetTintIntensity()).toBeGreaterThan(0);
  });

  it("setTime(12) 时 sunsetTint intensity = 0", () => {
    const cap = newCap();
    cap.setTime(12);
    expect((cap as unknown as { getSunsetTintIntensity: () => number }).getSunsetTintIntensity()).toBe(0);
  });

  it("saveState/loadState 不存 tint（tint 完全由时间驱动，无需持久化）", () => {
    const cap = newCap({ params: { timeOfDay: 18 } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    // tint 不持久化，由时间重新计算
    expect(cap2.getTimeOfDay()).toBe(18);
    expect((cap2 as unknown as { getSunsetTintIntensity: () => number }).getSunsetTintIntensity()).toBeGreaterThan(
      0
    );
  });

  it("godRays 关闭时 tint mesh 不挂载", () => {
    const cap = newCap();
    cap.setGodRaysEnabled(false);
    cap.setTime(18);
    const mesh = (cap as unknown as { sunsetTintMesh: THREE.Mesh | null }).sunsetTintMesh;
    expect(mesh?.parent).toBeNull();
  });
});

// ============ §4 解耦：sunIntensityScale / sunDiscScale 从 Preetham 里把天空色与太阳亮度解耦 ============
describe("SkyCapability — SkyParams 太阳耦合解耦参数", () => {
  it("DEFAULT_SKY_PARAMS 包含解耦参数且默认值合理", () => {
    expect(DEFAULT_SKY_PARAMS.sunIntensityScale).toBeDefined();
    expect(DEFAULT_SKY_PARAMS.sunDiscScale).toBeDefined();
    // 正午天空底色耦合从 1000^2 压到 750^2 ≈ 削 44%
    expect(DEFAULT_SKY_PARAMS.sunIntensityScale).toBeGreaterThan(0.5);
    expect(DEFAULT_SKY_PARAMS.sunIntensityScale).toBeLessThan(1.0);
    // 太阳盘 19M 亮度砍半，保留辨识度但不炸屏
    expect(DEFAULT_SKY_PARAMS.sunDiscScale).toBeGreaterThan(0.2);
    expect(DEFAULT_SKY_PARAMS.sunDiscScale).toBeLessThanOrEqual(1.0);
  });

  it("MODEL_SKY_PRESETS 全部 6 类预设均携带解耦参数（统一默认，不丢失差异）", () => {
    const all = ["default", "vrm", "mmd", "mmd-scene", "ysm", "litematic"];
    for (const k of all) {
      const preset = MODEL_SKY_PRESETS[k];
      // 必须存在（预设 k 已定义）
      expect(preset).toBeDefined();
      // 每个预设显式携带 sunIntensityScale / sunDiscScale（显式意图，不依赖 DEFAULT 兜底 undefined）
      expect(typeof preset!.sunIntensityScale).toBe("number");
      expect(typeof preset!.sunDiscScale).toBe("number");
    }
  });

  it("构造函数 params 覆盖解耦参数且通过 getter 可读", () => {
    const cap = newCap({ params: { sunIntensityScale: 0.6, sunDiscScale: 0.35 } });
    const params = cap.getParams();
    expect(params.sunIntensityScale).toBeCloseTo(0.6, 4);
    expect(params.sunDiscScale).toBeCloseTo(0.35, 4);
  });

  it("saveState/loadState 正确持久化解耦参数（不归因于「时间」或「预设」，用户可调）", () => {
    const cap1 = newCap({ params: { sunIntensityScale: 0.62, sunDiscScale: 0.42 } });
    cap1.saveState();
    const cap2 = newCap();
    cap2.loadState();
    const params = cap2.getParams();
    expect(params.sunIntensityScale).toBeCloseTo(0.62, 4);
    expect(params.sunDiscScale).toBeCloseTo(0.42, 4);
  });
});

// ============ injectSkySunScalePatch：给官方 Preetham Sky shader 追加解耦 uniforms ============
describe("injectSkySunScalePatch — 运行时 shader 解耦注入（最小 patch，不越 ADR-073 红线）", () => {

  it("注入后 uniforms 新增 sunIntensityScale / sunDiscScale 两项且默认值匹配 DEFAULT", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    expect(mat.uniforms.sunIntensityScale).toBeDefined();
    expect(mat.uniforms.sunDiscScale).toBeDefined();
    expect(mat.uniforms.sunIntensityScale.value).toBeCloseTo(DEFAULT_SKY_PARAMS.sunIntensityScale, 3);
    expect(mat.uniforms.sunDiscScale.value).toBeCloseTo(DEFAULT_SKY_PARAMS.sunDiscScale, 3);
  });

  it("注入后 fragment shader 声明了两个 uniform（防止 GLSL 编译未声明报错）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    // patch 前没有
    expect(mat.fragmentShader.includes("sunIntensityScale")).toBe(false);
    injectSkySunScalePatch(mat);
    // patch 后声明存在
    expect(mat.fragmentShader).toMatch(/uniform\s+float\s+sunIntensityScale\s*;/);
    expect(mat.fragmentShader).toMatch(/uniform\s+float\s+sunDiscScale\s*;/);
  });

  it("解耦点 ①：天空底色 Lin 的 vSunE 被 sunIntensityScale 缩放（切断 vSunE² 对天空色的绑架）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    // 原 shader L261: pow( vSunE * (
    // 替换后:    pow( (vSunE * sunIntensityScale) * (
    expect(mat.fragmentShader).toMatch(/vSunE\s*\*\s*sunIntensityScale/);
    // 不丢原有的物理模型内容：(1.0 - Fex) 和 ^1.5 依然存在
    expect(mat.fragmentShader).toMatch(/1\.0\s*-\s*Fex/);
    expect(mat.fragmentShader).toMatch(/vec3\(\s*1\.5\s*\)/);
  });

  it("解耦点 ②：太阳盘白光被 sunDiscScale 缩放（切断 19M 白光炸弹）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    // 原 shader L272: ( vSunE * 19000.0 * Fex ) * sundisc;
    // 替换后:    ( vSunE * 19000.0 * sunDiscScale * Fex ) * sundisc;
    expect(mat.fragmentShader).toMatch(/19000\.0\s*\*\s*sunDiscScale\s*\*\s*Fex/);
  });

  it("幂等：重复调用不会重复注入声明 / 重复乘法（避免 19000.0 * sunDiscScale * sunDiscScale 叠乘）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    const shaderOnce = mat.fragmentShader;
    const uniformCountOnce = Object.keys(mat.uniforms).length;
    injectSkySunScalePatch(mat);
    injectSkySunScalePatch(mat);
    // shader 字符串完全一致（无重复注入）
    expect(mat.fragmentShader).toBe(shaderOnce);
    // uniforms 数量不变（没有重复新建 uniform）
    expect(Object.keys(mat.uniforms).length).toBe(uniformCountOnce);
    // 只出现一次 19000.0 * sunDiscScale
    const matches = mat.fragmentShader.match(/19000\.0\s*\*\s*sunDiscScale/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("setter 更新值只改 uniforms.value，不重编译 shader（needsUpdate=false）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    const shaderBefore = mat.fragmentShader;
    mat.needsUpdate = false;
    // 手动改 uniforms.value （将来 applySky 里同步时也是这么做）
    mat.uniforms.sunIntensityScale.value = 0.55;
    mat.uniforms.sunDiscScale.value = 0.28;
    expect(mat.uniforms.sunIntensityScale.value).toBeCloseTo(0.55, 4);
    expect(mat.uniforms.sunDiscScale.value).toBeCloseTo(0.28, 4);
    // shader 不变，无重编译（Three ShaderMaterial 初始 needsUpdate 为 undefined，不应被置 true 触发重编）
    expect(mat.fragmentShader).toBe(shaderBefore);
    expect(mat.needsUpdate).toBeFalsy();
  });
});