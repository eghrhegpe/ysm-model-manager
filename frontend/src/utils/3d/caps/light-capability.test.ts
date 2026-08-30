// @vitest-environment node
// ===== LightCapability 测试 =====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  LightCapability,
  DEFAULT_LIGHT_PARAMS,
  LIGHT_PRESETS,
} from "./light-capability.ts";

// ---- 假渲染器 ----
function makeFakeRenderer() {
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
  return renderer;
}

function newCap(opts: { enabled?: boolean; params?: unknown; target?: THREE.Vector3; targetHeight?: number } = {}) {
  return new LightCapability({
    scene: new THREE.Scene(),
    renderer: makeFakeRenderer(),
    ...(opts as unknown as Record<string, unknown>),
  });
}

/** 往返 helper：saveState 后新实例 loadState（cone 引擎 + spotlight 开启），
 *  返回恢复后的实例与 params。ON/OFF 两方向共用，消除测试结构重复（jscpd）。 */
function roundtripConeVolumetric(opts: { volumetricEnabled: boolean }): {
  cap2: LightCapability;
  p: ReturnType<LightCapability["getParams"]>;
} {
  const cap = newCap();
  cap.setPreset("mmd", { manual: true });
  cap.setSpotlight({ enabled: true });
  cap.setVolumetric({ enabled: opts.volumetricEnabled });
  expect(cap.getVolumetricEngine()).toBe("cone"); // 默认引擎
  cap.saveState();
  const cap2 = newCap();
  cap2.loadState();
  return { cap2, p: cap2.getParams() };
}

describe("LightCapability — 构造函数与默认值", () => {
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
    const cap = newCap({ params: { ambient: { intensity: 0.9 } } });
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
});

describe("LightCapability — 聚光灯 setSpotlight", () => {
  it("启用聚光灯", () => {
    const cap = newCap({ params: { spotlight: { enabled: true } } });
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
  it("启用体积光锥 + 聚光灯时挂载锥组", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
      params: { spotlight: { enabled: true }, volumetric: { enabled: true } },
    });
    cap.apply();
    const cone = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(cone).toBeDefined();
    expect(cone!.children.length).toBe(2); // 两交叉 PlaneGeometry
  });

  it("仅 volumetric 启用但 spotlight 关闭 → 锥组不挂载", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
      params: { spotlight: { enabled: false }, volumetric: { enabled: true } },
    });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("setVolumetric({enabled:false}) 移除锥组", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
      params: { spotlight: { enabled: true }, volumetric: { enabled: true } },
    });
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
      params: { spotlight: { enabled: true }, volumetric: { enabled: true } },
    });
    cap.apply();
    cap.setVolumetric({ opacity: 0.8, fogPower: 2.5 });
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    expect(cap.getParams().volumetric.opacity).toBe(0.8);
    expect(cap.getParams().volumetric.fogPower).toBe(2.5);
  });
});

describe("LightCapability — 聚光灯定位 setTarget / setTargetHeight", () => {
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

describe("LightCapability — setPreset", () => {
  it("ysm 预设：方块顶光稍柔", () => {
    const cap = newCap();
    cap.setPreset("ysm");
    const p = cap.getParams();
    expect(p.key.intensity).toBe(1.3);
    expect(p.spotlight.intensity).toBe(1.8);
    expect(p.spotlight.angle).toBe(30);
  });

  it("vrm 预设：rim 稍强", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    expect(cap.getParams().rim.intensity).toBe(0.6);
    expect(cap.getParams().key.intensity).toBe(1.0);
  });

  it("mmd 预设：整体降 30%", () => {
    const cap = newCap();
    cap.setPreset("mmd");
    expect(cap.getParams().key.intensity).toBe(0.85);
  });

  it("未知类型回退 default 预设", () => {
    const cap = newCap();
    cap.setPreset("unknown-type");
    expect(cap.getParams().spotlight.enabled).toBe(false);
  });

  it("手动 preset 后自动 setPreset 不再覆盖（手动优先——双入口时序修复）", () => {
    const cap = newCap();
    cap.setPreset("vrm", { manual: true });
    expect(cap.getCurrentPreset()).toBe("vrm");
    cap.setPreset("ysm"); // 模拟切模型自动套 adapter.id（mount-preview-core）
    expect(cap.getCurrentPreset()).toBe("vrm"); // 手动选择压制自动覆盖
    expect(cap.getParams().key.intensity).toBe(1.0); // 仍是 vrm 预设参数
  });

  it("PMREM 环境光开启时 ambient 自动衰减 ×0.5（双间接光协调，caps 查询器经构造注入）", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene,
      renderer: makeFakeRenderer(),
      // fake sky cap 经注入查询器提供（组合根 createAll 同款通道）——不再 spy 全局单例
      caps: {
        getById: (id: string) =>
          id === "sky" ? ({ isEnvironmentEnabled: () => true } as never) : undefined,
      },
    });
    cap.setPreset("ysm"); // 触发 syncLightsFromParams
    const ambient = (cap as unknown as { ambientLight: THREE.AmbientLight }).ambientLight;
    expect(ambient.intensity).toBeCloseTo(cap.getParams().ambient.intensity * 0.5, 6);
  });
});

