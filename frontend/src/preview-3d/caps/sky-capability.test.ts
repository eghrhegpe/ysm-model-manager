// ===== SkyCapability 测试（preview-3d/caps/sky-capability.ts）=====
// 覆盖：构造默认值、时间/云量/环境 IBL、启用禁用、预设、持久化、getMenuControls、
// apply 完整管线（Fake PMREM）、regenerateEnvironment 失败兜底、god rays 挂载、昼夜循环。
//
// 设计说明：
// - Sky 构造纯数据对象（BoxGeometry + ShaderMaterial），不依赖 WebGL，node 可构造。
// - apply() 的 PMREMGenerator.fromScene 经 per-file vi.mock 提供 Fake（带 dispose），
//   happy-dom 下 requestAnimationFrame 可驱动昼夜循环，其余 three 导出取 actual。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import {
  SkyCapability,
  MODEL_SKY_PRESETS,
  injectSkySunScalePatch,
} from "./sky-capability.ts";
import { envState, resetEnvState, setEnvState } from "../state/env-state.ts";
import { clearEnvCallbacks } from "../state/env-dispatcher.ts";
import type { SceneCapability } from "./scene-capability.ts";

// ADR-196 单例化：SkyCapability 构造即注册 envState 回调（dispatch 广播），
// 测试若不清理，残留实例会响应后续 setEnvState/update 的派发（fromScene 计数污染）。
// 每个测试后清空回调注册表，保证 dispatch 只达当前测试的 cap。
afterEach(() => {
  clearEnvCallbacks();
});

// PMREMGenerator 扩展 mock：fromScene 返回带 dispose 的对象（真实返回 WebGLRenderTarget），
// 否则 regenerateEnvironment 二次调用 dispose 旧 RT 时 TypeError
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    domElement = document.createElement("div");
    setSize(): void {}
    setPixelRatio(): void {}
    render(): void {}
    dispose(): void {}
    getContext(): null { return null; }
  }
  class FakePMREMGenerator {
    fromScene(): { texture: THREE.Texture; dispose: () => void } {
      return { texture: new actual.Texture(), dispose: () => {} };
    }
    dispose(): void {}
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof actual.WebGLRenderer,
    PMREMGenerator: FakePMREMGenerator as unknown as typeof actual.PMREMGenerator,
  };
});

