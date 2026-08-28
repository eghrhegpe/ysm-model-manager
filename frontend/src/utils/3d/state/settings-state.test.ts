// ===== settings-state 契约测试（[doc:adr-125] P1 状态层 / P2 单渲染器 / P3 visible 规则）=====
// 锁定三件事：
//   1. 六条横切路径的读写闭环与「cap 缺席不炸、不落盘」的持久化边界
//   2. 设置面板不再手写 cap 已自报的开关（杜绝 f0fa3e23 型重复真值来源）
//   3. 条件显隐谓词可集中枚举（collectVisiblePredicates）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SETTINGS_PATHS,
  getStateValue,
  setStateValue,
  isPathAvailable,
  settingsSnapshot,
  subscribeSettings,
  resetSettingsListeners,
  toStatePath,
  type SettingsPath,
} from "./settings-state.ts";
import {
  buildCrossCuttingControls,
  collectSettingsCapControls,
  buildSettingsControls,
} from "../adapters/preview-menu-settings.ts";
import { collectVisiblePredicates } from "../adapters/preview-menu-cap-controls.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { MenuControlDef, SceneCapability } from "../caps/scene-capability.ts";
import { MAX_FPS_KEY, MAX_PIXEL_RATIO_KEY, getMaxFps } from "../render-budget.ts";

/** 最小 fake cap：仅实现状态层会探到的开关语义 + 自报控件 */
function makeFakeCap(
  id: string,
  opts: { controls?: MenuControlDef[]; env?: boolean; envMethods?: boolean } = {},
): SceneCapability & {
  enabled: boolean;
  envOn: boolean;
  isEnvironmentEnabled(): boolean;
  setEnvironmentEnabled(v: boolean): void;
} {
  const cap = {
    id,
    labelKey: `cap.${id}`,
    icon: "🧪",
    descKey: `cap.${id}.desc`,
    enabled: false,
    envOn: opts.env === true,
    controls: opts.controls ?? [],
    apply: vi.fn(),
    dispose: vi.fn(),
    setEnabled(v: boolean) {
      cap.enabled = v;
    },
    isEnabled: () => cap.enabled,
    setEnvironmentEnabled(v: boolean) {
      cap.envOn = v;
    },
    isEnvironmentEnabled: () => cap.envOn,
    getMenuControls: () => cap.controls,
    saveState: vi.fn(),
    loadState: vi.fn(),
  };
  // 模拟「有 id 但无环境语义」的 cap，验证状态层的结构性探测不会误判
  if (opts.envMethods === false) {
    delete (cap as unknown as Record<string, unknown>).setEnvironmentEnabled;
    delete (cap as unknown as Record<string, unknown>).isEnvironmentEnabled;
  }
  return cap as unknown as SceneCapability & {
    enabled: boolean;
    envOn: boolean;
    isEnvironmentEnabled(): boolean;
    setEnvironmentEnabled(v: boolean): void;
  };
}

/**
 * 把 fake cap 注入注册表读口（spy 而非 createAll）。
 *
 * 不用 `registry.add + createAll` 的原因：preview-menu-settings.ts 的 import 链
 * 已把真实 cap 工厂注册到全局单例，createAll 会在 happy-dom 下逐个构造失败
 * （无 WebGL renderer），且 factories 无法清空、跨用例累积。spy 只替换读口，隔离干净。
 */
function mountCaps(...caps: SceneCapability[]): void {
  vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue(caps);
  vi.spyOn(sceneCapabilityRegistry, "getById").mockImplementation((id: string) =>
    caps.find((c) => c.id === id),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetSettingsListeners();
});

afterEach(() => {
  resetSettingsListeners();
  vi.restoreAllMocks();
});

