// ===== PostprocessingCapability 测试（preview-3d/caps/postprocessing-capability.ts）=====
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
import { POSTPROC_PERSIST_FIELDS, PP_PARAMS_TO_ENV } from "./postprocessing-state.ts";
import type { LightCapability } from "./light-capability.ts";
import type { SceneCapability } from "./scene-capability.ts";
// ADR-196：统一状态层（测试隔离）
import { resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";

// 顶层隔离：每个测试前重置 envState 单例 + 清空回调注册表（防止 cap 泄漏跨测试）
beforeEach(() => {
  resetEnvState();
  clearEnvCallbacks();
});
afterEach(() => {
  clearEnvCallbacks();
});

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

/** 递归查找节点树中的节点（postprocessing 节点树：顶层 + folder children） */
function findNode(nodes: import("@/preview-3d/menu/menu-node-types.ts").PreviewMenuNode[], id: string): import("@/preview-3d/menu/menu-node-types.ts").PreviewMenuNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function newCap(opts: { enabled?: boolean; params?: Partial<import("./postprocessing-capability.ts").PostprocessingParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  // ADR-196：构造不再收 params，覆盖走 envState seed（resetEnvState 已在 beforeEach 清空）
  if (opts.params) {
    const seed: Partial<EnvState> = {};
    for (const [pk, evk] of Object.entries(PP_PARAMS_TO_ENV)) {
      const v = opts.params[pk as keyof import("./postprocessing-capability.ts").PostprocessingParams];
      if (v !== undefined) {
        (seed as Record<string, unknown>)[evk] = v;
      }
    }
    if (Object.keys(seed).length > 0) setEnvState(seed, { source: "manual" });
  }
  return new PostprocessingCapability({
    scene,
    renderer,
    camera,
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
}

describe("PostprocessingCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(false);
    // 通过 getMenuNodes 暴露的 getter 验证参数
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-toneMapping")!.control!.get!(undefined)).toBe("aces");
    expect(findNode(nodes, "pp-exposure")!.control!.get!(undefined)).toBe(1.0);
    expect(findNode(nodes, "pp-bloom-strength")!.control!.get!(undefined)).toBe(0.6);
    expect(findNode(nodes, "pp-ssao-enabled")!.control!.get!(undefined)).toBe(false);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { bloomStrength: 1.2, exposure: 1.5, toneMapping: "reinhard" } });
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-bloom-strength")!.control!.get!(undefined)).toBe(1.2);
    expect(findNode(nodes, "pp-exposure")!.control!.get!(undefined)).toBe(1.5);
    expect(findNode(nodes, "pp-toneMapping")!.control!.get!(undefined)).toBe("reinhard");
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
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-bloom-strength")!.control!.get!(undefined)).toBe(1.5);
    expect(findNode(nodes, "pp-bloom-threshold")!.control!.get!(undefined)).toBe(0.7);
    expect(findNode(nodes, "pp-bloom-radius")!.control!.get!(undefined)).toBe(0.8);
  });

  it("Bloom 跟随体积光联动开关", () => {
    const cap = newCap();
    cap.setBloomFollowVolumetric(false);
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-bloom-follow")!.control!.get!(undefined)).toBe(false);
    cap.setBloomFollowVolumetric(true);
    expect(findNode(nodes, "pp-bloom-follow")!.control!.get!(undefined)).toBe(true);
  });

  it("独立辉光开关默认开启且继承 DEFAULT", () => {
    expect(DEFAULT_POSTPROC_PARAMS.bloomEnabled).toBe(true);
    const cap = newCap();
    expect(cap.getParams().bloomEnabled).toBe(true);
  });

  it("pp-bloom-enabled 节点存在且读写经 setBloomEnabled（与管线开关 this.enabled 正交）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const node = findNode(nodes, "pp-bloom-enabled")!;
    expect(node).toBeDefined();
    expect(node.kind).toBe("toggle");
    expect(node.control!.get!(undefined)).toBe(true);
    cap.setBloomEnabled(false);
    expect(node.control!.get!(undefined)).toBe(false);
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
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-ssao-enabled")!.control!.get!(undefined)).toBe(true);
    expect(findNode(nodes, "pp-ssao-radius")!.control!.get!(undefined)).toBe(12);
    expect(findNode(nodes, "pp-ssao-mindist")!.control!.get!(undefined)).toBe(0.01);
    expect(findNode(nodes, "pp-ssao-maxdist")!.control!.get!(undefined)).toBe(0.5);
  });
});

