// @vitest-environment node
// ===== FogCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { FogCapability } from "./fog-capability.ts";
import { getParamRange } from "@/preview-3d/state/env-state-schema.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { clearEnvCallbacks, isEnvCallbacksSuspended } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-311 三分法 D2：布局断言 helper——归属用 childIds/nodeIds 配集合判据，
// 定位用 findNodeById（替代 nodes[i]! 位置索引；菜单项增删/重排不再让测试指错）。
import {
  assertNoDuplicateIds,
  childIds,
  findNodeById,
  nodeIds,
} from "@/preview-3d/menu/menu-test-helpers.ts";

// ADR-196：构造即注册全局 env 回调、仅 dispose 注销；与 ground/sky/water 同侪一致，
// afterEach 清空防 cap 泄漏跨测试（O(N²) 回调累积超时隐患）。
afterEach(() => { clearEnvCallbacks(); });
/** 测试用 scene：共享实例供「scene.fog 落地」断言（newCap 内部重建会丢引用） */
const scene = new THREE.Scene();
function newCap() {
  return new FogCapability({ scene });
}

describe("FogCapability — 构造与默认值", () => {
  beforeEach(() => { resetEnvState(); });

  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    // 单一 gate：构造后默认关雾（envState.fogEnabled=false），不再有恒 true 的私有态
    expect(cap.isEnabled()).toBe(false);
    expect(envState.fogEnabled).toBe(false);
    expect(p.mode).toBe("linear");
    expect(p.near).toBe(10);
    expect(p.far).toBe(200);
    expect(p.density).toBe(0.015);
    expect(p.color).toBe(0xaac4e8);
  });

  it("isEnabled 单一 gate：读 envState.fogEnabled（旧私有 enabled 已删）", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(false);
    setEnvState({ fogEnabled: true }, { source: "manual" });
    expect(cap.isEnabled()).toBe(true);
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
    const cap = newCap();
    cap.setLinearRange(20, 400);
    const p = cap.getParams();
    expect(p.near).toBe(20);
    expect(p.far).toBe(400);
  });

  it("setLinearRange 传单一参数不覆盖另一参数", () => {
    setEnvState({ fogNear: 10, fogFar: 200 }, { source: 'manual' });
    const cap = newCap();
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
    const cap = newCap();
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

  it("master toggle 与渲染一致：isEnabled 即 scene.fog 有无（旧私有态脱节回归锚）", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    // 默认关雾：toggle 显示 OFF 且不渲染（旧实现 toggle 恒 ON 而 scene.fog 恒 null）
    expect(cap.isEnabled()).toBe(false);
    expect(scene.fog).toBeNull();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    expect(scene.fog).not.toBeNull();
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

  it("loadState 读回 ADR-196 前 legacy 无前缀键（code_review df84baefb #13 迁移契约，防再次被删）", () => {
    // 升级用户：localStorage 仍是旧版 saveState 写的 {enabled, mode, color, near, far, density}
    // 无前缀形态。判据 = fogMode（saveState 恒写的前缀代表键）缺失 + 任一旧键存在 → 纯旧形态。
    // 此用例锁死「旧数据不静默回默认」——c1f4e4adb 曾误删迁移块，本用例防回归。
    localStorage.setItem(
      "ysm-scene-cap-fog",
      JSON.stringify({ enabled: true, mode: "exp2", color: 0x123456, near: 20, far: 300, density: 0.02 }),
    );
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getMode()).toBe("exp2");
    expect(cap.getParams().density).toBe(0.02);
    expect(cap.getParams().near).toBe(20);
    expect(cap.getParams().far).toBe(300);
  });

  it("loadState 读回合法数据", () => {
    localStorage.setItem("ysm-scene-cap-fog", JSON.stringify({ enabled: true, fogMode: "exp2", fogDensity: 0.02, fogColor: 0x123456, fogNear: 20, fogFar: 300 }));
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getMode()).toBe("exp2");
    expect(cap.getParams().density).toBe(0.02);
  });

  // [锐评 F-2] 恢复路径来源纪律：存档恢复是**程序化动作**，不得把 fog 组 6 键
  // 打成 manual——否则后续 auto-atmosphere 预设写雾参数被 shouldOverwrite 拒绝
  // （用户选了 sunset 氛围，雾却不跟着变）。与 ground/water 恢复口径对齐。
  it("[锐评 F-2] loadState 后 preset 仍能写雾参数（恢复不得把 fog 键打成 manual 冻死预设）", () => {
    localStorage.setItem(
      "ysm-scene-cap-fog",
      JSON.stringify({ enabled: true, fogMode: "linear", fogColor: 0x111111, fogNear: 10, fogFar: 100, fogDensity: 0.01 }),
    );
    const cap = newCap();
    cap.loadState();

    // 氛围预设（auto-atmosphere）写雾：恢复后必须仍然生效
    setEnvState(
      { fogMode: "exp2", fogDensity: 0.015, fogNear: 50, fogFar: 800 },
      { source: "auto-atmosphere" },
    );
    expect(envState.fogMode).toBe("exp2");
    expect(envState.fogDensity).toBe(0.015);
    expect(envState.fogFar).toBe(800);
  });

  // [锐评 R-1 收口 2026-09-22] 恢复走 auto-model（F-2）后，装配序 loadAll→applyModelDefaults
  // 的同轨 auto-model→auto-model 被 shouldOverwrite **放行**——无 isStateLoaded 守卫则
  // 存档雾被模型默认值顶掉（探针实证：vrm 把存档 fogColor 0x112233 改成 0xC5D4E8）。
  // 「持久化状态优先」从注释口号落成 shadow/reflector 同款显式守卫。
  it("[R-1] 有存档时 applyModelPreset 不得顶掉存档雾值（持久化状态优先）", () => {
    localStorage.setItem(
      "ysm-scene-cap-fog",
      JSON.stringify({ fogEnabled: true, fogMode: "exp2", fogColor: 0x112233, fogDensity: 0.03 }),
    );
    const cap = newCap();
    cap.loadState();
    cap.applyModelPreset("vrm"); // vrm 的 MODEL_DEFAULTS 携全套雾键
    expect(envState.fogColor, "存档雾色应存活").toBe(0x112233);
    expect(envState.fogDensity).toBe(0.03);
  });

  it("[R-1 对照] 无存档首启：applyModelPreset 照常套用模型雾值（守卫不误伤）", () => {
    const cap = newCap();
    cap.loadState(); // 无 localStorage → 早退，isStateLoaded 不置位
    cap.applyModelPreset("vrm");
    expect(envState.fogColor, "首启无存档 → 模型值照写").toBe(0xc5d4e8);
  });

  // [锐评 F-2] 挂起收口：恢复期间派发应被挂起，末尾统一 applyFog 一次——
  // 消除「6 次 dispatch × 6 次 applyFog」的启动期冗余（对齐 ground loadState）。
  it("loadState 恢复期间派发挂起，末尾统一落地一次", () => {
    localStorage.setItem(
      "ysm-scene-cap-fog",
      JSON.stringify({ enabled: true, fogMode: "exp2", fogColor: 0x123456, fogNear: 20, fogFar: 300, fogDensity: 0.02 }),
    );
    const cap = newCap();
    const applySpy = vi.spyOn(cap as unknown as { applyFog: () => void }, "applyFog");

    cap.loadState();

    // 恢复后状态正确落地，且 applyFog 只在末尾显式跑一次（挂起期内派发不触发回调）
    expect(envState.fogMode).toBe("exp2");
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect(applySpy).toHaveBeenCalledTimes(1);
    // 挂起计数必须归零（逃逸会让后续全仓 envState 派发静默假死）
    expect(isEnvCallbacksSuspended()).toBe(false);
  });
});