describe("P1 状态层 — 横切路径读写闭环", () => {
  it("六条路径全部注册，快照键与 SETTINGS_PATHS 一致", () => {
    const snap = settingsSnapshot();
    expect(Object.keys(snap).sort()).toEqual([...SETTINGS_PATHS].sort());
  });

  it("render.frustumCull 读写闭环且落 localStorage", () => {
    expect(getStateValue("render.frustumCull")).toBe(false);
    setStateValue("render.frustumCull", true);
    expect(getStateValue("render.frustumCull")).toBe(true);
    expect(localStorage.getItem("ysm_3d_frustumCull")).toBe("1");
    setStateValue("render.frustumCull", false);
    expect(localStorage.getItem("ysm_3d_frustumCull")).toBe("0");
  });

  it("render.maxFps 写入后 rAF 热路径缓存同步失效（否则节流不生效）", () => {
    expect(getMaxFps()).toBe(60);
    setStateValue("render.maxFps", "120");
    // getMaxFps 有模块级缓存，状态层必须显式 invalidate
    expect(getMaxFps()).toBe(120);
    expect(localStorage.getItem(MAX_FPS_KEY)).toBe("120");
  });

  it("render.maxPixelRatio 按滑块区间持久化", () => {
    setStateValue("render.maxPixelRatio", 1.75);
    expect(localStorage.getItem(MAX_PIXEL_RATIO_KEY)).toBe("1.75");
  });

  it("非数字写入退化为安全缺省，不产生 NaN 持久化", () => {
    setStateValue("render.maxFps", "abc");
    expect(Number(localStorage.getItem(MAX_FPS_KEY))).toBe(0);
    setStateValue("render.maxPixelRatio", "abc");
    expect(Number(localStorage.getItem(MAX_PIXEL_RATIO_KEY))).toBe(1.5);
  });
});

describe("P1 状态层 — cap 派生路径的持久化边界", () => {
  it("cap 缺席时：读安全缺省、available=false、写入静默不抛", () => {
    for (const p of ["render.bloom", "render.wireframe", "env.pmrem"] as SettingsPath[]) {
      expect(isPathAvailable(p)).toBe(false);
      expect(getStateValue(p)).toBe(false);
      expect(() => setStateValue(p, true)).not.toThrow();
    }
    // 边界核心：cap 派生项不落盘（cap 存自己的域，状态层不重复存）
    for (const p of ["pp", "wireframe", "sky"] as const) {
      expect(localStorage.getItem(`ysm_3d_cap_${p}`)).toBeNull();
    }
  });

  it("cap 就位后：读写透传至 cap，且 available 转为 true", () => {
    const pp = makeFakeCap("postprocessing");
    const wf = makeFakeCap("wireframe");
    const sky = makeFakeCap("sky", { env: false });
    mountCaps(pp, wf, sky);

    expect(isPathAvailable("render.bloom")).toBe(true);
    setStateValue("render.bloom", true);
    expect(pp.isEnabled()).toBe(true);
    expect(getStateValue("render.bloom")).toBe(true);

    setStateValue("render.wireframe", true);
    expect(wf.isEnabled()).toBe(true);

    setStateValue("env.pmrem", true);
    expect(sky.isEnvironmentEnabled()).toBe(true);
    expect(getStateValue("env.pmrem")).toBe(true);
  });

  it("结构性探测：id 对得上但方法不全的 cap 不误判为可用", () => {
    // 只有 isEnabled、缺 setEnabled —— toggleCap 应判为「无此能力」而非运行期炸裂
    const halfCap = {
      id: "wireframe",
      labelKey: "x",
      icon: "x",
      descKey: "x",
      apply: vi.fn(),
      dispose: vi.fn(),
      isEnabled: () => true,
      getMenuControls: () => [],
      saveState: vi.fn(),
      loadState: vi.fn(),
    } as unknown as SceneCapability;
    mountCaps(halfCap);
    expect(isPathAvailable("render.wireframe")).toBe(false);
    expect(getStateValue("render.wireframe")).toBe(false);
    expect(() => setStateValue("render.wireframe", true)).not.toThrow();
  });

  it("结构性探测：sky cap 缺环境语义时 env.pmrem 不可用", () => {
    const noEnvSky = makeFakeCap("sky", { envMethods: false }); // 有 isEnabled/setEnabled，无环境方法
    mountCaps(noEnvSky);
    expect(isPathAvailable("env.pmrem")).toBe(false);
  });
});