describe("LightCapability — getMenuControls 分组", () => {
  it("主灯之外的控件均含 group 字段（全部归 lightGroupParams）", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "light-key").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!).toBe("preview.lightGroupParams");
    });
  });
});

describe("LightCapability — setVolumetricEngine", () => {
  it("cone 模式默认", () => {
    const cap = newCap();
    expect(cap.getVolumetricEngine()).toBe("cone");
  });

  it("切换 postprocess：锥组移除", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
      params: { spotlight: { enabled: true }, volumetric: { enabled: true } },
    });
    cap.apply();
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setVolumetricEngine("postprocess");
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    expect(cap.getVolumetricEngine()).toBe("postprocess");
  });

  it("postprocess 切回 cone：锥组重新挂载", () => {
    const scene = new THREE.Scene();
    const cap = new LightCapability({
      scene, renderer: makeFakeRenderer(),
      params: { spotlight: { enabled: true }, volumetric: { enabled: true } },
    });
    cap.apply();
    cap.setVolumetricEngine("postprocess");
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    cap.setVolumetricEngine("cone");
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
  });
});

describe("LightCapability — setParams 合并更新", () => {
  it("只覆盖指定字段", () => {
    const cap = newCap({ params: { key: { intensity: 0.5 }, fill: { intensity: 0.3 } } });
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
    expect(Object.keys(LIGHT_PRESETS).length).toBeGreaterThanOrEqual(6);
  });
});

