// @vitest-environment node
// ===== LightCapability 测试 =====
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  LightCapability,
  DEFAULT_LIGHT_PARAMS,
  spotDistanceAttenuation,
} from "./light-capability.ts";
import type { SceneCapability } from "./scene-capability.ts";
import { toModelType } from "@/preview-3d/state/model-defaults.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";

// ADR-196：构造即注册全局 env 回调、仅 dispose 注销；与 ground/sky/water 同侪一致，
// afterEach 清空防 cap 泄漏跨测试（O(N²) 回调累积超时隐患）。
afterEach(() => { clearEnvCallbacks(); });

// ---- 假渲染器 ----
function makeFakeRenderer() {
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
  return renderer;
}

function newCap(opts: { enabled?: boolean; target?: THREE.Vector3; targetHeight?: number } = {}) {
  return new LightCapability({
    scene: new THREE.Scene(),
    renderer: makeFakeRenderer(),
    ...opts,
  });
}

/** 往返 helper：saveState 后新实例 loadState（spotlight 开启），
 *  返回恢复后的实例与 params。ON/OFF 两方向共用，消除测试结构重复（jscpd）。
 *  [ADR-246 D1] 原「cone 引擎」维度已随 postprocess 空壳一并删除。 */
function roundtripConeVolumetric(opts: { volumetricEnabled: boolean }): {
  cap2: LightCapability;
  p: ReturnType<LightCapability["getParams"]>;
} {
  const cap = newCap();
  cap.applyModelPreset("mmd", { manual: true });
  cap.setSpotlight({ enabled: true });
  cap.setVolumetric({ enabled: opts.volumetricEnabled });
  cap.saveState();
  const cap2 = newCap();
  cap2.loadState();
  return { cap2, p: cap2.getParams() };
}

describe("LightCapability — 构造函数与默认值", () => {
  beforeEach(() => resetEnvState());

  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    expect(p.spotlight.enabled).toBe(false);
    expect(p.volumetric.enabled).toBe(false);
    expect(p.ambient.intensity).toBe(0.5);
    expect(cap.isEnabled()).toBe(true);
  });

  it("enabled:false 初始不挂载", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getParams().key.enabled).toBe(true); // 参数不受 enabled 影响
  });

  it("params 覆盖生效", () => {
    // ADR-196：参数经 envState 读入，setEnvState → callback → Three 应用
    const cap = newCap();
    cap.setParams({ ambient: { intensity: 0.9 } });
    expect(cap.getParams().ambient.intensity).toBe(0.9);
  });

  it("target 默认 (0,0,0)，可覆盖", () => {
    const cap = newCap({ target: new THREE.Vector3(3, 2, 1) });
    const t = cap.getTarget();
    expect(t.x).toBe(3);
    expect(t.y).toBe(2);
    expect(t.z).toBe(1);
  });
});

describe("LightCapability — apply / setEnabled / dispose", () => {
  beforeEach(() => resetEnvState());

  it("apply 挂入全部灯光到场景", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    // 六个对象：key/fill/rim/ambient/spotlight/spotlightTarget
    const names = scene.children.map((c) => c.name || c.type);
    expect(scene.children.length).toBeGreaterThanOrEqual(6);
    expect(names.some((n) => n.includes("SpotLight"))).toBe(true);
  });

  it("setEnabled(false) 从场景移除全部灯光", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.children.length).toBeGreaterThanOrEqual(6);
    cap.setEnabled(false);
    expect(scene.children.length).toBe(0);
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnabled 切换：false→true 重新挂载", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.setEnabled(false);
    expect(scene.children.length).toBe(0);
    cap.setEnabled(true);
    expect(scene.children.length).toBeGreaterThanOrEqual(6);
  });

  it("dispose 释放并清空场景（重复 dispose 幂等）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.dispose();
    expect(scene.children.length).toBe(0);
    cap.dispose(); // 幂等：不抛错
  });

  it("[light-gizmo] 方向光灯 helper 挂场景且显隐跟随 enabled（开灯即见来向，关灯即收）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    const keyHelper = scene.getObjectByName("ysm-light-key-helper") as THREE.DirectionalLightHelper;
    const fillHelper = scene.getObjectByName("ysm-light-fill-helper") as THREE.DirectionalLightHelper;
    const rimHelper = scene.getObjectByName("ysm-light-rim-helper") as THREE.DirectionalLightHelper;
    expect(keyHelper).toBeDefined();
    expect(fillHelper).toBeDefined();
    expect(rimHelper).toBeDefined();
    // 默认三盏方向光均开 → helper 可见（开关一眼可见）
    expect(keyHelper.visible).toBe(true);
    expect(fillHelper.visible).toBe(true);
    expect(rimHelper.visible).toBe(true);
    // 关主灯 → 其 helper 立刻收起（其余不变）
    cap.setParams({ key: { enabled: false } });
    expect(keyHelper.visible).toBe(false);
    expect(fillHelper.visible).toBe(true);
    // 再开 → 恢复可见
    cap.setParams({ key: { enabled: true } });
    expect(keyHelper.visible).toBe(true);
  });
});

