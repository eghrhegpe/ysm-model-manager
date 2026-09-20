// @vitest-environment node
// ===== LightCapability 测试 =====
// [light-type-switch] key/fill/rim 统一为 LightInstanceParams（type/enabled/color/intensity/
// azimuth/elevation/angle/penumbra/distance/decay），原独立 spotlight 灯已删除——
// 「聚光灯」= 把某盏灯（默认 key）的 type 设为 "spot"，体积光锥由第一盏启用的 spot 灯驱动。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { LightCapability, spotDistanceAttenuation } from "./light-capability.ts";
import {
  DEFAULT_LIGHT_PARAMS,
  FLATTEN_MAP,
  LIGHT_SLOTS,
  type LightInstanceParams,
  readLightParams,
} from "./light-presets.ts";
import type { SceneCapability } from "./scene-capability.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
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

/** 三盏灯统一的「全部字段」基线（构造 LightInstanceParams 的部分覆盖用） */
const LIGHT_FIELDS_BASE: LightInstanceParams = {
  type: "directional",
  enabled: true,
  color: 0xffffff,
  intensity: 1,
  azimuth: 0,
  elevation: 0,
  angle: 25,
  penumbra: 0.3,
  distance: 30,
  decay: 1.5,
};

/** 往返 helper：saveState 后新实例 loadState（key 灯切聚光灯并开启），
 *  返回恢复后的实例与 params。ON/OFF 两方向共用，消除测试结构重复（jscpd）。
 *  [ADR-246 D1] 原「cone 引擎」维度已随 postprocess 空壳一并删除。 */