describe("P1 状态层 — 订阅通知", () => {
  it("setStateValue 默认广播；{ notify:false } 抑制广播（高频滑块）", () => {
    const seen: SettingsPath[] = [];
    const off = subscribeSettings((p) => seen.push(p));

    setStateValue("render.frustumCull", true);
    setStateValue("render.maxPixelRatio", 1.25, { notify: false });

    expect(seen).toEqual(["render.frustumCull"]);
    off();
    setStateValue("render.frustumCull", false);
    expect(seen).toHaveLength(1); // 退订后不再收到
  });

  it("订阅回调抛错不污染其他订阅者", () => {
    const ok = vi.fn();
    subscribeSettings(() => {
      throw new Error("boom");
    });
    subscribeSettings(ok);
    expect(() => setStateValue("render.frustumCull", true)).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("P2 单渲染器 — 设置面板为纯数据节点", () => {
  it("横切三项为数据节点，id 稳定且带绑定语义", () => {
    const ids = buildCrossCuttingControls().map((c) => c.id);
    expect(ids).toEqual(["settings-frustum-cull", "settings-fps", "settings-pixel-ratio"]);
  });

  it("横切控件读写直连状态层（改控件值 = 改状态 = 落盘）", () => {
    const [frustum, fps] = buildCrossCuttingControls();
    frustum.setValue(true);
    expect(getStateValue("render.frustumCull")).toBe(true);
    fps.setValue("30");
    expect(getStateValue("render.maxFps")).toBe(30);
  });

  it("自动聚合：仅收 settingsOrder 声明项，升序且抹平 group", () => {
    const mk = (id: string, order: number): MenuControlDef => ({
      id,
      kind: "toggle",
      labelKey: id,
      fallback: id,
      group: "preview.someGroup",
      settingsOrder: order,
      getValue: () => false,
      setValue: vi.fn(),
    });
    const cap = makeFakeCap("fakecap", {
      controls: [mk("c-30", 30), mk("c-10", 10), { ...mk("c-hidden", 0), settingsOrder: undefined }],
    });
    mountCaps(cap);

    const got = collectSettingsCapControls();
    expect(got.map((c) => c.id)).toEqual(["c-10", "c-30"]);
    expect(got.every((c) => c.group === undefined)).toBe(true);
  });

  it("cap 缺席时不产生任何聚合控件（且不在构建期冻结）", () => {
    expect(collectSettingsCapControls()).toEqual([]);
    // 后挂载 cap 再来一次，能看见——即 05fe24b7 所修「声明期求值」同类病不复现
    const cap = makeFakeCap("postprocessing", {
      controls: [{
        id: "pp-enabled",
        kind: "toggle",
        labelKey: "preview.postprocessing",
        fallback: "后处理管线",
        settingsOrder: 10,
        getValue: () => true,
        setValue: vi.fn(),
      }],
    });
    mountCaps(cap);
    expect(collectSettingsCapControls().map((c) => c.id)).toEqual(["pp-enabled"]);
  });

  it("回归红线：设置面板不再手写 cap 已自报的开关（f0fa3e23 型重复真值来源）", () => {
    const ids = buildSettingsControls().map((c) => c.id);
    // 这三个开关的唯一真值来源是 cap 自报控件，设置面板不得另起一份
    expect(ids).not.toContain("settings-bloom");
    expect(ids).not.toContain("settings-pmrem");
    expect(ids).not.toContain("settings-wireframe");
  });

  it("回归红线：横切控件 id 与 cap 自报 id 不撞车", () => {
    const ids = buildSettingsControls().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("P3 visible 规则 — 条件显隐可集中枚举", () => {
  it("collectVisiblePredicates 只挑出带谓词的控件（纯函数）", () => {
    const plain: MenuControlDef = {
      id: "a", kind: "toggle", labelKey: "a", fallback: "a",
      getValue: () => false, setValue: vi.fn(),
    };
    const gated: MenuControlDef = {
      ...plain, id: "b", visible: () => false,
    };
    expect(collectVisiblePredicates([plain, gated]).map((c) => c.id)).toEqual(["b"]);
  });

  it("聚合到设置面板的控件如带 visible，谓词仍可枚举（不被抹平丢失）", () => {
    const gated: MenuControlDef = {
      id: "c-gated", kind: "toggle", labelKey: "c", fallback: "c",
      settingsOrder: 5, visible: () => true,
      getValue: () => false, setValue: vi.fn(),
    };
    mountCaps(makeFakeCap("fakecap", { controls: [gated] }));
    expect(collectVisiblePredicates(collectSettingsCapControls()).map((c) => c.id)).toEqual([
      "c-gated",
    ]);
  });
});

describe("契约守卫", () => {
  it("toStatePath：SettingsPath 全部落在 PreviewStatePath 定义域内", () => {
    // 编译期由 toStatePath 的返回类型守住；运行期仅验证透传不改写
    for (const p of SETTINGS_PATHS) expect(toStatePath(p)).toBe(p);
  });
});