describe("LightCapability — 聚光灯 setSpotlight", () => {
  beforeEach(() => resetEnvState());

  it("启用聚光灯", () => {
    const cap = newCap();
    cap.setSpotlight({ enabled: true });
    const p = cap.getParams();
    expect(p.spotlight.enabled).toBe(true);
    expect(p.spotlight.angle).toBe(25);
    expect(p.spotlight.color).toBe(0xffffff);
  });

  it("setSpotlight 更新参数", () => {
    const cap = newCap();
    cap.setSpotlight({ enabled: true, angle: 40, intensity: 3.0, color: 0xffffcc });
    const p = cap.getParams();
    expect(p.spotlight.enabled).toBe(true);
    expect(p.spotlight.angle).toBe(40);
    expect(p.spotlight.intensity).toBe(3.0);
    expect(p.spotlight.color).toBe(0xffffcc);
  });
});

describe("LightCapability — 体积光锥 setVolumetric", () => {
  beforeEach(() => resetEnvState());

  it("启用体积光锥 + 聚光灯时挂载锥组", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
    });
    cap.setSpotlight({ enabled: true });
    cap.setVolumetric({ enabled: true });
    cap.apply();
    const cone = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(cone).toBeDefined();
    // 真锥体：单个 ConeGeometry 网格（原两交叉 PlaneGeometry 在侧面视角穿帮，见 light-cone.test.ts）
    expect(cone!.children.length).toBe(1);
    expect((cone!.children[0] as THREE.Mesh).geometry.type).toBe("ConeGeometry");
  });

  it("仅 volumetric 启用但 spotlight 关闭 → 锥组不挂载", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
    });
    cap.setVolumetric({ enabled: true });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("setVolumetric({enabled:false}) 移除锥组", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
    });
    cap.setSpotlight({ enabled: true });
    cap.setVolumetric({ enabled: true });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setVolumetric({ enabled: false });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    expect(cap.getParams().volumetric.enabled).toBe(false);
  });

  it("setVolumetric 更新参数不卸载（keep enabled）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
    });
    cap.setSpotlight({ enabled: true });
    cap.setVolumetric({ enabled: true });
    cap.apply();
    cap.setVolumetric({ opacity: 0.8, fogPower: 2.5 });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    expect(cap.getParams().volumetric.opacity).toBe(0.8);
    expect(cap.getParams().volumetric.fogPower).toBe(2.5);
  });
});

describe("LightCapability — 聚光灯定位 setTarget / setTargetHeight", () => {
  beforeEach(() => resetEnvState());

  it("setTarget 更新 target 位置", () => {
    const cap = new LightCapability({
      scene: new THREE.Scene(), renderer: makeFakeRenderer(),
      target: new THREE.Vector3(5, 2, -3), targetHeight: 10,
    });
    cap.apply();
    cap.setTarget(new THREE.Vector3(9, 1, 4));
    expect(cap.getTarget().x).toBe(9);
    expect(cap.getTarget().y).toBe(1);
    expect(cap.getTarget().z).toBe(4);
  });

  it("setTargetHeight 不抛错", () => {
    const cap = newCap({ targetHeight: 6 });
    expect(() => cap.setTargetHeight(12)).not.toThrow();
  });
});