function roundtripConeVolumetric(opts: { volumetricEnabled: boolean }): {
  cap2: LightCapability;
  p: ReturnType<LightCapability["getParams"]>;
} {
  const cap = newCap();
  // [light-type-switch] 原 setSpotlight({ enabled: true }) → 等价：key 灯切 spot 并开启
  cap.setLightParams("key", { type: "spot", enabled: true });
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
    // [light-type-switch] 原独立 spotlight 灯（默认关）已并入 key 灯：默认三盏灯全是方向光
    for (const which of ["key", "fill", "rim"] as const) {
      expect(p[which].type).toBe("directional");
      expect(p[which].enabled).toBe(true);
    }
    // 「默认无聚光灯」的等价断言：没有可见的 spot 灯 → 体积光锥无驱动源
    expect(cap.getSpotLightForCone()).toBeNull();
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
    // 六个对象：key/fill/rim/ambient/spotTarget（+ 每盏灯的 helper）
    expect(scene.children.length).toBeGreaterThanOrEqual(6);
    // [light-type-switch] 默认三盏灯都是方向光（原独立 Spotlight 不再常驻场景）
    expect(scene.children.filter((c) => c instanceof THREE.DirectionalLight)).toHaveLength(3);
    expect(scene.children.some((c) => c instanceof THREE.AmbientLight)).toBe(true);
    // 把 key 灯切成 spot → 聚光灯实例随即挂入场景（类型切换自带挂载分支）
    cap.setLightParams("key", { type: "spot" });
    expect(scene.children.some((c) => c instanceof THREE.SpotLight)).toBe(true);
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

describe("LightCapability — 聚光灯（key 灯 type=spot）", () => {
  beforeEach(() => resetEnvState());

  it("启用聚光灯", () => {
    const cap = newCap();
    // [light-type-switch] 原 cap.setSpotlight({ enabled: true }) →
    // 聚光灯 = 把 key 灯类型设为 spot（构造默认三盏都是 directional）
    cap.setLightParams("key", { type: "spot", enabled: true });
    const p = cap.getParams();
    expect(p.key.type).toBe("spot");
    expect(p.key.enabled).toBe(true);
    expect(p.key.angle).toBe(25); // 与旧 spotlight 同名字段一一对应
    expect(p.key.color).toBe(0xffffff);
  });

  it("setLightParams 更新聚光灯参数", () => {
    const cap = newCap();
    cap.setLightParams("key", { type: "spot", enabled: true, angle: 40, intensity: 3.0, color: 0xffffcc });
    const p = cap.getParams();
    expect(p.key.type).toBe("spot");
    expect(p.key.enabled).toBe(true);
    expect(p.key.angle).toBe(40);
    expect(p.key.intensity).toBe(3.0);
    expect(p.key.color).toBe(0xffffcc);
  });
});

describe("LightCapability — 体积光锥 setVolumetric", () => {
  beforeEach(() => resetEnvState());

  it("启用体积光锥 + 聚光灯时挂载锥组", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
    });
    cap.setLightParams("key", { type: "spot", enabled: true });
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
    cap.setLightParams("key", { type: "spot", enabled: true });
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
    cap.setLightParams("key", { type: "spot", enabled: true });
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

describe("LightCapability — 灯光与模型类别解耦（ADR-282）", () => {
  beforeEach(() => resetEnvState());

  it("applyModelPreset / getCurrentPreset 已退役（类别维度入口不存在）", () => {
    const cap = newCap() as unknown as Record<string, unknown>;
    expect(cap.applyModelPreset).toBeUndefined();
    expect(cap.getCurrentPreset).toBeUndefined();
  });

  it("换模型不再改动任何灯光参数：用户微调后 envState 保持原值", () => {
    const cap = newCap();
    cap.setLightParams("key", { intensity: 2.5, type: "spot", azimuth: 77 });
    cap.setLightParams("rim", { intensity: 0.9 });
    const snapshot = cap.getParams();
    // ADR-282：灯光与模型类别解耦——不再有任何「按类别套预设」的入口可调。
    // 旧 applyModelPreset 会按 MODEL_DEFAULTS 覆写三个光强（如 vrm 把 key 拉到 1.0）。
    expect(envState.lightKeyIntensity).toBe(2.5);
    expect(envState.lightRimIntensity).toBe(0.9);
    expect(cap.getParams()).toEqual(snapshot);
    expect(cap.getSpotLightForCone()?.which).toBe("key");
  });

  it("resetLightParams：三盏灯 + 环境光 + 体积光逐字段回到 DEFAULT_LIGHT_PARAMS", () => {
    const cap = newCap();
    // 先把所有维度推离默认
    cap.setLightParams("key", { type: "spot", intensity: 9, azimuth: 11, angle: 66, decay: 3 });
    cap.setLightParams("fill", { type: "point", intensity: 8, distance: 111 });
    cap.setLightParams("rim", { intensity: 7, color: 0x123456, enabled: false });
    cap.setVolumetric({ enabled: true, opacity: 0.9, fogPower: 3.3 });

    cap.resetLightParams();
    for (const which of LIGHT_SLOTS) {
      expect(cap.getParams()[which]).toEqual(DEFAULT_LIGHT_PARAMS[which]);
      expect(readLightParams(envState, which)).toEqual(DEFAULT_LIGHT_PARAMS[which]);
    }
    expect(cap.getParams().ambient).toEqual(DEFAULT_LIGHT_PARAMS.ambient);
    expect(cap.getParams().volumetric).toEqual(DEFAULT_LIGHT_PARAMS.volumetric);
    // 体积光回默认（关）→ 锥体已卸载
    expect(cap.getSpotLightForCone()).toBeNull();
  });

  it("resetLightParams 写 manual 源：重置后的值不被 auto-model 覆盖", () => {
    const cap = newCap();
    cap.setLightParams("key", { intensity: 9 });
    cap.resetLightParams();
    expect(envState.lightKeyIntensity).toBe(DEFAULT_LIGHT_PARAMS.key.intensity);
    // 模型类别（auto-model）不得覆盖用户显式重置的值——「重置」与拖滑块同源
    setEnvState({ lightKeyIntensity: 0.01 }, { source: "auto-model" });
    expect(envState.lightKeyIntensity).toBe(DEFAULT_LIGHT_PARAMS.key.intensity);
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
    // 原经 applyModelPreset("ysm") 顺带触发；该入口已据 ADR-282 退役，改为直接触发重算
    cap.refreshAmbientFromSky();
    const ambient = (cap as unknown as { ambientLight: THREE.AmbientLight }).ambientLight;
    expect(ambient.intensity).toBeCloseTo(cap.getParams().ambient.intensity * 0.5, 6);
  });
});

describe("LightCapability — getMenuNodes 分组（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => resetEnvState());

  it("主灯之外的节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // light-enabled 能力总开关 + [light-type-switch] light-select（编辑哪盏灯，取代原 light-key 平铺）
    expect(nodes[0]!.id).toBe("light-enabled");
    expect(nodes[1]!.id).toBe("light-select");
    // 其余节点在 folder children 内
    const folder = nodes[2]!;
    expect(folder.kind).toBe("folder");
    const childIds = folder.children!.map((c: { id: string }) => c.id);
    // 三盏灯的开关不再平铺在 folder 外层：统一设置条按当前槽位产出 light-<which>-*
    expect(childIds).toContain("light-key-enabled");
    expect(childIds).toContain("light-ambient");
    // [ADR-282] 原 light-preset 下拉已删，代之以「重置灯光」按钮
    expect(childIds).toContain("light-reset");
    expect(childIds).not.toContain("light-preset");
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

  it("是 collapsible card，体积光全量控件收进卡内；聚光灯参数由统一设置条按 type 展开", () => {
    const cap = newCap();
    const card = spotVolCard(cap);
    expect(card.kind).toBe("card");
    expect(card.collapsible).toBe(true);
    expect(card.labelKey).toBe("preview.spotlightVolume");
    expect(card.children!.map((c) => c.id)).toEqual([
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
    // [light-type-switch] 原卡内 light-spotlight / light-spot-intensity / light-cone-angle 已删——
    // 「聚光灯」改为把某盏灯的 type 设为 spot，其专属参数（锥角/半影/距离/衰减）随统一设置条展开。
    // 等价断言：切到 spot 后同一套设置条里出现这些控件。
    cap.setLightParams("key", { type: "spot" });
    const expanded = cap.getMenuNodes()[2]!.children!.map((c) => c.id);
    expect(expanded).toContain("light-key-angle");
    expect(expanded).toContain("light-key-penumbra");
    expect(expanded).toContain("light-key-distance");
    expect(expanded).toContain("light-key-decay");
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
    cap.setLightParams("key", { type: "spot", enabled: true });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    // [light-type-switch] helper 名随槽位（不再是单例 ysm-light-spot-helper）
    const helper = capScene.getObjectByName("ysm-light-key-helper");
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

  it("完整树 = light-enabled 能力总开关 + light-select 编辑灯选择 + 参数组 folder（统一设置条 + 折叠卡）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(3);
    // light-enabled 能力总开关（isEnabled/setEnabled）
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("light-enabled");
    expect(nodes[0]!.control!.get!(undefined)).toBe(true);
    nodes[0]!.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    // [light-type-switch] light-select：选择当前编辑的灯槽位（三灯按钮取代原三盏平铺 toggle）
    expect(nodes[1]!.kind).toBe("select");
    expect(nodes[1]!.id).toBe("light-select");
    expect(nodes[1]!.control!.get!(undefined)).toBe("key");
    nodes[1]!.control!.set!("fill");
    expect(cap.getActiveLight()).toBe("fill");
    nodes[1]!.control!.set!("key");
    // 参数组 folder：统一设置条（当前槽位 key，默认 directional 故无锥角/衰减控件）
    // + 环境光 + 聚光灯/体积光折叠卡 + 重置按钮（[ADR-282] 取代原预设下拉）
    const folder = nodes[2]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.lightGroupParams");
    expect(folder.children!.map((c: PreviewMenuNode) => c.id)).toEqual([
      "light-key-type",
      "light-key-enabled",
      "light-key-color",
      "light-key-intensity",
      "light-key-azimuth",
      "light-key-elevation",
      "light-ambient",
      "cap-group-spot-vol",
      "light-reset",
    ]);
  });

  it("slider/toggle 节点读写闭包直连 cap（fill/ambient，经 light-select 切槽位）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // [light-type-switch] 原平铺的 light-fill 开关 → 先切编辑槽位，再操作该槽位的统一设置条
    nodes[1]!.control!.set!("fill");
    const folder = cap.getMenuNodes()[2]!;
    const fill = folder.children!.find((c: PreviewMenuNode) => c.id === "light-fill-enabled")!;
    fill.control!.set!(false);
    expect(cap.getParams().fill.enabled).toBe(false);
    const ambient = folder.children!.find((c: PreviewMenuNode) => c.id === "light-ambient")!;
    ambient.control!.set!(1.5);
    expect(cap.getParams().ambient.intensity).toBe(1.5);
  });

  it("light-reset 按钮直连 resetLightParams（[ADR-282] 取代原预设下拉）", () => {
    const cap = newCap();
    cap.setLightParams("key", { intensity: 4.2 });
    cap.setLightParams("fill", { intensity: 3.3 });
    expect(cap.getParams().key.intensity).toBe(4.2);

    const folder = cap.getMenuNodes()[2]!;
    const reset = folder.children!.find((c: PreviewMenuNode) => c.id === "light-reset")!;
    expect(reset.kind).toBe("button");
    reset.action!({} as never);

    expect(cap.getParams().key.intensity).toBe(DEFAULT_LIGHT_PARAMS.key.intensity);
    expect(cap.getParams().fill.intensity).toBe(DEFAULT_LIGHT_PARAMS.fill.intensity);
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
    // [light-type-switch] DEFAULT_LIGHT_PARAMS.spotlight 已删除：spot 参数并入每盏灯
    expect(DEFAULT_LIGHT_PARAMS.key.type).toBe("directional");
    expect(DEFAULT_LIGHT_PARAMS.key.enabled).toBe(true);
    expect(DEFAULT_LIGHT_PARAMS.key.angle).toBe(25);
    expect(DEFAULT_LIGHT_PARAMS.key.penumbra).toBe(0.3);
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

  it("saveState/loadState 往返：布尔/数值/灯类型全还原（[ADR-282] 不再有预设维度）", () => {
    const cap = newCap();
    // [ADR-282] 原「先选手动预设」步骤已删：灯光与模型类别解耦，预设维度不存在。
    cap.setParams({ key: { enabled: false }, ambient: { intensity: 0.9 } });
    // [light-type-switch] 原独立 spotlight 开关 → 等价：把 key 灯类型切到 spot。
    // 刻意不传 enabled：用户刚关掉主灯，切类型不得把开关重新打开（类型与开关正交）。
    cap.setLightParams("key", { type: "spot" });
    cap.setVolumetric({ enabled: true });
    cap.saveState();

    const cap2 = newCap();
    cap2.loadState();
    const p = cap2.getParams();
    // 跨会话全部还原（不再有「预设先套用、保存值再覆盖」的时序问题）
    expect(p.key.enabled).toBe(false);
    expect(p.ambient.intensity).toBe(0.9);
    expect(p.key.type).toBe("spot");
    expect(p.volumetric.enabled).toBe(true);
    // 旧预设键不再写入存档
    const raw = JSON.parse(localStorage.getItem("ysm-scene-cap-light")!) as Record<string, unknown>;
    expect(raw.currentPreset).toBeUndefined();
    expect(raw.manualPreset).toBeUndefined();
  });

  it("saveState/loadState 往返：volumetric=false + 聚光灯开启 → 体积光保持关闭（不被重新打开）", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: false });
    // [ADR-246 D1] 原「引擎恢复强制开启体积光」的坑随 postprocess 空壳一并消除；
    // 本用例保留为「用户关闭意图跨会话存活」的契约锁。
    expect(p.key.type).toBe("spot");
    expect(p.volumetric.enabled).toBe(false);
    // 锥组不因任何恢复路径被挂载（spot 灯开启但 volumetric 关闭 → 无光锥）
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    expect(capScene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("saveState/loadState 往返：volumetric=true + 聚光灯开启 → 锥组重建并挂载", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: true });
    expect(p.key.type).toBe("spot");
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
      volumetricEngine: "postprocess",
    }));
    const cap = newCap();
    expect(() => cap.loadState()).not.toThrow();
    expect(cap.getParams().key.type).toBe("directional"); // 回 schema 默认（不再有任何预设）
  });
  it("[ADR-282] 旧存档的 manualPreset/currentPreset 成死数据：不报错、不影响灯光值", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({
      manualPreset: "litematic",
      currentPreset: "mmd",
      // 真实持久化形状是嵌套 per-light（buildLightPersistPayload）
      key: { intensity: 0.42 },
    }));
    const cap = newCap();
    expect(() => cap.loadState()).not.toThrow();
    // 旧预设键被忽略（不再有 applyModelPreset 可用）；显式保存的灯光值照常恢复
    expect(cap.getParams().key.intensity).toBe(0.42);
  });

  it("loadState 类型不匹配字段全部跳过（含旧 spotlight 迁移字段）", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({
      enabled: "yes", keyEnabled: 1, ambientIntensity: "bright",
      // [light-type-switch] 旧 spotlightEnabled 已不再是合法键；旧 spotlight 迁移块也须逐字段 typeof 校验
      spotlightEnabled: null, spotlight: { enabled: "yes", angle: "big" }, volumetricEnabled: 0,
    }));
    const cap = newCap();
    cap.loadState();
    const p = cap.getParams();
    expect(p.key.enabled).toBe(true); // 默认
    expect(p.ambient.intensity).toBe(0.5);
    // 脏 spotlight 块不迁移（enabled 非 boolean → 不切 key 类型；angle 非 number → 不写锥角）
    expect(p.key.type).toBe("directional");
    expect(p.key.angle).toBe(DEFAULT_LIGHT_PARAMS.key.angle);
    expect(p.volumetric.enabled).toBe(false);
  });
});

