// @vitest-environment node
// ===== FogCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { FogCapability } from "./fog-capability.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";

function newCap(opts: { enabled?: boolean } = {}) {
  return new FogCapability({ scene: new THREE.Scene(), ...opts });
}

describe("FogCapability — 构造与默认值", () => {
  beforeEach(() => { resetEnvState(); });

  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    expect(cap.isEnabled()).toBe(true);
    expect(envState.fogEnabled).toBe(false);
    expect(p.mode).toBe("linear");
    expect(p.near).toBe(10);
    expect(p.far).toBe(200);
    expect(p.density).toBe(0.015);
    expect(p.color).toBe(0xaac4e8);
  });

  it("enabled:false 初始禁用", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnvState 覆盖生效", () => {
    setEnvState({ fogMode: "exp2", fogDensity: 0.02, fogNear: 50, fogFar: 500 }, { source: 'manual' });
    const cap = newCap();
    const p = cap.getParams();
    expect(p.mode).toBe("exp2");
    expect(p.density).toBe(0.02);
    expect(p.near).toBe(50);
    expect(p.far).toBe(500);
  });
});

describe("FogCapability — 模式切换", () => {
  beforeEach(() => { resetEnvState(); });

  it("setMode 切换线性/指数", () => {
    const cap = newCap();
    cap.setMode("exp2");
    expect(cap.getMode()).toBe("exp2");
    cap.setMode("linear");
    expect(cap.getMode()).toBe("linear");
  });
});

describe("FogCapability — 线性范围", () => {
  beforeEach(() => { resetEnvState(); });

  it("setLinearRange 设置近远距", () => {
    const cap = newCap({ enabled: true });
    cap.setLinearRange(20, 400);
    const p = cap.getParams();
    expect(p.near).toBe(20);
    expect(p.far).toBe(400);
  });

  it("setLinearRange 传单一参数不覆盖另一参数", () => {
    setEnvState({ fogNear: 10, fogFar: 200 }, { source: 'manual' });
    const cap = newCap({ enabled: true });
    cap.setLinearRange(50, undefined);
    expect(cap.getParams().near).toBe(50);
    expect(cap.getParams().far).toBe(200);
    cap.setLinearRange(undefined, 600);
    expect(cap.getParams().near).toBe(50);
    expect(cap.getParams().far).toBe(600);
  });
});

describe("FogCapability — 指数密度", () => {
  beforeEach(() => { resetEnvState(); });

  it("setDensity 设置密度", () => {
    const cap = newCap({ enabled: true });
    cap.setDensity(0.03);
    expect(cap.getParams().density).toBe(0.03);
  });
});

describe("FogCapability — 启用/禁用", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnabledFog 切换", () => {
    const cap = newCap();
    cap.setEnabledFog(true);
    expect(envState.fogEnabled).toBe(true);
    cap.setEnabledFog(false);
    expect(envState.fogEnabled).toBe(false);
  });
});

describe("FogCapability — 预设", () => {
  beforeEach(() => { resetEnvState(); });

  it("applyModelPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.applyModelPreset("mmd");
    const p = cap.getParams();
    expect(p.mode).toBe("linear");
    cap.applyModelPreset("vrm");
    const p2 = cap.getParams();
    expect(p2.enabled).toBe(false); // 预设不强制开启
  });
});

describe("FogCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); resetEnvState(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    setEnvState({ fogEnabled: true, fogMode: "exp2", fogDensity: 0.025, fogNear: 30, fogFar: 500 }, { source: 'manual' });
    const cap = newCap();
    cap.saveState();
    resetEnvState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    expect(cap2.getMode()).toBe("exp2");
    expect(cap2.getParams().density).toBe(0.025);
    expect(cap2.getParams().near).toBe(30);
    expect(cap2.getParams().far).toBe(500);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap();
    cap.loadState();
    expect(cap.getMode()).toBe("linear");
  });

  it("loadState 读回合法数据", () => {
    localStorage.setItem("ysm-scene-cap-fog", JSON.stringify({ enabled: true, fogMode: "exp2", fogDensity: 0.02, fogColor: 0x123456, fogNear: 20, fogFar: 300 }));
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getMode()).toBe("exp2");
    expect(cap.getParams().density).toBe(0.02);
  });
});

