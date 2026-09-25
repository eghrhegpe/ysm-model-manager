// @vitest-environment node
// ===== ReflectorCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { ReflectorCapability } from "./reflector-capability.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";
import { findNodeById, childIds, nodeIds } from "@/preview-3d/menu/menu-test-helpers.ts";

// ADR-196：构造即注册全局 env 回调、仅 dispose 注销；与 ground/sky/water 同侪一致，
// afterEach 清空防 cap 泄漏跨测试（O(N²) 回调累积超时隐患）。
afterEach(() => { clearEnvCallbacks(); });

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

function newCap() {
  const scene = new THREE.Scene();
  return new ReflectorCapability({ scene, renderer: makeFakeRenderer() });
}

describe("ReflectorCapability — 构造与默认值", () => {
  beforeEach(() => { resetEnvState(); });

  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    // [锐评 F-1] 总开关单门收口后 isEnabled() 读 schema 键（默认关，与 water 同纪律）
    expect(cap.isEnabled()).toBe(false);
    expect(envState.reflectorEnabled).toBe(false);
    expect(p.enabled).toBe(false);
    expect(p.opacity).toBe(0.6);
    expect(p.size).toBe(100);
    expect(p.resolution).toBe(1024);
    expect(p.color).toBe(0xffffff);
    expect(p.clipBias).toBe(0.003);
  });

  it("构造不再是开关写口（总开关唯读 schema 键）", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnvState 覆盖生效", () => {
    setEnvState({ reflectorOpacity: 0.8, reflectorSize: 200, reflectorResolution: 2048 }, { source: 'manual' });
    const cap = newCap();
    const p = cap.getParams();
    expect(p.opacity).toBe(0.8);
    expect(p.size).toBe(200);
    expect(p.resolution).toBe(2048);
  });
});

describe("ReflectorCapability — 启用/禁用", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnabledReflector 切换", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    expect(envState.reflectorEnabled).toBe(true);
    cap.setEnabledReflector(false);
    expect(envState.reflectorEnabled).toBe(false);
  });
});

describe("ReflectorCapability — 透明度与颜色", () => {
  beforeEach(() => { resetEnvState(); });

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
  beforeEach(() => { resetEnvState(); });

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
  beforeEach(() => { resetEnvState(); });

  it("[ADR-284] applyModelPreset 仅按场景尺度改 size，不再改 opacity（噪声解耦）", () => {
    const cap = newCap();
    cap.applyModelPreset("vrm");
    const p = cap.getParams();
    // opacity 不再随类别变化 → 回落 schema 默认 0.6；size 是场景尺度参数，保留。
    expect(p.opacity).toBe(0.6);
    expect(p.size).toBe(60);
    cap.applyModelPreset("litematic");
    const p2 = cap.getParams();
    expect(p2.opacity).toBe(0.6);
    expect(p2.size).toBe(500);
  });
});

describe("ReflectorCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); resetEnvState(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    setEnvState({ reflectorEnabled: true, reflectorOpacity: 0.8, reflectorSize: 200, reflectorResolution: 2048, reflectorColor: 0xffeedd, reflectorClipBias: 0.005 }, { source: 'manual' });
    const cap = newCap();
    cap.saveState();
    resetEnvState();
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
    const cap = newCap();
    cap.loadState();
    expect(cap.getParams().opacity).toBe(0.6);
  });

  it("applyModelPreset 在 loadState 已恢复后不覆盖用户会话（对齐 shadow 的 isStateLoaded 守卫）", () => {
    setEnvState({ reflectorOpacity: 0.9, reflectorSize: 300 }, { source: 'manual' });
    const cap1 = newCap();
    cap1.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    cap2.applyModelPreset("litematic");
    const p = cap2.getParams();
    expect(p.opacity).toBe(0.9);
    expect(p.size).toBe(300);
  });

  it("applyModelPreset 在空存储（未恢复过状态）时照常套用模型预设", () => {
    const cap = newCap();
    cap.loadState();
    cap.applyModelPreset("vrm");
    // [ADR-284] opacity 噪声解耦，vrm 仅剩场景尺度 size=60；resolution 1024==默认已删。
    expect(cap.getParams().size).toBe(60);
  });
});

