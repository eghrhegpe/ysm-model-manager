// @vitest-environment node
// ===== PostprocessingCapability 测试（utils/3d/caps/postprocessing-capability.ts）=====
// 覆盖：构造默认值、启用禁用、Bloom/SSAO/色彩映射/SSR 参数、预设、持久化、getMenuControls。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  PostprocessingCapability,
  DEFAULT_POSTPROC_PARAMS,
  POSTPROC_PRESETS,
} from "./postprocessing-capability.ts";

// 拦截 buildComposer（内部依赖 EffectComposer/Pass 等，node 不可用）
beforeEach(() => {
  vi.spyOn(PostprocessingCapability.prototype as unknown as { buildComposer: () => void }, "buildComposer").mockImplementation(() => {
    // no-op
  });
});

function makeFakeRenderer() {
  return {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    domElement: { style: {}, width: 512, height: 512, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    getContext: () => null,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean; params?: Partial<import("./postprocessing-capability.ts").PostprocessingParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  return new PostprocessingCapability({ scene, renderer, camera, params: opts.params, enabled: opts.enabled });
}

describe("PostprocessingCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(false);
    // 通过 getMenuControls 暴露的 getter 验证参数
    const controls = cap.getMenuControls();
    const toneMapping = controls.find((c) => c.id === "pp-toneMapping")!;
    expect(toneMapping.getValue()).toBe("aces");
    const exposure = controls.find((c) => c.id === "pp-exposure")!;
    expect(exposure.getValue()).toBe(1.0);
    const bloomStr = controls.find((c) => c.id === "pp-bloom-strength")!;
    expect(bloomStr.getValue()).toBe(0.6);
    const ssaoEn = controls.find((c) => c.id === "pp-ssao-enabled")!;
    expect(ssaoEn.getValue()).toBe(false);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { bloomStrength: 1.2, exposure: 1.5, toneMapping: "reinhard" } });
    const controls = cap.getMenuControls();
    const bloomStr = controls.find((c) => c.id === "pp-bloom-strength")!;
    expect(bloomStr.getValue()).toBe(1.2);
    const exposure = controls.find((c) => c.id === "pp-exposure")!;
    expect(exposure.getValue()).toBe(1.5);
    const toneMapping = controls.find((c) => c.id === "pp-toneMapping")!;
    expect(toneMapping.getValue()).toBe("reinhard");
  });
});

describe("PostprocessingCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("PostprocessingCapability — Bloom 参数", () => {
  it("Bloom 强度/阈值/半径读写", () => {
    const cap = newCap();
    cap.setBloomStrength(1.5);
    cap.setBloomThreshold(0.7);
    cap.setBloomRadius(0.8);
    const controls = cap.getMenuControls();
    expect(controls.find((c) => c.id === "pp-bloom-strength")!.getValue()).toBe(1.5);
    expect(controls.find((c) => c.id === "pp-bloom-threshold")!.getValue()).toBe(0.7);
    expect(controls.find((c) => c.id === "pp-bloom-radius")!.getValue()).toBe(0.8);
  });

  it("Bloom 跟随体积光联动开关", () => {
    const cap = newCap();
    cap.setBloomFollowVolumetric(false);
    const ctrl = cap.getMenuControls().find((c) => c.id === "pp-bloom-follow")!;
    expect(ctrl.getValue()).toBe(false);
    cap.setBloomFollowVolumetric(true);
    expect(ctrl.getValue()).toBe(true);
  });
});

describe("PostprocessingCapability — SSAO", () => {
  it("SSAO 开关/半径/距离读写", () => {
    const cap = newCap();
    cap.setSSAOEnabled(true);
    cap.setSSAORadius(12);
    cap.setSSAOMinDist(0.01);
    cap.setSSAOMaxDist(0.5);
    const controls = cap.getMenuControls();
    expect(controls.find((c) => c.id === "pp-ssao-enabled")!.getValue()).toBe(true);
    expect(controls.find((c) => c.id === "pp-ssao-radius")!.getValue()).toBe(12);
    expect(controls.find((c) => c.id === "pp-ssao-mindist")!.getValue()).toBe(0.01);
    expect(controls.find((c) => c.id === "pp-ssao-maxdist")!.getValue()).toBe(0.5);
  });
});

describe("PostprocessingCapability — 色彩映射与曝光", () => {
  it("setToneMapping 切换", () => {
    const cap = newCap();
    cap.setToneMapping("linear");
    const ctrl = cap.getMenuControls().find((c) => c.id === "pp-toneMapping")!;
    expect(ctrl.getValue()).toBe("linear");
    cap.setToneMapping("none");
    expect(ctrl.getValue()).toBe("none");
  });

  it("setExposure 读写", () => {
    const cap = newCap();
    cap.setExposure(2.0);
    const ctrl = cap.getMenuControls().find((c) => c.id === "pp-exposure")!;
    expect(ctrl.getValue()).toBe(2.0);
  });
});