// ============ 锥组挂载态下的更新路径 ============
describe("LightCapability — 锥组挂载态更新路径", () => {
  beforeEach(() => resetEnvState());

  /** 锥顶（spot 灯位置）→ 几何中心：与 VolumetricCone.applyTransform 同式的定位契约 */
  function coneTip(cap: LightCapability, height: number): THREE.Vector3 {
    const spot = cap.getSpotLightForCone()!.light;
    const dir = cap.getTarget().sub(spot.position).normalize();
    const group = (cap as unknown as { scene: THREE.Scene }).scene.getObjectByName(
      "ysm-light-volumetric-cone",
    )!;
    return group.position.clone().addScaledVector(dir, -height / 2);
  }

  function coneCap(scene: THREE.Scene): LightCapability {
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    // 顺序敏感：rebuildCone 需要「启用的 spot 灯 + 体积光开」双条件，
    // 故先开 volumetric 再把 key 灯切成聚光灯
    cap.setVolumetric({ enabled: true });
    cap.setLightParams("key", { type: "spot", enabled: true });
    cap.apply(); // 挂载锥组
    return cap;
  }

  it("getLights/getSpotLightForCone 返回内部灯引用", () => {
    const cap = newCap();
    // [light-type-switch] getDirectionalLights/getSpotLight → getLights/getSpotLightForCone
    const lights = cap.getLights();
    expect(lights).toHaveLength(3);
    lights.forEach((l) => expect(l instanceof THREE.DirectionalLight).toBe(true));
    // 无启用的 spot 灯 → 锥体驱动源为空
    expect(cap.getSpotLightForCone()).toBeNull();
    // 把 key 灯切成 spot → 返回第一盏启用的 spot 灯 + 其槽位（同一内部引用）
    cap.setLightParams("key", { type: "spot", enabled: true });
    const spot = cap.getSpotLightForCone();
    expect(spot).not.toBeNull();
    expect(spot!.light instanceof THREE.SpotLight).toBe(true);
    expect(spot!.which).toBe("key");
    expect(cap.getLights()[0]).toBe(spot!.light);
  });

  it("setTarget 挂载态下同步锥组朝向（锥顶贴 spot 灯、灯随模型中心平移）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    const spotBefore = cap.getSpotLightForCone()!.light;
    const offsetBefore = spotBefore.position.clone().sub(cap.getTarget());
    cap.setTarget(new THREE.Vector3(10, 2, 5));
    // setTarget 触发锥组重建（新实例默认脱离场景 → 按重建前挂载态回挂），故重新取组
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    // [light-type-switch] 灯位 = 「target + 方位角/仰角 × targetHeight」：target 既是平移基准也是瞄准点。
    // 回归护栏：若改回原点固定半径，非原点模型（switch-preview 传 bbox 中心）的光源会跑飞。
    const spot = cap.getSpotLightForCone()!.light;
    const offsetAfter = spot.position.clone().sub(cap.getTarget());
    expect(offsetAfter.length()).toBeCloseTo(8, 5); // = targetHeight
    // 相对模型中心的偏移在 setTarget 前后不变（方向/距离只由方位角/仰角 + targetHeight 决定）
    expect(offsetAfter.distanceTo(offsetBefore)).toBeCloseTo(0, 5);
    // 锥顶仍贴灯位（coneTip 内部用「target − 灯位」反推 → 同时验证锥轴朝向）
    expect(coneTip(cap, 8).distanceTo(spot.position)).toBeCloseTo(0, 5);
  });

  it("setTargetHeight 重建锥后保持挂载（rebuildCone 换新实例不得让锥组消失）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setTargetHeight(12);
    const spot = cap.getSpotLightForCone()!.light;
    // [light-type-switch] 半径用 targetHeight → 改高度同时移动灯位与锥长；
    // 等价断言 = 重建后仍挂载 + 灯距靶点 = 新高 + 锥顶贴灯位 + 几何高度随高度更新。
    expect(spot.position.distanceTo(cap.getTarget())).toBeCloseTo(12, 5);
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    expect(coneTip(cap, 12).distanceTo(spot.position)).toBeCloseTo(0, 5);
    expect(
      ((group!.children[0] as THREE.Mesh).geometry as THREE.ConeGeometry).parameters.height,
    ).toBe(12);
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

  it("volumetric 关闭时卸载锥组；重新双开时回挂（[ADR-282] 改用 setVolumetric/reset 驱动）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();

    // 用户关闭体积光 → 锥组卸载（spot 灯类型保留）
    cap.setVolumetric({ enabled: false });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();

    // 用户重新双开（锥组挂载需「启用的 spot 灯 + volumetric」双开）→ 回挂
    cap.setLightParams("key", { type: "spot", enabled: true });
    cap.setVolumetric({ enabled: true });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();

    // [ADR-282] resetLightParams 把 volumetric 回默认（关）→ 锥组再卸载；
    // 且不再有任何「按模型类别切预设」的路径会动它。
    cap.resetLightParams();
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("key 灯参数变更时锥组已在场景则原位重建跟随", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setLightParams("key", { angle: 40, intensity: 3 });
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    // 单位补偿：THREE SpotLight.intensity = candela = UI 照度 ÷ 到目标衰减系数。
    // 灯位 = 模型中心 + 方位角/仰角方向 × targetHeight（默认 8），靶点在原点 → d = targetHeight。
    const spot = cap.getSpotLightForCone()!.light;
    const d = spot.position.distanceTo(new THREE.Vector3(0, 0, 0));
    expect(d).toBeCloseTo(8, 5); // 默认 targetHeight
    const falloff = spotDistanceAttenuation(d, 30, 1.5);
    expect(spot.intensity).toBeCloseTo(3 / falloff, 5);
  });

  it("spotlight 非几何字段（颜色/强度）走 uniforms 快路径，不重建 GPU 几何", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    const meshBefore = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    const uuidBefore = meshBefore.geometry.uuid;

    cap.setLightParams("key", { color: 0xff8800, intensity: 1.5, distance: 40, decay: 2 });

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
    cap.setLightParams("key", { angle: 40 });
    const uuidAfter = (
      scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh
    ).geometry.uuid;
    // 锥形变了，uniforms 无能为力 → 必须重建
    expect(uuidAfter).not.toBe(uuidBefore);
  });

  it("体积光参数变更走 uniforms 快路径，不重建几何", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    const meshBefore = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    const uuidBefore = meshBefore.geometry.uuid;

    cap.setVolumetric({ opacity: 0.8, edgeFade: 0.7, fogPower: 2.4 });

    const meshAfter = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    expect(meshAfter.geometry.uuid).toBe(uuidBefore);
    const u = (meshAfter.material as THREE.ShaderMaterial).uniforms;
    expect(u.uMaxAlpha.value).toBe(0.8);
    expect(u.uEdgeFade.value).toBe(0.7);
    expect(u.uFogPower.value).toBe(2.4);
  });

  it("setTargetHeight 重建几何并同步 uHeight（避免几何/uniform 不同步）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setTargetHeight(12);
    const mesh = scene.getObjectByName("ysm-light-volumetric-cone")!.children[0] as THREE.Mesh;
    expect((mesh.geometry as THREE.ConeGeometry).parameters.height).toBe(12);
    expect((mesh.material as THREE.ShaderMaterial).uniforms.uHeight.value).toBe(12);
  });

  it("锥组挂载态随聚光灯开关往返（体积光保持开启）", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    // 关聚光灯（key 灯 enabled=false → 无可见 spot 灯）→ 锥组不再产出（既不挂载也不残留）
    cap.setLightParams("key", { enabled: false });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    // 再开聚光灯 → 重建 + 回挂（volumetric 无需重新打开）
    cap.setLightParams("key", { enabled: true });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
  });

  it("setVolumetric({enabled:false}) 移除已挂载锥组", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setVolumetric({ enabled: false });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("setParams 把 key 灯切 spot + 开 volumetric 时挂载锥组；关闭时移除", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    // [light-type-switch] 原 setParams({ spotlight: { enabled: true }, ... }) →
    // 等价：一次合批把 key 灯类型设为 spot（构造默认三盏都是 directional）
    cap.setParams({ key: { type: "spot", enabled: true }, volumetric: { enabled: true } });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setParams({ volumetric: { enabled: false } });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });
});