describe("ReflectorCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => { resetEnvState(); });

  it("非总开关节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // master toggle 在顶层（逐 id 硬断言）
    const master = findNodeById(nodes, "reflector-enabled");
    expect(master.id).toBe("reflector-enabled");
    // 其余节点在 folder children 内
    const folder = findNodeById(nodes, "cap-group-reflector-params");
    expect(folder.kind).toBe("folder");
    const ids = childIds(folder);
    expect(ids).toContain("reflector-opacity");
    expect(ids).toContain("reflector-resolution");
    expect(ids).toContain("reflector-size");
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
  beforeEach(() => { resetEnvState(); });

  it("完整树 = master toggle 原生节点 + 参数组 folder（3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 顶层 2 节点成员（精确集合，不测顺序）
    expect(nodeIds(nodes).sort()).toEqual(["reflector-enabled", "cap-group-reflector-params"].sort());
    const master = findNodeById(nodes, "reflector-enabled");
    expect(master.kind).toBe("toggle");
    // [锐评 F-1] master toggle 读数 = schema 键（默认关，与 water 同纪律）
    expect(master.control!.get!(undefined)).toBe(false);
    master.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    master.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    // 参数组 folder
    const folder = findNodeById(nodes, "cap-group-reflector-params");
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.reflectorGroupParams");
    // 参数组 3 子成员（精确集合，不测顺序）
    expect(childIds(folder).sort()).toEqual(["reflector-opacity", "reflector-resolution", "reflector-size"].sort());
    // 全部原生节点（reflector 无复杂控件，不走 controls 通道）
    expect(folder.children!.every((c) => c.kind === "slider")).toBe(true);
  });

  it("剔除 master 后的子树（env 二级 body 语义）：仅参数组 folder", () => {
    const cap = newCap();
    const rest = cap.getMenuNodes().filter((n) => n.id !== cap.getMasterNodeId());
    // 剔除后成员 = 仅参数组 folder（集合断言）
    expect(nodeIds(rest).sort()).toEqual(["cap-group-reflector-params"].sort());
    const folder = findNodeById(rest, "cap-group-reflector-params");
    expect(folder.kind).toBe("folder");
    expect(folder.children!.some((c) => c.id === "reflector-enabled")).toBe(false);
  });

  it("slider 节点读写闭包直连 cap 参数", () => {
    setEnvState({ reflectorOpacity: 0.75 }, { source: "manual" });
    const cap = newCap();
    const folder = findNodeById(cap.getMenuNodes(), "cap-group-reflector-params");
    const opacity = findNodeById(folder.children!, "reflector-opacity");
    expect(opacity.control!.get!(undefined)).toBe(0.75);
    opacity.control!.set!(0.42);
    expect(cap.getParams().opacity).toBe(0.42);
  });
});

describe("ReflectorCapability — 真实管线", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabledReflector(true) + apply 后 scene 出现 ysm-reflector mesh，位置/旋转/uOpacity 就位", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    expect(reflector).toBeDefined();
    expect(reflector.position.y).toBeCloseTo(GROUND_LAYER_OFFSETS.reflector, 5);
    expect(reflector.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    const mat = reflector.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.uniforms.uOpacity.value).toBe(0.6);
    // opacity 注入成功：fragmentShader 含 uOpacity
    expect(mat.fragmentShader).toContain("uOpacity");
  });

  it("setOpacity 挂载态下更新 uniforms.uOpacity", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.apply();
    cap.setOpacity(0.2);
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    const mat = reflector.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uOpacity.value).toBe(0.2);
  });

  it("setColor 挂载态下更新 uniforms.color（官方 tint 通道）", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.apply();
    cap.setColor(0x123456);
    const reflector = ((cap as unknown as { scene: THREE.Scene }).scene.getObjectByName("ysm-reflector")) as THREE.Mesh;
    const mat = reflector.material as THREE.ShaderMaterial;
    expect((mat.uniforms.color.value as THREE.Color).getHex()).toBe(0x123456);
  });

  it("setSize/setResolution/setClipBias 挂载态下触发重建（旧 mesh 移除 + 新 mesh 就位）", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
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
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.apply();
    const reflector = ((cap as unknown as { scene: THREE.Scene }).scene.getObjectByName("ysm-reflector")) as THREE.Mesh;
    expect(reflector.position.y).toBeCloseTo(GROUND_LAYER_OFFSETS.reflector, 5);
  });

  it("applyModelPreset 挂载态下重建（新尺寸参数生效）", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.applyModelPreset("litematic");
    expect((scene.getObjectByName("ysm-reflector") as THREE.Mesh).material).toBeDefined();
    expect(cap.getParams().size).toBe(500);
  });

  it("setEnabled(false) 移除并释放；重复 apply 幂等", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
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
    localStorage.setItem("ysm-scene-cap-reflector", JSON.stringify({ enabled: true, reflectorEnabled: true, size: 250, opacity: 0.4 }));
    const cap = newCap();
    cap.loadState();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const reflector = scene.getObjectByName("ysm-reflector") as THREE.Mesh;
    expect(reflector).toBeDefined();
    expect(cap.getParams().size).toBe(250);
    localStorage.removeItem("ysm-scene-cap-reflector");
  });

  it("apply 挂载（总开关默认关时不创建，schema 键开后才创建）", () => {
    const cap = newCap();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.apply();
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    cap.setEnabledReflector(true);
    expect(scene.getObjectByName("ysm-reflector")).toBeDefined();
  });
});