describe("FogCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  beforeEach(() => { resetEnvState(); });

  it("非总开关节点全部嵌套在参数组 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // ADR-311 收敛示范：master 与参数组都是「成员」断言（按 id 定位 + 精确集合），
    // 不锁位置——env.ts envCapSubNodes 本就按 id 剔除 master，顶层顺序非契约。
    expect(findNodeById(nodes, "fog-enabled").kind).toBe("toggle");
    const folder = findNodeById(nodes, "cap-group-fog-params");
    expect(folder.kind).toBe("folder");
    // 精确集合：五参数全在且无多余（原 toContain×5 只测「不少」不测「不多」，集合更严）
    expect(childIds(folder).sort()).toEqual(
      ["fog-color", "fog-density", "fog-far", "fog-mode", "fog-near"].sort(),
    );
    // folder 的 labelKey 对应原 group
    expect(folder.labelKey).toBe("preview.fogGroupParams");
  });

  it("toggle 开关同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const enabledNode = findNodeById(cap.getMenuNodes(), "fog-enabled");
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    expect(enabledNode.control!.get!(undefined)).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("模式选择同步（节点 control 闭包）", () => {
    const cap = newCap();
    const modeNode = findNodeById(cap.getMenuNodes(), "fog-mode");
    modeNode.control!.set!("exp2");
    expect(cap.getMode()).toBe("exp2");
  });
});

