// ===== 环境菜单声明式 Schema 测试（对齐 MikuMikuAR getSkySchema() 范式）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderEnvLevel, buildEnvSchema } from "./env.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import type { PreviewMenuCtx } from "./core.ts";
import type { CameraControlBridge } from "../adapters/camera-controls.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";

/** 构造最小 PreviewMenuCtx（测试用） */
function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () => ({ mode: "orbit" as const, setMode: vi.fn(), reset: vi.fn() }) as unknown as CameraControlBridge,
    getSiblings: () => [],
    getCurrentPath: () => "",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    ...overrides,
  } as PreviewMenuCtx;
}

/** 构造 fake SlideMenuHandle */
function makeMenu(): SlideMenuHandle {
  const views: Array<{ title: string; render: (list: HTMLElement) => void }> = [];
  return {
    root: document.createElement("div"),
    list: document.createElement("div"),
    setTitle: vi.fn(),
    setOnClose: vi.fn(),
    home: vi.fn(),
    navigate: vi.fn((v) => views.push(v)),
    back: vi.fn(),
    refresh: vi.fn(),
    isShowing: vi.fn(),
    reset: vi.fn(),
    isAtRoot: () => true,
    dispose: vi.fn(),
  } as unknown as SlideMenuHandle;
}

/** 测试用 sky cap 共享工厂：两处 fakeSkyCap 构造重复 → 抽公共函数（修复 jscpd 自重复） */
function makeFakeSkyCap(controls?: ReturnType<NonNullable<SceneCapability["getMenuControls"]>>) {
  return {
    id: "sky",
    labelKey: "preview.sky",
    icon: "🌤️",
    descKey: "",
    getMenuControls: () => controls ?? [
      { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
    ],
    apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
  };
}

describe("renderEnvLevel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    
  });

  it("无 menu 句柄时走平铺路径（renderCapControls）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = makeFakeSkyCap();
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as unknown as SceneCapability) : null) });
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, undefined);
    // 平铺路径：应有 cap-sky-toggle 控件行
    expect(list.querySelector('[data-testid="cap-sky-toggle"]')).not.toBeNull();
  });

  it("有 menu 句柄时渲染预设栏 + cap 摘要行", () => {
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as unknown as SceneCapability) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    // 预设按钮存在
    expect(list.querySelector('[data-testid="env-preset-studio"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="env-preset-sunset"]')).not.toBeNull();
    // cap 摘要行存在
    expect(list.querySelector('[data-testid="cap-row-sky"]')).not.toBeNull();
  });

  it("cap 摘要行有 › 时点击触发 menu.navigate", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as unknown as SceneCapability) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-sky"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.cursor).toBe("pointer");
    expect(row.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    row.click();
    expect(menu.navigate).toHaveBeenCalled();
  });

  it("带 group 分区的 cap 子视图列出平级分区入口，水面独立下钻（方案 A）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeGroundCap = {
      id: "ground",
      labelKey: "preview.ground",
      icon: "🌐",
      descKey: "",
      getMenuControls: () => [
        { id: "ground-visible", kind: "toggle", labelKey: "preview.ground", fallback: "地面", getValue: () => true, setValue: () => {} },
        { id: "ground-water-enabled", kind: "toggle", labelKey: "preview.groundWaterEnabled", fallback: "水面", group: "preview.groundGroupWater", getValue: () => true, setValue: () => {} },
        { id: "ground-water-mode", kind: "select", labelKey: "preview.groundWaterMode", fallback: "形态", group: "preview.groundGroupWater", select: [{ value: "film", label: "薄膜" }], getValue: () => "film", setValue: () => {} },
        { id: "ground-mat-source", kind: "select", labelKey: "preview.groundMatSource", fallback: "材质", group: "preview.groundGroupMaterial", select: [{ value: "none", label: "无" }], getValue: () => "none", setValue: () => {} },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "ground" ? (fakeGroundCap as unknown as SceneCapability) : null) });
    // 自定义 menu：navigate 立即把 view.render 落到 subList，便于断言子视图 DOM
    const subList = document.createElement("div");
    let lastTitle = "";
    const menu = {
      ...makeMenu(),
      navigate: vi.fn((v: { title: string; render: (l: HTMLElement) => void }) => { lastTitle = v.title; v.render(subList); }),
    } as unknown as SlideMenuHandle;

    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-ground"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();

    // 子视图应列出分区入口（剔除根行主控件「地面」显隐后，base 空组不再渲染；仅余 水面 / 表面材质）
    expect(subList.querySelector('[data-testid="cap-group-entry-base"]')).toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupWater"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupMaterial"]')).not.toBeNull();
    expect(lastTitle).toBe("地面");

    // 点「水面」入口 → 二级子视图仅含水面控件，且不再包同名 section
    const waterEntry = subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupWater"]') as HTMLElement;
    waterEntry.click();
    expect(subList.querySelector('[data-testid="cap-ground-water-enabled"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-ground-water-mode"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-ground-visible"]')).toBeNull();
    expect(lastTitle).toBe("水面");
  });

  it("预设按钮点击调用 applyPreset（通过 menu.refresh）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = makeFakeSkyCap([]); // 空控件列表
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as unknown as SceneCapability) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const btn = list.querySelector('[data-testid="env-preset-studio"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(menu.refresh).toHaveBeenCalled();
  });

  it("cap 模式切换经 subscribe 触发 refresh，子视图重算后新分组出现（修复泳池/材质打不开）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    let mode: "film" | "pool" = "film";
    const listeners = new Set<() => void>();
    const fakeWaterCap = {
      id: "water",
      labelKey: "preview.water",
      icon: "💧",
      descKey: "",
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
      getMenuControls: () => [
        { id: "water-enabled", kind: "toggle", labelKey: "preview.groundWaterEnabled", fallback: "水面", getValue: () => true, setValue: () => {} },
        { id: "water-mode", kind: "select", labelKey: "preview.groundWaterMode", fallback: "形态", group: "preview.waterGroupForm", select: [{ value: "film", label: "薄膜" }, { value: "pool", label: "水池" }], getValue: () => mode, setValue: (v: string) => { mode = v as "film" | "pool"; listeners.forEach((l) => l()); } },
        { id: "water-pool-height", kind: "slider", labelKey: "preview.groundPoolHeight", fallback: "水池高度", group: "preview.waterGroupPool", slider: { min: 0.01, max: 5, step: 0.05 }, getValue: () => 1, setValue: () => {}, visible: () => mode === "pool" },
        { id: "water-wetness", kind: "slider", labelKey: "preview.waterFilmDensity", fallback: "浓度", group: "preview.waterGroupLook", slider: { min: 0, max: 1, step: 0.05 }, getValue: () => 0.5, setValue: () => {}, visible: () => mode === "film" },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "water" ? (fakeWaterCap as unknown as SceneCapability) : null) });
    const subList = document.createElement("div");
    let lastView: { title: string; render: (l: HTMLElement) => void } | null = null;
    const nav = (v: { title: string; render: (l: HTMLElement) => void }): void => {
      lastView = v; v.render(subList);
    };
    const menu = {
      ...makeMenu(),
      navigate: vi.fn(nav),
      refresh: vi.fn(() => { if (lastView) lastView.render(subList); }),
    } as unknown as SlideMenuHandle;

    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-water"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click(); // 进入水面子视图（mode=film）

    // 初始 film：水池分组条目不存在，浓度（film 专属）存在
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupPool"]')).toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupLook"]')).not.toBeNull();

    // 切到 pool（模拟用户选「水池」→ setValue 触发 listeners）
    const modeCtrl = fakeWaterCap.getMenuControls().find((c) => c.id === "water-mode")!;
    modeCtrl.setValue("pool");

    // 订阅回调应已触发 refresh，且重算后水池分组出现、浓度组消失
    expect(menu.refresh).toHaveBeenCalled();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupPool"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupLook"]')).toBeNull();

    // 点进「水池」条目 → 含水池高度控件（此前「打不开」的根因已修复）
    const poolEntry = subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupPool"]') as HTMLElement;
    poolEntry.click();
    expect(subList.querySelector('[data-testid="cap-water-pool-height"]')).not.toBeNull();
  });

  it("探针 P5-c：water 控件走 visibleWhen(s) 状态层谓词，切模式后 film 专属控件显隐（B 轨替代 A 轨）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    let mode: "film" | "pool" = "film";
    const listeners = new Set<() => void>();
    const fakeWaterCap = {
      id: "water",
      labelKey: "preview.water",
      icon: "💧",
      descKey: "",
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
      getWaterMode: () => mode,
      setWaterMode: (v: string) => { mode = v as "film" | "pool"; listeners.forEach((l) => l()); },
      getMenuControls: () => [
        { id: "water-enabled", kind: "toggle", labelKey: "preview.groundWaterEnabled", fallback: "水面", getValue: () => true, setValue: () => {} },
        { id: "water-mode", kind: "select", labelKey: "preview.groundWaterMode", fallback: "形态", group: "preview.waterGroupForm", select: [{ value: "film", label: "薄膜" }, { value: "pool", label: "水池" }], getValue: () => mode, setValue: (v: string) => { mode = v as "film" | "pool"; listeners.forEach((l) => l()); } },
        { id: "water-wetness", kind: "slider", labelKey: "preview.waterFilmDensity", fallback: "浓度", group: "preview.waterGroupLook", slider: { min: 0, max: 1, step: 0.05 }, getValue: () => 0.5, setValue: () => {}, visibleWhen: (s: any) => s["env.waterMode"] === "film" },
        { id: "water-pool-height", kind: "slider", labelKey: "preview.groundPoolHeight", fallback: "水池高度", group: "preview.waterGroupPool", slider: { min: 0.01, max: 5, step: 0.05 }, getValue: () => 1, setValue: () => {}, visibleWhen: (s: any) => s["env.waterMode"] === "pool" },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    // 注册到 registry，让 previewSnapshot() 经 env.waterMode binding 拿到 mode（状态层上浮）
    vi.spyOn(sceneCapabilityRegistry, "getById").mockImplementation((id: string) => (id === "water" ? (fakeWaterCap as unknown as SceneCapability) : undefined));
    const ctx = makeCtx({ getCap: (id) => (id === "water" ? (fakeWaterCap as unknown as SceneCapability) : null) });
    const subList = document.createElement("div");
    let lastView: { title: string; render: (l: HTMLElement) => void } | null = null;
    const nav = (v: { title: string; render: (l: HTMLElement) => void }): void => { lastView = v; v.render(subList); };
    const menu = {
      ...makeMenu(),
      navigate: vi.fn(nav),
      refresh: vi.fn(() => { if (lastView) lastView.render(subList); }),
    } as unknown as SlideMenuHandle;

    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);
    const row = list.querySelector('[data-testid="cap-row-water"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click(); // 进入水面子视图（mode=film）

    // 初始 film：浓度（Look 组，film 专属，visibleWhen 判定显示）存在，水池（Pool 组）不存在
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupLook"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupPool"]')).toBeNull();

    // 切到 pool（模拟用户选「水池」→ setValue 触发 listeners → 状态层快照更新 + 订阅刷新）
    fakeWaterCap.getMenuControls().find((c) => c.id === "water-mode")!.setValue("pool");

    expect(menu.refresh).toHaveBeenCalled();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupPool"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.waterGroupLook"]')).toBeNull();
  });
});