// ============ 菜单控件联动 ============
describe("ReflectorCapability — 菜单控件联动（节点 control 闭包）", () => {
  beforeEach(() => { resetEnvState(); });

  it("菜单滑杆值域 = schema 值域（ADR-283：菜单不再是第二事实源）", () => {
    const cap = newCap();
    const folder = findNodeById(cap.getMenuNodes(), "cap-group-reflector-params");
    for (const [id, key] of [
      ["reflector-opacity", "reflectorOpacity"],
      ["reflector-resolution", "reflectorResolution"],
      ["reflector-size", "reflectorSize"],
    ] as const) {
      const c = findNodeById(folder.children!, id).control!;
      expect({ min: c.min, max: c.max, step: c.step, unit: c.unit }, `${id} 值域应来自 schema`).toEqual(
        getParamRange(key),
      );
    }
  });

  it("opacity/resolution/size 滑块读写联动", () => {
    const cap = newCap();
    const folder = findNodeById(cap.getMenuNodes(), "cap-group-reflector-params");
    const by = (id: string) => findNodeById(folder.children!, id);
    by("reflector-opacity").control!.set!(0.9);
    expect(by("reflector-opacity").control!.get!(undefined)).toBe(0.9);
    by("reflector-resolution").control!.set!(2048);
    expect(by("reflector-resolution").control!.get!(undefined)).toBe(2048);
    by("reflector-size").control!.set!(400);
    expect(by("reflector-size").control!.get!(undefined)).toBe(400);
  });
});

// [锐评 F-2] 恢复路径来源纪律（fog F-2 / light L-1 / ground 同口径）：存档恢复是
// **程序化动作**，非用户手改，source 一律 auto-model——原实现 6 处全 manual，把
// reflector 组键的 lastWriteSource 冻死，此后同轨 auto-model（MODEL_DEFAULTS 携
// reflectorSize / reflectorResolution）写入被 shouldOverwrite 静默拒绝。
// 判据用**行为**（_writeSource 是模块私有、无导出读口），同 fog/light 先例。
describe("ReflectorCapability — 恢复路径来源纪律（锐评 F-2）", () => {
  beforeEach(() => {
    resetEnvState();
    localStorage.removeItem("ysm-scene-cap-reflector");
  });
  afterEach(() => localStorage.removeItem("ysm-scene-cap-reflector"));

  it("[F-2] loadState 后 auto-model 仍能写 reflectorSize（恢复不得冻成 manual）", () => {
    // 存档形态 = 本 cap saveState 的**实际**键形（无前缀 size/resolution/…，见 saveState）。
    localStorage.setItem(
      "ysm-scene-cap-reflector",
      JSON.stringify({ reflectorEnabled: true, size: 400, resolution: 512 }),
    );
    const cap = newCap();
    cap.loadState();
    expect(envState.reflectorSize, "存档值先落地").toBe(400);
    setEnvState({ reflectorSize: 150 }, { source: "auto-model" });
    expect(envState.reflectorSize, "恢复后模型默认值仍须能落地").toBe(150);
  });

  it("[F-2] loadState 后 auto-model 仍能写 reflectorResolution", () => {
    localStorage.setItem(
      "ysm-scene-cap-reflector",
      JSON.stringify({ reflectorEnabled: true, size: 400, resolution: 512 }),
    );
    const cap = newCap();
    cap.loadState();
    setEnvState({ reflectorResolution: 2048 }, { source: "auto-model" });
    expect(envState.reflectorResolution).toBe(2048);
  });
});