/** 环形日志注入点监听（ringLog 走 __ysmRingLog，console 仅兜底） */
function spyRingLog() {
  const calls: Array<{ mod: string; msg: string; lvl: string | undefined }> = [];
  (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog = (
    mod: string,
    msg: string,
    lvl?: string,
  ) => calls.push({ mod, msg, lvl });
  return {
    calls,
    expectLogged(mod: string, msgPart: string) {
      expect(calls.some((c) => c.mod === mod && c.msg.includes(msgPart))).toBe(true);
    },
    restore() {
      delete (globalThis as { __ysmRingLog?: unknown }).__ysmRingLog;
    },
  };
}

function makeFakeRenderer(overrides: { toneMapping?: THREE.ToneMapping; toneMappingExposure?: number } = {}) {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: overrides.toneMapping ?? THREE.ACESFilmicToneMapping,
    toneMappingExposure: overrides.toneMappingExposure ?? 1,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  const cap = new SkyCapability({
    scene,
    renderer,
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
  return cap;
}

describe("SkyCapability — 构造与默认值", () => {
  beforeEach(() => { resetEnvState(); });

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

  it("setEnvState 覆盖生效", () => {
    setEnvState({ skyTimeOfDay: 15, skyCloudCoverage: 0.5, skyEnvironment: false }, { source: 'manual' });
    const cap = newCap();
    expect(cap.getTimeOfDay()).toBe(15);
    expect(cap.getCloudCoverage()).toBe(0.5);
    expect(cap.isEnvironmentEnabled()).toBe(false);
  });
});

describe("SkyCapability — 时间控制", () => {
  beforeEach(() => { resetEnvState(); });

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
  beforeEach(() => { resetEnvState(); });

  it("setCloudCoverage 设置云量（0~1 clamp）", () => {
    const cap = newCap();
    cap.setCloudCoverage(0.5);
    expect(cap.getCloudCoverage()).toBe(0.5);
    cap.setCloudCoverage(1.5);
    expect(cap.getCloudCoverage()).toBe(1);
    cap.setCloudCoverage(-0.5);
    expect(cap.getCloudCoverage()).toBe(0);
  });

  it("setCloudCoverage(regenerate=false) 不触发 PMREM 重建（changed 集判定回归锚）", () => {
    // code_review 57aeefdb4 #5/#6/#8/#10（P2）回归锁：callback 云量分支曾读粘滞的
    // skyForceEnv（默认 true + 手动 setSun 置 true 从不复位）→ regenerate=false 的
    // 云量滑块拖动每 tick 全量 PMREM 烘焙（GPU 熔炉）；改 changed.has("skyForceEnv")
    // 判定后仅 regenerate=true 的派发携带该键才重建
    const cap = newCap();
    const spy = vi
      .spyOn(cap as unknown as { regenerateEnvironment: () => void }, "regenerateEnvironment")
      .mockImplementation(() => {});
    cap.setSun(30, 200); // 置 skyForceEnv=true（粘滞场景：旧实现此处会污染后续云量判定）
    spy.mockClear();
    cap.setCloudCoverage(0.5); // 默认 regenerate=false
    expect(spy).not.toHaveBeenCalled();
    cap.setCloudCoverage(0.7, true); // regenerate=true → 恰好一次重建
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("SkyCapability — 环境 IBL 开关", () => {
  beforeEach(() => { resetEnvState(); });

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
          id === "light" ? ({ refreshAmbientFromSky } as unknown as SceneCapability) : undefined,
      },
    });
    cap.setEnvironmentEnabled(false);
    expect(refreshAmbientFromSky).toHaveBeenCalledTimes(1);
    cap.setEnvironmentEnabled(true);
    expect(refreshAmbientFromSky).toHaveBeenCalledTimes(2);
  });
});

describe("SkyCapability — 启用/禁用", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("SkyCapability — 预设", () => {
  beforeEach(() => { resetEnvState(); });

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
  beforeEach(() => { localStorage.clear(); resetEnvState(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    setEnvState({ skyTimeOfDay: 15, skyCloudCoverage: 0.3, skyEnvironment: false }, { source: 'manual' });
    const cap = newCap();
    cap.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getTimeOfDay()).toBe(15);
    expect(cap2.getCloudCoverage()).toBe(0.3);
    expect(cap2.isEnvironmentEnabled()).toBe(false);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap();
    cap.loadState();
    expect(cap.getTimeOfDay()).toBe(9);
  });

  it("saveState↔loadState 字段对齐：7 字段单次 round-trip 全还原（防 saveState/loadState 漂移）", () => {
    setEnvState({
      skyTimeOfDay: 16,
      skyCloudCoverage: 0.4,
      skyEnvironment: false,
      skySunIntensityScale: 0.7,
      skySunDiscScale: 0.55,
    }, { source: 'manual' });
    const cap = newCap();
    cap.setEnabled(false);
    cap.setGodRaysEnabled(true);
    cap.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getTimeOfDay()).toBe(16);
    expect(cap2.getCloudCoverage()).toBeCloseTo(0.4, 4);
    expect(cap2.isEnvironmentEnabled()).toBe(false);
    expect(cap2.isEnabled()).toBe(false);
    expect(cap2.isGodRaysEnabled()).toBe(true);
    expect(cap2.getParams().sunIntensityScale).toBeCloseTo(0.7, 4);
    expect(cap2.getParams().sunDiscScale).toBeCloseTo(0.55, 4);
  });
});

describe("SkyCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => { resetEnvState(); });

  it("基座级节点平铺 + 高级 folder（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 0: timeline controls 通道
    expect(nodes[0]!.kind).toBe("controls");
    // 1: sky-time slider 平铺
    expect(nodes[1]!.id).toBe("sky-time");
    expect(nodes[1]!.kind).toBe("slider");
    // 2: sky-env toggle 平铺
    expect(nodes[2]!.id).toBe("sky-env");
    expect(nodes[2]!.kind).toBe("toggle");
    // 3: 高级 folder
    const folder = nodes[3]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.skyGroupAdvanced");
    const childIds = folder.children!.map((c) => c.id);
    expect(childIds).toContain("sky-cloud");
    expect(childIds).toContain("sky-sun-intensity");
    expect(childIds).toContain("sky-sun-disc");
    expect(childIds).toContain("sky-auto-rotate");
    expect(childIds).toContain("sky-godrays");
  });

  it("控件操作同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const timeNode = nodes[1]!;
    timeNode.control!.set!(18);
    expect(cap.getTimeOfDay()).toBe(18);
    expect(timeNode.control!.get!(undefined)).toBe(18);
    const envNode = nodes[2]!;
    envNode.control!.set!(false);
    expect(cap.isEnvironmentEnabled()).toBe(false);
    envNode.control!.set!(true);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("时间轴控件与云量滑块联动状态（controls 通道 + 高级 folder，节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const tlNode = nodes[0]!;
    const tl = (typeof tlNode.controls === "function" ? tlNode.controls() : tlNode.controls)![0]!;
    tl.setValue(20);
    expect(cap.getTimeOfDay()).toBe(20);
    expect(tl.getValue()).toBe(20);
    const folder = nodes[3]!;
    const cloudNode = folder.children!.find((c) => c.id === "sky-cloud")!;
    cloudNode.control!.set!(0.8);
    expect(cap.getCloudCoverage()).toBe(0.8);
  });

  it("太阳耦合滑块与昼夜循环控件联动（高级 folder，节点 control 闭包）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[3]!;
    const intensityNode = folder.children!.find((c) => c.id === "sky-sun-intensity")!;
    intensityNode.control!.set!(1.1);
    expect(cap.getSunIntensityScale()).toBe(1.1);
    expect(intensityNode.control!.get!(undefined)).toBe(1.1);
    const discNode = folder.children!.find((c) => c.id === "sky-sun-disc")!;
    discNode.control!.set!(0.3);
    expect(cap.getSunDiscScale()).toBe(0.3);
    const rotateNode = folder.children!.find((c) => c.id === "sky-auto-rotate")!;
    rotateNode.control!.set!(true);
    expect(cap.isAutoRotating()).toBe(true);
    expect(rotateNode.control!.get!(undefined)).toBe(true);
    rotateNode.control!.set!(false);
    expect(cap.isAutoRotating()).toBe(false);
    const godraysNode = folder.children!.find((c) => c.id === "sky-godrays")!;
    godraysNode.control!.set!(true);
    expect(cap.isGodRaysEnabled()).toBe(true);
    expect(godraysNode.control!.get!(undefined)).toBe(true);
  });
});