describe("LightCapability — applyModelPreset", () => {
  beforeEach(() => resetEnvState());

  it("ysm 预设：方块顶光稍柔", () => {
    const cap = newCap();
    cap.applyModelPreset("ysm");
    const p = cap.getParams();
    expect(p.key.intensity).toBe(1.3);
    expect(p.spotlight.intensity).toBe(1.8);
    expect(p.spotlight.angle).toBe(30);
  });

  it("vrm 预设：rim 稍强", () => {
    const cap = newCap();
    cap.applyModelPreset("vrm");
    expect(cap.getParams().rim.intensity).toBe(0.6);
    expect(cap.getParams().key.intensity).toBe(1.0);
  });

  it("mmd 预设：整体降 30%", () => {
    const cap = newCap();
    cap.applyModelPreset("mmd");
    expect(cap.getParams().key.intensity).toBe(0.85);
  });

  it("未知类型经 toModelType 收窄回退 default 预设（存储脏数据兜底）", () => {
    const cap = newCap();
    cap.applyModelPreset(toModelType("unknown-type"));
    expect(cap.getParams().spotlight.enabled).toBe(false);
  });

  it("原型链成员经 toModelType 收窄回退 default（Object.hasOwn 自身属性判定，防裸索引走原型链）", () => {
    const cap = newCap();
    // "constructor"/"toString" 等 Object.prototype 成员若被裸索引误判为合法模型类别，
    // pickModelDefaultFields 会读到 undefined 字段 → 预设静默 no-op（P2 行为 bug）。
    cap.applyModelPreset(toModelType("constructor"));
    expect(cap.getCurrentPreset()).toBe("default");
    cap.applyModelPreset(toModelType("toString"));
    expect(cap.getCurrentPreset()).toBe("default");
  });

  it("手动 preset 后自动 applyModelPreset 不再覆盖（手动优先——双入口时序修复）", () => {
    const cap = newCap();
    cap.applyModelPreset("vrm", { manual: true });
    expect(cap.getCurrentPreset()).toBe("vrm");
    cap.applyModelPreset("ysm"); // 模拟切模型自动套 adapter.id（mount-preview-core）
    expect(cap.getCurrentPreset()).toBe("vrm"); // 手动选择压制自动覆盖
    expect(cap.getParams().key.intensity).toBe(1.0); // 仍是 vrm 预设参数
  });

  it("自动 applyModelPreset 写 auto-model 源：后续 auto-atmosphere 可覆盖（锐评 §二 回归）", () => {
    const cap = newCap();
    cap.applyModelPreset("ysm"); // 自动套模型预设 → source "auto-model"
    // 昼夜循环 atmosphere 预设（auto-atmosphere > auto-model）应能覆盖 light 参数
    setEnvState({ lightKeyIntensity: 9.5 }, { source: "auto-atmosphere" });
    expect(envState.lightKeyIntensity).toBe(9.5);
    // 手动选择（opts.manual）写 manual 源 → 压制后续 auto-atmosphere
    cap.applyModelPreset("mmd", { manual: true });
    setEnvState({ lightKeyIntensity: 0.1 }, { source: "auto-atmosphere" });
    expect(envState.lightKeyIntensity).not.toBe(0.1);
  });

  it("PMREM 环境光开启时 ambient 自动衰减 ×0.5（双间接光协调，caps 查询器经构造注入）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene,
      renderer: makeFakeRenderer(),
      // fake sky cap 经注入查询器提供（组合根 createAll 同款通道）——不再 spy 全局单例
      caps: {
        getById: (id: string) =>
          id === "sky" ? ({ isEnvironmentEnabled: () => true } as unknown as SceneCapability) : undefined,
      },
    });
    cap.applyModelPreset("ysm"); // 触发 syncLightsFromParams
    const ambient = (cap as unknown as { ambientLight: THREE.AmbientLight }).ambientLight;
    expect(ambient.intensity).toBeCloseTo(cap.getParams().ambient.intensity * 0.5, 6);
  });
});

describe("LightCapability — getMenuNodes 分组（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => resetEnvState());

  it("主灯之外的节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // light-enabled 能力总开关 + light-key 平铺
    expect(nodes[0]!.id).toBe("light-enabled");
    expect(nodes[1]!.id).toBe("light-key");
    // 其余节点在 folder children 内
    const folder = nodes[2]!;
    expect(folder.kind).toBe("folder");
    const childIds = folder.children!.map((c: { id: string }) => c.id);
    expect(childIds).toContain("light-fill");
    expect(childIds).toContain("light-rim");
    expect(childIds).toContain("light-ambient");
    expect(childIds).toContain("light-preset");
    // [ADR-246 D3] 聚光灯 + 体积光收进同一可折叠卡（不再平铺、不做输入隐藏）
    expect(childIds).toContain("cap-group-spot-vol");
    // folder labelKey 对应原 group
    expect(folder.labelKey).toBe("preview.lightGroupParams");
  });
});