// [锐评 F-1] 能力总开关单门收口（fog/water/shadow 先例）：reflector 原为**双门**
// `!this.enabled || !envState.reflectorEnabled`，且 isEnabled() 只读私有门。两门默认值
// **相反**（私有 true / schema false，schema 侧刻意默认关——reflector-menu 同纪律
// 「每帧多一次整场重渲不是白拿的」），故**首启无存档时两门必然不同步**：菜单显示 ON、
// `buildReflector` 却因 reflectorEnabled=false 不建 mesh——与 fog 收口前的
// 「master toggle 显示 ON 而 scene.fog 恒 null」是同一脱节病。收口 = 删私有门。
describe("ReflectorCapability — 能力总开关单门收口（锐评 F-1）", () => {
  beforeEach(() => {
    resetEnvState();
    localStorage.removeItem("ysm-scene-cap-reflector");
  });
  afterEach(() => localStorage.removeItem("ysm-scene-cap-reflector"));

  it("[F-1] 私有门已退役（僵尸门守卫：构造不再收 enabled，实例无 enabled 自有属性）", () => {
    const cap = newCap();
    expect("enabled" in cap, "私有 enabled 不得复活").toBe(false);
  });

  it("[F-1] isEnabled/setEnabled 收敛为 envState.reflectorEnabled 别名（首启两门不再背离）", () => {
    const cap = newCap();
    // 首启：schema 默认 false → 菜单读数必须同步为 false（旧实现读私有门恒 true = 显示 ON 却无镜）
    expect(envState.reflectorEnabled).toBe(false);
    expect(cap.isEnabled(), "首启不得显示 ON 而无镜").toBe(false);
    expect(cap.getParams().enabled, "getParams 与 isEnabled 同源").toBe(false);
    // 写口只动 schema 键，且菜单读数随之翻转
    cap.setEnabled(true);
    expect(envState.reflectorEnabled).toBe(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(envState.reflectorEnabled).toBe(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("[F-1] 总开关只认 schema 键：直接改 envState.reflectorEnabled 即驱动 mesh 建/拆", () => {
    const cap = newCap();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.setEnabledReflector(true);
    expect(scene.getObjectByName("ysm-reflector")).toBeDefined();
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabledReflector(false);
    expect(scene.getObjectByName("ysm-reflector")).toBeUndefined();
    expect(cap.isEnabled()).toBe(false);
  });

  it("[F-1] saveState 不再落无前缀幽灵键 enabled（只写 schema 键形）", () => {
    const cap = newCap();
    cap.setEnabledReflector(true);
    cap.saveState();
    const saved = JSON.parse(localStorage.getItem("ysm-scene-cap-reflector")!) as Record<string, unknown>;
    expect("enabled" in saved, "无前缀幽灵键不得再进存档").toBe(false);
    expect("reflectorEnabled" in saved).toBe(true);
    expect(saved.reflectorEnabled).toBe(true);
  });

  it("[F-1] legacy enabled 回填进 schema 键（旧档不丢用户选择）", () => {
    // 旧档：只有无前缀 enabled，无 reflectorEnabled → 须回填，不得静默丢弃
    localStorage.setItem("ysm-scene-cap-reflector", JSON.stringify({ enabled: true, size: 250 }));
    const cap = newCap();
    cap.loadState();
    expect(envState.reflectorEnabled, "legacy enabled 须回填 schema 键").toBe(true);
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    expect(scene.getObjectByName("ysm-reflector"), "回填后应重建反射面").toBeDefined();
    expect(cap.isEnabled()).toBe(true);
  });

  it("[F-1] legacy 中毒救回：旧档 enabled=false 后仍能重新开启（不得永久关不掉）", () => {
    localStorage.setItem("ysm-scene-cap-reflector", JSON.stringify({ enabled: false, reflectorEnabled: false }));
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    expect(scene.getObjectByName("ysm-reflector"), "中毒后须能救回").toBeDefined();
    expect(cap.isEnabled()).toBe(true);
  });
});