describe("PostprocessingCapability — SSR 反射", () => {
  it("setReflectionMode 切换三档", () => {
    const cap = newCap();
    cap.setReflectionMode("envmap+ssr");
    const ctrl = cap.getMenuControls().find((c) => c.id === "pp-reflection-mode")!;
    expect(ctrl.getValue()).toBe("envmap+ssr");
    cap.setReflectionMode("ssr-only");
    expect(ctrl.getValue()).toBe("ssr-only");
    cap.setReflectionMode("envmap-only");
    expect(ctrl.getValue()).toBe("envmap-only");
  });

  it("SSR 参数读写", () => {
    const cap = newCap();
    cap.setSSROpacity(0.7);
    cap.setSSRMaxDistance(300);
    cap.setSSRThickness(0.03);
    cap.setSSRBlur(false);
    cap.setSSRDistanceAttenuation(false);
    cap.setSSRFresnel(false);
    cap.setSSRBouncing(true);
    const controls = cap.getMenuControls();
    expect(controls.find((c) => c.id === "pp-ssr-opacity")!.getValue()).toBe(0.7);
    expect(controls.find((c) => c.id === "pp-ssr-maxdistance")!.getValue()).toBe(300);
    expect(controls.find((c) => c.id === "pp-ssr-thickness")!.getValue()).toBe(0.03);
    expect(controls.find((c) => c.id === "pp-ssr-blur")!.getValue()).toBe(false);
    expect(controls.find((c) => c.id === "pp-ssr-distanceAttenuation")!.getValue()).toBe(false);
    expect(controls.find((c) => c.id === "pp-ssr-fresnel")!.getValue()).toBe(false);
    expect(controls.find((c) => c.id === "pp-ssr-bouncing")!.getValue()).toBe(true);
  });
});

describe("PostprocessingCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: {
      bloomStrength: 1.2, bloomThreshold: 0.7, bloomRadius: 0.8, bloomFollowVolumetric: false,
      ssaoEnabled: true, ssaoRadius: 12, ssaoMinDist: 0.01, ssaoMaxDist: 0.5,
      toneMapping: "reinhard", exposure: 1.5,
      reflectionMode: "envmap+ssr", ssrOpacity: 0.7, ssrMaxDistance: 300, ssrThickness: 0.03,
      ssrBlur: false, ssrDistanceAttenuation: false, ssrFresnel: false, ssrBouncing: true,
      reflectorDisableWhenSSR: false,
    } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    const c = cap2.getMenuControls();
    expect(c.find((x) => x.id === "pp-bloom-strength")!.getValue()).toBe(1.2);
    expect(c.find((x) => x.id === "pp-ssao-enabled")!.getValue()).toBe(true);
    expect(c.find((x) => x.id === "pp-toneMapping")!.getValue()).toBe("reinhard");
    expect(c.find((x) => x.id === "pp-exposure")!.getValue()).toBe(1.5);
    expect(c.find((x) => x.id === "pp-reflection-mode")!.getValue()).toBe("envmap+ssr");
    expect(c.find((x) => x.id === "pp-ssr-bouncing")!.getValue()).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { bloomStrength: 2.0 } });
    cap.loadState();
    const ctrl = cap.getMenuControls().find((x) => x.id === "pp-bloom-strength")!;
    expect(ctrl.getValue()).toBe(2.0);
  });
});

describe("PostprocessingCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(18);
    // 总开关
    expect(controls.find((c) => c.id === "pp-enabled")).toBeDefined();
    // 色彩与曝光组
    expect(controls.find((c) => c.id === "pp-toneMapping")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-exposure")).toBeDefined();
    // Bloom 组
    expect(controls.find((c) => c.id === "pp-bloom-strength")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-bloom-threshold")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-bloom-radius")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-bloom-follow")).toBeDefined();
    // SSAO 组
    expect(controls.find((c) => c.id === "pp-ssao-enabled")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssao-radius")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssao-mindist")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssao-maxdist")).toBeDefined();
    // 反射模式组
    expect(controls.find((c) => c.id === "pp-reflection-mode")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-reflector-disable-when-ssr")).toBeDefined();
    // SSR 参数组
    expect(controls.find((c) => c.id === "pp-ssr-opacity")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-maxdistance")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-thickness")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-blur")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-distanceAttenuation")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-fresnel")).toBeDefined();
    expect(controls.find((c) => c.id === "pp-ssr-bouncing")).toBeDefined();
  });

  it("toggle 开关同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "pp-enabled")!;
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("非总开关控件均含 group 字段（5 组：Color/Bloom/SSAO/Reflection/SSR）", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "pp-enabled").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.postprocessingGroup")).toBe(true);
    });
    // 确认 5 个 group 分组都存在
    const groups = new Set(controls.map((c) => c.group).filter(Boolean));
    expect(groups.size).toBe(5);
  });
});