describe("FogCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  it("完整树 = master toggle 原生节点 + 参数组 folder（color/select/3 slider）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    assertNoDuplicateIds(nodes);
    // ADR-311：顶层是「成员」——master + 参数组 folder 恰好两个，按 id 集合断言（顺序非契约）
    expect(nodeIds(nodes).sort()).toEqual(
      ["cap-group-fog-params", "fog-enabled"].sort(),
    );
    // master toggle 行为：默认关雾，control get/set 反映 envState.fogEnabled
    const master = findNodeById(nodes, "fog-enabled");
    expect(master.kind).toBe("toggle");
    expect(master.control!.get!(undefined)).toBe(false);
    master.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    // 参数组 folder 归属：五参数精确集合（无多无少，重排不敏感）
    const folder = findNodeById(nodes, "cap-group-fog-params");
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.fogGroupParams");
    expect(childIds(folder).sort()).toEqual(
      ["fog-color", "fog-density", "fog-far", "fog-mode", "fog-near"].sort(),
    );
    // 全原生节点（color/select/slider；fog 无复杂控件不走 controls 通道）——
    // kind 是每个成员自身的行为契约，按 id 逐条硬断言而非有序 kind 数组
    expect(findNodeById(nodes, "fog-color").kind).toBe("color");
    expect(findNodeById(nodes, "fog-mode").kind).toBe("select");
    expect(findNodeById(nodes, "fog-density").kind).toBe("slider");
    expect(findNodeById(nodes, "fog-near").kind).toBe("slider");
    expect(findNodeById(nodes, "fog-far").kind).toBe("slider");
  });

  it("剔除 master 后的子树（env 二级 body 语义）：仅参数组 folder", () => {
    const cap = newCap();
    const rest = cap.getMenuNodes().filter((n) => n.id !== cap.getMasterNodeId());
    // 成员集合断言：剔除 master 后顶层恰好只剩参数组 folder
    expect(nodeIds(rest).sort()).toEqual(["cap-group-fog-params"]);
    // master 不残留在任何子级（行为：filter 语义正确性）
    expect(childIds(findNodeById(rest, "cap-group-fog-params"))).not.toContain("fog-enabled");
  });

  it("color/select/slider 节点读写闭包直连 cap", () => {
    setEnvState({ fogMode: "exp2" }, { source: 'manual' });
    const cap = newCap();
    const color = findNodeById(cap.getMenuNodes(), "fog-color");
    expect(color.kind).toBe("color");
    expect(color.control!.get!(undefined)).toBe(0xaac4e8);
    color.control!.set!(0xff0000);
    expect(cap.getColor()).toBe(0xff0000);
    // select 模式
    const mode = findNodeById(cap.getMenuNodes(), "fog-mode");
    // 成员而非计数：断言「模式恰好是 linear/exp2 两枚举」（THREE.Fog 协议事实），
    // 新雾型加入时此断言指名缺项，而非 toHaveLength(2) 只报数字
    expect(mode.control!.options!.map((o) => o.value).sort()).toEqual(["exp2", "linear"]);
    mode.control!.set!("linear");
    expect(cap.getMode()).toBe("linear");
    // slider 密度
    const density = findNodeById(cap.getMenuNodes(), "fog-density");
    density.control!.set!(0.03);
    expect(cap.getDensity()).toBe(0.03);
  });

  it("菜单滑杆值域 = schema 值域（ADR-283：菜单不再是第二事实源）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const pairs = [
      ["fog-density", "fogDensity"],
      ["fog-near", "fogNear"],
      ["fog-far", "fogFar"],
    ] as const;
    for (const [id, key] of pairs) {
      // findNodeById 自带未命中失败信息（替代手搓 find+toBeDefined 两段）
      const c = findNodeById(nodes, id).control!;
      const range = getParamRange(key);
      expect({ min: c.min, max: c.max, step: c.step, unit: c.unit }, `${id} 值域应来自 schema`).toEqual(
        range,
      );
    }
  });

  it("mode select 选项带 labelKey（i18n 三语，不硬编码中文）", () => {
    const cap = newCap();
    const mode = findNodeById(cap.getMenuNodes(), "fog-mode");
    expect(mode.control!.options!.map((o) => o.labelKey).sort()).toEqual([
      "preview.fogModeExp2",
      "preview.fogModeLinear",
    ].sort());
  });

  it("near/far 仅 linear 可见、density 仅 exp2 可见（visibleWhen 吃 env.fogMode 快照）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 快照已收窄为精确联合（锐评 F-3），夹具参数随之收紧——旧 `string` 下拼错 mode 恒漏过
    const vis = (id: string, mode: "exp2" | "linear") =>
      findNodeById(nodes, id).visibleWhen!({ "env.fogMode": mode });
    // exp2：density 可见，near/far 隐藏
    expect(vis("fog-density", "exp2")).toBe(true);
    expect(vis("fog-near", "exp2")).toBe(false);
    expect(vis("fog-far", "exp2")).toBe(false);
    // linear：near/far 可见，density 隐藏
    expect(vis("fog-density", "linear")).toBe(false);
    expect(vis("fog-near", "linear")).toBe(true);
    expect(vis("fog-far", "linear")).toBe(true);
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
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    expect(scene.fog).not.toBeNull();
    cap.setEnabledFog(false);
    // 禁用时还原构造前 scene.fog（null）
    expect(scene.fog).toBeNull();
  });

  it("setColor 更新 currentFog 颜色", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    cap.setColor(0x00ff00);
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.getHex()).toBe(0x00ff00);
  });

  it("setLinearRange 更新 currentFog 近/远距", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    cap.setLinearRange(100, 2000);
    const fog = scene.fog as THREE.Fog;
    expect(fog.near).toBe(100);
    expect(fog.far).toBe(2000);
  });

  it("setDensity 更新 currentFog 密度（exp2 模式）", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    cap.setMode("exp2");
    cap.setDensity(0.05);
    const fog = scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(0.05);
  });

  it("同模式改参不重建雾对象（原地更新，GC 友好）", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    const before = scene.fog;
    cap.setColor(0x123456);
    cap.setLinearRange(5, 500);
    cap.setDensity(0.04); // linear 模式下 density 不改对象
    expect(scene.fog).toBe(before);
    expect((scene.fog as THREE.Fog).near).toBe(5);
    expect((scene.fog as THREE.Fog).color.getHex()).toBe(0x123456);
  });

  it("切换模式重建雾对象（Fog ↔ FogExp2 类型不同，必然新建）", () => {
    const scene = new THREE.Scene();
    const cap = new FogCapability({ scene });
    cap.setEnabledFog(true);
    const linearFog = scene.fog;
    cap.setMode("exp2");
    expect(scene.fog).not.toBe(linearFog);
    expect(scene.fog instanceof THREE.FogExp2).toBe(true);
    const exp2Fog = scene.fog;
    cap.setMode("linear");
    expect(scene.fog).not.toBe(exp2Fog);
    expect(scene.fog instanceof THREE.Fog).toBe(true);
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

describe("FogCapability — 菜单刷新订阅（subscribe）", () => {
  beforeEach(() => { resetEnvState(); });

  it("setMode 触发 notify（visibleWhen 吃 env.fogMode，需重渲染才刷新显隐）", () => {
    const cap = newCap();
    let n = 0;
    const off = cap.subscribe(() => {
      n++;
    });
    cap.setMode("exp2");
    expect(n).toBe(1);
    cap.setMode("linear");
    expect(n).toBe(2);
    off();
    cap.setMode("exp2");
    expect(n).toBe(2); // 取消订阅后不再通知
  });

  it("高频参数（color/near/far/density）不 notify（subscribe 契约：仅离散模式切换）", () => {
    const cap = newCap();
    let n = 0;
    cap.subscribe(() => {
      n++;
    });
    cap.setEnabledFog(true);
    cap.setColor(0x123456);
    cap.setLinearRange(5, 500);
    cap.setDensity(0.05);
    expect(n).toBe(0);
  });
});