// [ADR-246 D3] 聚光灯与体积光折叠卡：控件树契约（不做 visibleWhen 隐藏，只折叠）
describe("LightCapability — 聚光灯与体积光折叠卡", () => {
  beforeEach(() => resetEnvState());

  function spotVolCard(cap: LightCapability): PreviewMenuNode {
    const folder = cap.getMenuNodes()[2]!;
    const card = folder.children!.find((c: PreviewMenuNode) => c.id === "cap-group-spot-vol");
    expect(card).toBeDefined();
    return card!;
  }

  it("是 collapsible card，含聚光灯 + 体积光全量控件；体积光参数不做 visibleWhen 隐藏", () => {
    const cap = newCap();
    const card = spotVolCard(cap);
    expect(card.kind).toBe("card");
    expect(card.collapsible).toBe(true);
    expect(card.labelKey).toBe("preview.spotlightVolume");
    expect(card.children!.map((c) => c.id)).toEqual([
      "light-spotlight",
      "light-spot-intensity",
      "light-cone-angle",
      "light-volumetric",
      "light-volumetric-density",
      "light-volumetric-falloff",
      "light-volumetric-edge-fade",
      "light-volumetric-ratio",
    ]);
    // [用户裁定] 不做条件显隐：所有子节点无 visibleWhen，参数不因开关状态消失
    for (const child of card.children!) {
      expect(child.visibleWhen).toBeUndefined();
    }
  });

  it("三个语义滑块读写映射到 opacity / fogPower / edgeFade", () => {
    const cap = newCap();
    const card = spotVolCard(cap);
    const by = (id: string) => card.children!.find((c) => c.id === id)!;
    by("light-volumetric-density").control!.set!(0.8);
    expect(cap.getParams().volumetric.opacity).toBe(0.8);
    by("light-volumetric-falloff").control!.set!(2.4);
    expect(cap.getParams().volumetric.fogPower).toBe(2.4);
    by("light-volumetric-edge-fade").control!.set!(0.6);
    expect(cap.getParams().volumetric.edgeFade).toBe(0.6);
    // getter 回读一致
    expect(by("light-volumetric-density").control!.get!(undefined)).toBe(0.8);
    expect(by("light-volumetric-falloff").control!.get!(undefined)).toBe(2.4);
    expect(by("light-volumetric-edge-fade").control!.get!(undefined)).toBe(0.6);
  });

  it("上下亮度比滑块：读 tip/base 比值，写按 base 派生 tip", () => {
    const cap = newCap();
    const card = spotVolCard(cap);
    const ratio = card.children!.find((c) => c.id === "light-volumetric-ratio")!;
    const p0 = cap.getParams().volumetric;
    // 默认 base 0.9 / tip 0.25 → ratio ≈ 0.2778
    expect(ratio.control!.get!(undefined)).toBeCloseTo(p0.tipStrength / p0.baseStrength, 5);
    ratio.control!.set!(0.5);
    const p1 = cap.getParams().volumetric;
    expect(p1.tipStrength).toBeCloseTo(p1.baseStrength * 0.5, 5);
    expect(p1.baseStrength).toBeCloseTo(p0.baseStrength, 5); // base 不被比值滑块改写
    expect(ratio.control!.get!(undefined)).toBeCloseTo(0.5, 5);
  });

  it("baseStrength=0 时比值读取返回 0（除零守卫，锁定具体约定）", () => {
    const cap = newCap();
    cap.setVolumetric({ baseStrength: 0 });
    const card = spotVolCard(cap);
    const ratio = card.children!.find((c) => c.id === "light-volumetric-ratio")!;
    // 锁「返回 0」而非仅 isFinite——否则实现改成返回越界值用例仍绿
    expect(ratio.control!.get!(undefined)).toBe(0);
  });

  it("比值量程闭合 [0,1]：tip>base 的存量数据读取被 clamp 到 1（与滑块 max 一致）", () => {
    // 审查发现（ADR-246 D2 回归）：滑块声明 max:1，但 getter 原只挡除零——
    // 存量/预设若出现 base 0.2 / tip 0.9（比值 4.5），滑块 thumb 被 clamp 压到 100%，
    // 显示值与真实值不符；用户首拖即被静默改写 tip（光柱突跳）。
    const cap = newCap();
    cap.setVolumetric({ baseStrength: 0.2, tipStrength: 0.9 });
    const card = spotVolCard(cap);
    const ratio = card.children!.find((c) => c.id === "light-volumetric-ratio")!;
    expect(ratio.control!.get!(undefined)).toBe(1); // clamp 到滑块 max
  });

  it("比值 setter 对越界入参 clamp，getter/setter 值域对等", () => {
    const cap = newCap();
    const card = spotVolCard(cap);
    const ratio = card.children!.find((c) => c.id === "light-volumetric-ratio")!;
    ratio.control!.set!(2);
    const p = cap.getParams().volumetric;
    expect(p.tipStrength).toBeCloseTo(p.baseStrength * 1, 5); // clamp 到 1，不是 base*2
    expect(ratio.control!.get!(undefined)).toBe(1);
    ratio.control!.set!(-1);
    expect(cap.getParams().volumetric.tipStrength).toBe(0); // clamp 到 0
    expect(ratio.control!.get!(undefined)).toBe(0);
  });
});

