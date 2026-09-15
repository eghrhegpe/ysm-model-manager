// ===== 环境菜单声明式 Schema 测试（2026 收口：行 + navigate 下钻，folder 手风琴退役）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEnvSchema, disposeEnvSubscriptions } from "./env.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { resetEnvState, envState } from "@/preview-3d/state/env-state.ts";
import { ATMOSPHERE_PRESETS } from "@/preview-3d/state/atmosphere-presets.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import type { SlideMenuHandle } from "./slide-menu.ts";
import { setSceneCapabilityLookup } from "@/preview-3d/state/preview-state.ts";
import { EnvironmentCapability } from "@/preview-3d/caps/environment-capability.ts";
import { FogCapability } from "@/preview-3d/caps/fog-capability.ts";
import { GroundCapability } from "@/preview-3d/caps/ground-capability.ts";
import { ReflectorCapability } from "@/preview-3d/caps/reflector-capability.ts";
import { SkyCapability } from "@/preview-3d/caps/sky-capability.ts";
import { WaterCapability } from "@/preview-3d/caps/water-capability.ts";

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
  nodes: PreviewMenuNode[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    labelKey,
    icon: "sky" as const,
    descKey: "",
    getMenuNodes: () => nodes,
    apply: vi.fn(),
    dispose: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
    saveState: vi.fn(),
    loadState: vi.fn(),
    ...extra,
  };
}

type CtrlsFn = ReturnType<NonNullable<SceneCapability["getMenuNodes"]>>;

/**
 * 展开 env schema 中的 cap 行：schema[0] 是预设 select，其后是 card 卡壳，
 * 真正的行在 card.children 里（基础/氛围分段）。
 */
function capRows(schema: PreviewMenuNode[]): PreviewMenuNode[] {
  return schema.slice(1).flatMap((n) => (n.kind === "card" ? (n.children ?? []) : [n]));
}

/** 取第 idx 个 cap 行（0 基，跳过预设 select 与卡壳层） */
function capRow(schema: PreviewMenuNode[], idx: number): PreviewMenuNode {
  const row = capRows(schema)[idx]!;
  expect(row.kind).toBe("row");
  return row;
}

/** 执行 cap 行的 action：捕获 navigate 落点视图并渲染进容器，返回容器 */
type CapSubview = { title: string; render: (l: HTMLElement) => void };
function navigateAndRender(row: PreviewMenuNode, into?: HTMLElement): { container: HTMLElement; view: CapSubview | null } {
  const container = into ?? document.createElement("div");
  const box: { view: CapSubview | null } = { view: null };
  const actCtx: PreviewActionMenuCtx = {
    toast: vi.fn(),
    closeAllOverlays: vi.fn(),
    navigate: (v) => {
      box.view = v;
    },
  };
  row.action?.(actCtx);
  box.view?.render(container);
  return { container, view: box.view };
}