describe("PostprocessingCapability — 色彩映射与曝光", () => {
  it("setToneMapping 切换", () => {
    const cap = newCap();
    cap.setToneMapping("linear");
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-toneMapping")!.control!.get!(undefined)).toBe("linear");
    cap.setToneMapping("none");
    expect(findNode(nodes, "pp-toneMapping")!.control!.get!(undefined)).toBe("none");
  });

  it("setExposure 读写", () => {
    const cap = newCap();
    cap.setExposure(2.0);
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-exposure")!.control!.get!(undefined)).toBe(2.0);
  });
});

describe("PostprocessingCapability — SSR 反射", () => {
  it("setReflectionMode 切换三档", () => {
    const cap = newCap();
    cap.setReflectionMode("envmap+ssr");
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-reflection-mode")!.control!.get!(undefined)).toBe("envmap+ssr");
    cap.setReflectionMode("ssr-only");
    expect(findNode(nodes, "pp-reflection-mode")!.control!.get!(undefined)).toBe("ssr-only");
    cap.setReflectionMode("envmap-only");
    expect(findNode(nodes, "pp-reflection-mode")!.control!.get!(undefined)).toBe("envmap-only");
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
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-ssr-opacity")!.control!.get!(undefined)).toBe(0.7);
    expect(findNode(nodes, "pp-ssr-maxdistance")!.control!.get!(undefined)).toBe(300);
    expect(findNode(nodes, "pp-ssr-thickness")!.control!.get!(undefined)).toBe(0.03);
    expect(findNode(nodes, "pp-ssr-blur")!.control!.get!(undefined)).toBe(false);
    expect(findNode(nodes, "pp-ssr-distanceAttenuation")!.control!.get!(undefined)).toBe(false);
    expect(findNode(nodes, "pp-ssr-fresnel")!.control!.get!(undefined)).toBe(false);
    expect(findNode(nodes, "pp-ssr-bouncing")!.control!.get!(undefined)).toBe(true);
  });
});

describe("POSTPROC_PERSIST_FIELDS — 表驱动持久化契约（2026-09 锐评 P2-1）", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("键集契约：表键集 + enabled 与 params 全键双向全等（运行时镜像 satisfies 编译锁）", () => {
    const tableKeys = new Set(Object.keys(POSTPROC_PERSIST_FIELDS));
    tableKeys.add("enabled");
    const paramKeys = new Set(Object.keys(DEFAULT_POSTPROC_PARAMS));
    expect([...tableKeys].sort()).toEqual([...paramKeys].sort());
  });

  it("round-trip：全字段 setParams → saveState → 新会话 loadState → deep-equal", () => {
    const cap = newCap({ enabled: true, params: {
      enabled: true, // 构造器 enabled 不回写 params.enabled（历史双写口径），round-trip 快照需两者一致
      bloomStrength: 1.2, bloomThreshold: 0.7, bloomRadius: 0.8, bloomFollowVolumetric: false,
      bloomEnabled: false, ssaoEnabled: true, ssaoRadius: 12, ssaoMinDist: 0.01, ssaoMaxDist: 0.5,
      toneMapping: "reinhard", exposure: 1.5,
      reflectionMode: "envmap+ssr", ssrOpacity: 0.7, ssrMaxDistance: 300, ssrThickness: 0.03,
      ssrBlur: false, ssrDistanceAttenuation: false, ssrFresnel: false, ssrBouncing: true,
      reflectorDisableWhenSSR: false,
    } });
    cap.apply();
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getParams()).toEqual(cap.getParams());
    expect((cap2 as unknown as { enabled: boolean }).enabled).toBe(true);
  });

  it("round-trip 防漂移：save 的存档键集与表键集 + enabled 全等", () => {
    const cap = newCap({ enabled: false });
    cap.saveState();
    const saved = Object.keys(JSON.parse(localStorage.getItem("ysm-scene-cap-postprocessing") ?? "{}"));
    expect([...saved].sort()).toEqual([...Object.keys(POSTPROC_PERSIST_FIELDS), "enabled"].sort());
  });
});