// [ADR-246 D3] helper 挂载契约：loadState 单独调用（无 apply）也须挂场景，
// 不依赖「组合根随后必调 apply()」的隐式约定（审查发现）。
describe("LightCapability — helper 挂载契约", () => {
  beforeEach(() => { resetEnvState(); localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("loadState 单独调用后 helper 已在场景（不依赖后续 apply 兜底）", () => {
    const cap = newCap();
    cap.setSpotlight({ enabled: true });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    const helper = capScene.getObjectByName("ysm-light-spot-helper");
    expect(helper).toBeDefined();
    expect(helper!.visible).toBe(true);
  });
});

describe("LightCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => resetEnvState());

  it("getMasterNodeId 声明 light-enabled（场景组一级 headerToggle + 面板 filter 契约）", () => {
    const cap = newCap();
    expect(cap.getMasterNodeId()).toBe("light-enabled");
    // master id 必须在完整节点树顶层存在（filter 剔除才有意义）
    expect(cap.getMenuNodes().map((n) => n.id)).toContain("light-enabled");
  });

  it("完整树 = light-enabled 能力总开关 + light-key 平铺 toggle + 参数组 folder（4 控件 + 折叠卡）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(3);
    // light-enabled 能力总开关（isEnabled/setEnabled）
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("light-enabled");
    expect(nodes[0]!.control!.get!(undefined)).toBe(true);
    nodes[0]!.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    // light-key 平铺（主灯参数开关）
    expect(nodes[1]!.kind).toBe("toggle");
    expect(nodes[1]!.id).toBe("light-key");
    nodes[1]!.control!.set!(false);
    expect(cap.getParams().key.enabled).toBe(false);
    // 参数组 folder：预设 + 三点布光平铺 + 聚光灯/体积光折叠卡
    const folder = nodes[2]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.lightGroupParams");
    expect(folder.children!.map((c: PreviewMenuNode) => c.id)).toEqual([
      "light-preset",
      "light-fill",
      "light-fill-azimuth",
      "light-fill-elevation",
      "light-fill-intensity",
      "light-rim",
      "light-rim-azimuth",
      "light-rim-elevation",
      "light-rim-intensity",
      "light-ambient",
      "light-key-azimuth",
      "light-key-elevation",
      "light-key-intensity",
      "light-key-color",
      "cap-group-spot-vol",
    ]);
  });

  it("slider/toggle 节点读写闭包直连 cap（fill/ambient）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[2]!;
    const fill = folder.children!.find((c: PreviewMenuNode) => c.id === "light-fill")!;
    fill.control!.set!(true);
    expect(cap.getParams().fill.enabled).toBe(true);
    const ambient = folder.children!.find((c: PreviewMenuNode) => c.id === "light-ambient")!;
    ambient.control!.set!(1.5);
    expect(cap.getParams().ambient.intensity).toBe(1.5);
  });

  it("light-preset select 直连 cap 预设", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[2]!;
    const preset = folder.children!.find((c: PreviewMenuNode) => c.id === "light-preset")!;
    expect(preset.control!.options!.length).toBe(6);
    preset.control!.set!("mmd");
    expect(cap.getCurrentPreset()).toBe("mmd");
  });
});

// [ADR-246 D1] 原 setVolumetricEngine 描述块整体删除——postprocess 空壳引擎已移除，
// 「cone/postprocess 切换」维度不复存在（含 3 条为绕开引擎恢复副作用而写的回归用例）。

describe("LightCapability — setParams 合并更新", () => {
  beforeEach(() => resetEnvState());

  it("只覆盖指定字段", () => {
    const cap = newCap();
    cap.setParams({ key: { intensity: 0.5 }, fill: { intensity: 0.3 } });
    cap.setParams({ ambient: { color: 0xffffff, intensity: 0.8 } });
    const p = cap.getParams();
    expect(p.ambient.intensity).toBe(0.8);
    expect(p.key.intensity).toBe(0.5); // 未变
    expect(p.fill.intensity).toBe(0.3); // 未变
  });

  it("DEFAULT_LIGHT_PARAMS 基线", () => {
    expect(DEFAULT_LIGHT_PARAMS.spotlight.enabled).toBe(false);
    expect(DEFAULT_LIGHT_PARAMS.volumetric.enabled).toBe(false);
    expect(DEFAULT_LIGHT_PARAMS.ambient.intensity).toBe(0.5);
  });
});

