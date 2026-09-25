// ===== 环境菜单声明式 Schema 测试（2026 收口：行 + navigate 下钻，folder 手风琴退役）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEnvSchema, disposeEnvSubscriptions } from "./env.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import type { EnvPlacement, SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { resetEnvState, envState } from "@/preview-3d/state/env-state.ts";
import { ATMOSPHERE_PRESETS } from "@/preview-3d/state/atmosphere-presets.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import type { SlideMenuHandle } from "@/preview-3d/menu/shell/slide-menu.ts";
import { setSceneCapabilityLookup } from "@/preview-3d/state/preview-state.ts";
import { EnvironmentCapability } from "@/preview-3d/caps/environment-capability.ts";
import { FogCapability } from "@/preview-3d/caps/fog-capability.ts";
import { GroundCapability } from "@/preview-3d/caps/ground-capability.ts";
import { ReflectorCapability } from "@/preview-3d/caps/reflector-capability.ts";
import { findNodeById, nodeIds } from "@/preview-3d/menu/menu-test-helpers.ts";
import { SkyCapability } from "@/preview-3d/caps/sky-capability.ts";
import { WaterCapability } from "@/preview-3d/caps/water-capability.ts";
import { ENV_PRESETS } from "@/preview-3d/caps/environment-state.ts";
import type { LocaleKey } from "@/core/i18n/t.ts";

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

/** 6 环境 cap 的自报归属（ADR-268）：测试 fake cap 据此入选环境面板。
 *  不在表内的 id（如非环境 cap fake）getEnvPlacement 返回 undefined → 不入选。 */
const ENV_PLACE: Record<string, EnvPlacement> = {
  sky: { section: "basic", order: 10 },
  ground: { section: "basic", order: 20 },
  water: { section: "basic", order: 30 },
  environment: { section: "atmosphere", order: 10 },
  fog: { section: "atmosphere", order: 20 },
  reflector: { section: "atmosphere", order: 30 },
};

/** 测试用 cap 工厂：控件组可注入。默认按 id 自报环境归属（模拟真实 env cap），
 *  extra 可覆盖 getEnvPlacement（如伪造未知段 / 非环境 cap 排除）。 */