// ============ 灯对象命名 / 锥体驱动源优先级 ============
describe("LightCapability — 灯光对象命名与锥体驱动源", () => {
  beforeEach(() => resetEnvState());

  it("三盏灯按槽位命名（多 spot 同框不重名），与 helper 同口径", () => {
    const cap = newCap();
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    expect(scene.getObjectByName("ysm-light-key")).toBeDefined();
    expect(scene.getObjectByName("ysm-light-fill")).toBeDefined();
    expect(scene.getObjectByName("ysm-light-rim")).toBeDefined();
    cap.setLightParams("key", { type: "spot" });
    cap.setLightParams("fill", { type: "spot" });
    cap.setLightParams("rim", { type: "spot" });
    const names = new Set([
      scene.getObjectByName("ysm-light-key")!.uuid,
      scene.getObjectByName("ysm-light-fill")!.uuid,
      scene.getObjectByName("ysm-light-rim")!.uuid,
    ]);
    expect(names.size).toBe(3);
  });

  it("getSpotLightForCone 优先用当前编辑的灯（activeLight）", () => {
    const cap = newCap();
    cap.setVolumetric({ enabled: true });
    cap.setLightParams("key", { type: "spot", enabled: true });
    cap.setLightParams("fill", { type: "spot", enabled: true });
    expect(cap.getSpotLightForCone()!.which).toBe("key");
    cap.setActiveLight("fill");
    expect(cap.getSpotLightForCone()!.which).toBe("fill");
    cap.setActiveLight("rim");
    expect(cap.getSpotLightForCone()!.which).toBe("key");
  });

  it("setActiveLight 切换驱动源时主动收敛锥体（否则「切了没反应」等下次参数变更）", () => {
    const cap = newCap();
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const coneGroup = (): THREE.Object3D | undefined => scene.getObjectByName("ysm-light-volumetric-cone");

    cap.setVolumetric({ enabled: true });
    // 两盏都切成 spot，但 key 与 fill 拉开位置（方位角相反）——驱动源变了锥顶位置就变
    cap.setLightParams("key", { type: "spot", enabled: true, azimuth: 0, elevation: 30 });
    cap.setLightParams("fill", { type: "spot", enabled: true, azimuth: 180, elevation: 30 });
    expect(cap.getSpotLightForCone()!.which).toBe("key");
    const keyPos = coneGroup()!.position.clone();

    // 切到 fill（启用的 spot）→ 驱动源变更，锥体必须立即重建跟随（而非停在 key）
    cap.setActiveLight("fill");
    expect(cap.getSpotLightForCone()!.which).toBe("fill");
    expect(coneGroup()).toBeDefined();
    expect(coneGroup()!.position.equals(keyPos)).toBe(false);

    // 切到 rim（不是 spot）→ 回退到 key 驱动，锥体仍挂载且回到 key 位置
    cap.setActiveLight("rim");
    expect(cap.getSpotLightForCone()!.which).toBe("key");
    expect(coneGroup()).toBeDefined();
    expect(coneGroup()!.position.equals(keyPos)).toBe(true);
  });

  it("setActiveLight 同槽位重复设值不空转（驱动源未变不重建）", () => {
    const cap = newCap();
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    cap.setVolumetric({ enabled: true });
    cap.setLightParams("key", { type: "spot", enabled: true });
    const before = scene.getObjectByName("ysm-light-volumetric-cone")!.uuid;
    cap.setActiveLight("key"); // 与当前同值
    expect(scene.getObjectByName("ysm-light-volumetric-cone")!.uuid).toBe(before);
  });
});

