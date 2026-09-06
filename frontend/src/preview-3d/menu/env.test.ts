// ===== 环境菜单声明式 Schema 测试（ADR-193 第三刀：folder 内联展开，renderEnvLevel 退役）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEnvSchema, disposeEnvSubscriptions } from "./env.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import type { PreviewMenuCtx } from "./node-types.ts";
import type { CameraControlBridge } from "../adapters/camera-controls.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import { setSceneCapabilityLookup, previewSnapshot } from "../state/preview-state.ts";
import type { PreviewSnapshot } from "../state/preview-paths.ts";

/** 构造最小 PreviewMenuCtx（测试用） */
function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () =>
      ({ mode: "orbit" as const, setMode: vi.fn(), reset: vi.fn() }) as unknown as CameraControlBridge,
    getSiblings: () => [],
    getCurrentPath: () => "",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    ...overrides,
  } as PreviewMenuCtx;
}

/** 构造 fake SlideMenuHandle */
function makeMenu(): SlideMenuHandle {
  return {
    root: document.createElement("div"),
    list: document.createElement("div"),
    setTitle: vi.fn(),
    setOnClose: vi.fn(),
    home: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    isShowing: vi.fn(),
    reset: vi.fn(),
    isAtRoot: () => true,
    dispose: vi.fn(),
  } as unknown as SlideMenuHandle;
}

/** 测试用 cap 工厂：控件组可注入 */
function makeCap(
  id: string,
  labelKey: string,
  controls: ReturnType<NonNullable<SceneCapability["getMenuControls"]>>,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    labelKey,
    icon: "🌤️",
    descKey: "",
    getMenuControls: () => controls,
    apply: vi.fn(),
    dispose: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
    saveState: vi.fn(),
    loadState: vi.fn(),
    ...extra,
  };
}

type CtrlsFn = ReturnType<NonNullable<SceneCapability["getMenuControls"]>>;