describe("SkyCapability — 预设数据完整性", () => {
  beforeEach(() => { resetEnvState(); });

  it("envState 默认值完整", () => {
    expect(envState.skyTimeOfDay).toBe(9);
    expect(typeof envState.skyElevation).toBe("number");
    expect(typeof envState.skyTurbidity).toBe("number");
    expect(typeof envState.skyCloudCoverage).toBe("number");
    expect(envState.skyScale).toBeGreaterThan(0);
  });

  it("MODEL_SKY_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "vrm", "mmd", "mmd-scene", "ysm", "litematic"];
    for (const t of expectedTypes) {
      expect(MODEL_SKY_PRESETS[t]).toBeDefined();
    }
  });
});

describe("SkyCapability — God Rays（体积光束）", () => {
  beforeEach(() => { resetEnvState(); });

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
    setEnvState({ skyElevation: -10 }, { source: 'manual' });
    const cap = newCap();
    expect(cap.getGodRaysIntensity()).toBe(1);
  });

  it("getGodRaysIntensity: elevation=10 → ~0.33", () => {
    setEnvState({ skyElevation: 10 }, { source: 'manual' });
    const cap = newCap();
    expect(cap.getGodRaysIntensity()).toBeCloseTo(0.33, 1);
  });

  it("getGodRaysIntensity: elevation=20 → 0", () => {
    setEnvState({ skyElevation: 20 }, { source: 'manual' });
    const cap = newCap();
    expect(cap.getGodRaysIntensity()).toBe(0);
  });

  it("getGodRaysIntensity: elevation=-20 → 1", () => {
    setEnvState({ skyElevation: -20 }, { source: 'manual' });
    const cap = newCap();
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

  it("getMenuNodes 包含 sky-godrays toggle（高级 folder）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[3]!;
    const godraysNode = folder.children!.find((c) => c.id === "sky-godrays")!;
    expect(godraysNode).toBeDefined();
    expect(godraysNode.kind).toBe("toggle");
    expect(godraysNode.control!.get!(undefined)).toBe(false);
  });

  it("saveState/loadState 持久化 godRaysEnabled", () => {
    setEnvState({ skyTimeOfDay: 18 }, { source: 'manual' });
    const cap = newCap();
    cap.setGodRaysEnabled(true);
    cap.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isGodRaysEnabled()).toBe(true);
  });
});