describe("PostprocessingCapability — 预设数据完整性", () => {
  it("DEFAULT_POSTPROC_PARAMS 默认值完整", () => {
    expect(DEFAULT_POSTPROC_PARAMS.enabled).toBe(false);
    expect(typeof DEFAULT_POSTPROC_PARAMS.bloomStrength).toBe("number");
    expect(typeof DEFAULT_POSTPROC_PARAMS.ssaoEnabled).toBe("boolean");
    expect(typeof DEFAULT_POSTPROC_PARAMS.reflectionMode).toBe("string");
    expect(typeof DEFAULT_POSTPROC_PARAMS.exposure).toBe("number");
  });

  it("POSTPROC_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "litematic", "resourcepack", "mmd-scene"];
    for (const t of expectedTypes) {
      expect(POSTPROC_PRESETS[t]).toBeDefined();
    }
  });
});

// ============ 曝光归权（曝光治理 §1）：enabled=false 时绝不触碰 renderer toneMapping / exposure ============
describe("PostprocessingCapability — 曝光归权（enabled=false 不碰 renderer）", () => {
  function makeRendererWithState(toneMapping: THREE.ToneMapping = THREE.NoToneMapping as THREE.ToneMapping, exposure: number = 0.5) {
    const r = makeFakeRenderer();
    r.toneMapping = toneMapping;
    r.toneMappingExposure = exposure;
    return r as THREE.WebGLRenderer;
  }

  it("构造 enabled=false 时，不覆盖 renderer.toneMapping / exposure（保留 SkyCapability 写入值）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    // 模拟 SkyCapability 已经设置的状态
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.55);
    // 构造默认 enabled=false（DEFAULT_POSTPROC_PARAMS.enabled=false）
    new PostprocessingCapability({ scene, renderer, camera });
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.55, 4);
  });

  it("构造 enabled=true 时，正常写入 toneMapping / exposure", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.55);
    new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    // 默认 toneMapping=aces, exposure=1.0
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.0, 4);
  });

  it("apply() enabled=false 时跳 applyToneMapping，保留 renderer 原值", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.6);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    cap.apply();
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.6, 4);
  });

  it("apply() enabled=true 时写入 toneMapping / exposure", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.1);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true, params: { exposure: 1.2 } });
    cap.apply();
    expect(renderer.toneMappingExposure).toBeCloseTo(1.2, 4);
  });

  it("setEnabled(false→true) 时立刻写入 renderer；setEnabled(true→false) 不还原 Sky 写入（交给 dispose 精确还原 prev 值）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.5);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.5, 4);
    // 手动模拟 SkyCapability 写入值
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.58;
    cap.setEnabled(true);
    // 默认 exposure=1.0
    expect(renderer.toneMappingExposure).toBeCloseTo(1.0, 4);
    cap.setEnabled(false);
    // setEnabled(false) 不主动改 renderer（SkyCapability 自己仍会在 apply 时重写）
    // 这里我们验证关闭后仍然保持最近值，不引起跳变
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(typeof renderer.toneMappingExposure).toBe("number");
  });

  it("setToneMapping/setExposure 在 enabled=false 时只改 params，不动 renderer", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.62);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    // 记录 SkyCapability 写入值
    const origTM = renderer.toneMapping;
    const origExp = renderer.toneMappingExposure;
    cap.setToneMapping("reinhard");
    cap.setExposure(1.8);
    // renderer 不动
    expect(renderer.toneMapping).toBe(origTM);
    expect(renderer.toneMappingExposure).toBeCloseTo(origExp, 4);
    // params 已经更新
    expect(cap.getParams().toneMapping).toBe("reinhard");
    expect(cap.getParams().exposure).toBeCloseTo(1.8, 4);
  });

  it("setToneMapping/setExposure 在 enabled=true 时同步写 renderer", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    cap.setToneMapping("linear");
    cap.setExposure(2.0);
    expect(renderer.toneMapping).toBe(THREE.LinearToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(2.0, 4);
  });

  it("setPreset 在 enabled=false 时不碰 renderer（只更新 params）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.58);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    const origExp = renderer.toneMappingExposure;
    const origTM = renderer.toneMapping;
    // ysm 预设 enabled=false：统一亮度口径下预设只带 enabled，不携 exposure
    cap.setPreset("ysm");
    expect(renderer.toneMapping).toBe(origTM);
    expect(renderer.toneMappingExposure).toBeCloseTo(origExp, 4);
    // params 保持全局默认曝光（光影包统一值），不出现 per-type 1.05
    expect(cap.getParams().exposure).toBeCloseTo(1.0, 4);
    expect(cap.isEnabled()).toBe(false);
  });

  it("setPreset 在 enabled=true 时正常写 tone mapping / exposure（全局统一值）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    // vrm 预设 enabled=true：写全局默认曝光 1.0（不再 per-type 1.05）
    cap.setPreset("vrm");
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.0, 4);
  });

  it("setPreset 落库 this.enabled（per-type 开关生效，根治死代码）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    // 构造 off，套用 vrm（enabled:true）→ 应翻转为 on 并构建 composer
    const capOn = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    let built = false;
    (capOn as unknown as { buildComposer: () => void }).buildComposer = () => { built = true; };
    (capOn as unknown as { disposeComposer: () => void }).disposeComposer = () => {};
    (capOn as unknown as { applyReflectorSync: () => void }).applyReflectorSync = () => {};
    capOn.setPreset("vrm");
    expect(capOn.isEnabled()).toBe(true);
    expect(built).toBe(true);
    // 构造 on，套用 ysm（enabled:false）→ 应翻转为 off 并销毁 composer
    const capOff = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    let disposed = false;
    (capOff as unknown as { buildComposer: () => void }).buildComposer = () => {};
    (capOff as unknown as { disposeComposer: () => void }).disposeComposer = () => { disposed = true; };
    (capOff as unknown as { applyReflectorSync: () => void }).applyReflectorSync = () => {};
    capOff.setPreset("ysm");
    expect(capOff.isEnabled()).toBe(false);
    expect(disposed).toBe(true);
  });
});