describe("LightCapability — 场景边界", () => {
  beforeEach(() => resetEnvState());

  it("apply 到空场景后无灯光残留时重复 apply 不追加", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    const n1 = scene.children.length;
    cap.apply(); // 第二次 apply
    expect(scene.children.length).toBe(n1); // 不重复添加
  });

  it("dispose 后 setEnabled(true) 不崩溃", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.dispose();
    expect(() => cap.setEnabled(true)).not.toThrow();
  });
});
// ============ 持久化（saveState / loadState）============
describe("LightCapability — 持久化", () => {
  beforeEach(() => { resetEnvState(); localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState/loadState 往返：布尔/数值/引擎/预设全还原", () => {
    const cap = newCap();
    // 真实用户路径：先选手动预设，再逐个调灯开关（故开关值须在 applyModelPreset 之后设置，
    // 否则被预设就地覆盖，saveState 存下的就已经是预设值，测不出跨会话丢失）
    cap.applyModelPreset("mmd", { manual: true });
    cap.setParams({ key: { enabled: false }, ambient: { intensity: 0.9 } });
    cap.setSpotlight({ enabled: true });
    cap.setVolumetric({ enabled: true });
    cap.saveState();

    const cap2 = newCap();
    cap2.loadState();
    const p = cap2.getParams();
    // 用户显式保存的灯开关优先于模型预设（ADR-126 P5「手动优先」同口径）：
    // 预设先套用，再用保存值覆盖，故此处 key=false / spotlight=true / volumetric=true 均须保住
    expect(p.key.enabled).toBe(false); // 用户关了主光，不被 mmd 预设（true）盖回
    expect(p.ambient.intensity).toBe(0.9); // ambient 不在 MODEL_DEFAULTS 的 light 合并范围，保留
    expect(p.spotlight.enabled).toBe(true); // 用户开了聚光，不被 mmd 预设（false）盖回
    expect(p.volumetric.enabled).toBe(true); // 用户开了体积光，不被 mmd 预设（false）盖回
    expect(cap2.getCurrentPreset()).toBe("mmd");
  });

  it("saveState/loadState 往返：volumetric=false + spotlight 开启 → 体积光保持关闭（不被重新打开）", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: false });
    // [ADR-246 D1] 原「引擎恢复强制开启体积光」的坑随 postprocess 空壳一并消除；
    // 本用例保留为「用户关闭意图跨会话存活」的契约锁。
    expect(p.spotlight.enabled).toBe(true);
    expect(p.volumetric.enabled).toBe(false);
    // 锥组不因任何恢复路径被挂载（spotlight 开启但 volumetric 关闭 → 无光锥）
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    expect(capScene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("saveState/loadState 往返：volumetric=true + spotlight 开启 → 锥组重建并挂载", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: true });
    expect(p.spotlight.enabled).toBe(true);
    expect(p.volumetric.enabled).toBe(true);
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    expect(capScene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap();
    cap.loadState();
    expect(cap.getParams().ambient.intensity).toBe(0.5);
  });

  it("loadState 老存档残留 volumetricEngine 字段被忽略（ADR-246 D1 惰性数据）", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({
      volumetricEngine: "postprocess", currentPreset: "vrm",
    }));
    const cap = newCap();
    expect(() => cap.loadState()).not.toThrow();
    expect(cap.getCurrentPreset()).toBe("vrm"); // 预设仍自动恢复
  });

  it("loadState manualPreset 存在时按手动恢复并压制后续自动预设", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({ manualPreset: "litematic", currentPreset: "mmd" }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getCurrentPreset()).toBe("litematic"); // 手动优先
    cap.applyModelPreset("mmd"); // 自动套模型类别
    expect(cap.getCurrentPreset()).toBe("litematic"); // 仍被压制
  });

  it("loadState 类型不匹配字段全部跳过", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({
      enabled: "yes", keyEnabled: 1, ambientIntensity: "bright",
      spotlightEnabled: null, volumetricEnabled: 0,
    }));
    const cap = newCap();
    cap.loadState();
    const p = cap.getParams();
    expect(p.key.enabled).toBe(true); // 默认
    expect(p.ambient.intensity).toBe(0.5);
    expect(p.spotlight.enabled).toBe(false);
    expect(p.volumetric.enabled).toBe(false);
  });
});

