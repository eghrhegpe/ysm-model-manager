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
} from "./postprocessing-capability.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import { POSTPROC_PERSIST_FIELDS, PP_PARAMS_TO_ENV } from "./postprocessing-state.ts";
import type { LightCapability } from "./light-capability.ts";
import type { SceneCapability } from "./scene-capability.ts";
// ADR-196：统一状态层（测试隔离）
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { MODEL_DEFAULTS } from "@/preview-3d/state/model-defaults.ts";
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

/** stub LightCapability：供 render() 的 volumetric 联动查询。
 *  [ADR-246 D1] 原 engine 维度已删——postprocess 空壳引擎移除后无需再 stub getVolumetricEngine。
 *  [ADR-247] 联动读「浓度意图」opacity，故 stub 不再需要 volEnabled 维度（可见性不参与联动）。 */
function stubLightCap(opts: { opacity?: number } = {}) {
  return {
    getParams: () => ({ volumetric: { opacity: opts.opacity ?? 0.45 } }),
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

  it("[ADR-250] ppEnabled 经 MODEL_DEFAULTS 覆盖所有模型类型（原 POSTPROC_PRESETS 职责）", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "litematic", "resourcepack", "mmd-scene"];
    for (const t of expectedTypes) {
      expect(MODEL_DEFAULTS[t as keyof typeof MODEL_DEFAULTS]).toBeDefined();
    }
    // 显式声明意图的类型必须带布尔 ppEnabled（default 不写 → 继承 envState 默认 false）
    for (const t of ["ysm", "vrm", "mmd", "litematic", "resourcepack", "mmd-scene"] as const) {
      expect(typeof MODEL_DEFAULTS[t].ppEnabled).toBe("boolean");
    }
  });
});