describe("SkyCapability — Sunset Tint Overlay", () => {
  beforeEach(() => { resetEnvState(); });

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
    setEnvState({ skyElevation: -10 }, { source: 'manual' });
    const cap = newCap();
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
    setEnvState({ skyTimeOfDay: 18 }, { source: 'manual' });
    const cap = newCap();
    cap.saveState();
    resetEnvState();
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
  beforeEach(() => { resetEnvState(); });

  it("envState 包含解耦参数且默认值合理", () => {
    expect(envState.skySunIntensityScale).toBeDefined();
    expect(envState.skySunDiscScale).toBeDefined();
    // 正午天空底色耦合从 1000^2 压到 750^2 ≈ 削 44%
    expect(envState.skySunIntensityScale).toBeGreaterThan(0.5);
    expect(envState.skySunIntensityScale).toBeLessThan(1.0);
    // 太阳盘 19M 亮度砍半，保留辨识度但不炸屏
    expect(envState.skySunDiscScale).toBeGreaterThan(0.2);
    expect(envState.skySunDiscScale).toBeLessThanOrEqual(1.0);
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

  it("setEnvState 覆盖解耦参数且通过 getter 可读", () => {
    setEnvState({ skySunIntensityScale: 0.6, skySunDiscScale: 0.35 }, { source: 'manual' });
    const cap = newCap();
    const params = cap.getParams();
    expect(params.sunIntensityScale).toBeCloseTo(0.6, 4);
    expect(params.sunDiscScale).toBeCloseTo(0.35, 4);
  });

  it("saveState/loadState 正确持久化解耦参数（不归因于「时间」或「预设」，用户可调）", () => {
    setEnvState({ skySunIntensityScale: 0.62, skySunDiscScale: 0.42 }, { source: 'manual' });
    const cap1 = newCap();
    cap1.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    const params = cap2.getParams();
    expect(params.sunIntensityScale).toBeCloseTo(0.62, 4);
    expect(params.sunDiscScale).toBeCloseTo(0.42, 4);
  });
});

// ============ injectSkySunScalePatch：给官方 Preetham Sky shader 追加解耦 uniforms ============
describe("injectSkySunScalePatch — 运行时 shader 解耦注入（最小 patch，不越 ADR-073 红线）", () => {
  beforeEach(() => { resetEnvState(); });

  it("注入后 uniforms 新增 sunIntensityScale / sunDiscScale 两项且默认值匹配 envState", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    expect(mat.uniforms.sunIntensityScale).toBeDefined();
    expect(mat.uniforms.sunDiscScale).toBeDefined();
    expect(mat.uniforms.sunIntensityScale.value).toBeCloseTo(envState.skySunIntensityScale, 3);
    expect(mat.uniforms.sunDiscScale.value).toBeCloseTo(envState.skySunDiscScale, 3);
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

  it("幂等分支：已注入时仅同步默认值到 uniforms，不改 shader", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat, { sunIntensityScale: 0.6, sunDiscScale: 0.4 });
    const shaderBefore = mat.fragmentShader;
    // 第二次调用走幂等早退分支：只覆盖 uniforms.value
    injectSkySunScalePatch(mat, { sunIntensityScale: 0.9, sunDiscScale: 0.8 });
    expect(mat.fragmentShader).toBe(shaderBefore);
    expect(mat.uniforms.sunIntensityScale.value).toBe(0.9);
    expect(mat.uniforms.sunDiscScale.value).toBe(0.8);
  });

  it("半残状态修复：uniform 已注册但 sunDiscScale 乘法缺失 → 二次调用补全乘法（不分字段整体早退）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    // 模拟半残：乘法层被外部改动抹掉（回到无 sunDiscScale 的原始形态），但 uniform 仍注册
    expect(mat.fragmentShader).toMatch(/19000\.0 \* sunDiscScale \* Fex/);
    mat.fragmentShader = mat.fragmentShader.replace(
      "19000.0 * sunDiscScale * Fex",
      "19000.0 * Fex",
    );
    expect(mat.fragmentShader).not.toMatch(/19000\.0 \* sunDiscScale \* Fex/);
    // 二次调用：分字段守卫检测到 sunDiscScale uniform 在但乘法缺失 → 补全乘法而非整体早退
    injectSkySunScalePatch(mat);
    expect(mat.fragmentShader).toMatch(/19000\.0 \* sunDiscScale \* Fex/);
  });

  it("半残状态修复：sunIntensityScale 乘法缺失 → 二次调用补全（同理分字段）", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    expect(mat.fragmentShader).toMatch(/vSunE \* sunIntensityScale/);
    mat.fragmentShader = mat.fragmentShader.replace(
      "pow( (vSunE * sunIntensityScale) * (",
      "pow( vSunE * (",
    );
    expect(mat.fragmentShader).not.toMatch(/vSunE \* sunIntensityScale/);
    injectSkySunScalePatch(mat);
    expect(mat.fragmentShader).toMatch(/vSunE \* sunIntensityScale/);
  });

  it("乘法锚点彻底失配（文字被改）→ console.error 留痕不再静默，且不产生半残声明", () => {
    const log = spyRingLog();
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    injectSkySunScalePatch(mat);
    // 彻底破坏两个乘法锚点（模拟 Three 未来重构表达式），uniform 保留在对象层
    mat.fragmentShader = mat.fragmentShader
      .replace("pow( (vSunE * sunIntensityScale) * (", "pow( vSunE_Lin * (")
      .replace("19000.0 * sunDiscScale * Fex", "SUN_DISC_LUM * Fex");
    injectSkySunScalePatch(mat);
    // 锚点已彻底不在 → 无法补全 → 环形日志留痕（审计①：消除静默失效缝隙）
    log.expectLogged("sky", "锚点失配");
    log.restore();
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

  it("声明注入兜底：showSunDisc 锚点失配时在 hash 函数前插入声明", () => {
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    // 模拟 Three 未来版本调整 uniforms 顺序：主锚点被破坏，但保留 hash 函数标记
    mat.fragmentShader = mat.fragmentShader.replace(
      /(uniform\s+float\s+showSunDisc\s*;\s*\n\s*uniform\s+float\s+time\s*;)/,
      "// anchors removed",
    );
    // three r185 Material 只有 needsUpdate setter（version++），无 getter——用 version 观察重编译触发
    const versionBefore = mat.version;
    injectSkySunScalePatch(mat);
    expect(mat.fragmentShader).toMatch(/uniform\s+float\s+sunIntensityScale\s*;/);
    expect(mat.fragmentShader.indexOf("uniform float sunIntensityScale")).toBeLessThan(
      mat.fragmentShader.indexOf("float hash( vec2 p )"),
    );
    expect(mat.version).toBe(versionBefore + 1); // patched → needsUpdate=true → version++
  });

  it("两个锚点全部失配时 console.error 留痕并跳过 patch（不产生半残 shader）", () => {
    const log = spyRingLog();
    const sky = new Sky();
    const mat = sky.material as THREE.ShaderMaterial;
    mat.fragmentShader = "// totally different shader, no anchors at all";
    injectSkySunScalePatch(mat);
    log.expectLogged("sky", "无法注入声明");
    // uniforms 已注册（对象层先注册防 crash），但 shader 未被改
    expect(mat.uniforms.sunIntensityScale).toBeDefined();
    expect(mat.fragmentShader).toBe("// totally different shader, no anchors at all");
    log.restore();
  });
});

// ============ apply 完整管线（Fake PMREM + happy-dom rAF）============
describe("SkyCapability — apply 管线（真实分支）", () => {
  beforeEach(() => { resetEnvState(); });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("apply 后 sky 挂载 scene、tone mapping/exposure 设置、environment 生成", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer({ toneMapping: THREE.NoToneMapping, toneMappingExposure: 3.3 });
    const cap = new SkyCapability({ scene, renderer });
    cap.apply();
    expect(cap.isEnabled()).toBe(true);
    expect((cap as unknown as { sky: Sky }).sky.parent).toBe(scene);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(envState.skyExposure);
    expect(scene.environment).not.toBeNull();
  });

  it("environment=false 时 apply 清空 environment 但仍挂载天空", () => {
    const scene = new THREE.Scene();
    setEnvState({ skyEnvironment: false }, { source: 'manual' });
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.environment).toBeNull();
    expect((cap as unknown as { sky: Sky }).sky.parent).toBe(scene);
  });

  it("clearEnvironment 只清自己生成的环境（外部 environment 保留）", () => {
    const scene = new THREE.Scene();
    const external = new THREE.Texture();
    scene.environment = external;
    setEnvState({ skyEnvironment: false }, { source: 'manual' });
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.setEnvironmentEnabled(false);
    // renderTarget 未生成（environment=false 从未 build）→ 不等于 rt.texture → 外部值保留
    expect(scene.environment).toBe(external);
  });

  it("setEnabled(false) detach：sky/godRays/tint 全部移除", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.setGodRaysEnabled(true);
    cap.setTime(18); // 日落 → godRays + tint 挂载
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBe(scene);
    cap.setEnabled(false);
    expect((cap as unknown as { sky: Sky }).sky.parent).toBeNull();
    expect(scene.environment).toBeNull();
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBeNull();
    expect((cap as unknown as { sunsetTintMesh: THREE.Mesh }).sunsetTintMesh!.parent).toBeNull();
  });

  it("dispose 还原 tone mapping/exposure 并释放资源", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer({ toneMapping: THREE.NoToneMapping, toneMappingExposure: 3.3 });
    const cap = new SkyCapability({ scene, renderer });
    cap.apply();
    const pmrem = (cap as unknown as { pmrem: { dispose: () => void } | null }).pmrem;
    expect(pmrem).not.toBeNull();
    const pmremSpy = vi.spyOn(pmrem!, "dispose");
    cap.dispose();
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(3.3);
    expect((cap as unknown as { sky: Sky }).sky.parent).toBeNull();
    expect(scene.environment).toBeNull();
    expect((cap as unknown as { renderTarget: { dispose: () => void } | null }).renderTarget).toBeNull();
    expect((cap as unknown as { godRays: THREE.Group | null }).godRays).toBeNull();
    expect((cap as unknown as { sunsetTintMesh: THREE.Mesh | null }).sunsetTintMesh).toBeNull();
    expect(pmremSpy).toHaveBeenCalled();
  });

  it("[锐评 P1 跨 cap 踩踏] dispose 守卫还原：environment 被他人改写后不得冲掉", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.environment).not.toBeNull(); // 本能力 PMREM 贴图已接管
    const foreign = new THREE.Texture();
    scene.environment = foreign; // 模拟 environment-capability（HDR）在 sky 之后写入
    cap.dispose();
    expect(scene.environment).toBe(foreign);
  });

  it("dispose 在 environment 仍归自己所有时还原构造前快照", () => {
    const scene = new THREE.Scene();
    const prev = new THREE.Texture();
    scene.environment = prev;
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.environment).not.toBe(prev); // 已被 PMREM 贴图接管
    cap.dispose();
    expect(scene.environment).toBe(prev);
  });

  it("setSun 写 uniforms 并在 enabled+environment 下重建环境", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setSun(30, 200);
    const p = cap.getParams();
    expect(p.elevation).toBe(30);
    expect(p.azimuth).toBe(200);
    const sunU = (cap as unknown as { sky: Sky }).sky.material.uniforms["sunPosition"].value as THREE.Vector3;
    // code_review 57aeefdb4 #9（P3）：方向断言——callback 字段同步曾滞后一拍（先
    // writeUniforms 后同步 this.elevation），uniform 恒用旧太阳位置；换算
    // phi=degToRad(90-elevation)=60°、theta=degToRad(200) →
    // y=cos(phi)=0.5、x=sin(phi)sin(theta)<0（方位 200° 偏西）。length≈1 的单位向量
    // 断言捕获不到「方向陈旧」回归，此处 pin 分量。
    expect(sunU.length()).toBeCloseTo(1, 5);
    expect(sunU.y).toBeCloseTo(Math.cos(THREE.MathUtils.degToRad(60)), 5); // elevation 30 → 0.5
    expect(sunU.x).toBeLessThan(0); // azimuth 200 → 西侧（x<0）
    expect(scene.environment).not.toBeNull(); // regenerate 已跑
  });

  it("setSunIntensityScale / setSunDiscScale clamp 并同步 uniforms", () => {
    const cap = newCap();
    cap.setSunIntensityScale(2); // clamp 到 1.5
    expect(cap.getSunIntensityScale()).toBe(1.5);
    cap.setSunIntensityScale(-1); // clamp 到 0
    expect(cap.getSunIntensityScale()).toBe(0);
    cap.setSunDiscScale(0.7);
    expect(cap.getSunDiscScale()).toBe(0.7);
    const u = (cap as unknown as { sky: Sky }).sky.material.uniforms;
    expect(u["sunIntensityScale"].value).toBe(0);
    expect(u["sunDiscScale"].value).toBe(0.7);
  });

  it("setCloudCoverage(regenerate=true) 同步刷新 IBL 环境", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setCloudCoverage(0.5, true);
    const u = (cap as unknown as { envSky: Sky }).envSky.material.uniforms;
    expect(u["cloudCoverage"].value).toBe(0.5);
    expect(scene.environment).not.toBeNull();
  });

  it("regenerateEnvironment 失败（fromScene 抛错）走 catch 告警且 showSunDisc 恢复", () => {
    const log = spyRingLog();
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    vi.spyOn(THREE.PMREMGenerator.prototype as unknown as { fromScene: () => unknown }, "fromScene")
      .mockImplementation(() => {
        throw new Error("gl oom");
      });
    expect(() => cap.setEnvironmentEnabled(true)).not.toThrow();
    log.expectLogged("sky", "环境贴图生成失败");
    // finally 恢复太阳盘
    expect((cap as unknown as { envSky: Sky }).envSky.material.uniforms["showSunDisc"].value).toBe(1);
    log.restore();
  });

  it("getSunPosition 输出 clamp 到 [0,1]（夜间 elevation<0 时 y<0.5）", () => {
    setEnvState({ skyTimeOfDay: 0 }, { source: 'manual' }); // 午夜
    const cap = newCap();
    const pos = cap.getSunPosition();
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThanOrEqual(1);
    expect(pos.y).toBeLessThan(0.5); // 地平线下
    cap.setTime(12); // 正午
    expect(cap.getSunPosition().y).toBeGreaterThan(0.5);
  });
});