// ============ 锥组挂载态下的更新路径 ============
describe("LightCapability — 锥组挂载态更新路径", () => {
  beforeEach(() => resetEnvState());

  function coneCap(scene: THREE.Scene): LightCapability {
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    // 顺序敏感：rebuildCone 需要 spotlight+volumetric 双开才建锥组，
    // setSpotlight 内部有挂载分支，故先开 volumetric 再开 spotlight
    cap.setVolumetric({ enabled: true });
    cap.setSpotlight({ enabled: true });
    cap.apply(); // 挂载锥组
    return cap;
  }

  it("getDirectionalLights/getSpotLight 返回内部灯引用", () => {
    const cap = newCap();
    const dirs = cap.getDirectionalLights();
    expect(dirs).toHaveLength(3);
    dirs.forEach((d) => expect(d.isDirectionalLight).toBe(true));
    expect(cap.getSpotLight().isSpotLight).toBe(true);
  });

  it("setTarget 挂载态下同步锥组位置（跟随 spotlight 下方）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    const group = scene.getObjectByName("ysm-light-volumetric-cone")!;
    cap.setTarget(new THREE.Vector3(10, 2, 5));
    expect(group.position.x).toBe(10);
    expect(group.position.z).toBe(5);
    // 锥组在 spotlight（target.y + targetHeight）下方 half height
    expect(group.position.y).toBeCloseTo(2 + 8 - 8 / 2, 5);
  });

  it("setTargetHeight 重建锥后保持挂载（rebuildCone 换新实例不得让锥组消失）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setTargetHeight(12);
    const spot = cap.getSpotLight();
    expect(spot.position.y).toBeCloseTo(12, 5);
    // rebuildCone 会 dispose 旧锥组并换成新实例（新实例默认脱离场景），
    // 必须按重建前的挂载态回挂 + 重新定位，否则改高度会让体积光锥凭空消失
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    expect(group!.position.y).toBeCloseTo(12 - 12 / 2, 5);
  });

  it("setTargetHeight 在锥组未挂载时不主动挂载（保持未挂载态）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    // 未开 volumetric/spotlight → 无锥组
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    cap.setTargetHeight(12);
    // 回挂只恢复「重建前已挂载」的状态，不凭空新增挂载
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("applyModelPreset 切到 volumetric 关闭的预设时卸载锥组；重新开启时回挂", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    // 自动套模型预设（auto-model）不压制用户手动开启的锥组（manual > auto-model，
    // 锐评 §二 收口后与其他 cap 同契约——用户手动选择优先）
    cap.applyModelPreset("ysm");
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    // 手动切预设（light-preset select 入口）→ volumetric/spotlight 双关 → 锥组卸载
    cap.applyModelPreset("ysm", { manual: true });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    // 用户重新双开（锥组挂载需 volumetric+spotlight 双开）→ 回挂
    cap.setSpotlight({ enabled: true });
    cap.setVolumetric({ enabled: true });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
  });

  it("setSpotlight 时锥组已在场景则原位重建跟随", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setSpotlight({ angle: 40, intensity: 3 });
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    // 单位补偿：THREE SpotLight.intensity 现在是 candela = UI 照度 ÷ 到目标衰减系数
    // （默认 distance=30, decay=1.5, targetHeight=8 → 衰减约 0.0438）。
    const falloff = spotDistanceAttenuation(8, 30, 1.5);
    expect(cap.getSpotLight().intensity).toBeCloseTo(3 / falloff, 5);
  });

  it("spotlight 非几何字段（颜色/强度）走 uniforms 快路径，不重建 GPU 几何", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    const meshBefore = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    const uuidBefore = meshBefore.geometry.uuid;

    cap.setSpotlight({ color: 0xff8800, intensity: 1.5, distance: 40, decay: 2 });

    const meshAfter = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    // 同一几何实例 → 未 dispose/重建（旧实现对任意 spotlight 字段都整组 dispose + build，
    // 拖一次强度滑块即触发 GPU 几何重建与 GC 抖动）
    expect(meshAfter.geometry.uuid).toBe(uuidBefore);
    const u = (meshAfter.material as THREE.ShaderMaterial).uniforms;
    expect((u.uColor.value as THREE.Color).getHex()).toBe(0xff8800);
  });

  it("spotlight 几何字段（锥角）变更时重建几何", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    const uuidBefore = (
      scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh
    ).geometry.uuid;
    cap.setSpotlight({ angle: 40 });
    const uuidAfter = (
      scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh
    ).geometry.uuid;
    // 锥形变了，uniforms 无能为力 → 必须重建
    expect(uuidAfter).not.toBe(uuidBefore);
  });

  it("setVolumetric({enabled:false}) 移除已挂载锥组", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setVolumetric({ enabled: false });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("setParams 开 volumetric+spotlight 时挂载锥组；关闭时移除", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    cap.setParams({ spotlight: { enabled: true }, volumetric: { enabled: true } });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setParams({ volumetric: { enabled: false } });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });
});