describe("buildEnvSchema（ADR-193 第三刀：声明式 folder 手风琴）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // [ADR-168] 探针用例会注入 state 层查询器，用后即复（防泄漏到后续用例）
  afterEach(() => {
    setSceneCapabilityLookup(null);
    disposeEnvSubscriptions();
  });

  it("无 cap → 空态单节点（sectionTitle），零 renderCustom", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const schema = buildEnvSchema(makeCtx());
    expect(schema).toHaveLength(1);
    expect(schema[0]!.id).toBe("env-empty");
    expect(schema[0]!.kind).toBe("sectionTitle");
    expect(schema.every((n) => n.renderCustom === undefined)).toBe(true);
  });

  it("产出 预设 select + 按 ORDERED_IDS 排序的 cap folder，全部声明式", () => {
    const sky = makeCap("sky", "preview.sky", [
      {
        id: "sky-time",
        kind: "slider",
        labelKey: "preview.timeOfDay",
        fallback: "时间",
        getValue: () => 12,
        setValue: () => {},
        slider: { min: 0, max: 24, step: 0.25 },
      },
    ]);
    const fog = makeCap("fog", "preview.fog", [
      {
        id: "fog-enabled",
        kind: "toggle",
        labelKey: "preview.fogEnabled",
        fallback: "雾",
        getValue: () => false,
        setValue: () => {},
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([fog, sky]); // 乱序注入，验证排序
    const menu = makeMenu();
    const schema = buildEnvSchema(makeCtx(), menu);
    expect(schema[0]!.id).toBe("env-preset-bar");
    expect(schema[0]!.kind).toBe("select");
    expect(schema.slice(1).map((n) => n.id)).toEqual(["env-cap-sky", "env-cap-fog"]);
    expect(schema.every((n) => n.kind === "select" || n.kind === "folder")).toBe(true);
  });

  it("单组 cap：folder children = controls 节点，控件组惰性求值且剥 group 字段", () => {
    let calls = 0;
    const sky = makeCap("sky", "preview.sky", []);
    sky.getMenuControls = () => {
      calls++;
      return [
        {
          id: "sky-time",
          kind: "slider",
          labelKey: "preview.timeOfDay",
          fallback: "时间",
          group: "x",
          getValue: () => 12,
          setValue: () => {},
          slider: { min: 0, max: 24, step: 0.25 },
        },
      ];
    };
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky]);
    const schema = buildEnvSchema(makeCtx(), makeMenu());
    const folder = schema[1]!;
    expect(folder.children).toHaveLength(1);
    const ctrls = folder.children![0]!;
    expect(ctrls.kind).toBe("controls");
    const fn = ctrls.controls as () => CtrlsFn;
    const out1 = fn();
    const out2 = fn();
    expect(calls).toBeGreaterThanOrEqual(2); // 惰性：每次渲染重取
    expect("group" in out1[0]!).toBe(false); // 剥 group 防 renderCapControls 再包同名 section
    expect(out2[0]!.id).toBe("sky-time");
  });

  it("多组 cap（ground）：组内嵌 folder，labelKey 用 group 键，各组控件隔离", () => {
    const ground = makeCap("ground", "preview.ground", [
      {
        id: "ground-visible",
        kind: "toggle",
        labelKey: "preview.ground",
        fallback: "地面",
        getValue: () => true,
        setValue: () => {},
      },
      {
        id: "ground-water-enabled",
        kind: "toggle",
        labelKey: "preview.groundWaterEnabled",
        fallback: "水面",
        group: "preview.groundGroupWater",
        getValue: () => true,
        setValue: () => {},
      },
      {
        id: "ground-water-mode",
        kind: "select",
        labelKey: "preview.groundWaterMode",
        fallback: "形态",
        group: "preview.groundGroupWater",
        select: [{ value: "film", label: "薄膜" }],
        getValue: () => "film",
        setValue: () => {},
      },
      {
        id: "ground-mat-source",
        kind: "select",
        labelKey: "preview.groundMatSource",
        fallback: "材质",
        group: "preview.groundGroupMaterial",
        select: [{ value: "none", label: "无" }],
        getValue: () => "none",
        setValue: () => {},
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([ground]);
    const schema = buildEnvSchema(makeCtx(), makeMenu());
    const folder = schema[1]!;
    const grpFolders = folder.children!;
    expect(grpFolders.map((g) => g.labelKey)).toEqual([
      "preview.ground",
      "preview.groundGroupWater",
      "preview.groundGroupMaterial",
    ]);
    const waterCtrls = grpFolders[1]!.children![0]!.controls as () => CtrlsFn;
    const ids = waterCtrls().map((c) => c.id);
    expect(ids).toEqual(["ground-water-enabled", "ground-water-mode"]); // 水面组不混材质组
  });

  it("分组按 visibleWhen(s) 实时：水模式 film→pool 后重取，组员随快照切换（B 轨）", () => {
    let mode: "film" | "pool" = "film";
    const listeners = new Set<() => void>();
    const water = makeCap(
      "water",
      "preview.water",
      [],
      {
        subscribe: (l: () => void) => {
          listeners.add(l);
          return () => {
            listeners.delete(l);
          };
        },
        getWaterMode: () => mode,
        setWaterMode: (v: string) => {
          mode = v as "film" | "pool";
          listeners.forEach((l) => l());
        },
      },
    );
    water.getMenuControls = () =>
      [
        {
          id: "water-mode",
          kind: "select",
          labelKey: "preview.groundWaterMode",
          fallback: "形态",
          group: "preview.waterGroupForm",
          select: [
            { value: "film", label: "薄膜" },
            { value: "pool", label: "水池" },
          ],
          getValue: () => mode,
          setValue: (v: string) => {
            mode = v as "film" | "pool";
            listeners.forEach((l) => l());
          },
        },
        {
          id: "water-pool-height",
          kind: "slider",
          labelKey: "preview.groundPoolHeight",
          fallback: "水池高度",
          group: "preview.waterGroupPool",
          slider: { min: 0.01, max: 5, step: 0.05 },
          getValue: () => 1,
          setValue: () => {},
          visibleWhen: (s: Partial<PreviewSnapshot>) => s["env.waterMode"] === "pool",
        },
        {
          id: "water-wetness",
          kind: "slider",
          labelKey: "preview.waterFilmDensity",
          fallback: "浓度",
          group: "preview.waterGroupLook",
          slider: { min: 0, max: 1, step: 0.05 },
          getValue: () => 0.5,
          setValue: () => {},
          visibleWhen: (s: Partial<PreviewSnapshot>) => s["env.waterMode"] === "film",
        },
      ] as CtrlsFn;
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([water]);
    vi.spyOn(sceneCapabilityRegistry, "getById").mockImplementation((id: string) =>
      id === "water" ? (water as unknown as SceneCapability) : undefined,
    );
    // [ADR-168] 注入 state 层查询器：previewSnapshot() 经 env.waterMode 解析到 mode
    setSceneCapabilityLookup({ getById: (id: string) => (id === "water" ? water : undefined) });

    const schema = buildEnvSchema(makeCtx(), makeMenu());
    const folder = schema[1]!;
    const grpIds = () => folder.children!.map((g) => g.id);
    // 初始 film：Pool 组无可见成员 → 分区缺失；Look 组存在
    expect(grpIds().some((i) => i.includes("waterGroupPool"))).toBe(false);
    expect(grpIds().some((i) => i.includes("waterGroupLook"))).toBe(true);

    // 切 pool → 订阅触发 refresh → 面板重渲染 → builder 重跑 → 分区重建
    (water.getMenuControls().find((c) => c.id === "water-mode")!.setValue)("pool");
    expect(mode).toBe("pool");
    const schema2 = buildEnvSchema(makeCtx(), makeMenu());
    const grpIds2 = schema2[1]!.children!.map((g) => g.id);
    expect(grpIds2.some((i) => i.includes("waterGroupPool"))).toBe(true);
    expect(grpIds2.some((i) => i.includes("waterGroupLook"))).toBe(false);
    // Pool 组成员经 visibleWhen 实时过滤
    const poolCtrls = schema2[1]!.children!.find((g) => g.id.includes("waterGroupPool"))!
      .children![0]!.controls as () => CtrlsFn;
    expect(poolCtrls().map((c) => c.id)).toEqual(["water-pool-height"]);
  });

  it("订阅链：menu 存在时重建 cap 订阅，disposeEnvSubscriptions 退订全部", () => {
    const listeners = new Set<() => void>();
    const sky = makeCap("sky", "preview.sky", [], {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
    });
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky]);
    const menu = makeMenu();
    buildEnvSchema(makeCtx(), menu);
    expect(listeners.size).toBe(1);
    buildEnvSchema(makeCtx(), menu); // 重跑（refresh 路径）：先退订旧再建新，不叠加
    expect(listeners.size).toBe(1);
    disposeEnvSubscriptions();
    expect(listeners.size).toBe(0);
  });

  it("预设 select：set 走 ENV_PRESET_LINKAGE 跨 cap 联动（sky 时间 + fog + environment.setPresetId）", () => {
    const skySetTime = vi.fn();
    const fogSetEnabled = vi.fn();
    const envSetPreset = vi.fn();
    const sky = makeCap("sky", "preview.sky", [], { setTime: skySetTime, setCloudCoverage: vi.fn() });
    const fog = makeCap("fog", "preview.fog", [], {
      setEnabled: fogSetEnabled,
      setMode: vi.fn(),
      setDensity: vi.fn(),
      setLinearRange: vi.fn(),
    });
    const env = makeCap("environment", "preview.environment", [], {
      setPresetId: envSetPreset,
      setIntensity: vi.fn(),
    });
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky, fog, env]);
    vi.spyOn(sceneCapabilityRegistry, "getById").mockImplementation((id: string) => {
      if (id === "sky") return sky as unknown as SceneCapability;
      if (id === "fog") return fog as unknown as SceneCapability;
      if (id === "environment") return env as unknown as SceneCapability;
      return undefined;
    });
    const menu = makeMenu();
    const preset = buildEnvSchema(makeCtx(), menu)[0]!;
    expect(preset.control!.options).toHaveLength(5); // studio/sunset/night/forest/sky
    preset.control!.set!("sunset");
    expect(skySetTime).toHaveBeenCalledWith(18); // LINKAGE.sunset.sky.time
    expect(fogSetEnabled).toHaveBeenCalledWith(true);
    expect(envSetPreset).toHaveBeenCalledWith("sunset");
    expect(menu.refresh).toHaveBeenCalled(); // 联动后重渲染兄弟控件
  });

  it("previewSnapshot 惰性：分区每次渲染吃当前快照（不在构建期固化控件数组）", () => {
    const ground = makeCap("ground", "preview.ground", [
      {
        id: "ground-visible",
        kind: "toggle",
        labelKey: "preview.ground",
        fallback: "地面",
        getValue: () => true,
        setValue: () => {},
      },
      {
        id: "g-w",
        kind: "toggle",
        labelKey: "preview.groundWaterEnabled",
        fallback: "水面",
        group: "preview.groundGroupWater",
        getValue: () => true,
        setValue: () => {},
      },
      {
        id: "g-m",
        kind: "toggle",
        labelKey: "preview.groundMatSource",
        fallback: "材质",
        group: "preview.groundGroupMaterial",
        getValue: () => true,
        setValue: () => {},
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([ground]);
    const before = previewSnapshot();
    const schema = buildEnvSchema(makeCtx(), makeMenu());
    const ctrls = schema[1]!.children![1]!.children![0]!.controls as () => CtrlsFn;
    expect(ctrls().map((c) => c.id)).toEqual(["g-w"]);
    expect(before).toBeDefined();
  });
});
