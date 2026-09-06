// @vitest-environment node
// ===== ReflectorCapability 测试（preview-3d/caps/reflector-capability.ts）=====
// 覆盖：构造默认值、启用禁用、透明度/颜色、尺寸/精度、预设、持久化、getMenuControls。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  ReflectorCapability,
  DEFAULT_REFLECTOR_PARAMS,
  REFLECTOR_PRESETS,
} from "./reflector-capability.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";

// buildReflector 的 Reflector 构造（geometry + ShaderMaterial + WebGLRenderTarget）是纯数据
// 对象创建，不触碰真实 WebGL context，node 环境可直接跑真实管线（onBeforeRender 渲染除外）。

function newCap(opts: { enabled?: boolean; params?: Partial<import("./reflector-capability.ts").ReflectorParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = {
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
  // params/enabled 为构造参数可选键——仅真实存在时附带，避免显式 undefined 流入
  return new ReflectorCapability({
    scene,
    renderer,
    ...(opts.params !== undefined ? { params: opts.params } : {}),
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
}

describe("ReflectorCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    expect(cap.isEnabled()).toBe(false);
    expect(p.opacity).toBe(0.6);
    expect(p.size).toBe(100);
    expect(p.resolution).toBe(1024);
    expect(p.color).toBe(0xffffff);
    expect(p.clipBias).toBe(0.003);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { opacity: 0.8, size: 200, resolution: 2048 } });
    const p = cap.getParams();
    expect(p.opacity).toBe(0.8);
    expect(p.size).toBe(200);
    expect(p.resolution).toBe(2048);
  });
});

describe("ReflectorCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ReflectorCapability — 透明度与颜色", () => {
  it("setOpacity 限制 [0, 1]", () => {
    const cap = newCap();
    cap.setOpacity(0.5);
    expect(cap.getParams().opacity).toBe(0.5);
    cap.setOpacity(1.5);
    expect(cap.getParams().opacity).toBe(1);
    cap.setOpacity(-0.5);
    expect(cap.getParams().opacity).toBe(0);
  });

  it("setColor 设置颜色", () => {
    const cap = newCap();
    cap.setColor(0xff0000);
    expect(cap.getParams().color).toBe(0xff0000);
  });
});

describe("ReflectorCapability — 尺寸与精度", () => {
  it("setSize 设置地面大小", () => {
    const cap = newCap();
    cap.setSize(300);
    expect(cap.getParams().size).toBe(300);
  });

  it("setResolution 设置反射精度", () => {
    const cap = newCap();
    cap.setResolution(512);
    expect(cap.getParams().resolution).toBe(512);
  });
});

describe("ReflectorCapability — 预设", () => {
  it("setPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    const p = cap.getParams();
    expect(p.opacity).toBe(0.5);
    expect(p.size).toBe(60);
    cap.setPreset("litematic");
    const p2 = cap.getParams();
    expect(p2.opacity).toBe(0.25);
    expect(p2.size).toBe(500);
  });
});

describe("ReflectorCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: { opacity: 0.8, size: 200, resolution: 2048, color: 0xffeedd, clipBias: 0.005 } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    const p = cap2.getParams();
    expect(p.opacity).toBe(0.8);
    expect(p.size).toBe(200);
    expect(p.resolution).toBe(2048);
    expect(p.color).toBe(0xffeedd);
    expect(p.clipBias).toBe(0.005);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { opacity: 0.3 } });
    cap.loadState();
    expect(cap.getParams().opacity).toBe(0.3);
  });

  it("setPreset 在 loadState 已恢复后不覆盖用户会话（对齐 shadow 的 isStateLoaded 守卫）", () => {
    const cap1 = newCap({ params: { opacity: 0.9, size: 300 } });
    cap1.saveState();
    const cap2 = newCap();
    cap2.loadState();
    cap2.setPreset("litematic");
    const p = cap2.getParams();
    expect(p.opacity).toBe(0.9);
    expect(p.size).toBe(300);
  });

  it("setPreset 在空存储（未恢复过状态）时照常套用模型预设", () => {
    const cap = newCap();
    cap.loadState();
    cap.setPreset("vrm");
    expect(cap.getParams().opacity).toBe(0.5);
  });
});

describe("ReflectorCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  it("非总开关节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // master toggle 在顶层
    expect(nodes[0]!.id).toBe("reflector-enabled");
    // 其余节点在 folder children 内
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    const childIds = folder.children!.map((c) => c.id);
    expect(childIds).toContain("reflector-opacity");
    expect(childIds).toContain("reflector-resolution");
    expect(childIds).toContain("reflector-size");
    // folder 的 labelKey 对应原 group
    expect(folder.labelKey).toBe("preview.reflectorGroupParams");
  });

  it("toggle 开关同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "reflector-enabled")!;
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ReflectorCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  it("完整树 = master toggle 原生节点 + 参数组 folder（3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(2);
    // master toggle
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("reflector-enabled");
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    nodes[0]!.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    // 参数组 folder
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.reflectorGroupParams");
    expect(folder.children!.map((c) => c.id)).toEqual([
      "reflector-opacity",
      "reflector-resolution",
      "reflector-size",
    ]);
    // 全部原生节点（reflector 无复杂控件，不走 controls 通道）
    expect(folder.children!.every((c) => c.kind === "slider")).toBe(true);
  });

  it("剔除 master 后的子树（env 二级 body 语义）：仅参数组 folder", () => {
    const cap = newCap();
    const rest = cap.getMenuNodes().filter((n) => n.id !== cap.getMasterNodeId());
    expect(rest).toHaveLength(1);
    expect(rest[0]!.kind).toBe("folder");
    expect(rest[0]!.children!.some((c) => c.id === "reflector-enabled")).toBe(false);
  });

  it("slider 节点读写闭包直连 cap 参数", () => {
    const cap = newCap({ params: { opacity: 0.75 } });
    const folder = cap.getMenuNodes()[1]!;
    const opacity = folder.children!.find((c) => c.id === "reflector-opacity")!;
    expect(opacity.control!.get!(undefined)).toBe(0.75);
    opacity.control!.set!(0.42);
    expect(cap.getParams().opacity).toBe(0.42);
  });
});