// ============ 昼夜循环（SceneCapability.update(dt) 驱动；2026-09-03 起不再自建 rAF）============
describe("SkyCapability — 昼夜循环 autoRotate", () => {
  beforeEach(() => { resetEnvState(); });

  it("start/stop 切换与幂等；update(dt) 推进 timeOfDay", () => {
    const cap = newCap(); // envState.skyTimeOfDay = 9
    expect(cap.isAutoRotating()).toBe(false);
    cap.update(1); // 未启动 → no-op
    expect(cap.getTimeOfDay()).toBe(9);
    cap.startAutoRotate();
    expect(cap.isAutoRotating()).toBe(true);
    cap.startAutoRotate(); // 幂等：不重复起循环
    cap.update(1); // 1 秒 × 1 小时/秒
    expect(cap.getTimeOfDay()).toBe(10);
    cap.update(20); // 跨 24 点环绕：10 + 20 → 6
    expect(cap.getTimeOfDay()).toBe(6);
    cap.stopAutoRotate();
    expect(cap.isAutoRotating()).toBe(false);
    const stopped = cap.getTimeOfDay();
    cap.update(5);
    expect(cap.getTimeOfDay()).toBe(stopped); // 停止后 update 不再推进
  });

  it("stopAutoRotate 未启动时 no-op", () => {
    const cap = newCap();
    expect(() => cap.stopAutoRotate()).not.toThrow();
    expect(cap.isAutoRotating()).toBe(false);
  });

  it("[锐评 P3] enabled=false 时 update 冻结全部时间轴（timeOfDay/godRaysTime 不漂移）", () => {
    const cap = newCap({ enabled: false });
    cap.startAutoRotate();
    const t = (cap as unknown as { godRaysTime: { value: number } }).godRaysTime;
    cap.update(2);
    expect(cap.getTimeOfDay()).toBe(envState.skyTimeOfDay);
    expect(t.value).toBe(0);
  });

  it("dispose 自动停止昼夜循环", () => {
    const cap = newCap();
    cap.startAutoRotate();
    expect(cap.isAutoRotating()).toBe(true);
    cap.dispose();
    expect(cap.isAutoRotating()).toBe(false);
    cap.update(1); // dispose 后 update 空转，timeOfDay 不再推进
    expect(cap.getTimeOfDay()).toBe(envState.skyTimeOfDay);
  });

  it("[锐评 P1 GPU 熔炉修复] 昼夜循环 update(dt) 走阈值门控：高度角变化 < 2° 不重建 PMREM", () => {
    const cap = newCap(); // timeOfDay=9, 9h 附近高度角约每 0.1h 变化 1.3°
    cap.startAutoRotate();
    const fromScene = vi.spyOn(THREE.PMREMGenerator.prototype, "fromScene");
    fromScene.mockClear();
    // ① 首帧（初始 lastPmremElevation=-999）无条件重建一次
    cap.update(0.05); // +0.05h → 高度角变化 < 2°
    expect(fromScene).toHaveBeenCalledTimes(1);
    // ② 继续小幅推进（累计高度角变化仍 < 2°）→ 不重建（scene.environment 保持旧贴图）
    cap.update(0.1); // 累计 +0.15h，高度角变化 < 2° → 不应重建
    expect(fromScene).toHaveBeenCalledTimes(1);
    // ③ 大步推进跨过 2° 阈值 → 重建
    cap.update(1); // 累计 +1.15h，高度角变化远超 2° → 重建
    expect(fromScene).toHaveBeenCalledTimes(2);
  });

  it("手动 setTime 默认 forceEnv=true：任意精度调整都强制重建（滑块/时间轴体验不降级）", () => {
    const cap = newCap();
    const fromScene = vi.spyOn(THREE.PMREMGenerator.prototype, "fromScene");
    fromScene.mockClear();
    cap.setTime(9.05); // 微调 0.05h（高度角变化远 < 2°）——手动仍强制重建
    expect(fromScene).toHaveBeenCalledTimes(1);
    cap.setTime(9.1);
    expect(fromScene).toHaveBeenCalledTimes(2);
    cap.setTime(10); // 跨阈值手动调整同样重建（无门控）
    expect(fromScene).toHaveBeenCalledTimes(3);
    cap.dispose();
  });
});

