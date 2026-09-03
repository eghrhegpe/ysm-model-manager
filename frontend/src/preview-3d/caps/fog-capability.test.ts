// @vitest-environment node
// ===== FogCapability 测试（preview-3d/caps/fog-capability.ts）=====
// 覆盖：构造默认值、模式切换、线性近远距、指数密度、启用禁用、预设、持久化、getMenuControls。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  FogCapability,
  DEFAULT_FOG_PARAMS,
  FOG_PRESETS,
} from "./fog-capability.ts";

function newCap(opts: { enabled?: boolean; params?: Partial<import("./fog-capability.ts").FogParams> } = {}) {
  const scene = new THREE.Scene();
  // params/enabled 为构造参数可选键——仅真实存在时附带，避免显式 undefined 流入
  return new FogCapability({
    scene,
    ...(opts.params !== undefined ? { params: opts.params } : {}),
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
}

describe("FogCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    expect(cap.isEnabled()).toBe(false);
    expect(p.mode).toBe("linear");
    expect(p.near).toBe(10);
    expect(p.far).toBe(200);
    expect(p.density).toBe(0.015);
    expect(p.color).toBe(0xaac4e8);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { mode: "exp2", density: 0.02, near: 50, far: 500 } });
    const p = cap.getParams();
    expect(p.mode).toBe("exp2");
    expect(p.density).toBe(0.02);
    expect(p.near).toBe(50);
    expect(p.far).toBe(500);
  });
});

describe("FogCapability — 模式切换", () => {
  it("setMode 切换线性/指数", () => {
    const cap = newCap();
    cap.setMode("exp2");
    expect(cap.getMode()).toBe("exp2");
    cap.setMode("linear");
    expect(cap.getMode()).toBe("linear");
  });
});

describe("FogCapability — 线性范围", () => {
  it("setLinearRange 设置近远距", () => {
    const cap = newCap({ enabled: true });
    cap.setLinearRange(20, 400);
    const p = cap.getParams();
    expect(p.near).toBe(20);
    expect(p.far).toBe(400);
  });

  it("setLinearRange 传单一参数不覆盖另一参数", () => {
    const cap = newCap({ enabled: true, params: { near: 10, far: 200 } });
    cap.setLinearRange(50, undefined);
    expect(cap.getParams().near).toBe(50);
    expect(cap.getParams().far).toBe(200);
    cap.setLinearRange(undefined, 600);
    expect(cap.getParams().near).toBe(50);
    expect(cap.getParams().far).toBe(600);
  });
});

describe("FogCapability — 指数密度", () => {
  it("setDensity 设置密度", () => {
    const cap = newCap({ enabled: true });
    cap.setDensity(0.03);
    expect(cap.getParams().density).toBe(0.03);
  });
});

describe("FogCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("FogCapability — 预设", () => {
  it("setPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.setPreset("mmd");
    const p = cap.getParams();
    // mmd 预设
    expect(p.mode).toBe("linear");
    cap.setPreset("vrm");
    const p2 = cap.getParams();
    expect(p2.enabled).toBe(false); // 预设不强制开启
  });
});

describe("FogCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: { mode: "exp2", density: 0.025, near: 30, far: 500 } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    expect(cap2.getMode()).toBe("exp2");
    expect(cap2.getParams().density).toBe(0.025);
    expect(cap2.getParams().near).toBe(30);
    expect(cap2.getParams().far).toBe(500);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { mode: "exp2" } });
    cap.loadState();
    expect(cap.getMode()).toBe("exp2");
  });

  it("loadState 读回合法数据", () => {
    localStorage.setItem("ysm-scene-cap-fog", JSON.stringify({ enabled: true, mode: "exp2", density: 0.02, color: 0x123456, near: 20, far: 300 }));
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getMode()).toBe("exp2");
    expect(cap.getParams().density).toBe(0.02);
  });
});

describe("FogCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(5);
    // 总开关
    const enabledCtrl = controls.find((c) => c.id === "fog-enabled");
    expect(enabledCtrl).toBeDefined();
    expect(enabledCtrl!.kind).toBe("toggle");
    expect(enabledCtrl!.getValue()).toBe(false);
    // 模式选择
    const modeCtrl = controls.find((c) => c.id === "fog-mode");
    expect(modeCtrl).toBeDefined();
    expect(modeCtrl!.kind).toBe("select");
    expect(modeCtrl!.select?.length).toBe(2);
    // 近距/远距/密度滑块
    expect(controls.find((c) => c.id === "fog-near")).toBeDefined();
    expect(controls.find((c) => c.id === "fog-far")).toBeDefined();
    expect(controls.find((c) => c.id === "fog-density")).toBeDefined();
  });

  it("toggle 开关同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "fog-enabled")!;
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
    expect(enabledCtrl.getValue()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("模式选择同步", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const modeCtrl = controls.find((c) => c.id === "fog-mode")!;
    modeCtrl.setValue("exp2");
    expect(cap.getMode()).toBe("exp2");
  });

  it("非总开关控件均含 group 字段", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "fog-enabled").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(typeof c.group).toBe("string");
      expect(c.group!.startsWith("preview.")).toBe(true);
    });
  });
});

describe("FogCapability — 预设数据完整性", () => {
  it("DEFAULT_FOG_PARAMS 默认值完整", () => {
    expect(DEFAULT_FOG_PARAMS.enabled).toBe(false);
    expect(DEFAULT_FOG_PARAMS.mode).toBe("linear");
    expect(typeof DEFAULT_FOG_PARAMS.color).toBe("number");
    expect(typeof DEFAULT_FOG_PARAMS.near).toBe("number");
    expect(typeof DEFAULT_FOG_PARAMS.far).toBe("number");
    expect(typeof DEFAULT_FOG_PARAMS.density).toBe("number");
  });

  it("FOG_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "mmd-scene", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(FOG_PRESETS[t]).toBeDefined();
    }
  });
});