// ============ [ADR-250 §2.3] 曝光属主归 sky：postproc 只写 toneMapping ============
// 本组取代原「曝光归权（enabled=false 不碰 renderer）」——原契约是「postproc 拥有 exposure，
// 开启时写入、关闭时归还/让位」。ADR-250 判定该字段有两个并发持有者（sky 与 postproc），
// 并发持有无解，只能定单一属主；sky 有物理理由（天空为场景定基调、skyExposure 本就 per-type），
// postproc 没有（只管 ACES 转换与 bloom）。故 postproc **任何情况下都不写 toneMappingExposure**。
describe("PostprocessingCapability — 曝光属主归 sky（ADR-250）", () => {
  function makeRendererWithState(toneMapping: THREE.ToneMapping = THREE.NoToneMapping as THREE.ToneMapping, exposure: number = 0.5) {
    const r = makeFakeRenderer();
    r.toneMapping = toneMapping;
    r.toneMappingExposure = exposure;
    return r as THREE.WebGLRenderer;
  }

  it("构造 enabled=false 时，不覆盖 renderer.toneMapping / exposure（保留 sky 写入值）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.55);
    new PostprocessingCapability({ scene, renderer, camera });
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.55, 4);
  });

  it("构造 enabled=true 时写 toneMapping，但 exposure 保持 sky 的值（不夺属主）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.55);
    new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    // 关键：0.55（sky）而非 1.0（ppExposure 默认）——原实现会跳到 1.0，即「亮瞎」真因
    expect(renderer.toneMappingExposure).toBeCloseTo(0.55, 4);
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

  it("apply() enabled=true 时写 toneMapping，exposure 不动", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.1);
    setEnvState({ ppExposure: 1.2 }, { source: "manual" });
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    cap.apply();
    // [ADR-250] ppExposure 不再是 postproc 直写值——它由 sky 侧乘算生效
    expect(renderer.toneMappingExposure).toBeCloseTo(0.1, 4);
  });

  it("sky 活跃时：开关往返全程不写 exposure（sky 的写入权不被侵犯）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.5);
    const skyStub = { id: "sky", isEnabled: () => true } as unknown as SceneCapability;
    const caps = { getById: (id: string) => (id === "sky" ? skyStub : undefined) };
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false, caps });
    expect(renderer.toneMappingExposure).toBeCloseTo(0.5, 4);
    cap.setEnabled(true);
    // 开启不再跳到 ppExposure(1.0)——这正是 1.8× 亮瞎跳变的消除点
    expect(renderer.toneMappingExposure).toBeCloseTo(0.5, 4);
    renderer.toneMappingExposure = 0.58; // sky 周期性重写
    cap.setEnabled(false);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.58, 4);
  });

  it("sky 缺席时：开关往返亦不写 exposure（属主恒定，与 sky 存否无关）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.5);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    cap.setEnabled(true);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.5, 4);
    cap.setEnabled(false);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.5, 4);
  });

  it("setToneMapping/setExposure 在 enabled=false 时只改 params，不动 renderer", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.62);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    const origTM = renderer.toneMapping;
    const origExp = renderer.toneMappingExposure;
    cap.setToneMapping("reinhard");
    cap.setExposure(1.8);
    expect(renderer.toneMapping).toBe(origTM);
    expect(renderer.toneMappingExposure).toBeCloseTo(origExp, 4);
    expect(cap.getParams().toneMapping).toBe("reinhard");
    expect(cap.getParams().exposure).toBeCloseTo(1.8, 4);
  });

  it("setToneMapping 在 enabled=true 时写 renderer.toneMapping；setExposure 仍不写 exposure", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.NoToneMapping, 0.55);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    cap.setToneMapping("linear");
    cap.setExposure(2.0);
    expect(renderer.toneMapping).toBe(THREE.LinearToneMapping);
    // [ADR-250] 曝光值由 sky 侧乘算（skyExposure × ppExposure），非本 cap 直写
    expect(renderer.toneMappingExposure).toBeCloseTo(0.55, 4);
  });

  it("[ADR-250] 启用意图关闭时不碰 renderer（曝光属主归 sky）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState(THREE.ACESFilmicToneMapping, 0.58);
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: false });
    const origExp = renderer.toneMappingExposure;
    const origTM = renderer.toneMapping;
    cap.applyModelPreset("ysm"); // ysm 的 ppEnabled:false
    expect(renderer.toneMapping).toBe(origTM);
    expect(renderer.toneMappingExposure).toBeCloseTo(origExp, 4);
    expect(cap.getParams().exposure).toBeCloseTo(1.0, 4);
    expect(cap.isEnabled()).toBe(false);
  });

  it("[ADR-250] 启用时写 tone mapping，但**不写** toneMappingExposure（sky 独占）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    // sky 已写入自己的曝光（如 0.55），postproc 启用不得覆写它
    renderer.toneMappingExposure = 0.55;
    const cap = new PostprocessingCapability({ scene, renderer, camera, enabled: true });
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    // 关键断言：曝光保持 sky 的值，不被 ppExposure(1.0) 顶掉（原 1.8× 亮瞎的真因）
    expect(renderer.toneMappingExposure).toBeCloseTo(0.55, 4);
    void cap;
  });

  it("[ADR-250] 启用意图经 state 翻转：不再落 cap 字段、不重建 composer", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeRendererWithState();
    // 不传 enabled → 不写状态层（源未定），故 auto-model 预设可自由落地
    const capOn = new PostprocessingCapability({ scene, renderer, camera });
    capOn.applyModelPreset("vrm"); // vrm 的 ppEnabled:true
    expect(capOn.isEnabled()).toBe(true);
    const capOff = new PostprocessingCapability({ scene, renderer, camera });
    capOff.applyModelPreset("ysm"); // ysm 的 ppEnabled:false
    expect(capOff.isEnabled()).toBe(false);
    capOff.setEnabled(true); // 手动开关可任意翻转
    expect(capOff.isEnabled()).toBe(true);
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
  // [ADR-247] 联动读「用户浓度意图」而非「体积光此刻是否可见」：
  // 联动开关是用户偏好（是否接受体积光浓度调制 bloom），不应因聚光灯未开（体积光物理上
  // 不可见）而被静默撤销——否则默认配置（联动 on + 体积光 off）下开关显示「开」却从不生效，
  // 复现「开关撒谎」。故门禁只看联动开关本身，gain 恒取 opacity。
  const lightCap = (opacity: number) =>
    ({ getParams: () => ({ volumetric: { opacity } }) }) as unknown as SceneCapability;

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

  it("联动只受联动开关控制：体积光是否可见（enabled）不影响联动（ADR-247）", () => {
    // 回归锁：曾因门禁读 volumetric.enabled，导致默认配置（联动 on + 体积光 off）
    // 下开关显示「开」却恒不生效——开关撒谎。
    const cap = newCap({ params: { bloomStrength: 0.6, bloomThreshold: 0.6, bloomRadius: 0.5 } });
    const bp = mockBloomPass(cap);
    const withEnabled = (enabled: boolean) =>
      ({ getParams: () => ({ volumetric: { enabled, opacity: 1.0 } }) }) as unknown as SceneCapability;
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(withEnabled(false));
    const off = { threshold: bp.threshold, strength: bp.strength };
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(withEnabled(true));
    // 两种可见性下联动结果必须一致（均按 opacity=1.0 微调）
    expect(bp.threshold).toBeCloseTo(off.threshold, 10);
    expect(bp.strength).toBeCloseTo(off.strength, 10);
    expect(bp.strength).toBeCloseTo(0.6 * 1.2, 6); // 确实联动了（非原值 0.6）
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

  // [ADR-247 D1 审查补强 R2] opacity 非法（undefined/NaN）时必须退化为 0（=不联动），
  // 不得让 NaN 经乘法扩散进 bloomPass.strength/threshold 并永久污染 bloom。
  // 原式 `vol.enabled ? vol.opacity : 0` 在体积光关闭时短路为 0 顺带掩盖了缺失；
  // 改直读后需显式守卫。syncBloomPass 接受外部 stub，生产路径以外也须安全。
  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["null", null],
    ["字符串", "0.5" as unknown as number],
  ])("opacity 非法（%s）时联动退化为 0，不产生 NaN", (_label, bad) => {
    const cap = newCap({ params: { bloomStrength: 0.6, bloomThreshold: 0.6, bloomRadius: 0.5 } });
    const bp = mockBloomPass(cap);
    const stub = { getParams: () => ({ volumetric: { opacity: bad } }) } as unknown as SceneCapability;
    (cap as unknown as { syncBloomPass: (l: unknown) => void }).syncBloomPass(stub);
    expect(Number.isFinite(bp.threshold)).toBe(true);
    expect(Number.isFinite(bp.strength)).toBe(true);
    expect(bp.threshold).toBe(0.6); // 与「不联动」等价
    expect(bp.strength).toBe(0.6);
  });
});