// ============ God Rays 挂载/卸载（真实分支）============
describe("SkyCapability — God Rays 挂载分支", () => {
  beforeEach(() => { resetEnvState(); });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("日落时启用 godRays → group 挂载 scene 且 intensity 写入 uniform", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setGodRaysEnabled(true);
    cap.setTime(18); // elevation≈0 → intensity>0
    const group = (cap as unknown as { godRays: THREE.Group }).godRays;
    expect(group.parent).toBe(scene);
    expect(group.visible).toBe(true);
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uIntensity.value).toBeGreaterThan(0);
    // 挂载时颜色初始化为 sunset sunColor
    expect(mat.uniforms.uColor.value.getHex()).toBe(0xffe0a8);
    // sunset tint 同步挂载
    expect((cap as unknown as { sunsetTintMesh: THREE.Mesh }).sunsetTintMesh!.parent).toBe(scene);
  });

  it("正午时 godRays intensity=0 → group 卸载", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setGodRaysEnabled(true);
    cap.setTime(18);
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBe(scene);
    cap.setTime(12); // 正午 → intensity=0 → 卸载
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBeNull();
    expect((cap as unknown as { sunsetTintMesh: THREE.Mesh }).sunsetTintMesh!.parent).toBeNull();
  });

  it("godRays 关闭后 setTime 把已挂载的 group 移除", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setGodRaysEnabled(true);
    cap.setTime(18);
    cap.setGodRaysEnabled(false);
    cap.setTime(18); // updateGodRays 走 disabled 分支 → remove
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBeNull();
  });

  it("[锐评 P1 死时间轴] update(dt) 推进 godRaysTime（shimmer 动画独立于昼夜循环活着）", () => {
    const cap = newCap();
    const t = (cap as unknown as { godRaysTime: { value: number } }).godRaysTime;
    const before = t.value;
    cap.update(0.5); // 未开昼夜循环也要推进——shader sin(uTime*2.0+...) 依赖此时间轴
    expect(t.value).toBeCloseTo(before + 0.5, 5);
  });

  it("disabled 状态下 setGodRaysEnabled 只翻标志不触发挂载", () => {
    const scene = new THREE.Scene();
    const cap = new SkyCapability({ scene, renderer: makeFakeRenderer() });
    cap.setEnabled(false);
    cap.setGodRaysEnabled(true);
    expect(cap.isGodRaysEnabled()).toBe(true);
    expect((cap as unknown as { godRays: THREE.Group }).godRays.parent).toBeNull();
  });

  it("setPreset 在 disabled 时只合并参数不写 uniforms", () => {
    const cap = newCap({ enabled: false });
    const u = (cap as unknown as { sky: Sky }).sky.material.uniforms;
    const turbidityBefore = u["turbidity"].value;
    cap.setPreset("vrm");
    expect(envState.skyTurbidity).toBe(MODEL_SKY_PRESETS.vrm!.turbidity!);
    expect(u["turbidity"].value).toBe(turbidityBefore); // 未写入 uniforms
  });

  it("loadState 非法类型字段全部跳过（restoreFields 守卫）", () => {
    localStorage.setItem("ysm-scene-cap-sky", JSON.stringify({
      timeOfDay: "noon", cloudCoverage: "cloudy", environment: "yes", enabled: 1,
      sunIntensityScale: "big", sunDiscScale: null,
    }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getTimeOfDay()).toBe(envState.skyTimeOfDay);
    expect(cap.getCloudCoverage()).toBe(envState.skyCloudCoverage);
    expect(cap.isEnvironmentEnabled()).toBe(envState.skyEnvironment);
    expect(cap.getSunIntensityScale()).toBe(envState.skySunIntensityScale);
  });
});

