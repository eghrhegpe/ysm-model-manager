// @vitest-environment node
// ===== LightCapability 测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";
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