describe("LightCapability — 场景边界", () => {
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
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState/loadState 往返：布尔/数值/引擎/预设全还原", () => {
    const cap = newCap();
    // 真实用户路径：先选手动预设，再逐个调灯开关（故开关值须在 setPreset 之后设置，
    // 否则被预设就地覆盖，saveState 存下的就已经是预设值，测不出跨会话丢失）
    cap.setPreset("mmd", { manual: true });
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
    expect(p.ambient.intensity).toBe(0.9); // ambient 不在 LIGHT_PRESETS 合并范围，保留
    expect(p.spotlight.enabled).toBe(true); // 用户开了聚光，不被 mmd 预设（false）盖回
    expect(p.volumetric.enabled).toBe(true); // 用户开了体积光，不被 mmd 预设（false）盖回
    expect(cap2.getCurrentPreset()).toBe("mmd");
  });

  it("saveState/loadState 往返：volumetric=false + cone 引擎 + spotlight 开启 → 体积光不被引擎恢复重新打开（审核修复回归）", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: false });
    // 修复前：loadState 步骤④ setVolumetricEngine("cone") 因 spotlight 开启而强制
    // volumetric.enabled=true 并重建挂载光锥——用户保存的「体积光关」跨会话丢失。
    // 修复后：cone 引擎走无副作用字段恢复，用户保存值存活。
    expect(p.spotlight.enabled).toBe(true);
    expect(p.volumetric.enabled).toBe(false);
    expect(cap2.getVolumetricEngine()).toBe("cone");
    // 锥组不因引擎恢复被挂载（spotlight 开启但 volumetric 关闭 → 无光锥；
    // cap2 从未构建锥组，coneGroup 为 undefined 即「未挂载」）
    expect((cap2 as unknown as { coneGroup?: THREE.Object3D | null }).coneGroup?.parent).toBeUndefined();
  });

  it("saveState/loadState 往返：volumetric=true + cone 引擎 + spotlight 开启 → 锥组重建并挂载（复核 P1 回归）", () => {
    const { cap2, p } = roundtripConeVolumetric({ volumetricEnabled: true });
    // 复核修复前：cone 分支改纯字段赋值后，loadState 无任何路径重建锥组——保存
    // volumetric=true 的会话重载后锥组静默消失（coneGroup 恒 null、syncConeMount
    // 只处理已挂载、setSpotlight 因 coneGroup null 短路）。
    // 复核修复后：cone 分支按恢复后的 params 重建+挂载锥组（不强制翻转开关）。
    expect(p.spotlight.enabled).toBe(true);
    expect(p.volumetric.enabled).toBe(true);
    expect(cap2.getVolumetricEngine()).toBe("cone");
    const capScene = (cap2 as unknown as { scene: THREE.Scene }).scene;
    expect(capScene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { ambient: { intensity: 1.5 } } });
    cap.loadState();
    expect(cap.getParams().ambient.intensity).toBe(1.5);
  });

  it("loadState 非法 volumetricEngine 跳过；仅 currentPreset 时走自动恢复", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({
      volumetricEngine: "warp", currentPreset: "vrm",
    }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getVolumetricEngine()).toBe("cone"); // 非法值跳过
    expect(cap.getCurrentPreset()).toBe("vrm"); // 自动恢复
  });

  it("loadState manualPreset 存在时按手动恢复并压制后续自动预设", () => {
    localStorage.setItem("ysm-scene-cap-light", JSON.stringify({ manualPreset: "litematic", currentPreset: "mmd" }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getCurrentPreset()).toBe("litematic"); // 手动优先
    cap.setPreset("mmd"); // 自动套模型类别
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

  it("setPreset 切到 volumetric 关闭的预设时卸载锥组；重新开启时回挂", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeDefined();
    cap.setPreset("ysm"); // ysm 预设 volumetric.enabled=false → 锥组卸载
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
    cap.setPreset("mmd-scene"); // volumetric 仍 false → 保持卸载
    expect(scene.getObjectByName("ysm-light-volumetric-cone")).toBeUndefined();
  });

  it("setSpotlight 时锥组已在场景则原位重建跟随", () => {
    const scene = new THREE.Scene();
    const cap = coneCap(scene);
    cap.setSpotlight({ angle: 40, intensity: 3 });
    const group = scene.getObjectByName("ysm-light-volumetric-cone");
    expect(group).toBeDefined();
    expect(cap.getSpotLight().intensity).toBe(3);
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

// ============ 菜单控件联动 ============
describe("LightCapability — 菜单控件联动", () => {
  it("toggle/slider/select 全部读写联动", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const by = (id: string) => controls.find((c) => c.id === id)!;
    by("light-key").setValue(false);
    expect(by("light-key").getValue()).toBe(false);
    by("light-fill").setValue(false);
    expect(by("light-fill").getValue()).toBe(false);
    by("light-rim").setValue(false);
    expect(by("light-rim").getValue()).toBe(false);
    by("light-ambient").setValue(1.2);
    expect(by("light-ambient").getValue()).toBe(1.2);
    by("light-spotlight").setValue(true);
    expect(by("light-spotlight").getValue()).toBe(true);
    by("light-volumetric").setValue(true);
    expect(by("light-volumetric").getValue()).toBe(true);
    by("light-cone-angle").setValue(45);
    expect(by("light-cone-angle").getValue()).toBe(45);
    by("light-preset").setValue("vrm");
    expect(by("light-preset").getValue()).toBe("vrm");
  });

  it("light-preset select 经 manual 入口记录手动预设", () => {
    const cap = newCap();
    const presetCtrl = cap.getMenuControls().find((c) => c.id === "light-preset")!;
    presetCtrl.setValue("ysm");
    expect(cap.getCurrentPreset()).toBe("ysm");
    cap.setPreset("mmd"); // 自动入口被手动压制
    expect(cap.getCurrentPreset()).toBe("ysm");
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
