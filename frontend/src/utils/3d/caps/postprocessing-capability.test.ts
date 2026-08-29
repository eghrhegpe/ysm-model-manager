// ===== PostprocessingCapability 测试（utils/3d/caps/postprocessing-capability.ts）=====
// 覆盖：构造默认值、启用禁用、Bloom/SSAO/色彩映射/SSR 参数、预设、持久化、getMenuControls、
// 真实 composer 构建管线（EffectComposer + Passes 纯数据构造）、render() 语义、Reflector 联动、dispose。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import {
  PostprocessingCapability,
  DEFAULT_POSTPROC_PARAMS,
  POSTPROC_PRESETS,
} from "./postprocessing-capability.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import type { LightCapability } from "./light-capability.ts";

// buildComposer 的 EffectComposer/RenderPass/UnrealBloomPass/SSAOPass/SSRPass/OutputPass
// 均为纯数据构造（WebGLRenderTarget 不依赖 GL context），happy-dom 下可真实构建；
// 仅 composer.render()（逐 pass 真渲染）在测试中以 spy 拦截。

function makeFakeRenderer() {
  return {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    domElement: { style: {}, width: 512, height: 512, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: (v: { x: number; y: number }) => { v.x = 512; v.y = 512; return v; },
    getPixelRatio: () => 1,
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    getContext: () => null,
  } as unknown as THREE.WebGLRenderer;
}

/** stub LightCapability：供 render() 的 volumetric 联动查询 */
function stubLightCap(opts: { engine?: "cone" | "postprocess"; volEnabled?: boolean; opacity?: number } = {}) {
  return {
    getVolumetricEngine: () => opts.engine ?? "cone",
    getParams: () => ({ volumetric: { enabled: opts.volEnabled ?? false, opacity: opts.opacity ?? 0.45 } }),
  } as unknown as LightCapability;
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

  it("独立辉光开关默认开启且继承 DEFAULT", () => {
    expect(DEFAULT_POSTPROC_PARAMS.bloomEnabled).toBe(true);
    const cap = newCap();
    expect(cap.getParams().bloomEnabled).toBe(true);
  });

  it("pp-bloom-enabled 控件存在且读写经 setBloomEnabled（与管线开关 this.enabled 正交）", () => {
    const cap = newCap();
    const ctrl = cap.getMenuControls().find((c) => c.id === "pp-bloom-enabled")!;
    expect(ctrl).toBeDefined();
    expect(ctrl.kind).toBe("toggle");
    expect(ctrl.group).toBe("preview.postprocessingGroupBloom");
    expect(ctrl.getValue()).toBe(true);
    cap.setBloomEnabled(false);
    expect(ctrl.getValue()).toBe(false);
    expect(cap.getParams().bloomEnabled).toBe(false);
    cap.setBloomEnabled(true);
    expect(cap.getParams().bloomEnabled).toBe(true);
  });

  it("setBloomEnabled 立即旁路 bloomPass（composer 已构建时）", () => {
    const cap = newCap({ enabled: true });
    const fakePass = { enabled: true } as unknown as { enabled: boolean };
    (cap as unknown as { bloomPass: { enabled: boolean } | null }).bloomPass = fakePass;
    cap.setBloomEnabled(false);
    expect(fakePass.enabled).toBe(false);
    cap.setBloomEnabled(true);
    expect(fakePass.enabled).toBe(true);
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

// ============ 性能档位总闸 setMasterEnabled + setPreset 构建次数（审核修复回归） ============
describe("PostprocessingCapability — 总闸与 setPreset 构建次数", () => {
  function buildSpy() {
    return vi.spyOn(
      PostprocessingCapability.prototype as unknown as { buildComposer: () => void },
      "buildComposer",
    );
  }

  it("setMasterEnabled 只写生效开关，不抹 per-type 门禁 params.enabled（off→on 循环可恢复）", () => {
    const cap = newCap({ enabled: false, params: { enabled: true } }); // 门禁开、总闸关（vrm 初始态）
    cap.setMasterEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getParams().enabled).toBe(true); // 门禁未被抹
    cap.setMasterEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getParams().enabled).toBe(true); // 门禁保留 → 再开可恢复
    cap.setMasterEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("setMasterEnabled 值未变时不做无谓重建", () => {
    const cap = newCap({ enabled: true });
    const spy = buildSpy();
    spy.mockClear();
    cap.setMasterEnabled(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("setPreset enabled 翻转（false→true）时 composer 只构建一次", () => {
    const cap = newCap(); // 默认 enabled=false（params.enabled=false）
    const spy = buildSpy();
    spy.mockClear();
    cap.setPreset("vrm"); // 门禁 false→true 翻转
    expect(cap.isEnabled()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // 修复前末尾无条件重建会二次 build
  });

  it("setPreset enabled 未变（保持 on）时重建 composer 一次以同步参数", () => {
    const cap = newCap({ enabled: true, params: { enabled: true } });
    cap.setEnabled(true); // 建真 composer（后续 buildComposer 内部 disposeComposer 依赖真实实例）
    const spy = buildSpy();
    spy.mockClear();
    cap.setPreset("vrm");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
// ============ 真实 composer 构建管线 ============
describe("PostprocessingCapability — 真实 composer 构建管线", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function newRealCap(opts: { enabled?: boolean; params?: Partial<import("./postprocessing-capability.ts").PostprocessingParams>; reflectorCap?: ReflectorCapability | null } = {}) {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const cap = new PostprocessingCapability({ scene, renderer, camera, params: opts.params, enabled: opts.enabled });
    if (opts.reflectorCap !== undefined) cap.setReflectorCap(opts.reflectorCap);
    return { cap, scene, renderer, camera };
  }

  function internalsOf(cap: PostprocessingCapability) {
    return cap as unknown as {
      composer: EffectComposer; renderPass: Pass; bloomPass: Pass; outputPass: Pass;
      ssaoPass: Pass | null; ssrPass: Pass | null;
    };
  }

  it("setEnabled(true) 构建 composer：renderPass → bloomPass → outputPass 顺序就位", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    const x = internalsOf(cap);
    expect(x.composer).not.toBeNull();
    expect(x.renderPass).not.toBeNull();
    expect(x.bloomPass).not.toBeNull();
    expect(x.outputPass).not.toBeNull();
    expect(x.ssaoPass).toBeNull();
    expect(x.ssrPass).toBeNull();
    const passes = x.composer.passes;
    expect(passes.indexOf(x.renderPass)).toBe(0);
    expect(passes.indexOf(x.bloomPass)).toBe(1);
    expect(passes.indexOf(x.outputPass)).toBe(2);
  });

  it("ssaoEnabled=true 时 SSAOPass 插在 renderPass 之后、bloom 之前", () => {
    const { cap } = newRealCap({ params: { ssaoEnabled: true } });
    cap.setEnabled(true);
    const x = internalsOf(cap);
    const passes = x.composer.passes;
    expect(passes.indexOf(x.ssaoPass!)).toBe(1);
    expect(passes.indexOf(x.bloomPass!)).toBe(2);
    // SSAO 参数下发
    const ssao = x.ssaoPass as unknown as { kernelRadius: number; minDistance: number; maxDistance: number };
    expect(ssao.kernelRadius).toBe(DEFAULT_POSTPROC_PARAMS.ssaoRadius);
  });

  it("reflectionMode=envmap+ssr 时 SSRPass 插在 bloomPass 之后", () => {
    const { cap } = newRealCap({ params: { reflectionMode: "envmap+ssr" } });
    cap.setEnabled(true);
    const x = internalsOf(cap);
    const passes = x.composer.passes;
    expect(passes.indexOf(x.ssrPass!)).toBe(2);
    expect(passes.indexOf(x.outputPass!)).toBe(3);
    const ssr = x.ssrPass as unknown as { opacity: number; maxDistance: number; thickness: number; blur: boolean };
    expect(ssr.opacity).toBe(DEFAULT_POSTPROC_PARAMS.ssrOpacity);
  });

  it("reflectionMode=ssr-only 时 ssrPass.opacity 恒 1", () => {
    const { cap } = newRealCap({ params: { reflectionMode: "ssr-only", ssrOpacity: 0.3 } });
    cap.setEnabled(true);
    const ssr = internalsOf(cap).ssrPass as unknown as { opacity: number };
    expect(ssr.opacity).toBe(1);
  });

  it("setEnabled(false) 拆除 composer（全部 pass 引用清空）；再启用重建", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    expect(internalsOf(cap).composer).not.toBeNull();
    cap.setEnabled(false);
    expect(internalsOf(cap).composer).toBeNull();
    expect(internalsOf(cap).bloomPass).toBeNull();
    cap.setEnabled(true);
    expect(internalsOf(cap).composer).not.toBeNull();
  });

  it("setEnabled(true) 写入 renderer：SRGB 色彩空间 + toneMapping/exposure", () => {
    const { renderer } = newRealCap({ enabled: true, params: { toneMapping: "reinhard", exposure: 1.8 } });
    expect(renderer.toneMapping).toBe(THREE.ReinhardToneMapping);
    expect(renderer.toneMappingExposure).toBe(1.8);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("setSSAOEnabled(true) 重建 composer 挂 SSAO；setSSAORadius/MinDist/MaxDist 直改 pass", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    expect(internalsOf(cap).ssaoPass).toBeNull();
    cap.setSSAOEnabled(true);
    const ssao = internalsOf(cap).ssaoPass as unknown as { kernelRadius: number; minDistance: number; maxDistance: number };
    expect(ssao).not.toBeNull();
    cap.setSSAORadius(2.5);
    cap.setSSAOMinDist(0.05);
    cap.setSSAOMaxDist(0.5);
    expect(ssao.kernelRadius).toBe(2.5);
    expect(ssao.minDistance).toBe(0.05);
    expect(ssao.maxDistance).toBe(0.5);
  });

  it("setReflectionMode 重建 composer（SSR 组合变化）", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    expect(internalsOf(cap).ssrPass).toBeNull();
    cap.setReflectionMode("envmap+ssr");
    expect(internalsOf(cap).ssrPass).not.toBeNull();
    cap.setReflectionMode("envmap-only");
    expect(internalsOf(cap).ssrPass).toBeNull();
  });

  it("setBloom* 直改 bloomPass；setBloomEnabled(false) 旁路 bloomPass", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    const bloom = internalsOf(cap).bloomPass as unknown as { strength: number; threshold: number; radius: number; enabled: boolean };
    cap.setBloomStrength(1.5);
    cap.setBloomThreshold(0.5);
    cap.setBloomRadius(0.9);
    expect(bloom.strength).toBe(1.5);
    expect(bloom.threshold).toBe(0.5);
    expect(bloom.radius).toBe(0.9);
    cap.setBloomEnabled(false);
    expect(bloom.enabled).toBe(false);
    cap.setBloomEnabled(true);
    expect(bloom.enabled).toBe(true);
  });

  it("setSSR* 直改 ssrPass 属性", () => {
    const { cap } = newRealCap({ params: { reflectionMode: "envmap+ssr" } });
    cap.setEnabled(true);
    const ssr = internalsOf(cap).ssrPass as unknown as {
      opacity: number; maxDistance: number; thickness: number; blur: boolean;
      distanceAttenuation: boolean; fresnel: boolean; bouncing: boolean;
    };
    cap.setSSROpacity(0.7);
    cap.setSSRMaxDistance(8);
    cap.setSSRThickness(0.2);
    cap.setSSRBlur(true);
    cap.setSSRDistanceAttenuation(true);
    cap.setSSRFresnel(true);
    cap.setSSRBouncing(true);
    expect(ssr.opacity).toBe(0.7);
    expect(ssr.maxDistance).toBe(8);
    expect(ssr.thickness).toBe(0.2);
    expect(ssr.blur).toBe(true);
    expect(ssr.distanceAttenuation).toBe(true);
    expect(ssr.fresnel).toBe(true);
    expect(ssr.bouncing).toBe(true);
  });

  it("syncBloomPass 体积光联动：render() 时按 ±20% 微调 threshold/strength", () => {
    const { cap } = newRealCap({ params: { bloomStrength: 1.0, bloomThreshold: 0.85 } });
    cap.setEnabled(true);
    const bloom = internalsOf(cap).bloomPass as unknown as { strength: number; threshold: number; radius: number };
    const renderSpy = vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    const rendered = cap.render(0.016, stubLightCap({ volEnabled: true, opacity: 0.5 }));
    expect(rendered).toBe(true);
    expect(renderSpy).toHaveBeenCalled();
    expect(bloom.threshold).toBeCloseTo(0.85 * (1 - 0.2 * 0.5), 6);
    expect(bloom.strength).toBeCloseTo(1.0 * (1 + 0.2 * 0.5), 6);
    // 联动关闭时回用户原值
    cap.setBloomFollowVolumetric(false);
    cap.render(0.016, stubLightCap({ volEnabled: true, opacity: 0.5 }));
    expect(bloom.threshold).toBeCloseTo(0.85, 6);
    expect(bloom.strength).toBeCloseTo(1.0, 6);
  });

  it("render()：disabled 返回 false 且不建 composer；enabled 建 composer 并渲染", () => {
    const { cap } = newRealCap();
    const renderSpy = vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    expect(cap.render(0.016, null)).toBe(false);
    expect(internalsOf(cap).composer).toBeNull();
    cap.setEnabled(true);
    expect(cap.render(0.016, null)).toBe(true);
    expect(renderSpy).toHaveBeenCalled();
  });

  it("needComposer：disabled 但 lightCap 走 postprocess 体积光引擎 → 仍需 composer", () => {
    const { cap } = newRealCap();
    const renderSpy = vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    const rendered = cap.render(0.016, stubLightCap({ engine: "postprocess", volEnabled: true }));
    expect(rendered).toBe(true);
    expect(internalsOf(cap).composer).not.toBeNull();
    expect(renderSpy).toHaveBeenCalled();
  });

  it("setSize 同步 composer 与 bloom/SSR 分辨率；setPixelRatio 透传", () => {
    const { cap } = newRealCap({ params: { reflectionMode: "envmap+ssr" } });
    cap.setEnabled(true);
    const ssr = internalsOf(cap).ssrPass as unknown as { width: number; height: number };
    expect(() => cap.setSize(256, 128)).not.toThrow();
    expect(ssr.width).toBe(256);
    expect(ssr.height).toBe(128);
    expect(() => cap.setPixelRatio(2)).not.toThrow();
    // disabled 时 setSize no-op
    cap.setEnabled(false);
    expect(() => cap.setSize(100, 100)).not.toThrow();
  });

  it("dispose 还原 renderer tone mapping/exposure/colorSpace", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 0.4;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    cap.setEnabled(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    cap.dispose();
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(0.4);
    expect(internalsOf(cap).composer).toBeNull();
  });
});

// ============ ReflectorCapability 联动 ============
describe("PostprocessingCapability — ReflectorCapability 联动", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePair(opts: { mode?: "envmap-only" | "envmap+ssr" | "ssr-only"; disableWhenSSR?: boolean } = {}) {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const reflector = new ReflectorCapability({ scene, renderer, enabled: true });
    const cap = new PostprocessingCapability({
      scene, renderer, camera,
      params: { reflectionMode: opts.mode ?? "envmap+ssr", reflectorDisableWhenSSR: opts.disableWhenSSR ?? true },
    });
    return { cap, reflector, renderer };
  }

  it("SSR 活动 + reflectorDisableWhenSSR：注入即禁用 reflector，SSR 关闭恢复", () => {
    const { cap, reflector } = makePair();
    expect(reflector.isEnabled()).toBe(true);
    cap.setEnabled(true); // 构建 composer（applyReflectorSync 依赖 composer 存在才重建触发）
    cap.setReflectorCap(reflector);
    expect(reflector.isEnabled()).toBe(false); // SSR 活动自动禁用
    cap.setReflectionMode("envmap-only"); // SSR 关闭 → 重建 composer → 同步恢复
    expect(reflector.isEnabled()).toBe(true); // 恢复
  });

  it("reflectorDisableWhenSSR=false 时不禁用 reflector", () => {
    const { cap, reflector } = makePair({ disableWhenSSR: false });
    cap.setReflectorCap(reflector);
    expect(reflector.isEnabled()).toBe(true);
  });

  it("setReflectorDisableWhenSSR(true) 动态禁用；切回 false 恢复", () => {
    const { cap, reflector } = makePair({ disableWhenSSR: false });
    cap.setReflectorCap(reflector);
    cap.setReflectorDisableWhenSSR(true);
    expect(reflector.isEnabled()).toBe(false);
    cap.setReflectorDisableWhenSSR(false);
    expect(reflector.isEnabled()).toBe(true);
  });

  it("setReflectorCap 换引用时先还原旧引用状态", () => {
    const { cap, reflector, renderer } = makePair();
    const reflector2 = new ReflectorCapability({ scene: new THREE.Scene(), renderer, enabled: true });
    cap.setReflectorCap(reflector);
    expect(reflector.isEnabled()).toBe(false); // 被禁用
    cap.setReflectorCap(reflector2);
    expect(reflector.isEnabled()).toBe(true); // 旧引用还原
    expect(reflector2.isEnabled()).toBe(false); // 新引用被禁用
  });

  it("dispose 恢复被禁用的 reflector", () => {
    const { cap, reflector } = makePair();
    cap.setReflectorCap(reflector);
    expect(reflector.isEnabled()).toBe(false);
    cap.dispose();
    expect(reflector.isEnabled()).toBe(true);
  });

  it("masterEnabled off 后 reflector 保持禁用（SSR 配置仍在），dispose 才恢复", () => {
    const { cap, reflector } = makePair();
    cap.setEnabled(true);
    cap.setReflectorCap(reflector);
    expect(reflector.isEnabled()).toBe(false);
    // 总闸 off 只拆 composer；params.reflectionMode 仍是 SSR → applyReflectorSync 维持禁用语义
    cap.setMasterEnabled(false);
    expect(reflector.isEnabled()).toBe(false);
    cap.dispose(); // dispose 精确还原 prev
    expect(reflector.isEnabled()).toBe(true);
  });
});

// ============ 菜单控件联动（真实闭包）============
describe("PostprocessingCapability — 菜单控件联动补充", () => {
  it("bloom/SSAO/SSR/色彩控件 setValue 落地参数", () => {
    const cap = newCap();
    const by = (id: string) => cap.getMenuControls().find((c) => c.id === id)!;
    by("pp-bloom-strength").setValue(2.0);
    by("pp-bloom-threshold").setValue(0.4);
    by("pp-bloom-radius").setValue(0.7);
    by("pp-bloom-follow").setValue(false);
    by("pp-ssao-enabled").setValue(true);
    by("pp-ssao-radius").setValue(3);
    by("pp-ssao-mindist").setValue(0.03);
    by("pp-ssao-maxdist").setValue(0.4);
    by("pp-reflection-mode").setValue("envmap+ssr");
    by("pp-ssr-opacity").setValue(0.9);
    by("pp-ssr-maxdistance").setValue(10);
    by("pp-ssr-thickness").setValue(0.15);
    by("pp-ssr-blur").setValue(true);
    by("pp-ssr-distanceAttenuation").setValue(true);
    by("pp-ssr-fresnel").setValue(true);
    by("pp-ssr-bouncing").setValue(true);
    by("pp-reflector-disable-when-ssr").setValue(false);
    by("pp-exposure").setValue(1.4);
    by("pp-toneMapping").setValue("cineon");
    const p = cap.getParams();
    expect(p.bloomStrength).toBe(2.0);
    expect(p.bloomThreshold).toBe(0.4);
    expect(p.bloomRadius).toBe(0.7);
    expect(p.bloomFollowVolumetric).toBe(false);
    expect(p.ssaoEnabled).toBe(true);
    expect(p.ssaoRadius).toBe(3);
    expect(p.ssaoMinDist).toBe(0.03);
    expect(p.ssaoMaxDist).toBe(0.4);
    expect(p.reflectionMode).toBe("envmap+ssr");
    expect(p.ssrOpacity).toBe(0.9);
    expect(p.ssrMaxDistance).toBe(10);
    expect(p.ssrThickness).toBe(0.15);
    expect(p.ssrBlur).toBe(true);
    expect(p.ssrDistanceAttenuation).toBe(true);
    expect(p.ssrFresnel).toBe(true);
    expect(p.ssrBouncing).toBe(true);
    expect(p.reflectorDisableWhenSSR).toBe(false);
    expect(p.exposure).toBe(1.4);
    expect(p.toneMapping).toBe("cineon");
  });
});