// ============ [ADR-250] 启用意图（envState.ppEnabled）唯一真值源 ============
// 本组原为「总闸 setMasterEnabled + per-type 门禁 applyPostProcDefaults」二元机制测试。
// ADR-250 退役该机制后，保留其**保护意图**转为等价断言：
//   · 「off→on 可恢复」→ ppEnabled 写入即生效且可往返
//   · 「不越权开启」　→ 模型预设不得覆盖用户手动开关（auto-model vs manual 仲裁）
//   · 「无谓重建」　　→ composer 常驻：启用意图翻转不触发 build/dispose
describe("PostprocessingCapability — 启用意图 ppEnabled（ADR-250）", () => {
  function buildSpy() {
    return vi.spyOn(
      PostprocessingCapability.prototype as unknown as { buildComposer: () => void },
      "buildComposer",
    );
  }
  function disposeSpy() {
    return vi.spyOn(
      PostprocessingCapability.prototype as unknown as { disposeComposer: () => void },
      "disposeComposer",
    );
  }

  it("setEnabled 写 envState.ppEnabled 并即时反映到 isEnabled（唯一真值源）", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    expect(envState.ppEnabled).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    expect(envState.ppEnabled).toBe(false);
  });

  it("启用意图 off→on 往返可恢复（原「总闸不抹门禁」不变量等价形式）", () => {
    const cap = newCap({ enabled: true });
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("模型预设写 ppEnabled（auto-model 源）；用户手动设置后不被覆盖", () => {
    // 用户手动开启（manual 源）→ 后续 auto-model 预设不得覆盖（ADR-196 仲裁：manual 最高）
    const cap = newCap({ enabled: false });
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.applyModelPreset("ysm"); // ysm = ppEnabled:false，但用户已 manual → 不覆盖
    expect(cap.isEnabled()).toBe(true);
  });

  it("模型预设写 ppEnabled（auto-model 源）；未经用户手动设置时 preset 生效", () => {
    // envState 是模块级单例，beforeEach 已 reset → 此处 ppEnabled 为默认 false 且源未定
    expect(envState.ppEnabled).toBe(false);
    const fresh = newCap({});
    fresh.applyModelPreset("ysm"); // ysm = ppEnabled:false
    expect(fresh.isEnabled()).toBe(false);
  });

  it("模型预设 vrm/ysm 分别落 true/false", () => {
    const vrmCap = newCap({});
    vrmCap.applyModelPreset("vrm");
    expect(vrmCap.isEnabled()).toBe(true);
  });

  it("applyModelPreset('default') 不写 ppEnabled（default 无该键），保持现值", () => {
    const cap = newCap({ enabled: true });
    cap.applyModelPreset("default");
    expect(cap.isEnabled()).toBe(true);
  });

  // [ADR-250 §2.2] composer 常驻是本 ADR 对「配置缓存失效」的根治点：
  // 启用意图翻转**不得**触发整组 GPU 资源重建——这正是原机制每次换模型的代价。
  it("启用意图翻转不构建/销毁 composer（composer 常驻，缓存失效根治）", () => {
    const cap = newCap({ enabled: true });
    const bSpy = buildSpy();
    const dSpy = disposeSpy();
    bSpy.mockClear();
    dSpy.mockClear();
    cap.setEnabled(false);
    cap.setEnabled(true);
    cap.setEnabled(false);
    expect(bSpy).not.toHaveBeenCalled();
    expect(dSpy).not.toHaveBeenCalled();
  });

  // [ADR-250] loadState 恢复 enabled 落入 ppEnabled，与原 R1 场景等价但失配已不可能发生。
  it("loadState 恢复 enabled=true 落 ppEnabled，off→on 往返自洽（原 R1 场景）", () => {
    localStorage.clear();
    const cap1 = newCap({ enabled: true });
    cap1.saveState();
    const cap2 = newCap({ enabled: false });
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    cap2.setEnabled(false);
    expect(cap2.isEnabled()).toBe(false);
    cap2.setEnabled(true);
    expect(cap2.isEnabled()).toBe(true);
    localStorage.clear();
  });

  it("loadState 后 applyModelPreset('default') 不扰动已恢复的启用意图（原 R1 组合场景）", () => {
    localStorage.clear();
    const cap1 = newCap({ enabled: true });
    cap1.saveState();
    const cap2 = newCap({ enabled: false });
    cap2.loadState();
    cap2.applyModelPreset("default"); // default 无 ppEnabled 键 → 不触碰
    expect(cap2.isEnabled()).toBe(true);
    localStorage.clear();
  });

  // ===== ADR-250 三症状端到端回归（数值锁定，防回退）=====

  it("[症状③] 换模型（ppEnabled 翻转）不重建 composer——GPU 资源同一实例", () => {
    const cap = newCap({});
    const internals = cap as unknown as { composer: unknown; buildComposer: () => void };
    const composerAtStart = internals.composer;
    expect(composerAtStart).not.toBeNull();
    const spy = buildSpy();
    spy.mockClear();
    // 模拟切模型序列：ysm(false) → vrm(true) → mmd(true) → ysm(false)
    cap.applyModelPreset("ysm");
    cap.applyModelPreset("vrm");
    cap.applyModelPreset("mmd");
    cap.applyModelPreset("ysm");
    // 关键：整个切模型序列零重建（原实现每次翻转都 dispose + 重新 allocate 整组 RT）
    expect(spy).not.toHaveBeenCalled();
    expect(internals.composer).toBe(composerAtStart);
  });

  it("[症状②] MMD 开启后处理不抬高 exposure（1.8× 亮瞎消除，数值锁定）", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = makeFakeRenderer();
    // sky 已按 mmd 的 skyExposure 写入有效曝光
    const skyExposure = envState.skyExposure * envState.ppExposure;
    renderer.toneMappingExposure = skyExposure;
    const cap = new PostprocessingCapability({ scene, renderer, camera });
    cap.applyModelPreset("mmd"); // mmd: ppEnabled = true
    expect(cap.isEnabled()).toBe(true);
    // 原实现此处会跳到 ppExposure(1.0) = 约 1.8~2× 亮；现保持不变
    expect(renderer.toneMappingExposure).toBeCloseTo(skyExposure, 6);
  });

  it("[症状①] YSM 默认不开后处理，但用户可手动开回（偏好可覆盖，非钉死）", () => {
    const cap = newCap({});
    cap.applyModelPreset("ysm");
    expect(cap.isEnabled()).toBe(false); // 默认关（满亮材质 + 发光骨）
    cap.setEnabled(true); // 用户手动开 → 生效（原门禁在 cap 私有字段，用户无法覆盖）
    expect(cap.isEnabled()).toBe(true);
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
      // 查询器注入（替代原 setReflectorCap）：?? undefined 吞掉精确 optional 的 null
      ...(opts.reflectorCap !== undefined
        ? { caps: { getById: (id) => (id === "reflector" ? (opts.reflectorCap ?? undefined) : undefined) } }
        : {}),
    });
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

  it("[ADR-250] setEnabled(false) 不拆 composer（常驻）；passes 转旁路，再启用立即可用", () => {
    const { cap } = newRealCap();
    cap.setEnabled(true);
    const composerOn = internalsOf(cap).composer;
    expect(composerOn).not.toBeNull();
    cap.setEnabled(false);
    // 关键：composer 与各 pass 引用仍在（不再 dispose），这是「换模型不再重建 GPU 资源」的根基
    expect(internalsOf(cap).composer).toBe(composerOn);
    expect(internalsOf(cap).bloomPass).not.toBeNull();
    cap.setEnabled(true);
    expect(internalsOf(cap).composer).toBe(composerOn);
  });

  it("[ADR-250] setEnabled(true) 写 toneMapping / SRGB；exposure 归 sky 不受本 cap 支配", () => {
    const { renderer } = newRealCap({ enabled: true, params: { toneMapping: "reinhard", exposure: 1.8 } });
    expect(renderer.toneMapping).toBe(THREE.ReinhardToneMapping);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    // ppExposure(1.8) 不再是 renderer 上的直写值——由 sky 侧乘算 skyExposure × ppExposure
    expect(renderer.toneMappingExposure).not.toBe(1.8);
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
    const rendered = cap.render(0.016, stubLightCap({ opacity: 0.5 }));
    expect(rendered).toBe(true);
    expect(renderSpy).toHaveBeenCalled();
    expect(bloom.threshold).toBeCloseTo(0.85 * (1 - 0.2 * 0.5), 6);
    expect(bloom.strength).toBeCloseTo(1.0 * (1 + 0.2 * 0.5), 6);
    // 联动关闭时回用户原值
    cap.setBloomFollowVolumetric(false);
    cap.render(0.016, stubLightCap({ opacity: 0.5 }));
    expect(bloom.threshold).toBeCloseTo(0.85, 6);
    expect(bloom.strength).toBeCloseTo(1.0, 6);
  });

  it("render()：[ADR-250] composer 常驻——关闭态亦返回 true 并渲染（pass 旁路，不拆不建）", () => {
    const { cap } = newRealCap();
    const renderSpy = vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    // 构造即建 composer（常驻），关闭态走旁路渲染而非回退 renderer.render
    expect(internalsOf(cap).composer).not.toBeNull();
    expect(cap.render(0.016, null)).toBe(true);
    expect(renderSpy).toHaveBeenCalled();
    cap.setEnabled(true);
    expect(cap.render(0.016, null)).toBe(true);
  });

  it("render()：[ADR-250] 关闭态旁路——passes 全部 disabled（等价原 renderer.render）", () => {
    const { cap } = newRealCap();
    vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    expect(cap.isEnabled()).toBe(false);
    cap.render(0.016, stubLightCap({ opacity: 1 }));
    const internals = internalsOf(cap) as unknown as {
      bloomPass: { enabled: boolean };
      composer: unknown;
    };
    // 关闭态 bloomPass 旁路；composer 不销毁（缓存失效根治点）
    expect(internals.bloomPass.enabled).toBe(false);
    expect(internals.composer).not.toBeNull();
  });

  it("needComposer：[ADR-250] composer 常驻后不再因体积光/开关变化而拆建", () => {
    const { cap } = newRealCap();
    vi.spyOn(EffectComposer.prototype as unknown as { render: () => void }, "render").mockImplementation(() => {});
    const composerBefore = internalsOf(cap).composer;
    const rendered = cap.render(0.016, stubLightCap({ opacity: 1 }));
    expect(rendered).toBe(true);
    // 同一实例：未重建（原实现会在 disabled 时 disposeComposer 使其为 null）
    expect(internalsOf(cap).composer).toBe(composerBefore);
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
    // 2026-09-14 查询器机制：构造注入 caps（替代原 setReflectorCap 注入器）
    // [ADR-250] 显式 enabled:false —— composer 构造即建（常驻），此时不启用；
    // 后续 setEnabled(true) 经 envState 派发触发 applyReflectorSync。
    const cap = new PostprocessingCapability({
      scene,
      renderer,
      camera,
      enabled: false,
      caps: { getById: (id) => (id === "reflector" ? reflector : undefined) },
    });
    return { cap, reflector, renderer };
  }

  it("SSR 活动 + reflectorDisableWhenSSR：enable 即同步禁用 reflector，SSR 关闭恢复", () => {
    const { cap, reflector } = makePair();
    expect(reflector.isEnabled()).toBe(true);
    cap.setEnabled(true); // 触发 buildComposer → applyReflectorSync
    expect(reflector.isEnabled()).toBe(false); // SSR 活动自动禁用
    cap.setReflectionMode("envmap-only"); // SSR 关闭 → 重建 composer → 同步恢复
    expect(reflector.isEnabled()).toBe(true); // 恢复
  });

  it("reflectorDisableWhenSSR=false 时不禁用 reflector", () => {
    const { cap, reflector } = makePair({ disableWhenSSR: false });
    cap.setEnabled(true);
    expect(reflector.isEnabled()).toBe(true);
  });

  it("setReflectorDisableWhenSSR(true) 动态禁用；切回 false 恢复", () => {
    const { cap, reflector } = makePair({ disableWhenSSR: false });
    cap.setEnabled(true); // 首同步（query 就绪为 false 分支）
    expect(reflector.isEnabled()).toBe(true);
    cap.setReflectorDisableWhenSSR(true);
    expect(reflector.isEnabled()).toBe(false);
    cap.setReflectorDisableWhenSSR(false);
    expect(reflector.isEnabled()).toBe(true);
  });

  it("查询器缺席时 applyReflectorSync no-op（旧『换引用还原』语义已随注入器退役）", () => {
    const scene = new THREE.Scene();
    const renderer = makeFakeRenderer();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    setEnvState({ ppReflectionMode: "envmap+ssr", ppReflectorDisableWhenSSR: true }, { source: "manual" });
    // 不传 caps → 查询缺席 → 联动 no-op，不崩
    const cap = new PostprocessingCapability({ scene, renderer, camera });
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });

  // [ADR-247 D2] 用户手动覆盖：SSR 抑制期间用户自己重新开 reflector，
  // SSR 关闭时不得用陈旧的 prev 值把用户的选择抹掉。
  // 关键用例：用户压制前是「关」，压制期间手动开 → 解除时必须保持「开」。
  // （若压制前是「开」，回放 prev=true 恰好与用户选择相同，无法区分两条代码路径。）
  it("SSR 抑制期间用户手动开 reflector → SSR 关闭后保留用户的「开」（不回放陈旧 prev=false）", () => {
    const { cap, reflector } = makePair();
    reflector.setEnabled(false); // 用户压制前：reflector 关
    cap.setEnabled(true); // SSR 活动 → prev 记录 false（本就关，无需动作）
    expect(reflector.isEnabled()).toBe(false);
    // 用户在 SSR 仍活动时手动开启 reflector（面板 toggle 走 setEnabled）
    reflector.setEnabled(true);
    expect(reflector.isEnabled()).toBe(true);
    // SSR 关闭：我们已非压制持有者（reflector 已被用户开回），须保留用户选择
    cap.setReflectionMode("envmap-only");
    expect(reflector.isEnabled()).toBe(true); // ← 旧实现用 prev=false 抹掉，此处转红
  });

  // [R3] 用户手动重开后再触发任意一次 postprocessing 侧同步：SSR 仍活动 → 会再次压制。
  // 这是「SSR 活动期间 reflector 必须关闭」功能的预期行为（用户偏好让位于功能语义），
  // 本用例锁定该预期，避免被误当缺陷「修掉」。
  it("SSR 仍活动时用户手动重开会被再次压制（功能语义优先，非缺陷）", () => {
    const { cap, reflector } = makePair();
    cap.setEnabled(true);
    expect(reflector.isEnabled()).toBe(false);
    reflector.setEnabled(true); // 用户手动重开
    expect(reflector.isEnabled()).toBe(true);
    // 任意一次 postprocessing 侧同步（如切 disableWhenSSR 开关）→ SSR 仍活动 → 重新压制
    cap.setReflectorDisableWhenSSR(true);
    expect(reflector.isEnabled()).toBe(false);
    // 且压制基准仍是「最初压制前」的值（true），SSR 关闭后正确恢复
    cap.setReflectionMode("envmap-only");
    expect(reflector.isEnabled()).toBe(true);
  });

  it("SSR 关闭后不残留抑制态：再次开启 SSR 仍能正常抑制与还原", () => {
    const { cap, reflector } = makePair();
    cap.setEnabled(true);
    expect(reflector.isEnabled()).toBe(false);
    cap.setReflectionMode("envmap-only");
    expect(reflector.isEnabled()).toBe(true);
    // 第二轮：抑制态须已完全清空，不能因残留哨兵而跳过抑制
    cap.setReflectionMode("envmap+ssr");
    expect(reflector.isEnabled()).toBe(false);
    cap.setReflectionMode("envmap-only");
    expect(reflector.isEnabled()).toBe(true);
  });

  it("reflector 原本就关：SSR 开关一轮后仍保持关闭（不误恢复为开）", () => {
    const { cap, reflector } = makePair();
    reflector.setEnabled(false); // 用户先关掉 reflector
    cap.setEnabled(true); // SSR 活动，prev=false
    expect(reflector.isEnabled()).toBe(false);
    cap.setReflectionMode("envmap-only");
    expect(reflector.isEnabled()).toBe(false); // 仍关，不被误开
  });

  it("dispose 恢复被禁用的 reflector", () => {
    const { cap, reflector } = makePair();
    cap.setEnabled(true);
    expect(reflector.isEnabled()).toBe(false);
    cap.dispose();
    expect(reflector.isEnabled()).toBe(true);
  });

  it("启用意图关闭后 reflector 保持禁用（SSR 配置仍在），dispose 才恢复", () => {
    const { cap, reflector } = makePair();
    cap.setEnabled(true);
    expect(reflector.isEnabled()).toBe(false);
    // [ADR-250] 关闭后 composer 常驻（不拆）；params.reflectionMode 仍是 SSR
    // → applyReflectorSync 维持禁用语义
    cap.setEnabled(false);
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
  it("getMasterNodeId 声明 pp-enabled（场景组一级 headerToggle + 面板 filter 契约）", () => {
    const cap = newCap();
    expect(cap.getMasterNodeId()).toBe("pp-enabled");
    expect(cap.getMenuNodes().map((n) => n.id)).toContain("pp-enabled");
  });

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
