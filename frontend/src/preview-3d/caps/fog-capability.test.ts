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

describe("FogCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
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
  it("完整树 = master toggle 原生节点 + 参数组 folder（color/select/3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(2);
    // master toggle
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("fog-enabled");
    expect(nodes[0]!.control!.get!(undefined)).toBe(false);
    nodes[0]!.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
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
    const cap = newCap({ params: { mode: "exp2" } });
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