describe("buildEnvSchema（2026 收口：行 + navigate 下钻）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // [ADR-168] 探针用例会注入 state 层查询器，用后即复（防泄漏到后续用例）
  // per-mount 订阅隔离：buildEnvSchema 按 menu 句柄隔离订阅，测试创建的 menu 句柄需逐个清理
  const menusToDispose = new Set<SlideMenuHandle>();
  afterEach(() => {
    setSceneCapabilityLookup(null);
    for (const m of menusToDispose) disposeEnvSubscriptions(m);
    menusToDispose.clear();
  });

  it("无 cap → 空态单节点（sectionTitle），零 renderCustom", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const schema = buildEnvSchema(makeCtx());
    expect(schema).toHaveLength(1);
    expect(schema[0]!.id).toBe("env-empty");
    expect(schema[0]!.kind).toBe("sectionTitle");
    expect(schema.every((n) => n.renderCustom === undefined)).toBe(true);
  });

  it("产出 预设 select + 按 ORDERED_IDS 排序的 cap row，全部声明式", () => {
    const sky = makeCap("sky", "preview.sky", [
      {
        id: "sky-time",
        kind: "slider",
        labelKey: "preview.timeOfDay",
        control: {
          min: 0,
          max: 24,
          step: 0.25,
          get: () => 12,
          set: () => {},
        },
      },
    ]);
    const fog = makeCap("fog", "preview.fog", [
      {
        id: "fog-enabled",
        kind: "toggle",
        labelKey: "preview.fogEnabled",
        control: {
          get: () => false,
          set: () => {},
        },
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([fog, sky]); // 乱序注入，验证排序
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    expect(schema[0]!.id).toBe("env-preset-bar");
    expect(schema[0]!.kind).toBe("select");
    // 卡壳层：sky 归「基础」、fog 归「氛围」（ENV_SECTIONS 分段表单一事实源）
    expect(schema.slice(1).map((n) => n.id)).toEqual(["env-card-basic", "env-card-atmosphere"]);
    expect(schema.slice(1).every((n) => n.kind === "card")).toBe(true);
    expect(schema.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.envSectionBasic",
      "preview.envSectionAtmosphere",
    ]);
    const rows = capRows(schema);
    expect(rows.map((n) => n.id)).toEqual(["env-cap-sky", "env-cap-fog"]);
    // 每行是 row 节点（icon + label + action 下钻），带 chevron 语义由 action 表达
    expect(rows.every((n) => n.kind === "row" && typeof n.action === "function")).toBe(true);
    expect(schema.every((n) => n.renderCustom === undefined)).toBe(true);
  });

  it("cap 行 action → navigate 到参数子视图；子视图惰性渲染该 cap 全部控件（每次进入重取）", () => {
    let calls = 0;
    const sky = makeCap("sky", "preview.sky", []);
    sky.getMenuNodes = () => {
      calls++;
      return [
        {
          id: "sky-time",
          kind: "slider",
          labelKey: "preview.timeOfDay",
          control: {
            min: 0,
            max: 24,
            step: 0.25,
            get: () => 12,
            set: () => {},
          },
        },
      ];
    };
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    const row = capRow(schema, 0);
    // navigate 触发 + 子视图渲染
    const { container } = navigateAndRender(row);
    expect(container.querySelector('[data-testid="cap-sky-time"]')).not.toBeNull();
    // 惰性：每次 render 重取 getMenuNodes（ADR-125 P3 口径——cap 后创建也可见）
    navigateAndRender(row, container);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("cap 行下钻子视图：group 字段天然折叠成 .cap-section（多组 cap ground 不再手写分区套娃）", () => {
    const ground = makeCap("ground", "preview.ground", [
      {
        id: "ground-visible",
        kind: "toggle",
        labelKey: "preview.ground",
        control: {
          get: () => true,
          set: () => {},
        },
      },
      {
        id: "cap-group-ground-water",
        kind: "folder",
        labelKey: "preview.groundGroupWater",
        children: [
          {
            id: "ground-water-enabled",
            kind: "toggle",
            labelKey: "preview.groundWaterEnabled",
            control: {
              get: () => true,
              set: () => {},
            },
          },
        ],
      },
      {
        id: "cap-group-ground-material",
        kind: "folder",
        labelKey: "preview.groundGroupMaterial",
        children: [
          {
            id: "ground-mat-source",
            kind: "select",
            labelKey: "preview.groundMatSource",
            control: {
              options: [{ value: "none", label: "无" }],
              get: () => "none",
              set: () => {},
            },
          },
        ],
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([ground]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    const row = capRow(schema, 0);
    const { container } = navigateAndRender(row);
    // 无 group 的 ground-visible 平铺；两个 group → 两个 folder section
    expect(container.querySelector('[data-testid="cap-ground-visible"]')).not.toBeNull();
    const folders = container.querySelectorAll(
      '[data-testid^="cap-group-"]:not([data-testid$="-body"])',
    );
    expect(folders.length).toBe(2);
    // group 头文案（rmLabel 转译 labelKey）按组归属（water 组不混 material 组）
    const headerTexts = [...container.querySelectorAll(".cap-section-header")].map(
      (h) => h.textContent,
    );
    expect(headerTexts.join("")).toContain("水面");
    expect(headerTexts.join("")).toContain("材质");
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
    menusToDispose.add(menu);
    buildEnvSchema(makeCtx(), menu);
    expect(listeners.size).toBe(1);
    buildEnvSchema(makeCtx(), menu); // 重跑（refresh 路径）：先退订旧再建新，不叠加
    expect(listeners.size).toBe(1);
    disposeEnvSubscriptions(menu);
    expect(listeners.size).toBe(0);
  });

  it("预设 select：set 走 ATMOSPHERE_PRESETS 快照经 setEnvState 联动（sky/fog/env 一次写入）", () => {
    resetEnvState();
    const sky = makeCap("sky", "preview.sky", []);
    const fog = makeCap("fog", "preview.fog", []);
    const env = makeCap("environment", "preview.environment", []);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky, fog, env]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const preset = buildEnvSchema(makeCtx(), menu)[0]!;
    expect(preset.control!.options).toHaveLength(5); // studio/sunset/night/forest/sky
    preset.control!.set!("sunset");
    // ATMOSPHERE_PRESETS.sunset 完整快照落到 envState（不再逐 cap 调 setter）
    expect(envState.skyTimeOfDay).toBe(ATMOSPHERE_PRESETS.sunset.skyTimeOfDay); // 18
    expect(envState.fogEnabled).toBe(true);
    expect(envState.fogMode).toBe("linear");
    expect(envState.envPreset).toBe("sunset");
    expect(envState.envIntensity).toBeCloseTo(ATMOSPHERE_PRESETS.sunset.envIntensity! as number, 5);
    expect(menu.refresh).toHaveBeenCalled(); // 联动后重渲染兄弟控件
  });

  it("cap 自报 getMasterNodeId → 一级行带 headerToggle（行尾开关）；子视图剔除同源开关", () => {
    let enabled = false;
    const fog = makeCap("fog", "preview.fog", [
      {
        id: "fog-enabled",
        kind: "toggle" as const,
        labelKey: "preview.fog",
        control: {
          get: () => enabled,
          set: (v: boolean) => {
            enabled = v;
          },
        },
      },
      {
        id: "fog-color",
        kind: "color" as const,
        labelKey: "preview.fogColor",
        control: {
          get: () => 0,
          set: () => {},
        },
      },
    ] as unknown as CtrlsFn, {
      getMasterNodeId: () => "fog-enabled",
      isEnabled: () => enabled,
    });
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([fog]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    const row = capRow(schema, 0);
    // 一级行 headerToggle：读写即 masterCtrl 读写
    expect(row.headerToggle).toBeDefined();
    row.headerToggle!.onChange(true);
    expect(enabled).toBe(true);
    // 子视图剔除 fog-enabled（防「行开关 + 子页开关」双份）
    const { container } = navigateAndRender(row);
    expect(container.querySelector('[data-testid="cap-fog-enabled"]')).toBeNull();
    expect(container.querySelector('[data-testid="cap-fog-color"]')).not.toBeNull();
  });

  it("cap 不报 getMasterNodeId（sky）→ 一级行无 headerToggle；子视图全量保留控件", () => {
    const sky = makeCap("sky", "preview.sky", [
      {
        id: "sky-time",
        kind: "slider" as const,
        labelKey: "preview.timeOfDay",
        control: {
          min: 0,
          max: 24,
          step: 0.5,
          get: () => 12,
          set: () => {},
        },
      },
    ]);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    const row = capRow(schema, 0);
    expect(row.headerToggle).toBeUndefined();
    const { container } = navigateAndRender(row);
    expect(container.querySelector('[data-testid="cap-sky-time"]')).not.toBeNull();
  });
});

// ===== 守护测试（用户关切：隐式契约不可靠）=====
// 环境面板（🌍）一级行 headerToggle 依赖 cap 自报 getMasterNodeId()——漏声明则
// 行首默默无开关（静默回归）。本守护断言：环境面板 6 个 cap（ENV_IDS：
// sky/ground/water/environment/fog/reflector）生产类 prototype 必须声明
// getMasterNodeId，且其返回值在该 cap 的 getMenuNodes() 顶层树中确实存在
// 为 toggle 节点（编译/测试期把「漏实现」从静默无开关变成红）。
describe("守护：环境面板 6 cap 必须声明 getMasterNodeId（一级行开关的契约）", () => {
  const ENV_CAP_CLASSES = [
    SkyCapability,
    GroundCapability,
    WaterCapability,
    EnvironmentCapability,
    FogCapability,
    ReflectorCapability,
  ] as const;

  it("每个环境 cap 的 prototype 都声明 getMasterNodeId（防漏声明→一级默默无开关）", () => {
    for (const Cap of ENV_CAP_CLASSES) {
      expect(
        typeof (Cap as unknown as { prototype: Record<string, unknown> }).prototype
          .getMasterNodeId,
        `${Cap.name} 应声明 getMasterNodeId`,
      ).toBe("function");
    }
  });

  it("6 个环境 cap 的 master id 集合完整且无重复（新 cap 加入环境面板须在此登记）", () => {
    const EXPECTED = [
      "sky-enabled",
      "ground-visible",
      "ground-water-enabled",
      "env-enabled",
      "fog-enabled",
      "reflector-enabled",
    ];
    expect(EXPECTED).toHaveLength(ENV_CAP_CLASSES.length);
    expect(new Set(EXPECTED).size).toBe(EXPECTED.length); // 无重复
    // 每个 id 均为字符串、非空——防 master id 空串/缺失
    for (const id of EXPECTED) {
      expect(id.trim().length, `master id「${id}」不应为空`).toBeGreaterThan(0);
    }
  });
});