describe("FogCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => { resetEnvState(); });

  it("非总开关节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // master toggle 在顶层
    expect(nodes[0]!.id).toBe("fog-enabled");
    // 其余节点在 folder children 内
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    const childIds = folder.children!.map((c) => c.id);
    expect(childIds).toContain("fog-color");
    expect(childIds).toContain("fog-mode");
    expect(childIds).toContain("fog-density");
    expect(childIds).toContain("fog-near");
    expect(childIds).toContain("fog-far");
    // folder 的 labelKey 对应原 group
    expect(folder.labelKey).toBe("preview.fogGroupParams");
  });

  it("toggle 开关同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "fog-enabled")!;
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    expect(enabledNode.control!.get!(undefined)).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("模式选择同步（节点 control 闭包）", () => {
    const cap = newCap();
    const folder = cap.getMenuNodes()[1]!;
    const modeNode = folder.children!.find((c) => c.id === "fog-mode")!;
    modeNode.control!.set!("exp2");
    expect(cap.getMode()).toBe("exp2");
  });
});

describe("FogCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  it("完整树 = master toggle 原生节点 + 参数组 folder（color/select/3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(2);
    // master toggle
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("fog-enabled");
    expect(nodes[0]!.control!.get!(undefined)).toBe(true);
    nodes[0]!.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    // 参数组 folder
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.fogGroupParams");
    expect(folder.children!.map((c) => c.id)).toEqual([
      "fog-color",
      "fog-mode",
      "fog-density",
      "fog-near",
      "fog-far",
    ]);
    // 全原生节点（color/select/slider；fog 无复杂控件不走 controls 通道）
    expect(folder.children!.map((c) => c.kind)).toEqual([
      "color",
      "select",
      "slider",
      "slider",
      "slider",
    ]);
  });

  it("剔除 master 后的子树（env 二级 body 语义）：仅参数组 folder", () => {
    const cap = newCap();
    const rest = cap.getMenuNodes().filter((n) => n.id !== cap.getMasterNodeId());
    expect(rest).toHaveLength(1);
    expect(rest[0]!.children!.some((c) => c.id === "fog-enabled")).toBe(false);
  });

  it("color/select/slider 节点读写闭包直连 cap", () => {
    setEnvState({ fogMode: "exp2" }, { source: 'manual' });
    const cap = newCap();
    const folder = cap.getMenuNodes()[1]!;
    const color = folder.children!.find((c) => c.id === "fog-color")!;
    expect(color.kind).toBe("color");
    expect(color.control!.get!(undefined)).toBe(0xaac4e8);
    color.control!.set!(0xff0000);
    expect(cap.getColor()).toBe(0xff0000);
    // select 模式
    const mode = folder.children!.find((c) => c.id === "fog-mode")!;
    expect(mode.control!.options).toHaveLength(2);
    mode.control!.set!("linear");
    expect(cap.getMode()).toBe("linear");
    // slider 密度
    const density = folder.children!.find((c) => c.id === "fog-density")!;
    density.control!.set!(0.03);
    expect(cap.getDensity()).toBe(0.03);
  });
});

describe("FogCapability — 预设数据完整性", () => {
  beforeEach(() => { resetEnvState(); });

  it("envState 默认值完整", () => {
    expect(envState.fogEnabled).toBe(false);
    expect(envState.fogMode).toBe("linear");
    expect(typeof envState.fogColor).toBe("number");
    expect(typeof envState.fogNear).toBe("number");
    expect(typeof envState.fogFar).toBe("number");
    expect(typeof envState.fogDensity).toBe("number");
  });
});

describe("FogCapability — apply 管线", () => {
  beforeEach(() => { resetEnvState(); });

  it("applyFog 写入 scene.fog", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene, enabled: true });
    cap.setEnabledFog(true);
    expect(scene.fog).not.toBeNull();
    cap.setEnabledFog(false);
    // 禁用时还原构造前 scene.fog（null）
    expect(scene.fog).toBeNull();
  });

  it("setColor 更新 currentFog 颜色", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene, enabled: true });
    cap.setEnabledFog(true);
    cap.setColor(0x00ff00);
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.getHex()).toBe(0x00ff00);
  });

  it("setLinearRange 更新 currentFog 近/远距", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene, enabled: true });
    cap.setEnabledFog(true);
    cap.setLinearRange(100, 2000);
    const fog = scene.fog as THREE.Fog;
    expect(fog.near).toBe(100);
    expect(fog.far).toBe(2000);
  });

  it("setDensity 更新 currentFog 密度（exp2 模式）", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene, enabled: true });
    cap.setEnabledFog(true);
    cap.setMode("exp2");
    cap.setDensity(0.05);
    const fog = scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(0.05);
  });
});

describe("FogCapability — 生命周期", () => {
  beforeEach(() => { resetEnvState(); });

  it("dispose 还原 prevFog", () => {
    const scene = new THREE.Scene();
    const prevFog = new THREE.Fog(0xffffff, 10, 100);
    scene.fog = prevFog;
    const cap = new FogCapability({ scene });
    cap.dispose();
    expect(scene.fog).toBe(prevFog);
  });
});