// ============ 菜单控件联动（节点 control 闭包）============
describe("LightCapability — 菜单控件联动", () => {
  beforeEach(() => resetEnvState());

  it("toggle/slider/select 全部读写联动（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const folder = nodes[2]!;
    const by = (id: string) => folder.children!.find((c: PreviewMenuNode) => c.id === id)!;
    nodes[0]!.control!.set!(false);
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    by("light-fill").control!.set!(false);
    expect(by("light-fill").control!.get!(undefined)).toBe(false);
    by("light-rim").control!.set!(false);
    expect(by("light-rim").control!.get!(undefined)).toBe(false);
    by("light-ambient").control!.set!(1.2);
    expect(by("light-ambient").control!.get!(undefined)).toBe(1.2);
    by("light-preset").control!.set!("vrm");
    expect(by("light-preset").control!.get!(undefined)).toBe("vrm");
    // [ADR-246 D3] 聚光灯/体积光控件下沉折叠卡
    const card = by("cap-group-spot-vol");
    const inCard = (id: string) => card.children!.find((c: PreviewMenuNode) => c.id === id)!;
    inCard("light-spotlight").control!.set!(true);
    expect(inCard("light-spotlight").control!.get!(undefined)).toBe(true);
    inCard("light-volumetric").control!.set!(true);
    expect(inCard("light-volumetric").control!.get!(undefined)).toBe(true);
    inCard("light-cone-angle").control!.set!(45);
    expect(inCard("light-cone-angle").control!.get!(undefined)).toBe(45);
  });

  it("light-preset select 经 manual 入口记录手动预设（节点 control 闭包）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[2]!;
    const presetNode = folder.children!.find((c: PreviewMenuNode) => c.id === "light-preset")!;
    presetNode.control!.set!("ysm");
    expect(cap.getCurrentPreset()).toBe("ysm");
    cap.applyModelPreset("mmd"); // 自动入口被手动压制
    expect(cap.getCurrentPreset()).toBe("ysm");
  });
});

// [ADR-246 D3] 聚光灯可视化：SpotLightHelper 线框（空间参照，消灭盲拖调参）
describe("LightCapability — 聚光灯 helper 线框", () => {
  beforeEach(() => resetEnvState());

  it("apply 后场景中存在聚光灯 helper，且随聚光灯开关显隐", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    const helper = scene.getObjectByName("ysm-light-spot-helper");
    expect(helper).toBeDefined();
    // 聚光灯默认关 → helper 不可见
    expect(helper!.visible).toBe(false);
    cap.setSpotlight({ enabled: true });
    expect(scene.getObjectByName("ysm-light-spot-helper")!.visible).toBe(true);
    cap.setSpotlight({ enabled: false });
    expect(scene.getObjectByName("ysm-light-spot-helper")!.visible).toBe(false);
  });

  it("setEnabled(false) 卸载时 helper 一并移除场景", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-spot-helper")).toBeDefined();
    cap.setEnabled(false);
    expect(scene.getObjectByName("ysm-light-spot-helper")).toBeUndefined();
  });

  it("dispose 释放 helper（不泄漏）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(() => cap.dispose()).not.toThrow();
    expect(scene.getObjectByName("ysm-light-spot-helper")).toBeUndefined();
  });
});

// ============ 导出工具函数 ============
describe("light-capability 导出工具函数", () => {
  it("attenuateAmbientForSky：开 ×0.5 / 关 ×1", async () => {
    const { attenuateAmbientForSky, lightDirToPosition } = await import("./light-capability.ts");
    expect(attenuateAmbientForSky(1.0, true)).toBeCloseTo(0.5, 10);
    expect(attenuateAmbientForSky(1.0, false)).toBeCloseTo(1.0, 10);
    // lightDirToPosition：仰角 90 → 正上方；方位 0 → +Z
    const top = lightDirToPosition({ enabled: true, color: 0, intensity: 0, azimuth: 0, elevation: 90 }, 5);
    expect(top.y).toBeCloseTo(5, 5);
    expect(top.x).toBeCloseTo(0, 5);
    const north = lightDirToPosition({ enabled: true, color: 0, intensity: 0, azimuth: 0, elevation: 0 }, 5);
    expect(north.z).toBeCloseTo(5, 5);
    expect(north.y).toBeCloseTo(0, 5);
  });
});