function makeCap(
  id: string,
  labelKey: LocaleKey,
  nodes: PreviewMenuNode[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    labelKey,
    icon: "sky" as const,
    descKey: "",
    getMenuNodes: () => nodes,
    getEnvPlacement: () => ENV_PLACE[id],
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

  it("产出 预设 select + 按 cap 自报 order/section 归段排序的 cap row，全部声明式", () => {
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
        labelKey: "preview.fogEnabled" as LocaleKey,
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
    // 卡壳层：sky 归「基础」、fog 归「氛围」（各 cap 自报 getEnvPlacement.section，env.ts 不指派）
    // 卡片成员（精确集合；order 排序不测）
    expect(schema.slice(1).map((n) => n.id).sort()).toEqual(["env-card-basic", "env-card-atmosphere"].sort());
    expect(schema.slice(1).every((n) => n.kind === "card")).toBe(true);
    expect(schema.slice(1).map((n) => n.labelKey)).toEqual([
      "preview.envSectionBasic",
      "preview.envSectionAtmosphere",
    ]);
    const rows = capRows(schema);
    // cap 行成员（精确集合）
    expect(rows.map((n) => n.id).sort()).toEqual(["env-cap-sky", "env-cap-fog"].sort());
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
        labelKey: "preview.water",
        children: [
          {
            id: "ground-water-enabled",
            kind: "toggle",
            labelKey: "preview.waterEnabled",
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
    // [暗线 A 收口] environment cap 实现 subscribe（真实 cap 已实现）；预设写入经 env cap 自 notify
    // 驱动面板刷新（rebuildEnvSubs 接 menu.refresh），不再由 applyPreset 直接调 menu.refresh。
    const envListeners = new Set<() => void>();
    const env = makeCap("environment", "preview.environment", [], {
      // 真实 cap 经 listenerSet 注册；此处捕获同一通知，验证「预设变更→env cap 自 notify」链路
      subscribe: (l: () => void) => {
        envListeners.add(l);
        return () => {
          envListeners.delete(l);
        };
      },
    });
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky, fog, env]);
    const menu = makeMenu();
    menusToDispose.add(menu);
    const preset = buildEnvSchema(makeCtx(), menu)[0]!;
    // [锐评 P0-2] 成员机检：快捷预设 select 的 id 集与 ENV_PRESETS 键集恒等（排序是
    // PRESET_ORDER 的 UI 手写选择，**成员**是契约）——环境面板 preset-thumb select 经
    // Object.keys(ENV_PRESETS) 派生会自动收录新预设，若此处不同步补 PRESET_ORDER 会
    // 出现「env 面板有、快捷 select 无」的双源漂移，本用例即红。
    expect(new Set((preset.control!.options ?? []).map((o) => o.value))).toEqual(
      new Set(Object.keys(ENV_PRESETS)),
    );
    // [暗线 A 收口] 面板构建即订阅 env cap（rebuildEnvSubs）：断言 env cap 被订阅且监听即接 menu.refresh，
    // 取代原 applyPreset 直接调 menu.refresh 的接线（真实 cap 经 listenerSet 自 notify 触发此监听）。
    expect(envListeners.size).toBe(1);
    expect(menu.refresh).not.toHaveBeenCalled();
    // 模拟 env cap 离散键 notify → 面板经此监听刷新
    for (const l of envListeners) l();
    expect(menu.refresh).toHaveBeenCalledTimes(1);

    preset.control!.set!("sunset");
    // ATMOSPHERE_PRESETS.sunset 完整快照落到 envState（不再逐 cap 调 setter）
    expect(envState.skyTimeOfDay).toBe(ATMOSPHERE_PRESETS.sunset.skyTimeOfDay); // 18
    expect(envState.fogEnabled).toBe(true);
    expect(envState.fogMode).toBe("linear");
    expect(envState.envPreset).toBe("sunset");
    expect(envState.envIntensity).toBeCloseTo(ATMOSPHERE_PRESETS.sunset.envIntensity! as number, 5);
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

  // [A 隐身 cap / 万物即插件] 环境成员改由 cap 自报 getEnvPlacement（ADR-268），env.ts 不再
  // 持有成员清单：① 凡自报归属者入选、未报者排除；② 卡内按自报 order 排序；③ 新增 env cap
  // 无需改 env.ts 即自动出现（本用例注入一个 env.ts 从未听说过的 "aurora"）。
  it("A：环境成员由 cap 自报 getEnvPlacement 发现（自报即入选、未报即排除、env.ts 零登记）", () => {
    const ids = ["sky", "ground", "water", "environment", "fog", "reflector"];
    // 一个 env.ts 硬编码清单里从未出现过的「新」环境 cap，仅靠自报归属入选
    const aurora = makeCap("aurora", "preview.aurora" as LocaleKey, [], {
      getEnvPlacement: () => ({ section: "basic", order: 15 }),
    });
    // 一个非环境 cap（light）：不实现归属声明 → 不得混入环境面板
    const light = makeCap("light", "preview.light" as LocaleKey, [], {
      getEnvPlacement: () => undefined,
    });
    const caps = [...ids.map((id) => makeCap(id, `preview.${id}` as LocaleKey, [])), aurora, light];
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue(caps.slice().reverse());
    const menu = makeMenu();
    menusToDispose.add(menu);
    const schema = buildEnvSchema(makeCtx(), menu);
    const rows = capRows(schema);
    // light 被排除；其余 7 个（含未登记的 aurora）全入选
    expect(rows.map((r) => r.id)).not.toContain("env-cap-light");
    // 基础卡按 order：sky10 < aurora15 < ground20 < water30；氛围卡：environment10<fog20<reflector30
    // cap 行成员（精确集合；order 排序不测）
    expect(rows.map((r) => r.id).sort()).toEqual([
      "env-cap-sky",
      "env-cap-aurora",
      "env-cap-ground",
      "env-cap-water",
      "env-cap-environment",
      "env-cap-fog",
      "env-cap-reflector",
    ].sort());
    // aurora 归入它自报的「基础」卡（分组亦由自报 section 决定，非 env.ts 指派）
    const basicCard = schema.find((n) => n.id === "env-card-basic")!;
    expect((basicCard.children ?? []).map((c) => c.id)).toContain("env-cap-aurora");
  });

  // [B 跨会话预设] 预设 select 回退缓存必须 per-mount 隔离：menu A 选中的快预设
  // 不得串到 menu B（多挂载/新会话共用模块时旧实现的模块级 _lastEnvPreset 会污染）。
  it("B：两个 menu 实例的预设 select 各自独立，切换不跨会话串味", () => {
    resetEnvState();
    const sky = makeCap("sky", "preview.sky", []);
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([sky]);
    // getById("environment") 在测试注册表未挂 environment cap → undefined，
    // select.get 走 per-menu 回退缓存路径，正是污染发生处
    const menuA = makeMenu();
    const menuB = makeMenu();
    menusToDispose.add(menuA);
    menusToDispose.add(menuB);
    const selA = buildEnvSchema(makeCtx(), menuA)[0]!;
    const selB = buildEnvSchema(makeCtx(), menuB)[0]!;
    expect(selA.control!.get!(undefined)).toBe("studio");
    expect(selB.control!.get!(undefined)).toBe("studio");
    // A 切到 sunset
    selA.control!.set!("sunset");
    // A 反映自身选择；B 不受 A 污染
    expect(selA.control!.get!(undefined)).toBe("sunset");
    expect(selB.control!.get!(undefined)).toBe("studio");
    // 卸载 A：其 per-menu 缓存随之清除，重建同 menu 回默认（不残留 sunset）
    disposeEnvSubscriptions(menuA);
    const selA2 = buildEnvSchema(makeCtx(), menuA)[0]!;
    expect(selA2.control!.get!(undefined)).toBe("studio");
  });
});

// ===== 守护测试（用户关切：隐式契约不可靠）=====
// 环境面板（🌍）一级行依赖 cap 两处自报契约：getMasterNodeId()（升 headerToggle，漏则
// 行首默默无开关）与 getEnvPlacement()（入选环境面板 + 归哪张卡，漏则整个 cap 不显）。
// 二者皆「漏声明即静默消失」型回归，本守护遍历 6 个环境 cap 生产类 prototype，把漏实现
// 从静默变成编译/测试期红。
describe("守护：环境面板 6 cap 必须声明 getMasterNodeId + getEnvPlacement", () => {
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

  it("每个环境 cap 的 prototype 都声明 getEnvPlacement（防漏声明→整个 cap 从环境面板隐身）", () => {
    for (const Cap of ENV_CAP_CLASSES) {
      expect(
        typeof (Cap as unknown as { prototype: Record<string, unknown> }).prototype
          .getEnvPlacement,
        `${Cap.name} 应声明 getEnvPlacement`,
      ).toBe("function");
    }
  });

  it("6 cap 的 getEnvPlacement 自报分段/序与既定分组一致（basic=天/地/水，atmosphere=环境/雾/反射）", () => {
    // getEnvPlacement 实现为纯字面量（不引用 this），故可脱实例 .call({}) 求值
    const read = (Cap: (typeof ENV_CAP_CLASSES)[number]) =>
      (
        Cap as unknown as {
          prototype: { getEnvPlacement(this: unknown): EnvPlacement };
        }
      ).prototype.getEnvPlacement.call({});
    const expectSection: Record<string, string> = {
      SkyCapability: "basic",
      GroundCapability: "basic",
      WaterCapability: "basic",
      EnvironmentCapability: "atmosphere",
      FogCapability: "atmosphere",
      ReflectorCapability: "atmosphere",
    };
    const orders = new Map<string, number>();
    for (const Cap of ENV_CAP_CLASSES) {
      const p = read(Cap);
      expect(p.section, `${Cap.name}.section`).toBe(expectSection[Cap.name]);
      expect(Number.isFinite(p.order), `${Cap.name}.order 应为有限数`).toBe(true);
      orders.set(Cap.name, p.order);
    }
    // 段内序两两不同（保证面板顺序确定，不依赖注册序）
    const basic = ENV_CAP_CLASSES.filter((C) => expectSection[C.name] === "basic");
    expect(new Set(basic.map((C) => orders.get(C.name))).size).toBe(basic.length);
    const atmo = ENV_CAP_CLASSES.filter((C) => expectSection[C.name] === "atmosphere");
    expect(new Set(atmo.map((C) => orders.get(C.name))).size).toBe(atmo.length);
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