// ============ loadState 重入双跑治理（ADR-281 收口）============
describe("LightCapability — loadState 重入双跑治理", () => {
  beforeEach(() => {
    resetEnvState();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it("loadState 期间 env 回调被挂起：恢复路径只写 envState，不触发 onEnvChanged（消除重入双跑）", () => {
    const cap = newCap();
    cap.setLightParams("key", { type: "spot", intensity: 4, angle: 60 });
    cap.saveState();

    const cap2 = newCap();
    let duringLoadCalls = 0;
    const stub = cap2 as unknown as { onEnvChanged: (c: Set<EnvStateKey>, s: EnvState) => void };
    const orig = stub.onEnvChanged.bind(cap2);
    stub.onEnvChanged = (changed: Set<EnvStateKey>, state: EnvState) => {
      duringLoadCalls++;
      orig(changed, state);
    };
    cap2.loadState();
    expect(duringLoadCalls).toBe(0);
    const p = cap2.getParams();
    expect(p.key.type).toBe("spot");
    expect(p.key.intensity).toBe(4);
    expect(p.key.angle).toBe(60);
  });
});


// ============ 菜单控件联动（节点 control 闭包）============
describe("LightCapability — 菜单控件联动", () => {
  beforeEach(() => resetEnvState());

  it("菜单滑杆值域 = schema 值域（ADR-283：菜单不再是第二事实源）", () => {
    const cap = newCap();
    const collect = (nodes: PreviewMenuNode[]): PreviewMenuNode[] =>
      nodes.flatMap((n) => (n.children ? [n, ...collect(n.children)] : [n]));
    const fields = [
      "intensity",
      "azimuth",
      "elevation",
      "angle",
      "penumbra",
      "distance",
      "decay",
    ] as const;
    let checked = 0;
    for (const slot of ["key", "fill", "rim"] as const) {
      cap.setActiveLight(slot);
      // type=spot：angle/penumbra 仅 spot 渲染，distance/decay 仅非 directional（一套 spot 覆盖全部 7 字段）
      cap.setLightParams(slot, { type: "spot" });
      const all = collect(cap.getMenuNodes());
      for (const field of fields) {
        const id = `light-${slot}-${field}`;
        const node = all.find((n) => n.id === id);
        expect(node, `缺菜单节点 ${id}`).toBeDefined();
        const c = node!.control!;
        expect({ min: c.min, max: c.max, step: c.step, unit: c.unit }, `${id} 值域应来自 schema`).toEqual(
          getParamRange(FLATTEN_MAP[slot][field]),
        );
        checked += 1;
      }
    }
    expect(checked).toBe(21);
    const all = collect(cap.getMenuNodes());
    for (const [id, key] of [
      ["light-volumetric-density", "lightVolumetricOpacity"],
      ["light-volumetric-falloff", "lightVolumetricFogPower"],
      ["light-volumetric-edge-fade", "lightVolumetricEdgeFade"],
      ["light-ambient", "lightAmbientIntensity"],
    ] as const) {
      const c = all.find((n) => n.id === id)!.control!;
      expect({ min: c.min, max: c.max, step: c.step, unit: c.unit }, `${id} 值域应来自 schema`).toEqual(
        getParamRange(key),
      );
    }
    // 「上下亮度比」是派生标量（tip = base × ratio），不是 envState 键值 → 字面量属有意为之（ADR-283 §2.5 例外）
    const ratio = all.find((n) => n.id === "light-volumetric-ratio")!.control!;
    expect({ min: ratio.min, max: ratio.max, step: ratio.step }).toEqual({ min: 0, max: 1, step: 0.05 });
  });

  it("toggle/slider/select 全部读写联动（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 每次按需重取节点树：切槽位/切类型都会重建参数区（refreshOnChange 由消费端触发）
    const by = (id: string) =>
      cap.getMenuNodes()[2]!.children!.find((c: PreviewMenuNode) => c.id === id)!;
    nodes[0]!.control!.set!(false);
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    // [light-type-switch] 原平铺的 light-fill/light-rim 开关 → 切编辑槽位后由统一设置条读写
    nodes[1]!.control!.set!("fill");
    expect(nodes[1]!.control!.get!(undefined)).toBe("fill");
    by("light-fill-enabled").control!.set!(false);
    expect(cap.getParams().fill.enabled).toBe(false);
    by("light-fill-enabled").control!.set!(true);
    expect(by("light-fill-enabled").control!.get!(undefined)).toBe(true);
    nodes[1]!.control!.set!("rim");
    by("light-rim-enabled").control!.set!(false);
    expect(by("light-rim-enabled").control!.get!(undefined)).toBe(false);
    by("light-ambient").control!.set!(1.2);
    expect(by("light-ambient").control!.get!(undefined)).toBe(1.2);
    // [ADR-246 D3] 体积光控件下沉折叠卡
    const card = by("cap-group-spot-vol");
    const inCard = (id: string) => card.children!.find((c: PreviewMenuNode) => c.id === id)!;
    inCard("light-volumetric").control!.set!(true);
    expect(inCard("light-volumetric").control!.get!(undefined)).toBe(true);
    // 聚光灯专属参数（锥角）由统一设置条在 type=spot 时展开
    nodes[1]!.control!.set!("key");
    by("light-key-type").control!.set!("spot");
    by("light-key-angle").control!.set!(45);
    expect(by("light-key-angle").control!.get!(undefined)).toBe(45);
  });

  it("light-reset 按钮经节点闭包触发重置（[ADR-282] 取代原预设 select）", () => {
    const cap = newCap();
    cap.setLightParams("rim", { intensity: 5.5 });
    expect(cap.getParams().rim.intensity).toBe(5.5);

    const folder = cap.getMenuNodes()[2]!;
    const resetNode = folder.children!.find((c: PreviewMenuNode) => c.id === "light-reset")!;
    expect(resetNode.kind).toBe("button");
    resetNode.action!({} as never);

    expect(cap.getParams().rim.intensity).toBe(DEFAULT_LIGHT_PARAMS.rim.intensity);
  });
});

// [ADR-246 D3] 聚光灯可视化：SpotLightHelper 线框（空间参照，消灭盲拖调参）
// [light-type-switch] helper 由「单例 spotHelper」改为「每盏灯一个、随该灯类型重建」，
// 命名 ysm-light-<which>-helper。
describe("LightCapability — 聚光灯 helper 线框", () => {
  beforeEach(() => resetEnvState());

  it("apply 后场景中存在 key 灯 helper，切 spot 后重建且随开关显隐", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    const KEY_HELPER = "ysm-light-key-helper";
    // 默认 key 灯是方向光 → DirectionalLightHelper
    expect(scene.getObjectByName(KEY_HELPER)).toBeDefined();
    // 切 spot → 旧 helper 被 dispose，新 SpotLightHelper 须仍挂场景（与 apply/loadState 路径同款契约）
    cap.setLightParams("key", { type: "spot" });
    const helper = scene.getObjectByName(KEY_HELPER);
    expect(helper).toBeDefined();
    expect(helper!.visible).toBe(true);
    cap.setLightParams("key", { enabled: false });
    expect(scene.getObjectByName(KEY_HELPER)!.visible).toBe(false);
    cap.setLightParams("key", { enabled: true });
    expect(scene.getObjectByName(KEY_HELPER)!.visible).toBe(true);
  });

  it("setEnabled(false) 卸载时 helper 一并移除场景", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-key-helper")).toBeDefined();
    cap.setEnabled(false);
    expect(scene.getObjectByName("ysm-light-key-helper")).toBeUndefined();
  });

  it("dispose 释放 helper（不泄漏）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(() => cap.dispose()).not.toThrow();
    expect(scene.getObjectByName("ysm-light-key-helper")).toBeUndefined();
  });
});

// ============ 导出工具函数 ============
describe("light-capability 导出工具函数", () => {
  it("attenuateAmbientForSky：开 ×0.5 / 关 ×1", async () => {
    const { attenuateAmbientForSky, lightDirToPosition } = await import("./light-capability.ts");
    expect(attenuateAmbientForSky(1.0, true)).toBeCloseTo(0.5, 10);
    expect(attenuateAmbientForSky(1.0, false)).toBeCloseTo(1.0, 10);
    // lightDirToPosition：仰角 90 → 正上方；方位 0 → +Z
    // [light-type-switch] 入参类型统一为 LightInstanceParams（含 type/angle/penumbra/distance/decay）
    const top = lightDirToPosition({ ...LIGHT_FIELDS_BASE, elevation: 90 }, 5);
    expect(top.y).toBeCloseTo(5, 5);
    expect(top.x).toBeCloseTo(0, 5);
    const north = lightDirToPosition({ ...LIGHT_FIELDS_BASE, elevation: 0 }, 5);
    expect(north.z).toBeCloseTo(5, 5);
    expect(north.y).toBeCloseTo(0, 5);
  });
});