describe("buildEnvSchema（ADR-126 P5 声明式上岸）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("无 cap 时返回空态单节点，renderCustom 内部走 renderEnvLevel 平铺路径", () => {
    const ctx = makeCtx();
    const schema = buildEnvSchema(ctx);
    expect(schema.length).toBe(1);
    expect(schema[0].id).toBe("environment");
    expect(schema[0].kind).toBe("custom");
    expect(schema[0].labelKey).toBe("preview.environment");
    // renderCustom 调 renderEnvLevel（无 menu → 平铺路径）→ 应渲染空态提示
    const list = document.createElement("div");
    schema[0].renderCustom!(list);
    expect(list.textContent).toContain("进入 3D 后再打开环境面板");
  });

  it("有 menu 时返回单 custom 节点，renderCustom 触发 renderEnvLevel 两级菜单路径", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = makeFakeSkyCap();
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as unknown as SceneCapability) : null) });
    const menu = makeMenu();
    const schema = buildEnvSchema(ctx, menu);
    expect(schema.length).toBe(1);
    const list = document.createElement("div");
    schema[0].renderCustom!(list);
    // 两级菜单路径：应渲染预设栏 + cap 摘要行
    expect(list.querySelector('[data-testid="env-preset-studio"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="cap-row-sky"]')).not.toBeNull();
  });
});