describe("SkyCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  it("完整树 = timeline controls 节点 + sky-time/sky-env 平铺 + 高级 folder", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 0: timeline controls 通道（复杂控件）
    expect(nodes[0]!.kind).toBe("controls");
    const tl = typeof nodes[0]!.controls === "function" ? nodes[0]!.controls() : nodes[0]!.controls;
    expect(tl![0]!.kind).toBe("timeline");
    expect(tl![0]!.id).toBe("sky-timeline");
    // 1: sky-time slider 平铺
    expect(nodes[1]!.kind).toBe("slider");
    expect(nodes[1]!.id).toBe("sky-time");
    nodes[1]!.control!.set!(9);
    expect(cap.getTimeOfDay()).toBe(9);
    // 2: sky-env toggle 平铺（基座级开关）
    expect(nodes[2]!.kind).toBe("toggle");
    expect(nodes[2]!.id).toBe("sky-env");
    // 3: 高级 folder
    const folder = nodes[3]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.skyGroupAdvanced");
    expect(folder.children!.map((c) => c.id)).toEqual([
      "sky-cloud",
      "sky-sun-intensity",
      "sky-sun-disc",
      "sky-auto-rotate",
      "sky-godrays",
    ]);
  });

  it("高级组节点读写闭包直连 cap（cloud/godrays）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[3]!;
    const cloud = folder.children!.find((c) => c.id === "sky-cloud")!;
    cloud.control!.set!(0.6);
    expect(cap.getCloudCoverage()).toBeCloseTo(0.6, 5);
    const godrays = folder.children!.find((c) => c.id === "sky-godrays")!;
    godrays.control!.set!(true);
    expect(cap.isGodRaysEnabled()).toBe(true);
  });
});