describe("PostprocessingCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: {
      enabled: true, // 构造器 enabled 不回写 params.enabled（历史双写口径），round-trip 快照需两者一致
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
    const nodes = cap2.getMenuNodes();
    expect(findNode(nodes, "pp-bloom-strength")!.control!.get!(undefined)).toBe(1.2);
    expect(findNode(nodes, "pp-ssao-enabled")!.control!.get!(undefined)).toBe(true);
    expect(findNode(nodes, "pp-toneMapping")!.control!.get!(undefined)).toBe("reinhard");
    expect(findNode(nodes, "pp-exposure")!.control!.get!(undefined)).toBe(1.5);
    expect(findNode(nodes, "pp-reflection-mode")!.control!.get!(undefined)).toBe("envmap+ssr");
    expect(findNode(nodes, "pp-ssr-bouncing")!.control!.get!(undefined)).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { bloomStrength: 2.0 } });
    cap.loadState();
    const nodes = cap.getMenuNodes();
    expect(findNode(nodes, "pp-bloom-strength")!.control!.get!(undefined)).toBe(2.0);
  });
});

describe("PostprocessingCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  it("顶层结构：3 基座 toggle + 5 文件夹（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(8);
    // 基座级 toggle
    expect(nodes[0].id).toBe("pp-enabled");
    expect(nodes[0].kind).toBe("toggle");
    expect(nodes[2].id).toBe("pp-bloom-enabled");
    expect(nodes[2].kind).toBe("toggle");
    expect(nodes[4].id).toBe("pp-ssao-enabled");
    expect(nodes[4].kind).toBe("toggle");
    // 5 个 folder
    expect(nodes[1].kind).toBe("folder");
    expect(nodes[3].kind).toBe("folder");
    expect(nodes[5].kind).toBe("folder");
    expect(nodes[6].kind).toBe("folder");
    expect(nodes[7].kind).toBe("folder");
    // folder labelKey 对应原 group
    expect(nodes[1].labelKey).toBe("preview.postprocessingGroupColor");
    expect(nodes[3].labelKey).toBe("preview.postprocessingGroupBloom");
    expect(nodes[5].labelKey).toBe("preview.postprocessingGroupSsao");
    expect(nodes[6].labelKey).toBe("preview.postprocessingGroupReflection");
    expect(nodes[7].labelKey).toBe("preview.postprocessingGroupSsr");
  });

  it("toggle 开关同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "pp-enabled")!;
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
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
    // ADR-196：构造不再收 params，覆盖走 envState seed
    setEnvState({ ppExposure: 1.2 }, { source: "manual" });
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
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

  it("applyPostProcDefaults 在 enabled=false 时不碰 renderer（只更新 params）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.58);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    const origExp = renderer.toneMappingExposure;
    const origTM = renderer.toneMapping;
    // ysm 预设 enabled=false：统一亮度口径下预设只带 enabled，不携 exposure
    cap.applyPostProcDefaults("ysm");
    expect(renderer.toneMapping).toBe(origTM);
    expect(renderer.toneMappingExposure).toBeCloseTo(origExp, 4);
    // params 保持全局默认曝光（光影包统一值），不出现 per-type 1.05
    expect(cap.getParams().exposure).toBeCloseTo(1.0, 4);
    expect(cap.isEnabled()).toBe(false);
  });

  it("applyPostProcDefaults 在 enabled=true 时正常写 tone mapping / exposure（全局统一值）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    // vrm 预设 enabled=true：写全局默认曝光 1.0（不再 per-type 1.05）
    cap.applyPostProcDefaults("vrm");
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.0, 4);
  });

  it("applyPostProcDefaults 落库 this.enabled（per-type 开关生效，根治死代码）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    // 构造 off，套用 vrm（enabled:true）→ 应翻转为 on 并构建 composer
    const capOn = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    let composerBuilt = false;
    (capOn as unknown as { buildComposer: () => void }).buildComposer = () => { composerBuilt = true; };
    (capOn as unknown as { disposeComposer: () => void }).disposeComposer = () => {};
    (capOn as unknown as { applyReflectorSync: () => void }).applyReflectorSync = () => {};
    capOn.applyPostProcDefaults("vrm");
    expect(capOn.isEnabled()).toBe(true);
    expect(composerBuilt).toBe(true);
    // 构造 on，套用 ysm（enabled:false）→ 应翻转为 off 并销毁 composer
    const capOff = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    let disposed = false;
    (capOff as unknown as { buildComposer: () => void }).buildComposer = () => {};
    (capOff as unknown as { disposeComposer: () => void }).disposeComposer = () => { disposed = true; };
    (capOff as unknown as { applyReflectorSync: () => void }).applyReflectorSync = () => {};
    capOff.applyPostProcDefaults("ysm");
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
  const lightCap = (opacity: number) => ({ getParams: () => ({ volumetric: { opacity } }) }) as unknown as SceneCapability;

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

// ============ 性能档位总闸 setMasterEnabled + applyPostProcDefaults 构建次数（审核修复回归） ============
describe("PostprocessingCapability — 总闸与 applyPostProcDefaults 构建次数", () => {
  function buildSpy() {
    return vi.spyOn(
      PostprocessingCapability.prototype as unknown as { buildComposer: () => void },
      "buildComposer",
    );
  }

  // ADR-196：this.enabled 已是唯一真值源（无 params.enabled 双写），setMasterEnabled 直接切换
  it("setMasterEnabled 切换生效开关并构建/销毁 composer", () => {
    const cap = newCap({ enabled: false });
    cap.setMasterEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setMasterEnabled(false);
    expect(cap.isEnabled()).toBe(false);
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

  it("applyPostProcDefaults enabled 翻转（false→true）时 composer 只构建一次", () => {
    const cap = newCap(); // 默认 enabled=false（params.enabled=false）
    const spy = buildSpy();
    spy.mockClear();
    cap.applyPostProcDefaults("vrm"); // 门禁 false→true 翻转
    expect(cap.isEnabled()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // 修复前末尾无条件重建会二次 build
  });

  it("applyPostProcDefaults enabled 未变（保持 on）时重建 composer 一次以同步参数", () => {
    const cap = newCap({ enabled: true, params: { enabled: true } });
    cap.setEnabled(true); // 建真 composer（后续 buildComposer 内部 disposeComposer 依赖真实实例）
    const spy = buildSpy();
    spy.mockClear();
    cap.applyPostProcDefaults("vrm");
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
    // ADR-196：构造不再收 params，覆盖走 envState seed
    if (opts.params) {
      const seed: Partial<EnvState> = {};
      for (const [pk, evk] of Object.entries(PP_PARAMS_TO_ENV)) {
        const v = opts.params[pk as keyof import("./postprocessing-capability.ts").PostprocessingParams];
        if (v !== undefined) {
          (seed as Record<string, unknown>)[evk] = v;
        }
      }
      if (Object.keys(seed).length > 0) setEnvState(seed, { source: "manual" });
    }
    const cap = new PostprocessingCapability({
      scene,
      renderer,
      camera,
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
    });
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
    // ADR-196：构造不再收 params，覆盖走 envState seed
    setEnvState({
      ppReflectionMode: opts.mode ?? "envmap+ssr",
      ppReflectorDisableWhenSSR: opts.disableWhenSSR ?? true,
    }, { source: "manual" });
    const cap = new PostprocessingCapability({ scene, renderer, camera });
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

// ============ 菜单控件联动（节点 control 闭包）============
describe("PostprocessingCapability — 菜单控件联动补充", () => {
  it("bloom/SSAO/SSR/色彩控件 setValue 落地参数（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const by = (id: string) => findNode(nodes, id)!;
    by("pp-bloom-strength").control!.set!(2.0);
    by("pp-bloom-threshold").control!.set!(0.4);
    by("pp-bloom-radius").control!.set!(0.7);
    by("pp-bloom-follow").control!.set!(false);
    by("pp-ssao-enabled").control!.set!(true);
    by("pp-ssao-radius").control!.set!(3);
    by("pp-ssao-mindist").control!.set!(0.03);
    by("pp-ssao-maxdist").control!.set!(0.4);
    by("pp-reflection-mode").control!.set!("envmap+ssr");
    by("pp-ssr-opacity").control!.set!(0.9);
    by("pp-ssr-maxdistance").control!.set!(10);
    by("pp-ssr-thickness").control!.set!(0.15);
    by("pp-ssr-blur").control!.set!(true);
    by("pp-ssr-distanceAttenuation").control!.set!(true);
    by("pp-ssr-fresnel").control!.set!(true);
    by("pp-ssr-bouncing").control!.set!(true);
    by("pp-reflector-disable-when-ssr").control!.set!(false);
    by("pp-exposure").control!.set!(1.4);
    by("pp-toneMapping").control!.set!("cineon");
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

// ============ ADR-195 刀2：cap 直产节点（getMenuNodes 契约）============
describe("PostprocessingCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  it("顶层结构：3 基座 toggle + 5 文件夹，顺序与 getMenuControls 渲染等价", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(8);

    // 基座级 toggle（无 children）
    expect(nodes[0].id).toBe("pp-enabled");
    expect(nodes[0].kind).toBe("toggle");

    // Color 文件夹
    expect(nodes[1].kind).toBe("folder");
    expect(nodes[1].id).toBe("cap-group-postprocessing-color");
    expect((nodes[1] as { labelKey?: string }).labelKey).toBe("preview.postprocessingGroupColor");

    expect(nodes[2].id).toBe("pp-bloom-enabled");
    expect(nodes[2].kind).toBe("toggle");

    // Bloom 文件夹
    expect(nodes[3].kind).toBe("folder");
    expect(nodes[3].id).toBe("cap-group-postprocessing-bloom");
    expect((nodes[3] as { labelKey?: string }).labelKey).toBe("preview.postprocessingGroupBloom");

    expect(nodes[4].id).toBe("pp-ssao-enabled");
    expect(nodes[4].kind).toBe("toggle");

    // SSAO 文件夹
    expect(nodes[5].kind).toBe("folder");
    expect(nodes[5].id).toBe("cap-group-postprocessing-ssao");
    expect((nodes[5] as { labelKey?: string }).labelKey).toBe("preview.postprocessingGroupSsao");

    // Reflection 文件夹
    expect(nodes[6].kind).toBe("folder");
    expect(nodes[6].id).toBe("cap-group-postprocessing-reflection");
    expect((nodes[6] as { labelKey?: string }).labelKey).toBe("preview.postprocessingGroupReflection");

    // SSR 文件夹
    expect(nodes[7].kind).toBe("folder");
    expect(nodes[7].id).toBe("cap-group-postprocessing-ssr");
    expect((nodes[7] as { labelKey?: string }).labelKey).toBe("preview.postprocessingGroupSsr");
  });

  it("Bloom 文件夹子节点 pp-bloom-strength 读写闭包直连 cap", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const bloomFolder = nodes.find((n) => n.id === "cap-group-postprocessing-bloom") as unknown as {
      children?: Array<{ id?: string; control?: { get: () => unknown; set: (v: unknown) => void } }>;
    };
    const children = bloomFolder.children!;
    const strengthNode = children.find((n) => n.id === "pp-bloom-strength");

    expect(strengthNode).toBeDefined();
    // 初始值
    expect(strengthNode!.control!.get()).toBe(cap.getParams().bloomStrength);
    // set 闭包直连 cap
    strengthNode!.control!.set(2.5);
    expect(cap.getParams().bloomStrength).toBe(2.5);
    // get 读取最新
    expect(strengthNode!.control!.get()).toBe(2.5);
  });

  it("pp-enabled 基座 toggle 读写闭包直连 cap", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "pp-enabled") as unknown as {
      control?: { get: () => unknown; set: (v: unknown) => void };
    };

    expect(enabledNode).toBeDefined();
    expect(cap.isEnabled()).toBe(false);
    expect(enabledNode.control!.get()).toBe(false);
    enabledNode.control!.set(true);
    expect(cap.isEnabled()).toBe(true);
    enabledNode.control!.set(false);
    expect(cap.isEnabled()).toBe(false);
  });
});