describe("ReflectorCapability — 预设数据完整性", () => {
  it("DEFAULT_REFLECTOR_PARAMS 默认值完整", () => {
    expect(DEFAULT_REFLECTOR_PARAMS.enabled).toBe(false);
    expect(DEFAULT_REFLECTOR_PARAMS.size).toBe(100);
    expect(DEFAULT_REFLECTOR_PARAMS.resolution).toBe(1024);
    expect(DEFAULT_REFLECTOR_PARAMS.opacity).toBe(0.6);
    expect(DEFAULT_REFLECTOR_PARAMS.clipBias).toBe(0.003);
  });

  it("REFLECTOR_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(REFLECTOR_PRESETS[t]).toBeDefined();
    }
  });
});
describe("ReflectorCapability — 真实管线", () => {
  it("setEnabled(true) 后 scene 出现 ysm-reflector mesh，位置/旋转/uOpacity 就位", () => {
    const cap = newCap({ enabled: true, params: { opacity: 0.75 } });
    cap.apply(); // 构造不自动 build，需 apply 显式挂载
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    expect(reflector).toBeDefined();
    expect(reflector.position.y).toBeCloseTo(GROUND_LAYER_OFFSETS.reflector, 5);
    expect(reflector.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    const mat = reflector.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.uniforms.uOpacity.value).toBe(0.75);
    // opacity 注入成功：fragmentShader 含 uOpacity
    expect(mat.fragmentShader).toContain("uOpacity");
  });

  it("setOpacity 挂载态下更新 uniforms.uOpacity（不重建）", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    const mat = reflector.material as THREE.ShaderMaterial;
    cap.setOpacity(0.2);
    expect(mat.uniforms.uOpacity.value).toBe(0.2);
  });

  it("setColor 挂载态下更新 uniforms.color（官方 tint 通道）", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const reflector = ((cap as unknown as { scene: THREE.Scene }).scene.getObjectByName("ysm-reflector")) as THREE.Mesh;
    const mat = reflector.material as THREE.ShaderMaterial;
    cap.setColor(0x123456);
    expect((mat.uniforms.color.value as THREE.Color).getHex()).toBe(0x123456);
  });

  it("setSize/setResolution/setClipBias 挂载态下触发重建（旧 mesh 移除 + 新 mesh 就位）", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const first = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    cap.setSize(300);
    const second = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    expect(second).toBeDefined();
    expect(second).not.toBe(first); // 重建
    cap.setResolution(512);
    cap.setClipBias(0.008);
    expect((cap.getParams().clipBias)).toBe(0.008);
  });

  it("reflector 平面贴地偏移：position.y = GROUND_LAYER_OFFSETS.reflector（-0.01，z-fighting 防御）", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const reflector = ((cap as unknown as { scene: THREE.Scene }).scene.getObjectByName("ysm-reflector")) as THREE.Mesh;
    expect(reflector.position.y).toBeCloseTo(GROUND_LAYER_OFFSETS.reflector, 5);
  });

  it("setPreset 挂载态下重建（新尺寸参数生效）", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.setPreset("litematic");
    expect((scene.getObjectByName("ysm-reflector") as THREE.Mesh).material).toBeDefined();
    expect(cap.getParams().size).toBe(500);
  });

  it("setEnabled(false) 移除并释放；重复 apply 幂等", () => {
    const cap = newCap({ enabled: true });
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector")!;
    const geoDisposeSpy = vi.spyOn((reflector as THREE.Mesh).geometry, "dispose");
    cap.setEnabled(false);
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    expect(geoDisposeSpy).toHaveBeenCalled();
    cap.apply(); // enabled=false → 不再创建
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    cap.dispose(); // 幂等
  });

  it("loadState(enabled=true) 直接重建反射面", () => {
    localStorage.setItem("ysm-scene-cap-reflector", JSON.stringify({ enabled: true, size: 250, opacity: 0.4 }));
    const cap = newCap();
    cap.loadState();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    expect(reflector).toBeDefined();
    expect(cap.getParams().size).toBe(250);
    localStorage.removeItem("ysm-scene-cap-reflector");
  });

  it("apply 挂载（enabled 默认 false 时不创建）", () => {
    const cap = newCap({ enabled: true });
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.apply();
    expect(scene.getObjectByName("ysm-reflector")).toBeDefined();
    const capOff = newCap();
    capOff.apply();
    expect(((capOff as unknown as { scene: THREE.Scene }).scene.getObjectByName("ysm-reflector"))).toBeUndefined();
  });
});

// ============ 菜单控件联动 ============
describe("ReflectorCapability — 菜单控件联动（节点 control 闭包）", () => {
  it("opacity/resolution/size 滑块读写联动", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[1]!;
    const by = (id: string) => folder.children!.find((c) => c.id === id)!;
    by("reflector-opacity").control!.set!(0.9);
    expect(by("reflector-opacity").control!.get!(undefined)).toBe(0.9);
    by("reflector-resolution").control!.set!(2048);
    expect(by("reflector-resolution").control!.get!(undefined)).toBe(2048);
    by("reflector-size").control!.set!(400);
    expect(by("reflector-size").control!.get!(undefined)).toBe(400);
  });
});