describe("PostprocessingCapability — bloom 体积光联动（解耦缩放）", () => {
  // [doc:adr-126-p5] 用户拍板方案 b：联动以用户设置为基准 ±20% 微调——此前 opacity 直接
  // 放大成 strength（满值 1.5）+ 阈值压到 0.2，开体积光即亮爆；本组锁「不超用户设置区间」契约。
  function mockBloomPass(cap: PostprocessingCapability): { threshold: number; strength: number; radius: number } {
    const bp = { threshold: 0, strength: 0, radius: 0 };
    (cap as unknown as { bloomPass: unknown }).bloomPass = bp;
    return bp;
  }
  const lightCap = (opacity: number) => ({ getParams: () => ({ volumetric: { opacity } }) }) as never;

  it("默认体积光（opacity 0.45）：threshold/strength 落在用户设置 ±20% 内，radius 保持用户设置", () => {
    const cap = newCap({ params: { bloomStrength: 0.6, bloomThreshold: 0.6, bloomRadius: 0.5 } });
    const bp = mockBloomPass(cap);
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(lightCap(0.45));
    expect(bp.threshold).toBeGreaterThanOrEqual(0.6 * 0.8);
    expect(bp.threshold).toBeLessThanOrEqual(0.6);
    expect(bp.strength).toBeGreaterThanOrEqual(0.6);
    expect(bp.strength).toBeLessThanOrEqual(0.6 * 1.2);
    expect(bp.radius).toBe(0.5); // radius 不再被 edgeFade 劫持
  });

  it("满值体积光（opacity 1.0）：不再爆——strength ≤ +20%、threshold ≥ -20%", () => {
    const cap = newCap({ params: { bloomStrength: 0.6, bloomThreshold: 0.6, bloomRadius: 0.5 } });
    const bp = mockBloomPass(cap);
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(lightCap(1.0));
    expect(bp.threshold).toBeGreaterThanOrEqual(0.6 * 0.8 - 1e-9);
    expect(bp.strength).toBeLessThanOrEqual(0.6 * 1.2 + 1e-9);
  });

  it("低 bloomThreshold（<0.0625）不超用户设置：threshold 跟随 ±20% 而非下限钳制", () => {
    // 31c3f65a review P3：旧 Math.max(0.05, ...) 下限在 bloomThreshold<0.0625 时输出 0.05
    // 超过用户设置——违反「不超用户设置区间」契约；去下限后应跟随 0.8×user
    const cap = newCap({ params: { bloomStrength: 0.6, bloomThreshold: 0.04, bloomRadius: 0.5 } });
    const bp = mockBloomPass(cap);
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(lightCap(1.0));
    expect(bp.threshold).toBeCloseTo(0.04 * 0.8, 6); // 0.032 而非旧下限 0.05
  });

  it("联动关：直接用用户设置（else 分支不受影响）", () => {
    const cap = newCap({ params: { bloomStrength: 0.9, bloomThreshold: 0.7, bloomRadius: 0.4 } });
    cap.setBloomFollowVolumetric(false);
    const bp = mockBloomPass(cap);
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(lightCap(1.0));
    expect(bp.threshold).toBe(0.7);
    expect(bp.strength).toBe(0.9);
    expect(bp.radius).toBe(0.4);
  });
});